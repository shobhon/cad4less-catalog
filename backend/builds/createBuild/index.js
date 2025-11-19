const { v4: uuidv4 } = require("uuid");
const ddb = require("../../common/dynamoClient");
const { json } = require("../../common/response");

const BUILDS_TABLE = process.env.BUILDS_TABLE_NAME;

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");

    const buildId = uuidv4();
    const now = Date.now();

    const item = {
      buildId,
      name: body.name || "New Build",
      profile: body.profile || "CUSTOM",
      parts: body.parts || {},
      status: "draft",
      pricing: {},
      compatibilitySummary: {
        status: "pending",
        errors: [],
        warnings: [],
      },
      shipping: {},
      createdAt: now,
      updatedAt: now,
    };

    await ddb
      .put({
        TableName: BUILDS_TABLE,
        Item: item,
      })
      .promise();

    return json(201, { message: "Build created", build: item });
  } catch (err) {
    console.error("Error creating build:", err);
    return json(500, { message: "Internal server error", error: err.message });
  }
};
