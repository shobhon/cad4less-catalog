const axios = require("axios");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
} = require("@aws-sdk/lib-dynamodb");

const REGION = process.env.AWS_REGION || "us-west-1";
const TABLE_NAME = process.env.PARTS_TABLE_NAME || "Cad4LessPartsLive";
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const ACTOR_ID = "matyascimbulka~pcpartpicker-scraper";

if (!APIFY_TOKEN) {
  console.error("APIFY_TOKEN env var is not set");
  process.exit(1);
}

const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: REGION })
);

function mapApifyItemToPart(category, raw) {
  const id = raw.id || raw.url || raw.name;
  if (!id) return null;

  const image =
    raw.imageUrl || raw.image || "https://example.com/images/placeholder.png";

  let lowestPrice = null;
  let primaryVendor = "pcpartpicker";
  let vendorList = [];

  if (raw.prices && typeof raw.prices === "object") {
    if (typeof raw.prices.lowestPrice === "number") {
      lowestPrice = raw.prices.lowestPrice;
    }
    if (Array.isArray(raw.prices.prices)) {
      vendorList = raw.prices.prices.map((p) => ({
        vendor: p.merchant || p.merchantName || p.store || "pcpartpicker",
        price: typeof p.price === "number" ? p.price : null,
        availability: p.availability || "unknown",
        image,
        buyLink: p.buyLink || null,
        currency: p.currency || null,
      }));
      if (vendorList.length > 0) {
        primaryVendor = vendorList[0].vendor;
        if (lowestPrice == null && typeof vendorList[0].price === "number") {
          lowestPrice = vendorList[0].price;
        }
      }
    }
  }

  const specsSource = raw.specifications || raw.specification || {};

  const socket =
    specsSource.Socket ||
    specsSource["CPU Socket"] ||
    specsSource["Socket"] ||
    null;

  const chipset =
    specsSource["Chipset"] ||
    specsSource["Motherboard Chipset"] ||
    null;

  const formFactor =
    specsSource["Form Factor"] ||
    specsSource["Motherboard Form Factor"] ||
    null;

  const cores =
    specsSource.Cores ||
    specsSource["Core Count"] ||
    specsSource["CPU Cores"] ||
    null;

  const threads =
    specsSource.Threads ||
    specsSource["Thread Count"] ||
    specsSource["CPU Threads"] ||
    null;

  const tdp = specsSource.TDP || specsSource["TDP"] || null;

  const specs = { socket, chipset, formFactor, cores, threads, tdp };

  if (vendorList.length === 0) {
    vendorList = [
      {
        vendor: primaryVendor,
        price: lowestPrice,
        availability: "unknown",
        image,
        buyLink: raw.url || null,
        currency: null,
      },
    ];
  }

  return {
    id: String(id),
    category,
    name: raw.name || "Unknown part",
    vendor: primaryVendor,
    price: lowestPrice,
    availability: vendorList[0].availability,
    image,
    specs,
    vendorList,
  };
}

async function saveItemsToDynamo(tableName, category, items) {
  let inserted = 0;
  for (const raw of items) {
    const part = mapApifyItemToPart(category, raw);
    if (!part) continue;
    try {
      await ddb.send(new PutCommand({ TableName: tableName, Item: part }));
      inserted++;
    } catch (err) {
      console.error("Failed to insert item", {
        id: part.id,
        name: part.name,
        err: err.message,
      });
    }
  }
  return inserted;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runApifyActorSync(category, maxItems, searchPhrases) {
  const url = `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${encodeURIComponent(
    APIFY_TOKEN
  )}`;

  const input = {
    category,
    maxProducts: maxItems,
    maxReviews: 0,
    countryCode: "us",
  };

  if (Array.isArray(searchPhrases) && searchPhrases.length > 0) {
    input.searchPhrases = searchPhrases;
  }

  console.log("[runApifyActorSync] Calling Apify actor", url, "with input:", input);

  const resp = await axios.post(url, input, {
    headers: { "Content-Type": "application/json" },
    timeout: 60000,
  });

  if (!Array.isArray(resp.data)) {
    console.error("[runApifyActorSync] Unexpected Apify response:", resp.data);
    throw new Error("Apify response is not an array");
  }

  console.log(`[runApifyActorSync] Apify returned ${resp.data.length} items`);
  return resp.data;
}

async function runApifyActorAsync(category, maxItems, searchPhrases) {
  const startUrl = `https://api.apify.com/v2/acts/${ACTOR_ID}/runs?token=${encodeURIComponent(
    APIFY_TOKEN
  )}`;

  const input = {
    category,
    maxProducts: maxItems,
    maxReviews: 0,
    countryCode: "us",
  };

  if (Array.isArray(searchPhrases) && searchPhrases.length > 0) {
    input.searchPhrases = searchPhrases;
  }

  console.log("[runApifyActorAsync] Starting Apify run", startUrl, "with input:", input);

  const startResp = await axios.post(startUrl, input, {
    headers: { "Content-Type": "application/json" },
    timeout: 15000,
  });

  const startData =
    (startResp.data && startResp.data.data) || startResp.data || {};
  const runId = startData.id;
  const datasetId = startData.defaultDatasetId;

  if (!runId || !datasetId) {
    console.error("[runApifyActorAsync] Unexpected start response:", startResp.data);
    throw new Error("Apify start run response missing id/defaultDatasetId");
  }

  console.log(
    `[runApifyActorAsync] Apify run started: runId=${runId}, datasetId=${datasetId}`
  );

  const statusUrl = `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(
    APIFY_TOKEN
  )}`;

  const maxWaitMs = 10 * 60 * 1000; // 10 minutes
  const pollIntervalMs = 10000;
  const startTime = Date.now();

  while (true) {
    const statusResp = await axios.get(statusUrl, { timeout: 15000 });
    const statusData =
      (statusResp.data && statusResp.data.data) || statusResp.data || {};
    const status = statusData.status;

    console.log(`[runApifyActorAsync] Current status: ${status}`);

    if (status === "SUCCEEDED") {
      break;
    }

    if (["FAILED", "TIMED_OUT", "ABORTED"].includes(status)) {
      throw new Error(`Apify run ended with status ${status}`);
    }

    if (Date.now() - startTime > maxWaitMs) {
      throw new Error(`Apify run polling exceeded ${maxWaitMs}ms`);
    }

    await sleep(pollIntervalMs);
  }

  const itemsUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(
    APIFY_TOKEN
  )}&clean=true&format=json`;

  console.log("[runApifyActorAsync] Fetching dataset items from", itemsUrl);

  const itemsResp = await axios.get(itemsUrl, { timeout: 60000 });

  if (!Array.isArray(itemsResp.data)) {
    console.error("[runApifyActorAsync] Unexpected items response:", itemsResp.data);
    throw new Error("Apify dataset items response is not an array");
  }

  const items = itemsResp.data;
  console.log(`[runApifyActorAsync] Apify returned ${items.length} items`);
  return items.slice(0, maxItems);
}

async function main() {
  const category = (process.argv[2] || "cpu").toLowerCase();
  const max = parseInt(process.argv[3] || "10", 10) || 10;
  const search = process.argv[4] || "ryzen 5";

  const searchPhrases = [search];

  console.log(
    `Starting local import: category=${category}, max=${max}, search=${search}`
  );
  console.log(
    `Region=${REGION}, Table=${TABLE_NAME}, Actor=${ACTOR_ID}`
  );

  const useAsync = category === "motherboard";

  const rawItems = useAsync
    ? await runApifyActorAsync(category, max, searchPhrases)
    : await runApifyActorSync(category, max, searchPhrases);

  const inserted = await saveItemsToDynamo(TABLE_NAME, category, rawItems);

  console.log(
    `Import completed. Received ${rawItems.length} items, inserted ${inserted}.`
  );
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
