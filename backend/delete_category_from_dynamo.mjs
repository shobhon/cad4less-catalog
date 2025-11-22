#!/usr/bin/env node
import AWS from "aws-sdk";

const TABLE_NAME = process.env.PARTS_TABLE_NAME;
const REGION = process.env.AWS_REGION || "us-west-1";

if (!TABLE_NAME) {
  console.error("Error: PARTS_TABLE_NAME env var is required");
  process.exit(1);
}

const category = process.argv[2];
if (!category) {
  console.error("Usage: node delete_category_from_dynamo.mjs <category>");
  process.exit(1);
}

AWS.config.update({ region: REGION });

const ddb = new AWS.DynamoDB();
const docClient = new AWS.DynamoDB.DocumentClient();

async function getKeyAttributes() {
  const desc = await ddb.describeTable({ TableName: TABLE_NAME }).promise();
  const keySchema = desc.Table.KeySchema || [];
  return keySchema.map((k) => k.AttributeName);
}

async function scanAllByCategory(keyAttrs) {
  const items = [];
  let ExclusiveStartKey = undefined;

  const attrNames = {
    "#cat": "category",
  };
  const projectionAttrs = Array.from(
    new Set([...keyAttrs, "category"])
  );
  projectionAttrs.forEach((attr) => {
    attrNames[`#${attr}`] = attr;
  });

  do {
    const params = {
      TableName: TABLE_NAME,
      FilterExpression: "#cat = :c",
      ExpressionAttributeNames: attrNames,
      ExpressionAttributeValues: { ":c": category },
      ProjectionExpression: projectionAttrs.map((a) => `#${a}`).join(", "),
      ExclusiveStartKey,
    };
    const res = await docClient.scan(params).promise();
    if (res.Items && res.Items.length) {
      items.push(...res.Items);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

async function batchDelete(items, keyAttrs) {
  if (!items.length) return;

  const chunks = [];
  for (let i = 0; i < items.length; i += 25) {
    chunks.push(items.slice(i, i + 25));
  }

  for (const chunk of chunks) {
    const RequestItems = {
      [TABLE_NAME]: chunk.map((it) => {
        const Key = {};
        for (const attr of keyAttrs) {
          if (it[attr] !== undefined) {
            Key[attr] = it[attr];
          }
        }
        return { DeleteRequest: { Key } };
      }),
    };

    await docClient
      .batchWrite({ RequestItems })
      .promise();
  }
}

(async () => {
  try {
    console.log(`Deleting all items with category="${category}" from ${TABLE_NAME} in ${REGION}...`);

    const keyAttrs = await getKeyAttributes();
    console.log("Key attributes:", keyAttrs.join(", "));

    const items = await scanAllByCategory(keyAttrs);
    console.log(`Found ${items.length} items to delete.`);

    if (!items.length) {
      console.log("Nothing to delete, done.");
      return;
    }

    await batchDelete(items, keyAttrs);

    console.log("Deletion complete.");
  } catch (err) {
    console.error("Error deleting items:", err);
    process.exit(1);
  }
})();
