const AWS = require('aws-sdk');

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const PARTS_TABLE_NAME = process.env.PARTS_TABLE_NAME;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  try {
    const httpMethod = event && event.httpMethod ? event.httpMethod : 'GET';
    const path = event && event.path ? event.path : '';
    const resource = event && event.resource ? event.resource : '';

    // CORS preflight
    if (httpMethod === 'OPTIONS') {
      return jsonResponse(200, { message: 'OK' });
    }

    // POST /parts/import-csv  (CSV → DynamoDB, no Apify)
    if (
      httpMethod === 'POST' &&
      (path.endsWith('/parts/import-csv') || resource === '/parts/import-csv')
    ) {
      const rawBody = event.body || '';
      const decodedBody = event.isBase64Encoded
        ? Buffer.from(rawBody, 'base64').toString('utf8')
        : rawBody;

      if (!decodedBody) {
        return jsonResponse(400, { message: 'Missing request body' });
      }

      let payload;
      try {
        payload = JSON.parse(decodedBody);
      } catch (err) {
        return jsonResponse(400, {
          message: 'Request body must be JSON with shape { category, csv }',
          error: err.message,
        });
      }

      const { category, csv } = payload || {};

      if (!category || typeof category !== 'string') {
        return jsonResponse(400, {
          message: 'Field "category" is required and must be a string.',
        });
      }

      if (!csv || typeof csv !== 'string') {
        return jsonResponse(400, {
          message: 'Field "csv" is required and must be a string containing CSV data.',
        });
      }

      const rows = parseCsv(csv);
      if (!rows.length) {
        return jsonResponse(400, {
          message: 'CSV appears to be empty or has only a header row.',
        });
      }

      if (rows.length > 200) {
        return jsonResponse(400, {
          message: 'CSV has too many rows for a single import. Please limit to 200 rows or fewer.',
          rowCount: rows.length,
        });
      }

      const results = {
        attempted: rows.length,
        succeeded: 0,
        failed: 0,
        skippedNotInStock: 0,
        errors: [],
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          const record = mapRowToPartRecord(row, category);

          // Only import in‑stock items
          if (!isInStock(record.availability)) {
            results.skippedNotInStock += 1;
            continue;
          }

          await upsertPart(record);
          results.succeeded += 1;
        } catch (err) {
          results.failed += 1;
          results.errors.push({ index: i, message: err.message });
        }
      }

      return jsonResponse(200, {
        message: 'CSV import completed',
        ...results,
      });
    }

    // Legacy GET /parts/import
    if (httpMethod === 'GET') {
      return jsonResponse(200, {
        message:
          'CSV import endpoint is POST /parts/import-csv. This GET /parts/import is kept for backwards compatibility only.',
      });
    }

    return jsonResponse(405, { message: 'Method not allowed' });
  } catch (err) {
    console.error('Error in ImportPartsFunction:', err);
    return jsonResponse(500, {
      message: 'Internal server error',
      error: err.message,
    });
  }
};

// ---------- CSV helpers ----------

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] !== undefined ? values[idx] : '';
    });
    rows.push(row);
  }

  return rows;
}

function splitCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}

function isInStock(availability) {
  if (!availability) return false;
  const v = String(availability).toLowerCase();

  if (v.includes('in stock')) return true;
  if (v === 'available' || v === 'yes') return true;

  return false;
}

// ---------- Mapping + DynamoDB helpers ----------

function mapRowToPartRecord(row, category) {
  const name =
    row.name ||
    row.Name ||
    row.title ||
    row.Title ||
    row.productName ||
    row.ProductName;

  if (!name) {
    throw new Error(
      'Row is missing a recognizable name field (e.g., name, Name, title, productName).',
    );
  }

  const rawPrice =
    row.price ||
    row.Price ||
    row.FinalPrice ||
    row.basePrice ||
    row.BasePrice ||
    row.cost ||
    row.Cost;

  const numericPrice = rawPrice
    ? parseFloat(String(rawPrice).replace(/[^0-9.]/g, ''))
    : undefined;

  const currency =
    row.currency ||
    row.Currency ||
    row.priceCurrency ||
    row.PriceCurrency ||
    (rawPrice && /\$/.test(rawPrice) ? '$' : undefined) ||
    '$';

  const availability =
    row.availability ||
    row.Availability ||
    row.stockStatus ||
    row.StockStatus ||
    row.Instock ||
    row.inStock ||
    'unknown';

  const vendor =
    row.vendor ||
    row.Vendor ||
    row.seller ||
    row.Seller ||
    row.source ||
    row.Source ||
    'unknown';

  const image =
    row.image ||
    row.Image ||
    row.imageUrl ||
    row.imageURL ||
    row.image_url ||
    row.thumbnail ||
    row.Thumbnail ||
    null;

  const buyLink =
    row.url ||
    row.URL ||
    row.link ||
    row.Link ||
    row.productUrl ||
    row.ProductUrl ||
    row.productURL ||
    row.ProductURL ||
    null;

  const id =
    row.id ||
    row.Id ||
    row.ID ||
    row.slug ||
    row.Slug ||
    (buyLink ? slugify(buyLink) : slugify(name));

  // Basic specs, especially useful for CPUs (and harmless for other categories)
  const cores =
    row.cores ||
    row.Cores ||
    row.coreCount ||
    row.CoreCount ||
    row['Core Count'];

  const threads =
    row.threads ||
    row.Threads ||
    row.threadCount ||
    row.ThreadCount ||
    row['Thread Count'];

  const socket =
    row.socket ||
    row.Socket ||
    row['CPU Socket'] ||
    row['Cpu Socket'];

  const tdp =
    row.tdp ||
    row.TDP ||
    row.tdpWatts ||
    row.TdpWatts ||
    row['TDP (W)'];

  const specs = {};
  if (cores) specs.cores = String(cores);
  if (threads) specs.threads = String(threads);
  if (socket) specs.socket = String(socket);
  if (tdp) specs.tdp = String(tdp);

  const vendorEntry = {
    vendor,
    price:
      numericPrice !== undefined && !Number.isNaN(numericPrice)
        ? numericPrice
        : null,
    currency,
    availability,
    image,
    buyLink,
  };

  return {
    id,
    category,
    name,
    price: vendorEntry.price,
    vendor,
    availability,
    image,
    specs,
    vendorList: [vendorEntry],
  };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

async function upsertPart(record) {
  if (!PARTS_TABLE_NAME) {
    throw new Error('PARTS_TABLE_NAME env var is not set');
  }

  const now = new Date().toISOString();

  const params = {
    TableName: PARTS_TABLE_NAME,
    Key: { id: record.id },
    UpdateExpression:
      'SET #category = if_not_exists(#category, :category), ' +
      '#name = if_not_exists(#name, :name), ' +
      '#specs = if_not_exists(#specs, :specs), ' +
      '#price = :price, ' +
      '#vendor = :vendor, ' +
      '#availability = :availability, ' +
      '#image = if_not_exists(#image, :image), ' +
      '#vendorList = :vendorList, ' +
      '#updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#category': 'category',
      '#name': 'name',
      '#specs': 'specs',
      '#price': 'price',
      '#vendor': 'vendor',
      '#availability': 'availability',
      '#image': 'image',
      '#vendorList': 'vendorList',
      '#updatedAt': 'updatedAt',
    },
    ExpressionAttributeValues: {
      ':category': record.category,
      ':name': record.name,
      ':specs': record.specs || {},
      ':price':
        record.price !== undefined && !Number.isNaN(record.price)
          ? record.price
          : null,
      ':vendor': record.vendor,
      ':availability': record.availability,
      ':image': record.image || 'https://example.com/images/placeholder.png',
      ':vendorList': record.vendorList,
      ':updatedAt': now,
    },
  };

  await dynamoDb.update(params).promise();
}