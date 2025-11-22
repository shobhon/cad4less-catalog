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
  if (typeof (p as any).price === "number") {
    return (p as any).price;
  }

  const vendorList = (p as any).vendorList;
  if (Array.isArray(vendorList)) {
    const candidates = vendorList.filter(
      (v: any) => typeof v?.price === "number"
    );
    if (candidates.length > 0) {
      return candidates.reduce(
        (acc: number, v: any) => (v.price < acc ? v.price : acc),
        candidates[0].price as number
      );
    }
  }

  return null;
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
