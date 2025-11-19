// backend/fetchParts/index.js
// Fetch parts from DynamoDB (live table) using AWS SDK v3

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
} = require("@aws-sdk/lib-dynamodb");

// Explicit region; your Lambdas are deployed in us-west-1
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || "us-west-1" })
);

// The real table name in us-west-1
const TABLE_NAME = "Cad4LessPartsLive";

async function getLivePartsFromDynamo(category) {
  if (!TABLE_NAME) {
    throw new Error("TABLE_NAME is not set");
  }

  console.log("DDB debug", {
    lambdaRegion: process.env.AWS_REGION,
    tableName: TABLE_NAME,
    category,
  });

  const params = {
    TableName: TABLE_NAME,
    FilterExpression: "#cat = :category",
    ExpressionAttributeNames: { "#cat": "category" },
    ExpressionAttributeValues: { ":category": category.toLowerCase() },
  };

  const result = await ddb.send(new ScanCommand(params));
  const items = result.Items || [];

  return items.filter(
    (item) =>
      typeof item.category === "string" &&
      item.category.toLowerCase() === category.toLowerCase()
  );
}

exports.handler = async (event) => {
  try {
    const qs = event.queryStringParameters || {};
    const category = (qs.category || "cpu").toLowerCase();
    const vendorFilter = (qs.vendor || "all").toLowerCase();

    const parts = await getLivePartsFromDynamo(category);

    if (!parts || parts.length === 0) {
      return {
        statusCode: 404,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({
          message: `No parts found for category '${category}'`,
        }),
      };
    }

    let responseParts = parts;

    if (vendorFilter !== "all") {
      responseParts = parts.filter(
        (p) =>
          (p.vendor && typeof p.vendor === "string" && p.vendor.toLowerCase() === vendorFilter) ||
          (Array.isArray(p.vendorList) &&
            p.vendorList.some(
              (v) => v.vendor && typeof v.vendor === "string" && v.vendor.toLowerCase() === vendorFilter
            ))
      );
    }

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ category, vendor: vendorFilter, parts: responseParts }),
    };
  } catch (err) {
    console.error("Error in fetchParts:", err);
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ message: "Internal server error", error: err.message }),
    };
  }
};