const AWS = require("aws-sdk");

const ddb = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.PARTS_TABLE_NAME;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  // Log a compact view of the event for debugging, but avoid logging huge bodies
  console.log(
    "DeletePartFunction event:",
    JSON.stringify({
      httpMethod: event && event.httpMethod,
      path: event && event.path,
      rawPath: event && event.rawPath,
      pathParameters: event && event.pathParameters,
      queryStringParameters: event && event.queryStringParameters,
    })
  );

  // Handle CORS preflight
  const httpMethod =
    (event && event.httpMethod) ||
    (event &&
      event.requestContext &&
      (event.requestContext.httpMethod ||
        (event.requestContext.http && event.requestContext.http.method)));

  if (httpMethod === "OPTIONS") {
    return jsonResponse(200, { ok: true });
  }

  // Determine part id
  let id = null;
  const pathParameters = (event && event.pathParameters) || {};
  const query = (event && event.queryStringParameters) || {};

  // Path parameter: /parts/{id} or /parts/delete/{id}
  if (typeof pathParameters.id === "string" && pathParameters.id.trim()) {
    id = pathParameters.id.trim();
  }

  // Query string: /parts/delete?id=...
  if (!id && typeof query.id === "string" && query.id.trim()) {
    id = query.id.trim();
  }

  // Fallback to JSON body { "id": "..." }
  if (!id && event && event.body) {
    try {
      const payload = JSON.parse(event.body);
      if (payload && typeof payload.id === "string" && payload.id.trim()) {
        id = payload.id.trim();
      }
    } catch (e) {
      console.warn("DeletePartFunction: failed to parse body JSON", e);
    }
  }

  if (!id) {
    console.warn("DeletePartFunction: missing 'id'");
    return jsonResponse(400, {
      success: false,
      message: "Missing required 'id' parameter.",
    });
  }

  if (!TABLE_NAME) {
    console.error("DeletePartFunction: PARTS_TABLE_NAME env var is not set");
    return jsonResponse(500, {
      success: false,
      message: "Server configuration error: PARTS_TABLE_NAME is not set.",
    });
  }

  try {
    const params = {
      TableName: TABLE_NAME,
      Key: { id },
    };

    console.log(
      "DeletePartFunction: deleting from table",
      TABLE_NAME,
      "with key",
      params.Key
    );

    await ddb.delete(params).promise();

    return jsonResponse(200, {
      success: true,
      id,
    });
  } catch (err) {
    console.error("DeletePartFunction: DynamoDB delete error", err);
    return jsonResponse(500, {
      success: false,
      message: "Failed to delete part.",
      error: err && err.message ? err.message : "Unknown error",
    });
  }
};