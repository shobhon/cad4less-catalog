const axios = require("axios");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const APIFY_BASE_URL = "https://api.apify.com/v2";
const APIFY_HTTP_TIMEOUT_MS = 8000; // per-call timeout, not total run time

function getApifyToken() {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error("APIFY_TOKEN env var is not set");
  }
  return token;
}

/**
 * Start Apify Pcpartpicker actor asynchronously (returns a run, does NOT wait for the dataset).
 */
async function startApifyRun(category, maxItems, searchPhrases) {
  const token = getApifyToken();

  const url = `${APIFY_BASE_URL}/acts/matyascimbulka~pcpartpicker-scraper/runs?token=${encodeURIComponent(
    token
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

  console.log("Starting Apify run", { url, input });

  let resp;
  try {
    resp = await axios.post(url, input, {
      headers: { "Content-Type": "application/json" },
      timeout: APIFY_HTTP_TIMEOUT_MS,
    });
  } catch (err) {
    console.error("Apify start run failed", {
      message: err.message,
      code: err.code,
      name: err.name,
      isAxiosError: !!err.isAxiosError,
      status: err.response && err.response.status,
      dataPreview:
        err.response && err.response.data
          ? JSON.stringify(err.response.data).slice(0, 500)
          : undefined,
    });

    if (err.code === "ECONNABORTED") {
      const e = new Error(
        `Apify start-run request exceeded ${APIFY_HTTP_TIMEOUT_MS}ms timeout`
      );
      e.cause = err;
      throw e;
    }

    throw err;
  }

  console.log("Apify start-run HTTP status:", resp.status);

  const data = resp.data;
  if (!data || !data.data || !data.data.id) {
    console.error("Unexpected Apify start-run response", data);
    throw new Error("Unexpected Apify start-run response, missing data.id");
  }

  const run = data.data;
  console.log("Apify run started", {
    id: run.id,
    status: run.status,
    defaultDatasetId: run.defaultDatasetId,
  });

  return run; // { id, status, defaultDatasetId, ... }
}

/**
 * Get Apify run status by runId.
 */
async function getApifyRun(runId) {
  const token = getApifyToken();
  const url = `${APIFY_BASE_URL}/actor-runs/${encodeURIComponent(
    runId
  )}?token=${encodeURIComponent(token)}`;

  console.log("Checking Apify run status", { url, runId });

  const resp = await axios.get(url, {
    timeout: APIFY_HTTP_TIMEOUT_MS,
  });

  if (!resp.data || !resp.data.data) {
    console.error("Unexpected getApifyRun response", resp.data);
    throw new Error("Unexpected getApifyRun response, missing data");
  }

  const run = resp.data.data;
  console.log("Apify run status", {
    id: run.id,
    status: run.status,
    defaultDatasetId: run.defaultDatasetId,
  });

  return run;
}

/**
 * Fetch dataset items once the run has finished.
 */
async function fetchApifyItems(datasetId, limit) {
  const token = getApifyToken();
  const url = `${APIFY_BASE_URL}/datasets/${encodeURIComponent(
    datasetId
  )}/items?token=${encodeURIComponent(
    token
  )}&clean=true&limit=${encodeURIComponent(limit)}`;

  console.log("Fetching Apify dataset items", { url, limit });

  const resp = await axios.get(url, {
    timeout: APIFY_HTTP_TIMEOUT_MS,
  });

  const data = resp.data;

  try {
    if (Array.isArray(data)) {
      console.log(
        "Dataset items sample:",
        JSON.stringify(data[0]).slice(0, 800)
      );
    } else {
      console.log(
        "Dataset non-array response:",
        JSON.stringify(data).slice(0, 800)
      );
    }
  } catch (e) {
    console.warn("Failed to log dataset preview", e);
  }

  if (!Array.isArray(data)) {
    throw new Error("Unexpected dataset items format, expected an array");
  }

  console.log(`Dataset returned ${data.length} items`);
  return data;
}

/**
 * Map Apify Pcpartpicker item into our Cad4Less part schema.
 */
function mapApifyItemToPart(category, raw) {
  const id = raw.id || raw.url || raw.name;
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
  const cores = specsSource.Cores || specsSource["Core Count"] || null;
  const threads = specsSource.Threads || specsSource["Thread Count"] || null;
  const tdp = specsSource.TDP || specsSource["TDP"] || null;
  const specs = { socket, cores, threads, tdp };

  if (!id) {
    console.warn("Skipping item without id", raw);
    return null;
  }

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

/**
 * Insert items into Dynamo.
 */
async function saveItemsToDynamo(tableName, category, items) {
  let inserted = 0;
  for (const raw of items) {
    try {
      const part = mapApifyItemToPart(category, raw);
      if (!part) {
        continue;
      }
      await ddb.send(new PutCommand({ TableName: tableName, Item: part }));
      inserted++;
    } catch (err) {
      console.error("Failed to insert item", { rawId: raw.id, err });
    }
  }
  return inserted;
}

async function countPartsInDynamo(tableName, category) {
  let total = 0;
  let lastEvaluatedKey;
  do {
    const resp = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "#cat = :c",
        ExpressionAttributeNames: { "#cat": "category" },
        ExpressionAttributeValues: { ":c": category },
        ProjectionExpression: "id",
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    total += resp.Count || 0;
    lastEvaluatedKey = resp.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return total;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

exports.handler = async (event) => {
  try {
    const tableName = process.env.PARTS_TABLE_NAME;
    if (!tableName) throw new Error("PARTS_TABLE_NAME env var is not set");

    const qs = event.queryStringParameters || {};
    const category = (qs.category || "cpu").toLowerCase();

    const maxParam = qs.max || "10";
    const max = Number.parseInt(maxParam, 10);
    const maxItems = Number.isFinite(max) && max > 0 ? Math.min(max, 50) : 10;

    const searchRaw = qs.search || "";
    let searchPhrases = searchRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (searchPhrases.length === 0 && category === "cpu") {
      searchPhrases = ["ryzen 5"];
    }

    const action = (qs.action || qs.mode || "").toLowerCase();

    // ---------- STATUS MODE: poll run + import when finished ----------
    if (action === "status") {
      const runId = qs.runId;
      if (!runId) {
        throw new Error("runId is required when action=status");
      }

      console.log(
        `Status check (no Apify call): category=${category}, max=${maxItems}, runId=${runId}`
      );

      const currentCount = await countPartsInDynamo(tableName, category);

      return {
        statusCode: 200,
        headers: JSON_HEADERS,
        body: JSON.stringify({
          message: "Status check completed (Apify status polling disabled)",
          category,
          runId,
          maxItems,
          currentCount,
        }),
      };
    }

    // ---------- START MODE: kick off a new Apify run and return quickly ----------
    console.log(
      `Starting async import: category=${category}, max=${maxItems}, searchPhrases=${JSON.stringify(
        searchPhrases
      )}`
    );

    const run = await startApifyRun(category, maxItems, searchPhrases);

    const pollUrlHint = `/parts/import?action=status&runId=${encodeURIComponent(
      run.id
    )}&category=${encodeURIComponent(category)}&max=${maxItems}`;

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        message: "Apify run started",
        category,
        runId: run.id,
        runStatus: run.status,
        pollUrlHint,
      }),
    };
  } catch (err) {
    console.error("Import error:", err);
    const payload = {
      message: "Import failed",
      error: err.message,
    };
    if (err.response && err.response.data) {
      payload.apifyResponse = err.response.data;
      payload.apifyStatus = err.response.status;
    }
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify(payload),
    };
  }
};