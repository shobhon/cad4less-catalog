// Lambda to fetch parts from PCPartPicker via Apify and store them in the Parts table.
// NOTE: This uses node-fetch. Ensure you add it to your backend dependencies:
//   npm install node-fetch@2
//
// Env vars required:
//   APIFY_TOKEN         - your Apify API token
//   APIFY_ACTOR_ID      - optional, defaults to "matyascimbulka/pcpartpicker-scraper"
//   PARTS_TABLE_NAME    - DynamoDB table for parts

const fetch = require("node-fetch");
const ddb = require("../common/dynamoClient");
const { json } = require("../common/response");

const PARTS_TABLE_NAME = process.env.PARTS_TABLE_NAME;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const APIFY_ACTOR_ID =
  process.env.APIFY_ACTOR_ID || "matyascimbulka/pcpartpicker-scraper";

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const category = qs.category;
    const searchPhrase = qs.searchPhrase || "";

    if (!APIFY_TOKEN) {
      return json(500, { message: "APIFY_TOKEN env var is not set" });
    }

    if (!category) {
      return json(400, { message: "category query parameter is required" });
    }

    // 1. Start Apify actor run
    const runInput = {
      searchPhrases: searchPhrase ? [searchPhrase] : [],
      category: category,
      maxProducts: 20,
    };

    const runUrl = `https://api.apify.com/v2/acts/${encodeURIComponent(
      APIFY_ACTOR_ID
    )}/runs?token=${APIFY_TOKEN}`;

    const runRes = await fetch(runUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runInput),
    });

    if (!runRes.ok) {
      const txt = await runRes.text();
      throw new Error(`Apify actor run failed: ${runRes.status} ${txt}`);
    }

    const runJson = await runRes.json();
    const runData = runJson.data || runJson; // handle both wrapped and direct forms
    const datasetId = runData.defaultDatasetId;

    if (!datasetId) {
      throw new Error("No defaultDatasetId returned from Apify run");
    }

    // 2. Read dataset items
    const itemsUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&format=json`;
    const itemsRes = await fetch(itemsUrl);

    if (!itemsRes.ok) {
      const txt = await itemsRes.text();
      throw new Error(`Failed to fetch dataset items: ${itemsRes.status} ${txt}`);
    }

    const items = await itemsRes.json();
    if (!Array.isArray(items)) {
      throw new Error("Dataset items response is not an array");
    }

    // 3. Map to internal schema & batch write
    const writeRequests = items.map((item) => {
      const partId = item.id || item.sku || item.slug || item.name;
      const name = item.name || "Unknown part";

      // Map vendor prices
      let vendorList = [];
      if (item.prices && Array.isArray(item.prices.prices)) {
        vendorList = item.prices.prices.map((p) => ({
          vendor: p.merchant || p.store || "unknown",
          price: typeof p.price === "number" ? p.price : null,
          stockStatus: p.availability || p.stock || "unknown",
          url: p.buyLink || p.url || null,
        }));
      }

      const specs = item.specifications || item.specs || {};

      return {
        PutRequest: {
          Item: {
            category,
            partId,
            name,
            specs,
            vendorList,
            approved: false, // require manual approval in admin
            source: "pcpartpicker-apify",
            createdAt: Date.now(),
          },
        },
      };
    });

    if (!writeRequests.length) {
      return json(200, {
        message: "Apify run succeeded but returned no items",
        items: [],
      });
    }

    // DynamoDB batchWrite in chunks of 25
    const chunks = [];
    for (let i = 0; i < writeRequests.length; i += 25) {
      chunks.push(writeRequests.slice(i, i + 25));
    }

    for (const chunk of chunks) {
      await ddb
        .batchWrite({
          RequestItems: {
            [PARTS_TABLE_NAME]: chunk,
          },
        })
        .promise();
    }

    return json(200, {
      message: `Fetched ${writeRequests.length} parts from PCPartPicker via Apify for category ${category}`,
      count: writeRequests.length,
    });
  } catch (err) {
    console.error("Error in fetchPartsExternal:", err);
    return json(500, { message: "Internal server error", error: err.message });
  }
};
