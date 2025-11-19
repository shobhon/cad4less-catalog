/* eslint-disable no-console */
/**
 * Seed curated Intel-compatible motherboards into DynamoDB parts table.
 *
 * Usage (from repo root):
 *   export AWS_REGION="us-west-1"
 *   export PARTS_TABLE_NAME="Cad4LessPartsLive"
 *   node backend/importParts/seed-motherboards.js
 */

const { DynamoDBClient, BatchWriteItemCommand } = require("@aws-sdk/client-dynamodb");

const REGION = process.env.AWS_REGION || "us-west-1";
const TABLE_NAME = process.env.PARTS_TABLE_NAME || "Cad4LessPartsLive";

if (!TABLE_NAME) {
  console.error("PARTS_TABLE_NAME env var is required");
  process.exit(1);
}

/**
 * NOTE: Prices are example numbers in USD.
 * All items are normalized to match the existing parts schema used by the app:
 *  - id, name, category, vendor, price, availability, image
 *  - specs (map)
 *  - vendorList (array of vendor offers)
 */
const motherboardSeeds = [
  // Socket: LGA1200 (Intel 10th/11th Gen)
  {
    id: "asus-rog-strix-z590-e-gaming-wifi",
    name: "ASUS ROG Strix Z590-E Gaming WiFi",
    category: "motherboard",
    vendor: "amazon",
    price: 329.99,
    availability: "In stock",
    image: "https://example.com/images/placeholder.png",
    specs: {
      "CPU Socket": "LGA1200",
      Chipset: "Z590",
      "Form Factor": "ATX",
    },
  },
  {
    id: "gigabyte-z490-aorus-pro-ax",
    name: "Gigabyte Z490 AORUS Pro AX",
    category: "motherboard",
    vendor: "amazon",
    price: 289.99,
    availability: "In stock",
    image: "https://example.com/images/placeholder.png",
    specs: {
      "CPU Socket": "LGA1200",
      Chipset: "Z490",
      "Form Factor": "ATX",
    },
  },
  {
    id: "msi-mag-b560m-mortar-wifi",
    name: "MSI MAG B560M Mortar WiFi",
    category: "motherboard",
    vendor: "amazon",
    price: 179.99,
    availability: "In stock",
    image: "https://example.com/images/placeholder.png",
    specs: {
      "CPU Socket": "LGA1200",
      Chipset: "B560",
      "Form Factor": "mATX",
    },
  },

  // Socket: LGA1151 (Intel 6th/7th/8th/9th Gen)
  {
    id: "asus-prime-z370-a",
    name: "ASUS Prime Z370-A",
    category: "motherboard",
    vendor: "amazon",
    price: 159.99,
    availability: "In stock",
    image: "https://example.com/images/placeholder.png",
    specs: {
      "CPU Socket": "LGA1151",
      Chipset: "Z370",
      "Form Factor": "ATX",
    },
  },
  {
    id: "msi-z370-gaming-pro-carbon",
    name: "MSI Z370 Gaming Pro Carbon",
    category: "motherboard",
    vendor: "amazon",
    price: 169.99,
    availability: "In stock",
    image: "https://example.com/images/placeholder.png",
    specs: {
      "CPU Socket": "LGA1151",
      Chipset: "Z370",
      "Form Factor": "ATX",
    },
  },
  {
    id: "gigabyte-b365m-ds3h",
    name: "Gigabyte B365M DS3H",
    category: "motherboard",
    vendor: "amazon",
    price: 129.99,
    availability: "In stock",
    image: "https://example.com/images/placeholder.png",
    specs: {
      "CPU Socket": "LGA1151",
      Chipset: "B365",
      "Form Factor": "mATX",
    },
  },

  // Socket: LGA1150 (Intel 4th/5th Gen)
  {
    id: "asus-z97-pro-gaming",
    name: "ASUS Z97-Pro Gaming",
    category: "motherboard",
    vendor: "amazon",
    price: 139.99,
    availability: "In stock",
    image: "https://example.com/images/placeholder.png",
    specs: {
      "CPU Socket": "LGA1150",
      Chipset: "Z97",
      "Form Factor": "ATX",
    },
  },
  {
    id: "gigabyte-ga-h97m-d3h",
    name: "Gigabyte GA-H97M-D3H",
    category: "motherboard",
    vendor: "amazon",
    price: 119.99,
    availability: "In stock",
    image: "https://example.com/images/placeholder.png",
    specs: {
      "CPU Socket": "LGA1150",
      Chipset: "H97",
      "Form Factor": "mATX",
    },
  },
  {
    id: "msi-z97-gaming-5",
    name: "MSI Z97 Gaming 5",
    category: "motherboard",
    vendor: "amazon",
    price: 129.99,
    availability: "In stock",
    image: "https://example.com/images/placeholder.png",
    specs: {
      "CPU Socket": "LGA1150",
      Chipset: "Z97",
      "Form Factor": "ATX",
    },
  },
];

/**
 * Convert a JS object into the DynamoDB item format used by Cad4LessPartsLive.
 */
function toDynamoItem(part) {
  const specsMap = {};
  if (part.specs) {
    for (const [key, value] of Object.entries(part.specs)) {
      specsMap[key] = { S: String(value) };
    }
  }

  const vendorList = [
    {
      M: {
        vendor: { S: part.vendor },
        price:
          typeof part.price === "number"
            ? { N: String(part.price) }
            : { NULL: true },
        availability: { S: part.availability || "unknown" },
        currency: { S: "$" },
        image: { S: part.image },
        buyLink: { S: "" },
      },
    },
  ];

  const item = {
    id: { S: part.id },
    name: { S: part.name },
    category: { S: part.category || "motherboard" },
    vendor: { S: part.vendor },
    availability: { S: part.availability || "unknown" },
    image: { S: part.image },
    vendorList: { L: vendorList },
    specs: { M: specsMap },
  };

  if (typeof part.price === "number") {
    item.price = { N: String(part.price) };
  }

  return item;
}

async function batchWriteAll(client, tableName, parts) {
  const BATCH_SIZE = 25;
  let written = 0;

  for (let i = 0; i < parts.length; i += BATCH_SIZE) {
    const slice = parts.slice(i, i + BATCH_SIZE);
    const requestItems = {};
    requestItems[tableName] = slice.map((p) => ({
      PutRequest: { Item: toDynamoItem(p) },
    }));

    const command = new BatchWriteItemCommand({
      RequestItems: requestItems,
    });

    console.log(
      `[seed-motherboards] Writing batch ${i / BATCH_SIZE + 1} (${slice.length} items)…`,
    );
    const resp = await client.send(command);

    if (resp.UnprocessedItems && Object.keys(resp.UnprocessedItems).length > 0) {
      console.warn(
        "[seed-motherboards] Warning: some items were unprocessed, retry logic not implemented in this simple seeder.",
      );
    }

    written += slice.length;
  }

  return written;
}

async function main() {
  console.log("[seed-motherboards] Region:", REGION);
  console.log("[seed-motherboards] Table:", TABLE_NAME);
  console.log(
    `[seed-motherboards] Seeding ${motherboardSeeds.length} curated motherboards…`,
  );

  const client = new DynamoDBClient({ region: REGION });

  try {
    const written = await batchWriteAll(client, TABLE_NAME, motherboardSeeds);
    console.log(`[seed-motherboards] Done. Wrote ${written} motherboard items.`);
  } catch (err) {
    console.error("[seed-motherboards] Fatal error:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  // Run only when executed directly with `node seed-motherboards.js`
  main();
}