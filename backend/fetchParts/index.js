// backend/fetchParts/index.js
// Fetch parts from DynamoDB (live table) using AWS SDK v3

const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");

// Explicit region; your Lambdas are deployed in us-west-1
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION || "us-west-1" })
);

// The real table name in us-west-1
const TABLE_NAME = "Cad4LessPartsLive";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
};

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
    const method = (
      event.httpMethod ||
      (event.requestContext &&
        event.requestContext.http &&
        event.requestContext.http.method) ||
      "GET"
    ).toUpperCase();

    if (method === "OPTIONS") {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: "",
      };
    }

    // JSON body update path (not currently used by the frontend, but kept for completeness)
    if (method === "POST" || method === "PUT") {
      let body;
      try {
        body = JSON.parse(event.body);
      } catch {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ message: "Invalid JSON body" }),
        };
      }
      const { id, approved } = body || {};

      if (!id || typeof approved !== "boolean") {
        return {
          statusCode: 400,
          headers: CORS_HEADERS,
          body: JSON.stringify({ message: "id and approved are required" }),
        };
      }

      const params = {
        TableName: TABLE_NAME,
        Key: { id },
        UpdateExpression: "SET approved = :approved",
        ExpressionAttributeValues: { ":approved": approved },
      };

      await ddb.send(new UpdateCommand(params));

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ success: true, id, approved }),
      };
    }

    if (method === "GET") {
      const qs = event.queryStringParameters || {};

      // Lightweight update path using GET and query string so we don't need
      // a separate POST method on API Gateway.
      if (qs.action === "updateApproved") {
        const id = qs.id;
        const approvedParam = qs.approved;

        if (!id || typeof approvedParam !== "string") {
          return {
            statusCode: 400,
            headers: CORS_HEADERS,
            body: JSON.stringify({
              message: "id and approved are required in query string",
            }),
          };
        }

        const approved =
          approvedParam === "true" ||
          approvedParam === "1" ||
          approvedParam === "yes" ||
          approvedParam === "on";

        const params = {
          TableName: TABLE_NAME,
          Key: { id },
          UpdateExpression: "SET approved = :approved",
          ExpressionAttributeValues: { ":approved": approved },
        };

        await ddb.send(new UpdateCommand(params));

        return {
          statusCode: 200,
          headers: CORS_HEADERS,
          body: JSON.stringify({ success: true, id, approved }),
        };
      }

      // Default GET logic for listing parts
      const category = (qs.category || "cpu").toLowerCase();
      const vendorFilter = (qs.vendor || "all").toLowerCase();

      const parts = await getLivePartsFromDynamo(category);

      if (!parts || parts.length === 0) {
        return {
          statusCode: 404,
          headers: CORS_HEADERS,
          body: JSON.stringify({
            message: `No parts found for category '${category}'`,
          }),
        };
      }

      let responseParts = parts;

      if (vendorFilter !== "all") {
        responseParts = parts.filter(
          (p) =>
            (p.vendor &&
              typeof p.vendor === "string" &&
              p.vendor.toLowerCase() === vendorFilter) ||
            (Array.isArray(p.vendorList) &&
              p.vendorList.some(
                (v) =>
                  v.vendor &&
                  typeof v.vendor === "string" &&
                  v.vendor.toLowerCase() === vendorFilter
              ))
        );
      }

      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({ category, vendor: vendorFilter, parts: responseParts }),
      };
    }

    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: `Method ${method} not allowed` }),
    };
  } catch (err) {
    console.error("Error in fetchParts:", err);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ message: "Internal server error", error: err.message }),
    };
  }
};