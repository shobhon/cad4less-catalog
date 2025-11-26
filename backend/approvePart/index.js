const AWS = require("aws-sdk");

// Use the built-in DocumentClient
const dynamo = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.PARTS_TABLE_NAME;

// CORS headers for every response
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,DELETE",
};

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: HEADERS,
    body: JSON.stringify(bodyObj ?? {}),
  };
}

exports.handler = async (event) => {
  console.log("ApprovePart event:", JSON.stringify(event));

  // Works for both REST and HTTP API payload formats
  const method =
    event.httpMethod ||
    event.requestContext?.httpMethod ||
    event.requestContext?.http?.method;

  // --- CORS preflight: handle FIRST, no body parsing ---
  if (method === "OPTIONS") {
    return json(200, { message: "Preflight OK" });
  }

  if (method !== "POST") {
    return json(405, { message: "Method Not Allowed", method });
  }

  // --- Parse body safely ---
  let body = {};
  try {
    if (typeof event.body === "string") {
      body = event.body ? JSON.parse(event.body) : {};
    } else if (event.body && typeof event.body === "object") {
      body = event.body;
    }
  } catch (err) {
    console.error("Failed to parse JSON body", err);
    return json(400, { message: "Invalid JSON body" });
  }

  // Support both { id } and { partId }
  const id = body.partId || body.id;

  // Accept either `approved` or `useInBuilds`
  let approved = body.approved;
  if (typeof approved !== "boolean" && typeof body.useInBuilds === "boolean") {
    approved = body.useInBuilds;
  }

  if (!id || typeof approved !== "boolean") {
    return json(400, {
      message:
        "id (or partId) and approved/useInBuilds (boolean) are required",
      received: { id, approved, useInBuilds: body.useInBuilds },
    });
  }

  const params = {
    TableName: TABLE_NAME,
    Key: { id },
    UpdateExpression: "SET approved = :a",
    ExpressionAttributeValues: {
      ":a": approved,
    },
    ReturnValues: "ALL_NEW",
  };

  try {
    const res = await dynamo.update(params).promise();
    console.log("ApprovePart update result:", JSON.stringify(res));
    return json(200, {
      message: "Part approval updated",
      part: res.Attributes,
    });
  } catch (err) {
    console.error("Error approving part:", err);
    return json(500, {
      message: "Failed to update part approval",
      error: err.message,
    });
  }
};