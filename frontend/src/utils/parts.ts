import type { Part } from "../api/client";

export const getBestPrice = (p: Part): number | null => {
  if (typeof p.price === "number") {
    return p.price;
  }
  if (Array.isArray(p.vendorList)) {
    const candidates = p.vendorList.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (v: any) => typeof v?.price === "number",
    );
    if (candidates.length > 0) {
      // smallest vendor price
      return candidates.reduce(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (acc: number, v: any) => (v.price < acc ? v.price : acc),
        candidates[0].price,
      );
    }
  }
  return null;
};

export const getCoreCount = (p: Part): number | null => {
  const raw =
    (p.specs?.cores as string | undefined) ||
    (p.specs?.["Core Count"] as string | undefined) ||
    (p.specs?.["Core count"] as string | undefined);
  if (!raw) return null;
  const m = String(raw).match(/\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
};

export const getSocket = (p: Part): string => {
  const specs = p.specs ?? {};

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

  // Fallback: any spec key that mentions "socket"
  const socketKey = Object.keys(specs).find((k) =>
    k.toLowerCase().includes("socket"),
  );
  if (socketKey) {
    return String(
      specs[socketKey as keyof typeof specs] ?? "",
    ).trim();
  }

  return "";
};

export const normalizeSocket = (value: string): string =>
  value
    .toLowerCase()
    // Remove spaces, dashes and other non-alphanumeric chars for better matching:
    // e.g. "LGA 1700" vs "LGA1700"
    .replace(/[^a-z0-9]/g, "");

export const formatMoney = (value: number): string =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
