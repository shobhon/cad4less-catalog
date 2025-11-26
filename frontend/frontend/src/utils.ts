

import type { Part } from "./api/client";

export type BestPriceResult = {
  store: string;
  price: number;
  url?: string | null;
  source?: string | null;
};

/**
 * Format a numeric price as a currency string.
 * Defaults to USD and returns "N/A" for null/undefined/invalid values.
 */
export function formatMoney(
  value: number | null | undefined,
  currency: string = "USD"
): string {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Fallback in case Intl or the currency code fails for any reason
    const safe = Number.isFinite(value) ? value : 0;
    return `$${safe.toFixed(2)}`;
  }
}

/**
 * Normalize an arbitrary array of raw offer objects into a consistent shape
 * so we can reliably select the best (lowest) price.
 *
 * This is intentionally defensive and works with multiple possible field names
 * so that it can be reused across categories (CPU, Motherboard, Cooler,
 * Memory/RAM, Video Card, etc.) without coupling to a single backend shape.
 */
function normaliseOffersFromArray(
  arr: any[] | null | undefined
): BestPriceResult[] {
  if (!Array.isArray(arr)) return [];

  const results: BestPriceResult[] = [];

  for (const raw of arr) {
    if (!raw) continue;

    const price = Number(
      raw.price ??
        raw.amount ??
        raw.value ??
        raw.unitPrice ??
        raw.unit_price
    );

    if (!Number.isFinite(price) || price <= 0) continue;

    const store: string =
      raw.store ??
      raw.vendor ??
      raw.merchant ??
      raw.seller ??
      raw.name ??
      "Unknown";

    const url: string | null =
      raw.url ??
      raw.link ??
      raw.href ??
      raw.offerUrl ??
      raw.offer_url ??
      null;

    const source: string | null =
      raw.source ??
      raw.sourceName ??
      raw.origin ??
      null;

    results.push({ store, price, url, source });
  }

  return results;
}

/**
 * Determine the best (lowest) price for a given part across all known offers.
 *
 * This function is used consistently by the catalog modules (CPU, Motherboard,
 * Cooler, Memory/RAM, Video Card, etc.) to drive the "Store" and "Price"
 * columns. It is deliberately defensive and category-agnostic:
 *
 * - First prefers explicit vendor/offer arrays (vendorPrices, offers, prices, etc.)
 * - Then falls back to explicit "best price" fields if present
 * - Finally falls back to the part's own price/store, if nothing else is available
 *
 * Returns `null` if no usable price can be determined.
 */
export function getBestPrice(part: Part): BestPriceResult | null {
  const anyPart: any = part as any;

  const offers: BestPriceResult[] = [];

  // Primary source: explicit vendor / offer arrays
  offers.push(
    ...normaliseOffersFromArray(
      anyPart.vendorPrices ??
        anyPart.offers ??
        anyPart.priceOffers ??
        anyPart.priceEntries ??
        anyPart.prices
    )
  );

  // Secondary source: explicit "best price" fields on the part, if present
  if (anyPart.bestPrice != null || anyPart.bestPriceStore) {
    const price = Number(
      anyPart.bestPrice ??
        anyPart.price
    );

    if (Number.isFinite(price) && price > 0) {
      offers.push({
        store: anyPart.bestPriceStore ?? anyPart.store ?? "Unknown",
        price,
        url:
          anyPart.bestPriceUrl ??
          anyPart.detailUrl ??
          anyPart.pcpartpickerUrl ??
          anyPart.pcpartpickerPriceListUrl ??
          null,
        source: anyPart.bestPriceSource ?? "bestPrice",
      });
    }
  }

  // Final fallback: part-level store/price, if nothing else exists
  if (!offers.length && (anyPart.price != null || anyPart.store)) {
    const price = Number(anyPart.price);

    if (Number.isFinite(price) && price > 0) {
      offers.push({
        store: anyPart.store ?? "Unknown",
        price,
        url:
          anyPart.detailUrl ??
          anyPart.pcpartpickerUrl ??
          anyPart.pcpartpickerPriceListUrl ??
          null,
        source: "part",
      });
    }
  }

  if (!offers.length) {
    return null;
  }

  // Choose the lowest-priced offer (ties resolved by first occurrence)
  let best = offers[0];
  for (const offer of offers) {
    if (offer.price < best.price) {
      best = offer;
    }
  }

  return best;
}