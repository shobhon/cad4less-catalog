/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require("fs");
const path = require("path");
const { DynamoDBClient, PutItemCommand } = require("@aws-sdk/client-dynamodb");

const REGION = process.env.AWS_REGION || "us-west-1";
const TABLE_NAME = process.env.PARTS_TABLE_NAME || "Cad4LessPartsLive";

const ddb = new DynamoDBClient({ region: REGION });

function log(...args) {
  console.log("[local-import-from-file]", ...args);
}

/**
 * Try to normalize any Apify-ish JSON into an array of “product-like” objects.
 *  - If top-level is already an array, return it.
 *  - If top-level is object, look for array properties (.items, .data, .datasetItems),
 *    or otherwise the first array whose elements look like products (have .name, .url, or .specifications).
 */
function normalizeApifyJson(rawJson) {
  if (Array.isArray(rawJson)) {
    return rawJson;
  }

  if (!rawJson || typeof rawJson !== "object") {
    throw new Error("Unexpected JSON format: top-level is not array or object");
  }

  // Common patterns: { items: [...] }, { data: [...] }, { datasetItems: [...] }
  const knownKeys = ["items", "data", "datasetItems", "results"];
  for (const key of knownKeys) {
    if (Array.isArray(rawJson[key])) {
      return rawJson[key];
    }
  }

  // Generic fallback: find the first array-valued property where elements look like products.
  const candidateArrays = Object.entries(rawJson)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => ({ key, value }));

  for (const { key, value } of candidateArrays) {
    const first = value[0];
    if (first && typeof first === "object") {
      if (
        "name" in first ||
        "url" in first ||
        "specifications" in first ||
        "category" in first
      ) {
        log(
          `Using nested array at key "${key}" as normalized product list (len=${value.length})`,
        );
        return value;
      }
    }
  }

  // If we get here, we couldn't find a good array
  if (rawJson.error) {
    throw new Error(
      `Unexpected JSON format and Apify error present: ${JSON.stringify(
        rawJson.error,
      )}`,
    );
  }

  throw new Error(
    "Unexpected JSON format: top-level is object and no suitable array property (.items/.data/.datasetItems/...) found",
  );
}

/**
 * Map a raw Apify product/item object into the internal Part shape we write to Dynamo.
 * We keep this tolerant so it works for both CPU and motherboard items.
 */
function mapRawItemToPart(raw, category) {
  const id =
    raw.id ||
    raw.partId ||
    raw.slug ||
    raw.sku ||
    raw.url ||
    `item-${Math.random().toString(36).slice(2, 10)}`;

  const name = raw.name || raw.title || "Unknown part";

  const specs = raw.specifications || raw.specs || {};
  const vendor =
    raw.vendor ||
    raw.storeName ||
    (raw.source && String(raw.source).toLowerCase()) ||
    "pcpartpicker";

  // Try to obtain a price from the most likely fields
  let price = null;
  if (typeof raw.price === "number") {
    price = raw.price;
  } else if (typeof raw.price === "string") {
    const m = raw.price.replace(/[^0-9.]/g, "");
    if (m) {
      const n = Number.parseFloat(m);
      if (Number.isFinite(n)) price = n;
    }
  } else if (Array.isArray(raw.offers) && raw.offers.length > 0) {
    const offerWithPrice = raw.offers.find(
      (o) => o && typeof o.price === "number",
    );
    if (offerWithPrice) price = offerWithPrice.price;
  }

  const vendorList = [];
  if (Array.isArray(raw.offers)) {
    for (const o of raw.offers) {
      if (!o) continue;
      vendorList.push({
        vendor: o.vendor || o.storeName || "unknown",
        price:
          typeof o.price === "number"
            ? o.price
            : o.price
            ? Number.parseFloat(String(o.price).replace(/[^0-9.]/g, "")) ||
              null
            : null,
        availability:
          (o.availability || o.status || "").toString().toLowerCase() ||
          "unknown",
        buyLink: o.url || o.buyUrl || o.link || null,
        image: o.image || raw.image || raw.imageUrl || null,
        currency: o.currency || "USD",
      });
    }
  }

  // Fallback single vendor entry if no offers array
  if (vendorList.length === 0) {
    vendorList.push({
      vendor,
      price,
      availability: (raw.availability || raw.status || "unknown").toString(),
      buyLink: raw.url || null,
      image: raw.image || raw.imageUrl || null,
      currency: raw.currency || "USD",
    });
  }

  // Availability: be generous – consider truthy "in stock" / "available" strings
  const availabilityRaw =
    raw.availability ||
    raw.status ||
    (specs && specs["Availability"]) ||
    "unknown";
  const availability = String(availabilityRaw).toLowerCase().includes("stock")
    ? "In stock"
    : String(availabilityRaw || "unknown");

  return {
    id: String(id),
    name: String(name),
    category: String(category).toLowerCase(),
    vendor,
    price,
    image: raw.image || raw.imageUrl || "https://example.com/images/placeholder.png",
    availability,
    specs,
    vendorList,
  };
}

async function putPart(part) {
  const item = {
    id: { S: part.id },
    name: { S: part.name },
    category: { S: part.category },
    vendor: { S: part.vendor },
    availability: { S: part.availability || "unknown" },
    // nullable numeric
    ...(typeof part.price === "number" && {
      price: { N: part.price.toString() },
    }),
    image: { S: part.image || "" },
    specs: { S: JSON.stringify(part.specs || {}) },
    vendorList: { S: JSON.stringify(part.vendorList || []) },
  };

  const cmd = new PutItemCommand({
    TableName: TABLE_NAME,
    Item: item,
  });

  await ddb.send(cmd);
}

async function main() {
  const [, , filePath, categoryArg] = process.argv;

  if (!filePath || !categoryArg) {
    console.error(
      "Usage: node local-import-from-file.js <json-file> <category>",
    );
    process.exit(1);
  }

  const category = String(categoryArg).toLowerCase();
  const abs = path.resolve(filePath);
  log(`Reading Apify data from: ${abs}`);
  log(
    `Region=${REGION}, Table=${TABLE_NAME}, Category=${category}`,
  );

  const rawText = fs.readFileSync(abs, "utf8");
  const parsed = JSON.parse(rawText);

  const items = normalizeApifyJson(parsed);

  if (!Array.isArray(items) || items.length === 0) {
    log("No items found after normalization; nothing to import.");
    return;
  }

  log(`Normalized items array length: ${items.length}`);

  let inserted = 0;
  for (const raw of items) {
    try {
      const part = mapRawItemToPart(raw, category);
      if (!part.id || !part.name) {
        log("Skipping item without id/name:", raw);
        continue;
      }

      // Skip obvious test / verification rows
      if (
        /verification/i.test(part.name) &&
        !part.specs["Chipset"] &&
        !part.specs["CPU Socket"] &&
        !part.specs["CPU Socket Type"]
      ) {
        log(`Skipping verification placeholder: ${part.id} - ${part.name}`);
        continue;
      }

      await putPart(part);
      inserted += 1;
      log(`Inserted ${part.id} - ${part.name}`);
    } catch (err) {
      console.error("Failed to import item:", err);
    }
  }

  log(
    `Import from file completed. Total items=${items.length}, inserted=${inserted}.`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal error in local-import-from-file:", err);
    process.exit(1);
  });
}