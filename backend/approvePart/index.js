const ddb = require("../common/dynamoClient");
const { json } = require("../common/response");

const TABLE_NAME = process.env.PARTS_TABLE_NAME;

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { partId, category, approved } = body;

    if (!partId || !category || typeof approved !== "boolean") {
      return json(400, {
        message: "partId, category, and approved (boolean) are required",
      });
    }

    const params = {
      TableName: TABLE_NAME,
      Key: { category, partId },
      UpdateExpression: "SET approved = :a",
      ExpressionAttributeValues: {
        ":a": approved,
      },
      ReturnValues: "ALL_NEW",
    };

    const res = await ddb.update(params).promise();

    return json(200, { message: "Part approval updated", part: res.Attributes });
  } catch (err) {
    console.error("Error approving part:", err);
    return json(500, { message: "Internal server error", error: err.message });
  }
};
