import fs from 'fs/promises';
import AWS from 'aws-sdk';

async function loadJson(path) {
  const txt = await fs.readFile(path, 'utf8');
  return JSON.parse(txt);
}

function extractId(raw) {
  if (raw.id) return raw.id;
  if (raw.url) {
    const m = raw.url.match(/\/product\/([^/]+)/);
    if (m) return m[1];
  }
  return raw.name;
}

function buildVendorListCpu(raw) {
  const priceEntries =
    raw.prices && Array.isArray(raw.prices.prices)
      ? raw.prices.prices
      : [];

  const inStock = priceEntries.filter(
    (p) =>
      typeof p.availability === 'string' &&
      p.availability.toLowerCase().includes('in stock')
  );

  if (inStock.length === 0) {
    return { vendorList: [], best: null };
  }

  const sorted = [...inStock].sort((a, b) => {
    if (typeof a.price !== 'number') return 1;
    if (typeof b.price !== 'number') return -1;
    return a.price - b.price;
  });

  const best = sorted[0];

  const vendorList = sorted.map((p) => ({
    vendor: p.merchant,
    buyLink: p.buyLink,
    availability: p.availability,
    price: typeof p.price === 'number' ? p.price : null,
    priceCurrency: p.currency || '$',
    image: null,
  }));

  return { vendorList, best };
}

function buildVendorListGeneric(raw) {
  return {
    vendorList: [
      {
        vendor: 'pcpartpicker',
        buyLink: raw.url,
        availability: 'unknown',
        price: null,
        priceCurrency: 'USD',
        image: null,
      },
    ],
    best: null,
  };
}

function normalizeSpecs(rawSpecs) {
  const specs =
    rawSpecs && typeof rawSpecs === 'object' ? { ...rawSpecs } : {};

  if (specs.Socket && !specs.socket) {
    specs.socket = specs.Socket;
  }

  return specs;
}

async function batchWriteAll(docClient, tableName, items) {
  const BATCH_SIZE = 25;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const params = {
      RequestItems: {
        [tableName]: batch.map((Item) => ({
          PutRequest: { Item },
        })),
      },
    };
    console.log(`Writing batch of ${batch.length} items to ${tableName}...`);
    await docClient.batchWrite(params).promise();
  }
}

async function main() {
  const [, , categoryArg, jsonPath, maxItemsArg] = process.argv;

  if (!categoryArg || !jsonPath) {
    console.error(
      'Usage: node backend/import_pcpartpicker_to_dynamo.mjs <category> <jsonPath> [maxItems]'
    );
    process.exit(1);
  }

  const maxItems = maxItemsArg ? parseInt(maxItemsArg, 10) : 1000;

  const region = process.env.AWS_REGION || 'us-west-1';
  const tableName = process.env.PARTS_TABLE_NAME;

  if (!tableName) {
    console.error('PARTS_TABLE_NAME env var is required');
    process.exit(1);
  }

  AWS.config.update({ region });
  const docClient = new AWS.DynamoDB.DocumentClient();

  const raw = await loadJson(jsonPath);
  if (!Array.isArray(raw)) {
    throw new Error(`Expected JSON array in ${jsonPath}, got ${typeof raw}`);
  }

  console.log(
    `Loaded ${raw.length} raw Apify items from ${jsonPath} for category=${categoryArg}`
  );

  const seenIds = new Set();
  const items = [];
  const now = new Date().toISOString();

  for (const rec of raw) {
    const id = extractId(rec);
    if (!id) continue;
    if (seenIds.has(id)) continue;

    let vendorList;
    let bestOffer;

    const shouldUsePriceVendors =
      categoryArg === 'cpu' ||
      categoryArg === 'motherboard' ||
      categoryArg === 'cpu-cooler';

    if (shouldUsePriceVendors) {
      const { vendorList: vl, best } = buildVendorListCpu(rec);
      vendorList = vl;
      bestOffer = best;

      // Only import items that have at least one in-stock priced offer
      if (!bestOffer) continue;
    } else {
      const { vendorList: vl, best } = buildVendorListGeneric(rec);
      vendorList = vl;
      bestOffer = best;
    }

    const specs = normalizeSpecs(rec.specifications);

    const item = {
      id,
      category: categoryArg,
      name: rec.name,
      image: null,
      availability: bestOffer ? bestOffer.availability || 'unknown' : 'unknown',
      vendor: 'pcpartpicker',
      store: bestOffer ? bestOffer.merchant : 'pcpartpicker',
      price:
        bestOffer && typeof bestOffer.price === 'number'
          ? bestOffer.price
          : null,
      vendorList,
      specs,
      approved: false,
      inStock:
        !!(
          bestOffer &&
          typeof bestOffer.availability === 'string' &&
          bestOffer.availability.toLowerCase().includes('in stock')
        ),
      updatedAt: now,
    };

    items.push(item);
    seenIds.add(id);

    if (items.length >= maxItems) break;
  }

  console.log(`Prepared ${items.length} DynamoDB items. Example:`);
  if (items.length > 0) {
    console.log(JSON.stringify(items[0], null, 2));
  }

  if (items.length === 0) {
    console.warn('No items to import (after filtering).');
    return;
  }

  await batchWriteAll(docClient, tableName, items);
  console.log('Import complete.');
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});