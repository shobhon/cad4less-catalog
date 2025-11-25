import { parseCsv } from '../csvParser';
import { upsertPart } from '../database/parts';

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(body),
  };
}

function mapRowToPartRecord(row, category) {
  // Prefer an explicit category from the CSV row if present,
  // and fall back to the request-level category or "unknown".
  const rowCategory =
    row.category ||
    row.Category ||
    row.partCategory ||
    row.PartCategory ||
    null;

  const finalCategory =
    (rowCategory && String(rowCategory).trim().length > 0
      ? String(rowCategory).trim()
      : null) ||
    (category && String(category).trim().length > 0
      ? String(category).trim()
      : null) ||
    'unknown';

  // Name field can be BOM-prefixed in the CSV ("\ufeff\"name\"")
  const rawName =
    row.name ||
    row.Name ||
    row['\ufeff"name"'] ||
    null;
  const name = rawName ? String(rawName).trim() : null;

  // Choose a stable id: prefer explicit ids, then Part #, then URL, then name.
  const id =
    row.id ||
    row.ID ||
    row.partId ||
    row.PartId ||
    row.partID ||
    row.PartID ||
    row['specifications/Part #'] ||
    row.url ||
    name ||
    null;

  // Extract pricing and vendor info from the Apify "prices/..." structure
  const rawLowestPrice =
    row['prices/lowestPrice'] ||
    row['prices/prices/0/price'] ||
    row['prices/prices/1/price'] ||
    row['prices/prices/2/price'] ||
    row.price ||
    row.Price ||
    null;

  const price = rawLowestPrice ? Number(String(rawLowestPrice).replace(/[^0-9.]/g, '')) || 0 : 0;

  const merchants = [
    row['prices/prices/0/merchant'],
    row['prices/prices/1/merchant'],
    row['prices/prices/2/merchant'],
    row.vendor,
    row.Vendor,
  ].filter(Boolean);
  const vendor = merchants.length > 0 ? String(merchants[0]) : null;

  const availabilities = [
    row['prices/prices/0/availability'],
    row['prices/prices/1/availability'],
    row['prices/prices/2/availability'],
    row.availability,
    row.Availability,
  ].filter(Boolean);
  const availability =
    availabilities.length > 0 ? String(availabilities[0]) : null;

  const buyLinks = [
    row['prices/prices/0/buyLink'],
    row['prices/prices/1/buyLink'],
    row['prices/prices/2/buyLink'],
    row.url,
  ].filter(Boolean);
  const buyLink = buyLinks.length > 0 ? String(buyLinks[0]) : null;

  const currencies = [
    row['prices/prices/0/currency'],
    row['prices/prices/1/currency'],
    row['prices/prices/2/currency'],
  ].filter(Boolean);
  const currency = currencies.length > 0 ? String(currencies[0]) : null;

  // Consider anything that does NOT explicitly say "out of stock" as in stock.
  const availabilityText = availability ? availability.toLowerCase() : '';
  const inStock =
    availabilityText.length === 0 ||
    !availabilityText.includes('out of stock');

  const vendorEntry = {
    merchant: vendor,
    price,
    buyLink,
    currency,
    availability,
  };

  return {
    id,
    category: finalCategory,
    name,
    price,
    vendor,
    availability,
    inStock,
    url: row.url || null,
    vendorList: [vendorEntry],
  };
}

exports.handler = async (event) => {
  if (
    event.httpMethod === 'POST' &&
    event.path &&
    event.path.endsWith('/parts/import-csv')
  ) {
    const payload = event.body ? JSON.parse(event.body) : {};
    const { category, csv } = payload || {};

    // Category is optional; we prefer the per-row CSV "Category" column.
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

        // Always attempt to upsert; do not skip based on inStock.
        await upsertPart(record);
        results.succeeded += 1;
      } catch (err) {
        results.failed += 1;
        results.errors.push({ index: i, message: err.message });
      }
    }

    console.log('ImportPartsFunction /parts/import-csv summary:', results);
    results.skippedNotInStock = 0;

    return jsonResponse(200, {
      message: 'CSV import completed (ts v2)',
      ...results,
    });
  }

  // Other routes and logic remain unchanged
};