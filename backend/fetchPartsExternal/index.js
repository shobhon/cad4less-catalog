const AWS = require("aws-sdk");

// Use the same environment variable convention as other Lambdas
const TABLE_NAME = process.env.PARTS_TABLE_NAME || "Cad4LessPartsLive";
console.log("FetchPartsExternal using TABLE_NAME=", TABLE_NAME);

const ddb = new AWS.DynamoDB.DocumentClient();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
};

exports.handler = async (event) => {
  console.log("FetchPartsExternal event:", JSON.stringify(event));

  // Handle preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: "",
    };
  }

  try {
    const qs = event.queryStringParameters || {};
    const requestedCategory = qs.category;
    const vendorFilter = qs.vendor || "all";

    if (!requestedCategory) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({ message: "category query parameter is required" }),
      };
    }

    // Support legacy mixed-case categories: try a small set of variants
    const lc = requestedCategory.toLowerCase();
    const ucFirst = requestedCategory.charAt(0).toUpperCase() + requestedCategory.slice(1);
    const candidateCategories = Array.from(new Set([requestedCategory, lc, ucFirst]));

    let items = [];

    for (const cat of candidateCategories) {
      const params = {
        TableName: TABLE_NAME,
        FilterExpression: "#cat = :c",
        ExpressionAttributeNames: { "#cat": "category" },
        ExpressionAttributeValues: { ":c": cat },
      };

      console.log("Scanning table for category", cat, "with params", JSON.stringify(params));
      const res = await ddb.scan(params).promise();
      if (res.Items && res.Items.length) {
        items = items.concat(res.Items);
      }
    }

    if (!items.length) {
      return {
        statusCode: 404,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          message: `No parts found for category '${requestedCategory}'`,
        }),
      };
    }

    // Optional vendor filter, if provided and not "all"
    const vf = (vendorFilter || "all").toLowerCase();
    if (vf !== "all") {
      items = items.filter((p) => {
        const store = (p.store || p.vendor || "").toString().toLowerCase();
        if (store && store === vf) return true;

        if (Array.isArray(p.vendorList)) {
          return p.vendorList.some((v) =>
            v && typeof v.vendor === "string" && v.vendor.toLowerCase() === vf
          );
        }

        return false;
      });
    }

    const responseBody = {
      category: requestedCategory,
      vendor: vendorFilter || "all",
      parts: items,
    };

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify(responseBody),
    };
  } catch (err) {
    console.error("FetchPartsExternal error:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: "Internal server error", error: err.message }),
    };
  }
};