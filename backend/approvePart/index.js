const ddb = require("../common/dynamoClient");
const { json } = require("../common/response");

const TABLE_NAME = process.env.PARTS_TABLE_NAME;

exports.handler = async (event) => {
  console.log("ApprovePart event:", JSON.stringify(event));

  try {
    const body = JSON.parse(event.body || "{}");

    // Support both { partId } and { id } from the frontend
    const id = body.partId || body.id;
    const category = body.category;
    const approved = body.approved;

    if (!id || !category || typeof approved !== "boolean") {
      return json(400, {
        message: "id (or partId), category, and approved (boolean) are required",
        received: { id, category, approved },
      });
    }

    const params = {
      TableName: TABLE_NAME,
      Key: { id, category },
      UpdateExpression: "SET approved = :a",
      ExpressionAttributeValues: {
        ":a": approved,
      },
      ConditionExpression: "attribute_exists(id)",
      ReturnValues: "ALL_NEW",
    };

    const res = await ddb.update(params).promise();

    return json(200, { message: "Part approval updated", part: res.Attributes });
  } catch (err) {
    console.error("Error approving part:", err);
    return json(500, { message: "Internal server error", error: err.message });
  }
};
