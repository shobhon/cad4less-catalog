import type { Part } from "./api/client";

/**
 * Format a number as USD (e.g. $129.99).
 */
export function formatMoney(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}

/**
 * Get the best (lowest) numeric price from either the top-level price
 * or any vendorList entries.
 */
export function getBestPrice(p: Part): number | null {
  const rawTopLevelPrice = (p as any).price;

  const parsedTopLevelPrice =
    typeof rawTopLevelPrice === "number"
      ? rawTopLevelPrice
      : typeof rawTopLevelPrice === "string"
      ? Number(rawTopLevelPrice.replace(/[^0-9.]/g, ""))
      : NaN;

  const vendorList = (p as any).vendorList;
  const vendorPrices: number[] = [];

  if (Array.isArray(vendorList)) {
    for (const v of vendorList) {
      const raw = v?.price;
      const parsed =
        typeof raw === "number"
          ? raw
          : typeof raw === "string"
          ? Number(String(raw).replace(/[^0-9.]/g, ""))
          : NaN;
      if (!Number.isNaN(parsed)) {
        vendorPrices.push(parsed);
      }
    }
  }

  const candidates: number[] = [];

  if (!Number.isNaN(parsedTopLevelPrice)) {
    candidates.push(parsedTopLevelPrice);
  }

  candidates.push(...vendorPrices);

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce(
    (min, value) => (value < min ? value : min),
    candidates[0]
  );
}

/**
 * Try to read a CPU / motherboard socket string from the specs bag.
 */
export function getSocket(p: Part): string {
  const specs: Record<string, unknown> = ((p as any).specs ?? {}) as Record<
    string,
    unknown
  >;

  const direct =
    (specs.socket as string | undefined) ||
    (specs.Socket as string | undefined) ||
    (specs["CPU Socket"] as string | undefined) ||
    (specs["CPU Socket Type"] as string | undefined) ||
    (specs["Socket / CPU"] as string | undefined) ||
    (specs["Socket / CPU Type"] as string | undefined) ||
    (specs["Socket Type"] as string | undefined);

  if (direct && String(direct).trim()) {
    return String(direct).trim();
  }

  const socketKey = Object.keys(specs).find((k) =>
    k.toLowerCase().includes("socket")
  );
  if (socketKey) {
    return String(specs[socketKey] ?? "").trim();
  }

  return "";
}
