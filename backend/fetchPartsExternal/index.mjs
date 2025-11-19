// index.mjs — Node.js 22.x + ESM + AWS SDK v3 + native fetch

import {
  DynamoDBClient,
  BatchWriteItemCommand
} from "@aws-sdk/client-dynamodb";
import { marshall } from "@aws-sdk/util-dynamodb";

const ddb = new DynamoDBClient({});

const PARTS_TABLE_NAME = process.env.PARTS_TABLE_NAME;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR_ID =
  process.env.APIFY_ACTOR_ID || "matyascimbulka/pcpartpicker-scraper";

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  };
}

export const handler = async (event) => {
  try {
    console.log("START FETCH");

    if (!APIFY_TOKEN) throw new Error("APIFY_TOKEN missing");
    if (!PARTS_TABLE_NAME) throw new Error("PARTS_TABLE_NAME missing");

    const qs = event.queryStringParameters || {};
    const category = qs.category;
    const searchPhrase = qs.searchPhrase || "";

    if (!category) {
      return response(400, { message: "category query parameter required" });
    }

    // 1. Start Apify actor run
    const runRes = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(
        APIFY_ACTOR_ID
      )}/runs?token=${APIFY_TOKEN}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchPhrases: searchPhrase ? [searchPhrase] : [],
          category,
          maxProducts: 10
        })
      }
    );

    const runJson = await runRes.json();
    const datasetId =
      runJson.data?.defaultDatasetId || runJson.defaultDatasetId;

    if (!datasetId) throw new Error("datasetId missing");

    // 2. Fetch dataset items
    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&format=json`
    );
    const items = await itemsRes.json();

    console.log("Items received:", items.length);

    const writes = items.map((item) => ({
      PutRequest: {
        Item: marshall({
          category,
          partId: item.id || item.name,
          name: item.name,
          specs: item.specifications || {},
          vendorList: item.prices?.prices || [],
          approved: false,
          source: "pcpartpicker-apify",
          createdAt: Date.now()
        })
      }
    }));

    for (let i = 0; i < writes.length; i += 25) {
      await ddb.send(
        new BatchWriteItemCommand({
          RequestItems: { [PARTS_TABLE_NAME]: writes.slice(i, i + 25) }
        })
      );
    }

    return response(200, { message: "OK", count: writes.length });
  } catch (err) {
    console.error("ERROR:", err);
    return response(500, { message: "Internal error", error: err.message });
  }
};
