const AWS = require("aws-sdk");

const docClient = new AWS.DynamoDB.DocumentClient();
const TABLE_NAME = process.env.PARTS_TABLE_NAME || "Cad4LessPartsLive";

exports.handler = async (event) => {
  console.log("FetchPartsFunction event:", JSON.stringify(event));

  try {
    const qs = event.queryStringParameters || {};
    const category = qs.category;

    if (!category) {
      return buildResponse(400, {
        message: "Missing required query parameter: category",
      });
    }

    // For now, keep the logic very simple and just return all items
    // that match the requested category and are in-stock & approved.
    const params = {
      TableName: TABLE_NAME,
      FilterExpression:
        "#cat = :c AND approved = :trueVal AND inStock = :trueVal",
      ExpressionAttributeNames: {
        "#cat": "category",
      },
      ExpressionAttributeValues: {
        ":c": category,
        ":trueVal": true,
      },
    };

    console.log("DynamoDB scan params:", JSON.stringify(params));

    const data = await docClient.scan(params).promise();

    console.log(
      `DynamoDB scan result: Count=${data.Count}, ScannedCount=${data.ScannedCount}`
    );

    const items = Array.isArray(data.Items) ? data.Items : [];

    return buildResponse(200, {
      items,
      count: items.length,
    });
  } catch (err) {
    console.error("Error in FetchPartsFunction:", err);

    return buildResponse(500, {
      message: "Internal server error in FetchPartsFunction",
      error: String(err && err.message ? err.message : err),
    });
  }
};

function buildResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}
