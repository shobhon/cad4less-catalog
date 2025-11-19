const ddb = require("../common/dynamoClient");
const { json } = require("../common/response");

const TABLE_NAME = process.env.PARTS_TABLE_NAME;

exports.handler = async () => {
  try {
    const params = {
      TableName: TABLE_NAME,
      // MVP: Scan for approved = false. For production, use a GSI instead.
      FilterExpression: "approved = :f",
      ExpressionAttributeValues: { ":f": false },
      Limit: 200,
    };

    const result = await ddb.scan(params).promise();

    return json(200, { items: result.Items || [] });
  } catch (err) {
    console.error("Error listing pending parts:", err);
    return json(500, { message: "Internal server error", error: err.message });
  }
};
