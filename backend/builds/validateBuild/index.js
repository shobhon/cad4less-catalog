const ddb = require("../../common/dynamoClient");
const { json } = require("../../common/response");
const { calculatePricing } = require("../../common/priceCalculator");
const { simpleCompatibilityCheck } = require("../../common/compatibility");

const BUILDS_TABLE = process.env.BUILDS_TABLE_NAME;
const PARTS_TABLE = process.env.PARTS_TABLE_NAME;

exports.handler = async (event) => {
  try {
    const buildId = event.pathParameters && event.pathParameters.buildId;
    if (!buildId) {
      return json(400, { message: "buildId is required in the path" });
    }

    // 1. Load build
    const buildRes = await ddb
      .get({
        TableName: BUILDS_TABLE,
        Key: { buildId },
      })
      .promise();

    const build = buildRes.Item;
    if (!build) {
      return json(404, { message: "Build not found" });
    }

    const partsMap = build.parts || {};

    // 2. Load part records
    const keys = Object.entries(partsMap).map(([category, partId]) => ({
      category,
      partId,
    }));

    if (!keys.length) {
      return json(400, { message: "Build has no parts to validate" });
    }

    const batchReq = {
      RequestItems: {
        [PARTS_TABLE]: {
          Keys: keys.map((k) => ({
            category: k.category,
            partId: k.partId,
          })),
        },
      },
    };

    const batchRes = await ddb.batchGet(batchReq).promise();
    const partsRecords = (batchRes.Responses && batchRes.Responses[PARTS_TABLE]) || [];

    // 3. Build category → record map
    const partsByCategory = {};
    for (const rec of partsRecords) {
      if (!rec || !rec.category) continue;
      // Only keep first if duplicates exist
      if (!partsByCategory[rec.category]) {
        partsByCategory[rec.category] = rec;
      }
    }

    // 4. Compatibility
    const comp = simpleCompatibilityCheck({
      cpu: partsByCategory["cpu"],
      motherboard: partsByCategory["motherboard"],
      gpu: partsByCategory["gpu"],
      psu: partsByCategory["psu"],
    });

    // 5. Pricing (simple: 15% margin default)
    const pricing = calculatePricing(partsRecords, { marginPercent: 15 });

    // 6. Total weight (optional)
    let totalWeightKg = 0;
    for (const rec of partsRecords) {
      if (rec && typeof rec.weightKg === "number") {
        totalWeightKg += rec.weightKg;
      }
    }

    const now = Date.now();

    // 7. Update build with summary
    const updateRes = await ddb
      .update({
        TableName: BUILDS_TABLE,
        Key: { buildId },
        UpdateExpression:
          "SET compatibilitySummary = :comp, pricing = :pricing, shipping.weightKg = :w, updatedAt = :u",
        ExpressionAttributeValues: {
          ":comp": comp,
          ":pricing": pricing,
          ":w": Number(totalWeightKg.toFixed(2)),
          ":u": now,
        },
        ReturnValues: "ALL_NEW",
      })
      .promise();

    return json(200, {
      message: "Build validated",
      build: updateRes.Attributes,
    });
  } catch (err) {
    console.error("Error validating build:", err);
    return json(500, { message: "Internal server error", error: err.message });
  }
};
