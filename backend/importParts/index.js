const AWS = require('aws-sdk');

const dynamoDb = new AWS.DynamoDB.DocumentClient();
const PARTS_TABLE_NAME = process.env.PARTS_TABLE_NAME;

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,DELETE',
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

      // Category is now optional; we prefer the per-row CSV "Category" column.
      const baseCategory =
        typeof category === 'string' && category.trim().length > 0
          ? category.trim()
          : null;

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
          const record = mapRowToPartRecord(row, baseCategory);

          await upsertPart(record);
          results.succeeded += 1;
        } catch (err) {
          results.failed += 1;
          results.errors.push({ index: i, message: err.message });
        }
      }

      // Normalize CSV import summary so we never report "skipped (not in stock)"
      if (Array.isArray(rows)) {
        // Ensure attempted reflects the total number of parsed rows
        results.attempted = rows.length;
      }

      // If failed is not a number, treat it as 0
      if (typeof results.failed !== 'number' || Number.isNaN(results.failed)) {
        results.failed = 0;
      }

      // Compute succeeded as attempted - failed, and force skippedNotInStock to 0
      results.succeeded = Math.max(0, results.attempted - results.failed);
      results.skippedNotInStock = 0;

      console.log('ImportPartsFunction /parts/import-csv summary (normalized):', results);

      // Note: the normalized summary log above already printed detailed results.
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
      if (inQuotes) {
        // Inside a quoted field
        if (line[i + 1] === '"') {
          // Escaped quote ("")
          current += '"';
          i++;
        } else {
          // Closing quote
          inQuotes = false;
        }
      } else {
        // Not currently in quotes
        if (current === '') {
          // Quote at the start of the field starts a quoted section
          inQuotes = true;
        } else {
          // Quote in the middle of a field is treated as a literal character
          current += '"';
        }
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
  if (!availability) return true; // default to importing when we can't tell
  const v = String(availability).toLowerCase().trim();

  // Explicit negatives
  if (v.includes('out of stock')) return false;
  if (v.includes('sold out')) return false;
  if (v === 'no' || v === '0') return false;

  // Everything else ("in stock", "available", "available soon", "backordered", etc.)
  // is treated as in-stock for import purposes so Apify CSV rows don't get skipped.
  return true;
}

function looksLikeStorageRow(row) {
  if (!row) return false;

  // 1) Exact "scrape-storage.csv" signature:
  // name,capacity,price_per_gb,type_or_rpm,cache,form_factor,
  // interface,rating_count,availability,price
  const hasSignatureColumns =
    Object.prototype.hasOwnProperty.call(row, 'capacity') &&
    Object.prototype.hasOwnProperty.call(row, 'price_per_gb') &&
    Object.prototype.hasOwnProperty.call(row, 'type_or_rpm') &&
    Object.prototype.hasOwnProperty.call(row, 'cache') &&
    Object.prototype.hasOwnProperty.call(row, 'form_factor') &&
    Object.prototype.hasOwnProperty.call(row, 'interface') &&
    Object.prototype.hasOwnProperty.call(row, 'rating_count') &&
    Object.prototype.hasOwnProperty.call(row, 'availability') &&
    Object.prototype.hasOwnProperty.call(row, 'price');

  if (hasSignatureColumns) {
    // This is our hard-coded storage CSV format
    return true;
  }

  // 2) Fallback heuristic for other storage-looking CSVs
  const hasCapacity = row.capacity || row.Capacity;
  const hasTypeOrRpm =
    row.type_or_rpm ||
    row.Type ||
    row.type ||
    row.driveType ||
    row.DriveType;
  const hasFormFactor =
    row.form_factor ||
    row['form factor'] ||
    row.FormFactor ||
    row.formFactor;
  const hasInterface =
    row.interface ||
    row.Interface ||
    row.busInterface ||
    row.BusInterface;

  // Treat rows that look like Storage (HDD/SSD) as storage when no category is provided.
  return !!(hasCapacity && (hasTypeOrRpm || hasFormFactor || hasInterface));
}

// ---------- Mapping + DynamoDB helpers ----------

function mapRowToPartRecord(row, category) {
  // Prefer an explicit category from the CSV row if present,
  // and fall back to the request-level category or "unknown".
  const rowCategory =
    row.category ||
    row.Category ||
    row.partCategory ||
    row.PartCategory ||
    null;

  let finalCategory =
    (category && String(category).trim().length > 0
      ? String(category).trim()
      : null) ||
    (rowCategory && String(rowCategory).trim().length > 0
      ? String(rowCategory).trim()
      : null) ||
    null;

  // If neither the request nor the row provided a category, but the row clearly
  // looks like a Storage (HDD/SSD) part, infer "storage" as the category.
  if (!finalCategory && looksLikeStorageRow(row)) {
    finalCategory = 'storage';
  }

  if (!finalCategory) {
    finalCategory = 'unknown';
  }

  const name =
    row.name ||
    row.Name ||
    row.title ||
    row.Title ||
    row.productName ||
    row.ProductName ||
    row['\uFEFFname'];

  if (!name) {
    throw new Error(
      'Row is missing a recognizable name field (e.g., name, Name, title, productName).',
    );
  }

  let rawPrice =
    row.price ||
    row.Price ||
    row.FinalPrice ||
    row.basePrice ||
    row.BasePrice ||
    row.cost ||
    row.Cost ||
    row['prices/lowestPrice'] ||
    row['prices/prices/0/price'];

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

  let availability =
    row.availability ||
    row.Availability ||
    row.stockStatus ||
    row.StockStatus ||
    row.Instock ||
    row.inStock ||
    'unknown';

  // Always look at Apify PCPartPicker availability fields
  const apifyAvail = [
    row['prices/prices/0/availability'],
    row['prices/prices/1/availability'],
    row['prices/prices/2/availability'],
  ]
    .map((v) => (v ? String(v).trim() : ''))
    .filter((v) => v.length > 0);

  // If we didn't get a direct availability string, derive it from Apify vendors
  if ((!availability || availability === 'unknown') && apifyAvail.length > 0) {
    // Prefer any value containing "in stock" (case-insensitive), otherwise take the first non-empty value
    const inStockCandidate = apifyAvail.find((v) =>
      v.toLowerCase().includes('in stock'),
    );
    availability = inStockCandidate || apifyAvail[0];
  }

  let inStock = isInStock(availability);

  // If still not in stock, but any Apify vendor says "In stock", treat as in stock
  if (!inStock && apifyAvail.some((v) => v.toLowerCase().includes('in stock'))) {
    inStock = true;
  }

  const approvedRaw = row.approved ?? row.Approved ?? row['approved?'] ?? row['Approved?'];

  let approved;
  if (approvedRaw !== undefined && approvedRaw !== null && String(approvedRaw).trim() !== '') {
    const v = String(approvedRaw).toLowerCase();
    approved =
      approvedRaw === true ||
      v === 'true' ||
      v === 'yes' ||
      v === '1';
  } else {
    approved = undefined; // do not override existing DynamoDB value
  }

  const useInBuildsRaw =
    row.useInBuilds ??
    row.UseInBuilds ??
    row['use_in_builds'] ??
    row['Use_in_builds'];

  let useInBuilds;
  if (useInBuildsRaw !== undefined && useInBuildsRaw !== null && String(useInBuildsRaw).trim() !== '') {
    const v2 = String(useInBuildsRaw).toLowerCase();
    useInBuilds =
      useInBuildsRaw === true ||
      v2 === 'true' ||
      v2 === 'yes' ||
      v2 === '1';
  } else {
    useInBuilds = undefined;
  }

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

  if (String(finalCategory).toLowerCase() === 'storage') {
    addStorageSpecsFromRow(row, specs);
  }

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
    category: finalCategory,
    name,
    price: vendorEntry.price,
    vendor,
    availability,
    inStock,
    image,
    specs,
    vendorList: [vendorEntry],
    ...(approved !== undefined ? { approved } : {}),
    ...(useInBuilds !== undefined ? { useInBuilds } : {}),
  };
}

function addStorageSpecsFromRow(row, specs) {
  if (!row || !specs) return;

  // Capacity (e.g., "2 TB", "500 GB", "1.024 TB")
  const capacityRaw =
    row.capacity ||
    row.Capacity ||
    row.capacityRaw ||
    row.CapacityRaw ||
    null;

  if (capacityRaw) {
    const capStr = String(capacityRaw).trim();
    specs.capacityRaw = capStr;

    const match = capStr.match(/^([\d.]+)\s*(tb|gb)/i);
    if (match) {
      const value = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      if (!Number.isNaN(value)) {
        const gb = unit === 'tb' ? value * 1024 : value;
        specs.capacityGb = gb;
      }
    }
  }

  // Type vs RPM (SSD / HDD / Hybrid, and rpm if present)
  const typeOrRpm =
    row.type_or_rpm ||
    row.Type ||
    row.type ||
    row.driveType ||
    row.DriveType ||
    null;

  if (typeOrRpm) {
    const t = String(typeOrRpm).trim();

    if (/ssd/i.test(t)) {
      specs.storageType = 'ssd';
    } else if (/hybrid/i.test(t)) {
      specs.storageType = 'hybrid';
    } else if (/rpm/i.test(t)) {
      specs.storageType = 'hdd';
    } else {
      specs.storageType = t.toLowerCase();
    }

    const rpmMatch = t.match(/(\d+)\s*rpm/i);
    if (rpmMatch) {
      const rpmVal = parseInt(rpmMatch[1], 10);
      if (!Number.isNaN(rpmVal)) {
        specs.rpm = rpmVal;
      }
    }
  }

  // Cache (e.g., "256 MB")
  const cacheRaw = row.cache || row.Cache || null;
  if (cacheRaw) {
    const cacheStr = String(cacheRaw).trim();
    const cacheMatch = cacheStr.match(/([\d.]+)/);
    if (cacheMatch) {
      const cacheMb = parseFloat(cacheMatch[1]);
      if (!Number.isNaN(cacheMb)) {
        specs.cacheMb = cacheMb;
      }
    }
  }

  // Form factor (e.g., "M.2-2280", "2.5\"", "3.5\"")
  const formFactor =
    row.form_factor ||
    row['form factor'] ||
    row.FormFactor ||
    row.formFactor ||
    null;
  if (formFactor) {
    specs.formFactor = String(formFactor).trim();
  }

  // Interface + NVMe flag (e.g., "M.2 PCIe 4.0 X4", "SATA 6.0 Gb/s")
  const iface =
    row.interface ||
    row.Interface ||
    row.busInterface ||
    row.BusInterface ||
    null;
  if (iface) {
    const ifaceStr = String(iface).trim();
    specs.interface = ifaceStr;
    specs.isNvme = /pcie/i.test(ifaceStr);
  }

  // Price per GB (strip currency symbols)
  const pricePerGbRaw =
    row.price_per_gb ||
    row.pricePerGb ||
    row.PricePerGb ||
    null;
  if (pricePerGbRaw) {
    const num = parseFloat(String(pricePerGbRaw).replace(/[^0-9.]/g, ''));
    if (!Number.isNaN(num)) {
      specs.pricePerGb = num;
    }
  }

  // Rating count
  const ratingRaw =
    row.rating_count ||
    row.RatingCount ||
    row.ratings ||
    row.Ratings ||
    null;
  if (
    ratingRaw !== null &&
    ratingRaw !== undefined &&
    String(ratingRaw).trim() !== ''
  ) {
    const ratingNum = parseInt(String(ratingRaw).replace(/[^0-9]/g, ''), 10);
    if (!Number.isNaN(ratingNum)) {
      specs.ratingCount = ratingNum;
    }
  }
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

  const hasApproved = Object.prototype.hasOwnProperty.call(record, 'approved');
  const hasUseInBuilds = Object.prototype.hasOwnProperty.call(record, 'useInBuilds');

  const now = new Date().toISOString();

  const categoryUpdate =
    record.category === 'storage'
      ? '#category = :category'
      : '#category = if_not_exists(#category, :category)';

  const updateParts = [
    categoryUpdate,
    '#name = if_not_exists(#name, :name)',
    '#specs = if_not_exists(#specs, :specs)',
    '#price = :price',
    '#vendor = :vendor',
    '#availability = :availability',
    '#inStock = :inStock',
    '#isDeleted = if_not_exists(#isDeleted, :isDeletedFalse)',
    '#image = if_not_exists(#image, :image)',
    '#vendorList = :vendorList',
    '#updatedAt = :updatedAt',
  ];

  if (hasApproved) {
    updateParts.push('#approved = :approved');
  }
  if (hasUseInBuilds) {
    updateParts.push('#useInBuilds = :useInBuilds');
  }

  const updateExpression = 'SET ' + updateParts.join(', ');

  const expressionAttributeNames = {
    '#category': 'category',
    '#name': 'name',
    '#specs': 'specs',
    '#price': 'price',
    '#vendor': 'vendor',
    '#availability': 'availability',
    '#inStock': 'inStock',
    '#isDeleted': 'isDeleted',
    '#image': 'image',
    '#vendorList': 'vendorList',
    '#updatedAt': 'updatedAt',
  };
  if (hasApproved) {
    expressionAttributeNames['#approved'] = 'approved';
  }
  if (hasUseInBuilds) {
    expressionAttributeNames['#useInBuilds'] = 'useInBuilds';
  }

  const expressionAttributeValues = {
    ':category': record.category,
    ':name': record.name,
    ':specs': record.specs || {},
    ':price':
      record.price !== undefined && !Number.isNaN(record.price)
        ? record.price
        : null,
    ':vendor': record.vendor,
    ':availability': record.availability,
    ':inStock': !!record.inStock,
    ':isDeletedFalse': false,
    ':image': record.image || 'https://example.com/images/placeholder.png',
    ':vendorList': record.vendorList,
    ':updatedAt': now,
  };

  if (hasApproved) {
    expressionAttributeValues[':approved'] = record.approved === true;
  }
  if (hasUseInBuilds) {
    expressionAttributeValues[':useInBuilds'] = record.useInBuilds === true;
  }

  const params = {
    TableName: PARTS_TABLE_NAME,
    Key: { id: record.id },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
  };

  await dynamoDb.update(params).promise();
}