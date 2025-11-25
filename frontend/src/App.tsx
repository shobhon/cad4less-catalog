import React, { useState, useEffect } from "react";
import { fetchParts, Part, updatePartApproved, runApifyImport, importPartsFromCsv } from "./api/client";
import { formatMoney, getBestPrice as baseGetBestPrice } from "./utils";

type SortKey = "name-asc" | "price-asc" | "price-desc";

type ApifyCategory =
  | "cpu"
  | "cpu-cooler"
  | "motherboard"
  | "memory"
  | "storage"
  | "video-card"
  | "case"
  | "power-supply"
  | "operating-system"
  | "monitor"
  | "expansion-cards-networking"
  | "peripherals"
  | "accessories-other";

const PAGE_SIZE = 10;

const socketCellStyle: React.CSSProperties = {
  whiteSpace: "nowrap",
  maxWidth: "220px",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function deepFindString(obj: any, keyTest: (key: string) => boolean): string | null {
  const stack: any[] = [obj];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;

    for (const [key, value] of Object.entries(current)) {
      if (keyTest(key)) {
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
  return null;
}

function deepFindNumber(obj: any, keyTest: (key: string) => boolean): number | null {
  const stack: any[] = [obj];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;

    for (const [key, value] of Object.entries(current)) {
      if (keyTest(key)) {
        if (typeof value === "number" && Number.isFinite(value)) {
          return value;
        }
        if (typeof value === "string") {
          const parsed = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }
      }
      if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
  return null;
}

function getBestPrice(p: Part): number | null {
  // Try the original helper first, in case it already knows the schema.
  try {
    const base = (baseGetBestPrice as any)?.(p);
    if (typeof base === "number" && Number.isFinite(base)) {
      return base;
    }
  } catch {
    // ignore and fall back to manual logic
  }

  const anyPart = p as any;
  const candidates: number[] = [];

  const pushPriceLike = (val: unknown) => {
    if (typeof val === "number" && Number.isFinite(val) && val > 0) {
      candidates.push(val);
    } else if (typeof val === "string") {
      const parsed = Number.parseFloat(val.replace(/[^0-9.]/g, ""));
      if (Number.isFinite(parsed) && parsed > 0) {
        candidates.push(parsed);
      }
    }
  };

  // Top-level price
  pushPriceLike(anyPart.price);

  // Attribute-style rows: { name: "Price", value: "$123.45" }
  const stackAttr: any[] = [anyPart];
  while (stackAttr.length) {
    const current = stackAttr.pop();
    if (!current || typeof current !== "object") continue;

    const c: any = current;
    if (typeof c.name === "string" && c.name.toLowerCase().includes("price")) {
      const raw = c.value ?? c.val ?? c.amount ?? c.price;
      if (raw != null) {
        pushPriceLike(raw);
      }
    }

    for (const v of Object.values(current)) {
      if (v && typeof v === "object") stackAttr.push(v);
    }
  }

  // Common nested vendor lists from PcPartPicker / Apify style data
  const vendorLists: any[] = [];
  if (Array.isArray(anyPart.vendorList)) vendorLists.push(...anyPart.vendorList);
  if (Array.isArray(anyPart.vendors)) vendorLists.push(...anyPart.vendors);
  if (Array.isArray(anyPart.offers)) vendorLists.push(...anyPart.offers);

  for (const v of vendorLists) {
    if (!v) continue;
    const vv: any = v;
    pushPriceLike(vv.price ?? vv.priceWithTax ?? vv.amount);
  }

  if (candidates.length > 0) {
    return Math.min(...candidates);
  }

  // Last resort: search anywhere in the object for a numeric "price" field.
  const deep = deepFindNumber(anyPart, (key) => {
    const k = key.toLowerCase();
    return k === "price" || k.endsWith("price");
  });

  return deep != null && Number.isFinite(deep) ? deep : null;
}

function findSocketViaNameValue(obj: any): string | null {
  const stack: any[] = [obj];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;

    const c: any = current;
    if (typeof c.name === "string" && c.name.toLowerCase().includes("socket")) {
      const raw = c.value ?? c.val ?? c.text ?? c.data;
      if (raw != null && String(raw).trim()) {
        const s = String(raw).trim();
        if (!/^https?:\/\//i.test(s)) {
          return s;
        }
      }
    }

    for (const v of Object.values(current)) {
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return null;
}

function getSocket(p: Part): string {
  const anyPart = p as any;

  // Top-level shortcuts
  const directTop =
    (anyPart.socket as string | undefined) ||
    (anyPart.Socket as string | undefined) ||
    (anyPart.cpuSocket as string | undefined) ||
    (anyPart.CPUSocket as string | undefined);

  if (directTop && String(directTop).trim()) {
    return String(directTop).trim();
  }

  // Specs / attributes-style objects
  const specs = (anyPart.specs ?? anyPart.Specs ?? anyPart.attributes ?? {}) as any;

  const directSpecs =
    (specs.socket as string | undefined) ||
    (specs.Socket as string | undefined) ||
    (specs["CPU Socket"] as string | undefined) ||
    (specs["CPU Socket Type"] as string | undefined) ||
    (specs["Socket / CPU"] as string | undefined) ||
    (specs["Socket / CPU Type"] as string | undefined) ||
    (specs["Socket Type"] as string | undefined);

  if (directSpecs && String(directSpecs).trim()) {
    return String(directSpecs).trim();
  }

  // Keys that *mention* socket inside specs
  const socketKey = Object.keys(specs).find((k) => k.toLowerCase().includes("socket"));
  if (socketKey) {
    const v = specs[socketKey];
    if (v != null && String(v).trim() && !/^https?:\/\//i.test(String(v))) {
      return String(v).trim();
    }
  }

  // Fallback to any top-level property that looks like socket,
  // but avoid URL-shaped values.
  const topLevelSocketKey = Object.keys(anyPart).find((k) =>
    k.toLowerCase().includes("socket")
  );
  if (topLevelSocketKey) {
    const v = anyPart[topLevelSocketKey];
    if (v != null && String(v).trim() && !/^https?:\/\//i.test(String(v))) {
      return String(v).trim();
    }
  }

  // Attribute-style arrays: { name: "Socket", value: "LGA1700" }
  const fromNameValue = findSocketViaNameValue(anyPart);
  if (fromNameValue) {
    return fromNameValue;
  }

  // Deep fallback: look anywhere in the object for a field whose key mentions "socket".
  const deepSocket = deepFindString(anyPart, (key) => key.toLowerCase().includes("socket"));
  if (deepSocket && !/^https?:\/\//i.test(deepSocket)) {
    return deepSocket;
  }

  // As a last resort, try to parse the socket from the product name itself
  const nameRaw =
    (p.name as string | undefined) ||
    (anyPart.title as string | undefined) ||
    (anyPart.productName as string | undefined);

  if (nameRaw && nameRaw.trim()) {
    const m = nameRaw.match(/(LGA ?\d{3,5}|AM[2-5]|TR4|sTRX4)/i);
    if (m) {
      return m[0].replace(/\s+/g, "").toUpperCase();
    }
  }
  return "";
}

function extractSocketTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const value = raw.toString();
  const tokens: string[] = [];

  const regex = /(LGA ?\d{3,5}|AM[2-5]|FM[12]|TR4|sTRX4|SP3)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value))) {
    const normalized = match[0].replace(/\s+/g, "").toUpperCase();
    tokens.push(normalized);
  }

  if (!tokens.length) {
    value
      .split(/[\/,]+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => tokens.push(t.toUpperCase()));
  }

  return Array.from(new Set(tokens));
}

function normalizeSocket(value: string | null | undefined): string {
  if (!value) return "";
  return value.toString().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isInStock(p: Part): boolean {
  const anyPart = p as any;

  if (typeof anyPart.inStock === "boolean" && anyPart.inStock) {
    return true;
  }

  const vendorLists: any[] = [];
  if (Array.isArray(anyPart.vendorList)) vendorLists.push(...anyPart.vendorList);
  if (Array.isArray(anyPart.vendors)) vendorLists.push(...anyPart.vendors);
  if (Array.isArray(anyPart.offers)) vendorLists.push(...anyPart.offers);

  let sawExplicitOutOfStock = false;
  for (const v of vendorLists) {
    if (!v) continue;
    const avail = (v.availability ?? v.stockStatus ?? v.status ?? "")
      .toString()
      .toLowerCase()
      .trim();

    if (!avail) continue;

    if (
      avail.includes("in stock") ||
      avail.includes("available") ||
      avail.includes("in-store") ||
      avail.includes("ready to ship")
    ) {
      return true;
    }

    if (
      avail.includes("out of stock") ||
      avail.includes("out-of-stock") ||
      avail.includes("sold out") ||
      avail.includes("unavailable") ||
      avail.includes("backorder") ||
      avail.includes("back-order") ||
      avail.includes("preorder") ||
      avail.includes("pre-order")
    ) {
      sawExplicitOutOfStock = true;
    }
  }

  const availabilityRaw = (
    p.availability ??
    anyPart.stockStatus ??
    anyPart.availabilityStatus ??
    ""
  )
    .toString()
    .toLowerCase()
    .trim();

  if (sawExplicitOutOfStock) {
    return false;
  }

  if (availabilityRaw) {
    if (availabilityRaw.includes("out of stock")) return false;
    if (availabilityRaw.includes("out-of-stock")) return false;
    if (availabilityRaw.includes("unavailable")) return false;
    if (availabilityRaw.includes("sold out")) return false;
    if (availabilityRaw.includes("preorder") || availabilityRaw.includes("pre-order"))
      return false;
    if (availabilityRaw.includes("backorder") || availabilityRaw.includes("back-order"))
      return false;

    return true;
  }

  return true;
}

function inferStoreFromBuyLink(anyPart: any): string | null {
  const vendorLists: any[] = [];
  if (Array.isArray(anyPart.vendorList)) vendorLists.push(...anyPart.vendorList);
  if (Array.isArray(anyPart.vendors)) vendorLists.push(...anyPart.vendors);
  if (Array.isArray(anyPart.offers)) vendorLists.push(...anyPart.offers);

  for (const v of vendorLists) {
    if (!v || typeof v !== "object") continue;
    const vv: any = v;
    const raw =
      (vv.buyLink as string | undefined) ||
      (vv.url as string | undefined) ||
      (vv.link as string | undefined);
    if (!raw || typeof raw !== "string") continue;

    try {
      const u = new URL(raw);
      let host = u.hostname.toLowerCase();
      if (host.startsWith("www.")) host = host.slice(4);

      if (host.includes("amazon.")) return "amazon";
      if (host.includes("newegg.")) return "newegg";
      if (host.includes("pcpartpicker.")) return "pcpartpicker";
      if (host.includes("bestbuy.")) return "bestbuy";
      if (host.includes("bhphotovideo.")) return "bhphotovideo";
      if (host.includes("walmart.")) return "walmart";

      const base = host.split(".")[0];
      if (base) return base;
    } catch {
      // ignore malformed URLs
    }
  }

  return null;
}

function getStoreLabel(p: Part): string {
  const anyPart = p as any;

  const isPlaceholder = (v?: string | null) => {
    if (!v) return true;
    const s = v.toLowerCase().trim();
    return !s || s === "manual" || s === "unknown" || s === "other";
  };

  let direct =
    (anyPart.store as string | undefined) ||
    (anyPart.Store as string | undefined) ||
    (anyPart.vendor as string | undefined) ||
    (anyPart.Vendor as string | undefined) ||
    (anyPart.source as string | undefined) ||
    (anyPart.Source as string | undefined);

  if (direct && !isPlaceholder(direct)) {
    return direct.trim();
  }

  const vendorLists: any[] = [];
  if (Array.isArray(anyPart.vendorList)) vendorLists.push(...anyPart.vendorList);
  if (Array.isArray(anyPart.vendors)) vendorLists.push(...anyPart.vendors);
  if (Array.isArray(anyPart.offers)) vendorLists.push(...anyPart.offers);

  for (const v of vendorLists) {
    if (!v) continue;
    const vv: any = v;
    const candidate =
      (vv.store as string | undefined) ||
      (vv.vendor as string | undefined) ||
      (vv.name as string | undefined) ||
      (vv.merchant as string | undefined) ||
      (vv.shopName as string | undefined);

    if (candidate && !isPlaceholder(candidate)) {
      return candidate.trim();
    }
  }

  const inferredFromUrl = inferStoreFromBuyLink(anyPart);
  if (inferredFromUrl && !isPlaceholder(inferredFromUrl)) {
    return inferredFromUrl;
  }

  for (const [key, val] of Object.entries(anyPart)) {
    if (
      typeof val === "string" &&
      val.trim() &&
      !isPlaceholder(val) &&
      (key.toLowerCase().includes("store") ||
        key.toLowerCase().includes("vendor") ||
        key.toLowerCase().includes("seller") ||
        key.toLowerCase().includes("source"))
    ) {
      return val.trim();
    }
  }

  const deepStore = deepFindString(anyPart, (key) => {
    const k = key.toLowerCase();
    return (
      k.includes("store") ||
      k.includes("vendor") ||
      k.includes("seller") ||
      k.includes("merchant") ||
      k.includes("source")
    );
  });
  if (deepStore && !isPlaceholder(deepStore)) {
    return deepStore;
  }

  return "unknown";
}

function getPrimaryOffer(p: Part): { label: string; url: string | null } {
  const anyPart = p as any;

  let label = getStoreLabel(p);
  let url: string | null = null;

  const vendorLists: any[] = [];
  if (Array.isArray(anyPart.vendorList)) vendorLists.push(...anyPart.vendorList);
  if (Array.isArray(anyPart.vendors)) vendorLists.push(...anyPart.vendors);
  if (Array.isArray(anyPart.offers)) vendorLists.push(...anyPart.offers);

  if (label && label !== "unknown" && vendorLists.length) {
    const lowerLabel = label.toLowerCase().trim();
    const match = vendorLists.find((v) => {
      if (!v || typeof v !== "object") return false;
      const vv: any = v;
      const candidates = [
        vv.store,
        vv.Store,
        vv.vendor,
        vv.Vendor,
        vv.name,
        vv.merchant,
        vv.shopName,
      ];
      return candidates.some(
        (c) => typeof c === "string" && c.toLowerCase().trim() === lowerLabel
      );
    });

    if (match) {
      const m: any = match;
      url =
        (m.buyLink as string | undefined) ??
        (m.url as string | undefined) ??
        (m.link as string | undefined) ??
        null;
    }
  }

  if (!url && vendorLists.length) {
    const v0: any = vendorLists[0];
    if (!label || label === "unknown") {
      const candidate =
        (v0.store as string | undefined) ??
        (v0.vendor as string | undefined) ??
        (v0.name as string | undefined) ??
        (v0.merchant as string | undefined) ??
        (v0.shopName as string | undefined);
      if (candidate) {
        label = candidate;
      }
    }

    url =
      (v0.buyLink as string | undefined) ??
      (v0.url as string | undefined) ??
      (v0.link as string | undefined) ??
      null;
  }

  if (!label) {
    label = "unknown";
  }

  return { label, url };
}

function applyFiltersAndSorting(
  items: Part[],
  searchText: string,
  storeFilter: string,
  sortKey: SortKey,
  options?: { requirePrice?: boolean; socketFilterKeys?: string[] }
) {
  const requirePrice = options?.requirePrice ?? false;
  const socketFilterKeys = options?.socketFilterKeys ?? [];
  const normalizedSearch = searchText.trim().toLowerCase();

  const filtered = items.filter((p) => {
    if (!isInStock(p)) return false;

    if (requirePrice) {
      const price = getBestPrice(p);
      if (price == null || !Number.isFinite(price) || price <= 0) {
        return false;
      }
    }

    if (socketFilterKeys.length) {
      const rawSocket = getSocket(p);
      const partTokens = extractSocketTokens(rawSocket);
      const partNorms = partTokens.map((t) => normalizeSocket(t));
      const hasOverlap = partNorms.some((norm) => socketFilterKeys.includes(norm));
      if (!hasOverlap) {
        return false;
      }
    }

    if (storeFilter !== "all") {
      if (!getStoreLabel(p) || getStoreLabel(p) !== storeFilter) {
        return false;
      }
    }

    if (!normalizedSearch) return true;

    const name = (p.name ?? "").toLowerCase();
    const id = (p.id ?? "").toLowerCase();
    const socket = getSocket(p).toLowerCase();

    return (
      name.includes(normalizedSearch) ||
      id.includes(normalizedSearch) ||
      socket.includes(normalizedSearch)
    );
  });

  const sorted = [...filtered].sort((a, b) => {
    const aName = (a.name ?? "").toString();
    const bName = (b.name ?? "").toString();

    if (sortKey === "name-asc") {
      return aName.localeCompare(bName, "en-US", { sensitivity: "base" });
    }

    const aPrice = getBestPrice(a);
    const bPrice = getBestPrice(b);

    const aNum = typeof aPrice === "number" ? aPrice : Infinity;
    const bNum = typeof bPrice === "number" ? bPrice : Infinity;

    if (sortKey === "price-asc") {
      return aNum - bNum;
    }

    if (sortKey === "price-desc") {
      return bNum - aNum;
    }

    return 0;
  });

  return { filtered, sorted };
}

function getStoreOptions(items: Part[]): string[] {
  const set = new Set<string>();
  for (const p of items) {
    const label = getStoreLabel(p);
    if (label && label !== "unknown") {
      set.add(label);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function CatalogDashboard() {
  // ---- CPU catalog state ----
  const [cpus, setCpus] = useState<Part[]>([]);
  const [loadingCpus, setLoadingCpus] = useState(false);
  const [cpuError, setCpuError] = useState<string | null>(null);
  const [cpuSearch, setCpuSearch] = useState("");
  const [cpuStoreFilter, setCpuStoreFilter] = useState<string>("all");
  const [cpuSortKey, setCpuSortKey] = useState<SortKey>("name-asc");
  const [cpuPage, setCpuPage] = useState(1);

  // ---- Motherboard catalog state ----
  const [motherboards, setMotherboards] = useState<Part[]>([]);
  const [loadingMotherboards, setLoadingMotherboards] = useState(false);
  const [mbError, setMbError] = useState<string | null>(null);
  const [mbSearch, setMbSearch] = useState("");
  const [mbStoreFilter, setMbStoreFilter] = useState<string>("all");
  const [mbSortKey, setMbSortKey] = useState<SortKey>("name-asc");
  const [mbPage, setMbPage] = useState(1);
  const [lastMbRefreshTime, setLastMbRefreshTime] = useState<Date | null>(null);

  // ---- CPU Cooler catalog state ----
  const [coolers, setCoolers] = useState<Part[]>([]);
  const [loadingCoolers, setLoadingCoolers] = useState(false);
  const [coolerError, setCoolerError] = useState<string | null>(null);
  const [coolerSearch, setCoolerSearch] = useState("");
  const [coolerStoreFilter, setCoolerStoreFilter] = useState<string>("all");
  const [coolerSortKey, setCoolerSortKey] = useState<SortKey>("name-asc");
  const [coolerPage, setCoolerPage] = useState(1);

  // ---- Compatibility filter state ----
  const [activeSocket, setActiveSocket] = useState<string | null>(null);
  const [activeSocketLabel, setActiveSocketLabel] = useState<string | null>(null);
  const [activeSocketKeys, setActiveSocketKeys] = useState<string[]>([]);
  const [activeSource, setActiveSource] = useState<"cpu" | "motherboard" | "cooler" | null>(
    null
  );

  const clearCompatibilityFilter = React.useCallback(() => {
    setActiveSocket(null);
    setActiveSocketLabel(null);
    setActiveSocketKeys([]);
    setActiveSource(null);
    setCpuPage(1);
    setMbPage(1);
    setCoolerPage(1);
  }, []);

  const handleRowClick = React.useCallback(
    (source: "cpu" | "motherboard" | "cooler", part: Part) => {
      const rawSocket = getSocket(part);
      const tokens = extractSocketTokens(rawSocket);
      if (!tokens.length) {
        clearCompatibilityFilter();
        return;
      }

      const label = rawSocket && rawSocket.trim() ? rawSocket.trim() : tokens.join(", ");

      setActiveSocket(label);
      setActiveSocketLabel(label);
      setActiveSocketKeys(tokens.map((t) => normalizeSocket(t)));
      setActiveSource(source);

      if (source !== "cpu") setCpuPage(1);
      if (source !== "motherboard") setMbPage(1);
      if (source !== "cooler") setCoolerPage(1);
    },
    [clearCompatibilityFilter]
  );

  const loadCpus = React.useCallback(async () => {
    try {
      setLoadingCpus(true);
      setCpuError(null);
      const data = await fetchParts("cpu" as any, "all");
      setCpus(data.parts ?? []);
      setCpuPage(1);
    } catch (err: any) {
      console.error("Failed to fetch CPUs", err);
      setCpuError(err?.message ?? "Failed to fetch CPUs");
    } finally {
      setLoadingCpus(false);
    }
  }, []);

  const loadMotherboards = React.useCallback(async () => {
    try {
      setLoadingMotherboards(true);
      setMbError(null);
      const data = await fetchParts("motherboard" as any, "all");
      setMotherboards(data.parts ?? []);
      setLastMbRefreshTime(new Date());
      setMbPage(1);
    } catch (err: any) {
      console.error("Failed to fetch motherboards", err);
      setMbError(err?.message ?? "Failed to fetch motherboards");
    } finally {
      setLoadingMotherboards(false);
    }
  }, []);

  const loadCoolers = React.useCallback(async () => {
    try {
      setLoadingCoolers(true);
      setCoolerError(null);
      const data = await fetchParts("cpu-cooler" as any, "all");
      setCoolers(data.parts ?? []);
      setCoolerPage(1);
    } catch (err: any) {
      console.error("Failed to fetch CPU coolers", err);
      setCoolerError(err?.message ?? "Failed to fetch CPU coolers");
    } finally {
      setLoadingCoolers(false);
    }
  }, []);

  useEffect(() => {
    void loadCpus();
  }, [loadCpus]);

  useEffect(() => {
    void loadMotherboards();
  }, [loadMotherboards]);

  useEffect(() => {
    void loadCoolers();
  }, [loadCoolers]);

  // ---- CPU derived lists ----
  const cpusLive = React.useMemo(
    () =>
      cpus.filter((p) => {
        const vendor = ((p as any).vendor ?? "").toString().toLowerCase();
        return vendor === "pcpartpicker";
      }),
    [cpus]
  );
  const cpuStores = ["all", ...getStoreOptions(cpusLive)];
  const cpuSocketKeys =
    activeSocketKeys.length && activeSource !== "cpu" ? activeSocketKeys : [];
  const cpuProcessed = applyFiltersAndSorting(
    cpusLive,
    cpuSearch,
    cpuStoreFilter,
    cpuSortKey,
    { requirePrice: true, socketFilterKeys: cpuSocketKeys }
  );
  const cpuTotal = cpusLive.length;
  const cpuMatching = cpuProcessed.sorted.length;
  const cpuPageCount = Math.max(1, Math.ceil(cpuMatching / PAGE_SIZE));
  const cpuPageClamped = Math.min(cpuPage, cpuPageCount);
  const cpuStart = (cpuPageClamped - 1) * PAGE_SIZE;
  const cpuPageItems = cpuProcessed.sorted.slice(cpuStart, cpuStart + PAGE_SIZE);

  // ---- Motherboard derived lists ----
  const motherboardsLive = React.useMemo(
    () =>
      motherboards.filter((p) => {
        const vendor = ((p as any).vendor ?? "").toString().toLowerCase();
        return vendor === "pcpartpicker";
      }),
    [motherboards]
  );
  const mbStores = ["all", ...getStoreOptions(motherboardsLive)];
  const mbSocketKeys =
    activeSocketKeys.length && activeSource !== "motherboard" ? activeSocketKeys : [];
  const mbProcessed = applyFiltersAndSorting(
    motherboardsLive,
    mbSearch,
    mbStoreFilter,
    mbSortKey,
    { requirePrice: true, socketFilterKeys: mbSocketKeys }
  );
  const mbTotal = motherboardsLive.length;
  const mbMatching = mbProcessed.sorted.length;
  const mbPageCount = Math.max(1, Math.ceil(mbMatching / PAGE_SIZE));
  const mbPageClamped = Math.min(mbPage, mbPageCount);
  const mbStart = (mbPageClamped - 1) * PAGE_SIZE;
  const mbPageItems = mbProcessed.sorted.slice(mbStart, mbStart + PAGE_SIZE);

  // ---- Cooler derived lists ----
  const coolersLive = React.useMemo(() => coolers, [coolers]);
  const coolerStores = ["all", ...getStoreOptions(coolersLive)];
  const coolerSocketKeys =
    activeSocketKeys.length && activeSource !== "cooler" ? activeSocketKeys : [];
  const coolerProcessed = applyFiltersAndSorting(
    coolersLive,
    coolerSearch,
    coolerStoreFilter,
    coolerSortKey,
    { requirePrice: true, socketFilterKeys: coolerSocketKeys }
  );
  const coolerTotal = coolersLive.length;
  const coolerMatching = coolerProcessed.sorted.length;
  const coolerPageCount = Math.max(1, Math.ceil(coolerMatching / PAGE_SIZE));
  const coolerPageClamped = Math.min(coolerPage, coolerPageCount);
  const coolerStart = (coolerPageClamped - 1) * PAGE_SIZE;
  const coolerPageItems = coolerProcessed.sorted.slice(
    coolerStart,
    coolerStart + PAGE_SIZE
  );

  const totalParts = cpuTotal + mbTotal + coolerTotal;

  return (
    <>
      {/* Overview tile */}
      <section className="panel">
        <header className="panel-header">
          <h2>Select Parts for PC Builds</h2>
          <p className="panel-subtitle">
            Operations dashboard for CPUs, motherboards, and CPU coolers. Use the
            &quot;Use in builds&quot; column to choose which parts are eligible for
            CAD4Less custom PC builds.
          </p>
        </header>
        <div className="table-meta" style={{ marginTop: "10px" }}>
          <span>Total parts in catalog: {totalParts}</span>
          <span>CPUs: {cpuTotal}</span>
          <span>Motherboards: {mbTotal}</span>
          <span>CPU coolers: {coolerTotal}</span>
        </div>
        {activeSocket && (
          <div className="compat-banner">
            <span>
              Compatibility filter active: showing parts compatible with socket{" "}
              <strong>{activeSocketLabel ?? activeSocket}</strong>{" "}
              {activeSource && (
                <>
                  (selected from{" "}
                  {activeSource === "cpu"
                    ? "CPU table"
                    : activeSource === "motherboard"
                    ? "Motherboard table"
                    : "Cooler table"}
                  )
                </>
              )}
            </span>
            <button
              type="button"
              className="btn btn-secondary compat-clear-btn"
              onClick={clearCompatibilityFilter}
            >
              Clear compatibility filter
            </button>
          </div>
        )}
      </section>

      {/* 1. CPU Catalog */}
      <section className="panel panel--catalog">
        <header className="panel-header">
          <h2>1. CPU Catalog (Live Data)</h2>
          <p className="panel-subtitle">
            Review every CPU currently in the catalog. Turn on{" "}
            <strong>&quot;Use in builds&quot;</strong> for processors you are
            comfortable offering in customer PC configurations.
          </p>
        </header>

        <div className="toolbar">
          <div className="toolbar-group">
            <label className="toolbar-label">Store filter</label>
            <select
              className="toolbar-select"
              value={cpuStoreFilter}
              onChange={(e) => {
                setCpuStoreFilter(e.target.value);
                setCpuPage(1);
              }}
            >
              {cpuStores.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All stores" : s}
                </option>
              ))}
            </select>
          </div>

          <div className="toolbar-group toolbar-group--grow">
            <label className="toolbar-label">Search by name / socket / ID</label>
            <input
              className="toolbar-input"
              type="text"
              placeholder="e.g. i7, 14700K, LGA1700"
              value={cpuSearch}
              onChange={(e) => {
                setCpuSearch(e.target.value);
                setCpuPage(1);
              }}
            />
          </div>

          <div className="toolbar-group">
            <label className="toolbar-label">Sort by</label>
            <select
              className="toolbar-select"
              value={cpuSortKey}
              onChange={(e) => {
                setCpuSortKey(e.target.value as SortKey);
                setCpuPage(1);
              }}
            >
              <option value="name-asc">Name (A → Z)</option>
              <option value="price-asc">Price (low → high)</option>
              <option value="price-desc">Price (high → low)</option>
            </select>
          </div>

          <div className="toolbar-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void loadCpus()}
              disabled={loadingCpus}
            >
              {loadingCpus ? "Refreshing…" : "Reload list"}
            </button>
          </div>
        </div>

        <div className="table-meta">
          <span>Processors in catalog: {cpuTotal}</span>
          <span>Matching filters: {cpuMatching}</span>
          <span>
            Showing: {cpuPageItems.length} of {cpuMatching} (page {cpuPageClamped} /{" "}
            {cpuPageCount})
          </span>
          {activeSocket && (
            <span className="table-meta-filter">
              Compatibility filter: socket{" "}
              <strong>{activeSocketLabel ?? activeSocket}</strong>
            </span>
          )}
        </div>

        {cpuError && <div className="alert alert-error">{cpuError}</div>}

        {loadingCpus ? (
          <div className="table-loading">Loading CPUs…</div>
        ) : cpuMatching === 0 ? (
          <div className="table-empty">
            No CPUs match the current filters. Adjust the filters above or run the CPU
            import job in the backend to refresh the list.
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="use-in-builds-col">Use in builds</th>
                    <th>CPU</th>
                    <th>Socket</th>
                    <th>Store</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {cpuPageItems.map((p) => {
                    const bestPrice = getBestPrice(p);
                    const socket = getSocket(p);
                    const { label: storeLabel, url: storeUrl } = getPrimaryOffer(p);

                    return (
                      <tr
                        key={p.id ?? p.name}
                        onClick={() => handleRowClick("cpu", p)}
                        className="clickable-row"
                      >
                        <td
                          className="use-in-builds-cell"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!!p.approved}
                            onChange={async (e) => {
                              const next = e.target.checked;
                              setCpus((prev) =>
                                prev.map((item) =>
                                  item.id === p.id ? { ...item, approved: next } : item
                                )
                              );
                              try {
                                await updatePartApproved(p.id as string, "cpu", next);
                              } catch (err) {
                                console.error("Failed to update CPU approval", err);
                                setCpus((prev) =>
                                  prev.map((item) =>
                                    item.id === p.id ? { ...item, approved: !next } : item
                                  )
                                );
                                alert("Failed to save selection for this CPU.");
                              }
                            }}
                          />
                        </td>
                        <td className="cell-main">
                          <div className="cell-title">{p.name}</div>
                          {p.productLink && (
                            <a
                              href={p.productLink}
                              target="_blank"
                              rel="noreferrer"
                              className="cell-link"
                            >
                              {p.productLink}
                            </a>
                          )}
                        </td>
                        <td style={socketCellStyle} title={socket || undefined}>
                          {socket || "—"}
                        </td>
                        <td>
                          {storeUrl ? (
                            <a
                              href={storeUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="cell-link"
                            >
                              {storeLabel}
                            </a>
                          ) : (
                            storeLabel || "—"
                          )}
                        </td>
                        <td>{bestPrice != null ? formatMoney(bestPrice) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button
                type="button"
                className="btn"
                onClick={() => setCpuPage((prev) => Math.max(1, prev - 1))}
                disabled={cpuPageClamped <= 1}
              >
                Previous page
              </button>
              <span className="pagination-info">
                Page {cpuPageClamped} of {cpuPageCount}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => setCpuPage((prev) => Math.min(prev + 1, cpuPageCount))}
                disabled={cpuPageClamped >= cpuPageCount}
              >
                Next page
              </button>
            </div>
          </>
        )}
      </section>

      {/* 2. Motherboard Catalog */}
      <section className="panel panel--catalog">
        <header className="panel-header">
          <h2>2. Motherboard Catalog (Live Data)</h2>
          <p className="panel-subtitle">
            Review all motherboards currently available in your catalog. Turn on{" "}
            <strong>&quot;Use in builds&quot;</strong> for boards you want to allow in
            CAD4Less PC builds.
          </p>
        </header>

        <div className="toolbar">
          <div className="toolbar-group">
            <label className="toolbar-label">Store filter</label>
            <select
              className="toolbar-select"
              value={mbStoreFilter}
              onChange={(e) => {
                setMbStoreFilter(e.target.value);
                setMbPage(1);
              }}
            >
              {mbStores.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All stores" : s}
                </option>
              ))}
            </select>
          </div>

          <div className="toolbar-group toolbar-group--grow">
            <label className="toolbar-label">Search by name / socket / ID</label>
            <input
              className="toolbar-input"
              type="text"
              placeholder="e.g. Z790, B760, LGA1700"
              value={mbSearch}
              onChange={(e) => {
                setMbSearch(e.target.value);
                setMbPage(1);
              }}
            />
          </div>

          <div className="toolbar-group">
            <label className="toolbar-label">Sort by</label>
            <select
              className="toolbar-select"
              value={mbSortKey}
              onChange={(e) => {
                setMbSortKey(e.target.value as SortKey);
                setMbPage(1);
              }}
            >
              <option value="name-asc">Name (A → Z)</option>
              <option value="price-asc">Price (low → high)</option>
              <option value="price-desc">Price (high → low)</option>
            </select>
          </div>

          <div className="toolbar-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void loadMotherboards()}
              disabled={loadingMotherboards}
            >
              {loadingMotherboards ? "Refreshing…" : "Reload list"}
            </button>
          </div>
        </div>

        <div className="table-meta">
          <span>Boards in catalog: {mbTotal}</span>
          <span>Matching filters: {mbMatching}</span>
          <span>
            Showing: {mbPageItems.length} of {mbMatching} (page {mbPageClamped} /{" "}
            {mbPageCount})
          </span>
          {lastMbRefreshTime && (
            <span>Last refresh: {lastMbRefreshTime.toLocaleTimeString()}</span>
          )}
          {activeSocket && (
            <span className="table-meta-filter">
              Compatibility filter: socket{" "}
              <strong>{activeSocketLabel ?? activeSocket}</strong>
            </span>
          )}
        </div>

        {mbError && <div className="alert alert-error">{mbError}</div>}

        {loadingMotherboards ? (
          <div className="table-loading">Loading motherboards…</div>
        ) : mbMatching === 0 ? (
          <div className="table-empty">
            No motherboards match the current filters. Adjust the filters above or run
            the motherboard import job in the backend to refresh the list.
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="use-in-builds-col">Use in builds</th>
                    <th>Motherboard</th>
                    <th>Socket</th>
                    <th>Store</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {mbPageItems.map((p) => {
                    const bestPrice = getBestPrice(p);
                    const socket = getSocket(p);
                    const { label: storeLabel, url: storeUrl } = getPrimaryOffer(p);

                    const normalizedStore = (storeLabel || "")
                      .toString()
                      .toLowerCase()
                      .trim();
                    const isPcPartPickerStore =
                      normalizedStore === "pcpartpicker" ||
                      normalizedStore === "pc part picker";

                    const storeCell = storeUrl ? (
                      <a
                        href={storeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="cell-link"
                      >
                        {isPcPartPickerStore ? "PCPartPicker (view offers)" : storeLabel}
                      </a>
                    ) : (
                      storeLabel || "—"
                    );

                    let priceCell: React.ReactNode;
                    if (bestPrice != null) {
                      priceCell = formatMoney(bestPrice);
                    } else if (isPcPartPickerStore && storeUrl) {
                      priceCell = (
                        <a
                          href={storeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="cell-link"
                        >
                          View price on PCPartPicker
                        </a>
                      );
                    } else {
                      priceCell = "—";
                    }

                    return (
                      <tr
                        key={p.id ?? p.name}
                        onClick={() => handleRowClick("motherboard", p)}
                        className="clickable-row"
                      >
                        <td
                          className="use-in-builds-cell"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!!p.approved}
                            onChange={async (e) => {
                              const next = e.target.checked;
                              setMotherboards((prev) =>
                                prev.map((item) =>
                                  item.id === p.id ? { ...item, approved: next } : item
                                )
                              );
                              try {
                                await updatePartApproved(
                                  p.id as string,
                                  "motherboard",
                                  next
                                );
                              } catch (err) {
                                console.error("Failed to update motherboard approval", err);
                                setMotherboards((prev) =>
                                  prev.map((item) =>
                                    item.id === p.id ? { ...item, approved: !next } : item
                                  )
                                );
                                alert(
                                  "Failed to save selection for this motherboard."
                                );
                              }
                            }}
                          />
                        </td>
                        <td className="cell-main">
                          <div className="cell-title">{p.name}</div>
                          {p.productLink && (
                            <a
                              href={p.productLink}
                              target="_blank"
                              rel="noreferrer"
                              className="cell-link"
                            >
                              {p.productLink}
                            </a>
                          )}
                        </td>
                        <td style={socketCellStyle} title={socket || undefined}>
                          {socket || "—"}
                        </td>
                        <td>{storeCell}</td>
                        <td>{priceCell}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button
                type="button"
                className="btn"
                onClick={() => setMbPage((prev) => Math.max(1, prev - 1))}
                disabled={mbPageClamped <= 1}
              >
                Previous page
              </button>
              <span className="pagination-info">
                Page {mbPageClamped} of {mbPageCount}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => setMbPage((prev) => Math.min(prev + 1, mbPageCount))}
                disabled={mbPageClamped >= mbPageCount}
              >
                Next page
              </button>
            </div>
          </>
        )}
      </section>

      {/* 3. CPU Coolers Catalog */}
      <section className="panel panel--catalog">
        <header className="panel-header">
          <h2>3. CPU Coolers Catalog (Live Data)</h2>
          <p className="panel-subtitle">
            Review all CPU coolers currently available in your catalog. Turn on{" "}
            <strong>&quot;Use in builds&quot;</strong> for coolers you want to include
            in CAD4Less PC builds.
          </p>
        </header>

        <div className="toolbar">
          <div className="toolbar-group">
            <label className="toolbar-label">Store filter</label>
            <select
              className="toolbar-select"
              value={coolerStoreFilter}
              onChange={(e) => {
                setCoolerStoreFilter(e.target.value);
                setCoolerPage(1);
              }}
            >
              {coolerStores.map((s) => (
                <option key={s} value={s}>
                  {s === "all" ? "All stores" : s}
                </option>
              ))}
            </select>
          </div>

          <div className="toolbar-group toolbar-group--grow">
            <label className="toolbar-label">Search by name / socket / ID</label>
            <input
              className="toolbar-input"
              type="text"
              placeholder="e.g. 240mm, AM5, LGA1700"
              value={coolerSearch}
              onChange={(e) => {
                setCoolerSearch(e.target.value);
                setCoolerPage(1);
              }}
            />
          </div>

          <div className="toolbar-group">
            <label className="toolbar-label">Sort by</label>
            <select
              className="toolbar-select"
              value={coolerSortKey}
              onChange={(e) => {
                setCoolerSortKey(e.target.value as SortKey);
                setCoolerPage(1);
              }}
            >
              <option value="name-asc">Name (A → Z)</option>
              <option value="price-asc">Price (low → high)</option>
              <option value="price-desc">Price (high → low)</option>
            </select>
          </div>

          <div className="toolbar-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void loadCoolers()}
              disabled={loadingCoolers}
            >
              {loadingCoolers ? "Refreshing…" : "Reload list"}
            </button>
          </div>
        </div>

        <div className="table-meta">
          <span>Coolers in catalog: {coolerTotal}</span>
          <span>Matching filters: {coolerMatching}</span>
          <span>
            Showing: {coolerPageItems.length} of {coolerMatching} (page{" "}
            {coolerPageClamped} / {coolerPageCount})
          </span>
          {activeSocket && (
            <span className="table-meta-filter">
              Compatibility filter: socket{" "}
              <strong>{activeSocketLabel ?? activeSocket}</strong>
            </span>
          )}
        </div>

        {coolerError && <div className="alert alert-error">{coolerError}</div>}

        {loadingCoolers ? (
          <div className="table-loading">Loading CPU coolers…</div>
        ) : coolerMatching === 0 ? (
          <div className="table-empty">
            No CPU coolers match the current filters. Adjust the filters above or run
            the cooler import job in the backend to refresh the list.
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="use-in-builds-col">Use in builds</th>
                    <th>Cooler</th>
                    <th>Socket</th>
                    <th>Store</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  {coolerPageItems.map((p) => {
                    const bestPrice = getBestPrice(p);
                    const socket = getSocket(p);
                    const { label: storeLabel, url: storeUrl } = getPrimaryOffer(p);

                    return (
                      <tr
                        key={p.id ?? p.name}
                        onClick={() => handleRowClick("cooler", p)}
                        className="clickable-row"
                      >
                        <td
                          className="use-in-builds-cell"
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={!!p.approved}
                            onChange={async (e) => {
                              const next = e.target.checked;
                              setCoolers((prev) =>
                                prev.map((item) =>
                                  item.id === p.id ? { ...item, approved: next } : item
                                )
                              );
                              try {
                                await updatePartApproved(
                                  p.id as string,
                                  "cpu-cooler",
                                  next
                                );
                              } catch (err) {
                                console.error("Failed to update cooler approval", err);
                                setCoolers((prev) =>
                                  prev.map((item) =>
                                    item.id === p.id ? { ...item, approved: !next } : item
                                  )
                                );
                                alert("Failed to save selection for this cooler.");
                              }
                            }}
                          />
                        </td>
                        <td className="cell-main">
                          <div className="cell-title">{p.name}</div>
                          {p.productLink && (
                            <a
                              href={p.productLink}
                              target="_blank"
                              rel="noreferrer"
                              className="cell-link"
                            >
                              {p.productLink}
                            </a>
                          )}
                        </td>
                        <td style={socketCellStyle} title={socket || undefined}>
                          {socket || "—"}
                        </td>
                        <td>
                          {storeUrl ? (
                            <a
                              href={storeUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="cell-link"
                            >
                              {storeLabel}
                            </a>
                          ) : (
                            storeLabel || "—"
                          )}
                        </td>
                        <td>{bestPrice != null ? formatMoney(bestPrice) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <button
                type="button"
                className="btn"
                onClick={() => setCoolerPage((prev) => Math.max(1, prev - 1))}
                disabled={coolerPageClamped <= 1}
              >
                Previous page
              </button>
              <span className="pagination-info">
                Page {coolerPageClamped} of {coolerPageCount}
              </span>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setCoolerPage((prev) => Math.min(prev + 1, coolerPageCount))
                }
                disabled={coolerPageClamped >= coolerPageCount}
              >
                Next page
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}

// --- Begin: Add Parts Tab ---
const AddPartsTab: React.FC = () => {
  const [category, setCategory] = useState<ApifyCategory>("cpu");
  const [csvText, setCsvText] = useState<string>("");
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setCsvText(text);
      setStatus(
        `Loaded ${file.name}. Review the CSV below, then click "Import CSV" to add parts.`
      );
    };
    reader.onerror = () => {
      console.error("Failed to read CSV file", reader.error);
      setStatus(
        "Error: Could not read that CSV file. Try again or paste the CSV content instead."
      );
    };
    reader.readAsText(file);
  };

  const handleImportCsv = async () => {
    const trimmed = csvText.trim();
    if (!trimmed) {
      setStatus(
        "Error: Please paste CSV content or load a CSV file before importing."
      );
      return;
    }

    setIsImporting(true);
    setStatus(null);

    try {
      const result = await importPartsFromCsv(category as any, trimmed);
      console.log("CSV import result", result);

      const attempted = (result as any)?.attempted ?? 0;
      const succeeded = (result as any)?.succeeded ?? 0;
      const failed = (result as any)?.failed ?? 0;
      const skippedNotInStock = (result as any)?.skippedNotInStock ?? 0;
      const message = (result as any)?.message as string | undefined;

      const summary = `CSV import completed: ${succeeded}/${attempted} succeeded, ${failed} failed, ${skippedNotInStock} skipped (not in stock).`;

      setStatus(message ? `${summary} Message: ${message}` : summary);
    } catch (err: any) {
      console.error("CSV import error", err);
      setStatus(
        `Error: ${
          err?.message ??
          "Unable to import CSV. Check the browser console or network tab for details, or contact an administrator."
        }`
      );
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Add Parts</h2>
        <p className="panel-subtitle">
          Add new parts by pasting CSV data or uploading a .csv file. Choose the part
          category, load your CSV, then click <strong>Import CSV</strong>. Successful
          imports will show up in the &quot;Select Parts for PC Builds&quot; tab after
          you reload that list.
        </p>
      </header>
      <div className="panel-body">
        <div
          className="toolbar"
          style={{ marginBottom: 16, alignItems: "flex-start" }}
        >
          {/* CSV text area + file upload */}
          <div className="toolbar-group toolbar-group--grow">
            <label className="toolbar-label" htmlFor="csv-text">
              CSV content
            </label>
            <textarea
              id="csv-text"
              className="toolbar-input"
              rows={10}
              placeholder={
                "Example:\nname,price,availability\nTest RAM 16GB,49.99,In stock"
              }
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
            <div className="panel-subtitle" style={{ fontSize: 12, marginTop: 8 }}>
              Paste CSV rows here. The first line should contain column headers like
              <code> name, price, availability </code>.
            </div>
            <div style={{ marginTop: 8 }}>
              <label className="toolbar-label" htmlFor="csv-file">
                Or upload a .csv file
              </label>
              <input
                id="csv-file"
                type="file"
                accept=".csv,text/csv"
                className="toolbar-input"
                onChange={handleFileChange}
              />
              <div className="panel-subtitle" style={{ fontSize: 12, marginTop: 4 }}>
                When you choose a file, its contents will be loaded into the box above.
              </div>
            </div>
          </div>

          {/* Import button */}
          <div className="toolbar-group">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleImportCsv}
              disabled={isImporting || !csvText.trim()}
            >
              {isImporting ? "Importing…" : "Import CSV"}
            </button>
          </div>
        </div>

        {status && (
          <div
            className={
              status.toLowerCase().startsWith("error:")
                ? "alert alert-error"
                : "alert alert-info"
            }
          >
            {status}
          </div>
        )}
      </div>
    </section>
  );
};

// --- Begin: New PC Build Tab ---
const getPartId = (p: Part): string => {
  const anyPart = p as any;
  if (anyPart.id != null) return String(anyPart.id);
  if (typeof anyPart.sku === "string" && anyPart.sku.trim()) return anyPart.sku.trim();
  if (typeof anyPart.name === "string" && anyPart.name.trim()) return anyPart.name.trim();
  return JSON.stringify(anyPart);
};

type PartSelectProps = {
  label: string;
  options: Part[];
  value: string;
  onChange: (id: string | null) => void;
  placeholder?: string;
};

const PartSelect: React.FC<PartSelectProps> = ({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
}) => (
  <div className="toolbar-group">
    <label className="toolbar-label">{label}</label>
    <select
      className="toolbar-select"
      value={value}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">{placeholder}</option>
      {options.map((p) => {
        const optionId = getPartId(p);
        const price = getBestPrice(p);
        const priceText = price != null ? formatMoney(price) : "(no price)";
        return (
          <option key={optionId} value={optionId}>
            {p.name ? `${p.name} — ${priceText}` : optionId}
          </option>
        );
      })}
    </select>
  </div>
);

const NewPcBuildTab: React.FC = () => {
  const [loadingParts, setLoadingParts] = React.useState(false);
  const [partsError, setPartsError] = React.useState<string | null>(null);

  const [cpuOptions, setCpuOptions] = React.useState<Part[]>([]);
  const [motherboardOptions, setMotherboardOptions] = React.useState<Part[]>([]);
  const [coolerOptions, setCoolerOptions] = React.useState<Part[]>([]);

  // Build meta
  const [buildName, setBuildName] = React.useState("");
  const [profile, setProfile] = React.useState("standard");
  const [notes, setNotes] = React.useState("");

  // Selected component IDs (string; empty string means "none selected")
  const [cpuId, setCpuId] = React.useState<string>("");
  const [motherboardId, setMotherboardId] = React.useState<string>("");
  const [coolerId, setCoolerId] = React.useState<string>("");

  const [marginPercent, setMarginPercent] = React.useState<number>(20);

  const reloadParts = React.useCallback(async () => {
    try {
      setLoadingParts(true);
      setPartsError(null);
      const [cpuResp, mbResp, coolerResp] = await Promise.all([
        fetchParts("cpu" as any, "all"),
        fetchParts("motherboard" as any, "all"),
        fetchParts("cpu-cooler" as any, "all"),
      ]);

      const onlyApproved = (items: Part[] | undefined | null) =>
        (items ?? []).filter((p) => !!p.approved);

      setCpuOptions(onlyApproved(cpuResp.parts));
      setMotherboardOptions(onlyApproved(mbResp.parts));
      setCoolerOptions(onlyApproved(coolerResp.parts));
    } catch (err: any) {
      console.error("Failed to load parts for New PC Build", err);
      setPartsError(err?.message ?? "Failed to load parts for New PC Build");
    } finally {
      setLoadingParts(false);
    }
  }, []);

  React.useEffect(() => {
    void reloadParts();
  }, [reloadParts]);

  const selectedCpu = React.useMemo(
    () => cpuOptions.find((p) => getPartId(p) === cpuId) ?? null,
    [cpuId, cpuOptions]
  );
  const selectedMotherboard = React.useMemo(
    () => motherboardOptions.find((p) => getPartId(p) === motherboardId) ?? null,
    [motherboardId, motherboardOptions]
  );
  const selectedCooler = React.useMemo(
    () => coolerOptions.find((p) => getPartId(p) === coolerId) ?? null,
    [coolerId, coolerOptions]
  );

  const compatibleMotherboards = React.useMemo(() => {
    if (!selectedCpu) return motherboardOptions;

    const cpuTokens = extractSocketTokens(getSocket(selectedCpu));
    const cpuKeys = cpuTokens.map((t) => normalizeSocket(t));

    if (!cpuKeys.length) return motherboardOptions;

    return motherboardOptions.filter((mb) => {
      const mbTokens = extractSocketTokens(getSocket(mb));
      const mbKeys = mbTokens.map((t) => normalizeSocket(t));
      return mbKeys.some((k) => cpuKeys.includes(k));
    });
  }, [selectedCpu, motherboardOptions]);

  const compatibleCoolers = React.useMemo(() => {
    if (!selectedCpu && !selectedMotherboard) return coolerOptions;

    const keySet = new Set<string>();

    if (selectedCpu) {
      extractSocketTokens(getSocket(selectedCpu))
        .map((t) => normalizeSocket(t))
        .forEach((k) => keySet.add(k));
    }

    if (selectedMotherboard) {
      extractSocketTokens(getSocket(selectedMotherboard))
        .map((t) => normalizeSocket(t))
        .forEach((k) => keySet.add(k));
    }

    if (!keySet.size) return coolerOptions;

    return coolerOptions.filter((cooler) => {
      const coolerKeys = extractSocketTokens(getSocket(cooler)).map((t) =>
        normalizeSocket(t)
      );
      return coolerKeys.some((k) => keySet.has(k));
    });
  }, [selectedCpu, selectedMotherboard, coolerOptions]);

  const selectedParts: Part[] = React.useMemo(() => {
    const parts: Part[] = [];
    if (selectedCpu) parts.push(selectedCpu);
    if (selectedMotherboard) parts.push(selectedMotherboard);
    if (selectedCooler) parts.push(selectedCooler);
    return parts;
  }, [selectedCpu, selectedMotherboard, selectedCooler]);

  const partsSubtotal = React.useMemo(
    () =>
      selectedParts.reduce((sum, p) => {
        const price = getBestPrice(p);
        return sum + (price ?? 0);
      }, 0),
    [selectedParts]
  );

  const finalPrice = React.useMemo(
    () => partsSubtotal * (1 + (marginPercent || 0) / 100),
    [partsSubtotal, marginPercent]
  );

  const handleSaveDraft = () => {
    const payload = {
      name: buildName,
      profile,
      notes,
      components: {
        cpuId,
        motherboardId,
        coolerId,
      },
      pricing: {
        partsSubtotal,
        marginPercent,
        finalPrice,
      },
    };

    console.log("New PC build draft (frontend-only, not yet persisted):", payload);
    alert(
      "Draft saved in browser memory only for now.\nBackend persistence and validation will be wired in a later phase."
    );
  };

  const allRequiredSelected =
    !!selectedCpu && !!selectedMotherboard && !!selectedCooler && !!buildName.trim();

  return (
    <section className="panel panel--catalog">
      <header className="panel-header">
        <h2>New PC Build</h2>
        <p className="panel-subtitle">
          Use this one-page workspace to design CAD4Less PC builds. Start with approved
          parts, let socket-aware filters keep components compatible, and track parts
          cost and selling price in the summary.
        </p>
      </header>

      {partsError && <div className="alert alert-error">{partsError}</div>}

      <div
        className="panel-body"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 24,
        }}
      >
        {/* Left: build details + component dropdowns */}
        <div>
          <div className="panel panel--sub">
            <header className="panel-header">
              <h3>Build details</h3>
            </header>
            <div className="panel-body">
              <div className="toolbar-group">
                <label className="toolbar-label">Build name</label>
                <input
                  type="text"
                  className="toolbar-input"
                  placeholder="e.g. CAD4Less i7 LGA1700 Workstation"
                  value={buildName}
                  onChange={(e) => setBuildName(e.target.value)}
                />
              </div>

              <div className="toolbar-group">
                <label className="toolbar-label">Profile</label>
                <select
                  className="toolbar-select"
                  value={profile}
                  onChange={(e) => setProfile(e.target.value)}
                >
                  <option value="economy">Economy</option>
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                  <option value="ai">AI / GPU-heavy</option>
                  <option value="custom">Custom</option>
                </select>
              </div>

              <div className="toolbar-group">
                <label className="toolbar-label">Internal notes</label>
                <textarea
                  className="toolbar-input"
                  rows={3}
                  placeholder="Internal notes about this configuration (not shown on Shopify)…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="panel panel--sub">
            <header className="panel-header">
              <h3>Component selection</h3>
              <p className="panel-subtitle">
                All dropdowns only show parts marked &quot;Use in builds&quot; on the
                Select Parts tab. Motherboard and cooler options are automatically
                limited to sockets that match the selected CPU and motherboard.
              </p>
            </header>
            <div className="panel-body">
              {loadingParts && (
                <div className="table-loading">Loading parts for New PC Build…</div>
              )}

              {!loadingParts && (
                <>
                  <PartSelect
                    label="CPU"
                    options={cpuOptions}
                    value={cpuId}
                    onChange={(id) => {
                      setCpuId(id ?? "");
                      // Reset downstream selections when CPU changes
                      setMotherboardId("");
                      setCoolerId("");
                    }}
                    placeholder="Select CPU"
                  />

                  <PartSelect
                    label="Motherboard"
                    options={compatibleMotherboards}
                    value={motherboardId}
                    onChange={(id) => {
                      setMotherboardId(id ?? "");
                      // Reset cooler when motherboard changes
                      setCoolerId("");
                    }}
                    placeholder={
                      selectedCpu
                        ? "Select motherboard (socket-compatible)"
                        : "Select motherboard"
                    }
                  />

                  <PartSelect
                    label="CPU cooler"
                    options={compatibleCoolers}
                    value={coolerId}
                    onChange={(id) => setCoolerId(id ?? "")}
                    placeholder={
                      selectedCpu || selectedMotherboard
                        ? "Select cooler (socket-compatible)"
                        : "Select cooler"
                    }
                  />

                  <div className="toolbar-group" style={{ marginTop: 16 }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void reloadParts()}
                      disabled={loadingParts}
                    >
                      {loadingParts ? "Refreshing parts…" : "Reload parts lists"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right: summary & pricing */}
        <aside className="panel panel--sub">
          <header className="panel-header">
            <h3>Build summary &amp; pricing</h3>
          </header>
          <div className="panel-body">
            <div className="table-meta" style={{ marginBottom: 12 }}>
              <span>Selected components: {selectedParts.length}</span>
            </div>

            {selectedParts.length === 0 ? (
              <div className="table-empty">
                Start by selecting a CPU, motherboard, and cooler. As you choose parts,
                they will appear here with a running cost total.
              </div>
            ) : (
              <div className="table-wrapper" style={{ maxHeight: 260, overflow: "auto" }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Part</th>
                      <th>Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedCpu && (
                      <tr>
                        <td>CPU</td>
                        <td className="cell-main">
                          <div className="cell-title">{selectedCpu.name}</div>
                        </td>
                        <td>
                          {(() => {
                            const price = getBestPrice(selectedCpu);
                            return price != null ? formatMoney(price) : "—";
                          })()}
                        </td>
                      </tr>
                    )}
                    {selectedMotherboard && (
                      <tr>
                        <td>Motherboard</td>
                        <td className="cell-main">
                          <div className="cell-title">{selectedMotherboard.name}</div>
                        </td>
                        <td>
                          {(() => {
                            const price = getBestPrice(selectedMotherboard);
                            return price != null ? formatMoney(price) : "—";
                          })()}
                        </td>
                      </tr>
                    )}
                    {selectedCooler && (
                      <tr>
                        <td>CPU cooler</td>
                        <td className="cell-main">
                          <div className="cell-title">{selectedCooler.name}</div>
                        </td>
                        <td>
                          {(() => {
                            const price = getBestPrice(selectedCooler);
                            return price != null ? formatMoney(price) : "—";
                          })()}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div className="panel-divider" style={{ margin: "16px 0" }} />

            <div className="toolbar-group">
              <label className="toolbar-label">Parts subtotal</label>
              <div>{formatMoney(partsSubtotal)}</div>
            </div>

            <div className="toolbar-group">
              <label className="toolbar-label">Margin %</label>
              <input
                type="number"
                className="toolbar-input"
                min={0}
                max={95}
                step={1}
                value={marginPercent}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (Number.isNaN(val)) {
                    setMarginPercent(0);
                  } else {
                    setMarginPercent(val);
                  }
                }}
              />
            </div>

            <div className="toolbar-group">
              <label className="toolbar-label">Final price</label>
              <div>{formatMoney(finalPrice)}</div>
            </div>

            <div className="panel-divider" style={{ margin: "16px 0" }} />

            <div className="toolbar-group" style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveDraft}
                disabled={!allRequiredSelected}
              >
                Save draft (local)
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!allRequiredSelected}
                onClick={() => {
                  alert(
                    "Compatibility validation and backend persistence for this build will be added in the next phase."
                  );
                }}
              >
                Validate build
              </button>
            </div>

            {!allRequiredSelected && (
              <p className="panel-subtitle" style={{ marginTop: 8 }}>
                To save this build, enter a build name and select a CPU, motherboard,
                and cooler.
              </p>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
};

// --- Begin: Catalog Tab ---
const CatalogTab: React.FC = () => {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Catalog</h2>
        <p className="panel-subtitle">
          This view will list saved PC builds that are ready to be exported to Shopify
          as products on cad4less.com.
        </p>
      </header>
      <div className="panel-body">
        <p>
          In a later phase, this tab will show every build created in the &quot;New PC
          Build&quot; tab, including the build profile (Economy / Standard / Premium /
          AI), cost breakdown, and Shopify export status.
        </p>
      </div>
    </section>
  );
};

// --- App with Tab Navigation ---
const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<
    "add-parts" | "select-parts" | "new-build" | "catalog"
  >("select-parts");

  const tabButtonClass = (
    tab: "add-parts" | "select-parts" | "new-build" | "catalog"
  ) =>
    [
      "tabs-tab",
      "btn",
      activeTab === tab ? "btn-primary" : "btn-secondary",
      activeTab === tab ? "tabs-tab--active" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const tabLabelStyle: React.CSSProperties = {
    fontSize: "18px",
    fontWeight: 700,
  };

  return (
    <div className="app-root">
      <header className="panel-header" style={{ marginBottom: "24px" }}>
        <h1>CAD4Less Catalog Admin</h1>
        <p className="panel-subtitle">
          Internal Genesis console for importing parts, designing CAD-optimized PC
          builds, and publishing finished systems to cad4less.com.
        </p>
      </header>

      <nav className="tabs" style={{ marginBottom: "32px" }}>
        <button
          type="button"
          className={tabButtonClass("add-parts")}
          style={tabLabelStyle}
          onClick={() => setActiveTab("add-parts")}
        >
          Add Parts
        </button>
        <button
          type="button"
          className={tabButtonClass("select-parts")}
          style={tabLabelStyle}
          onClick={() => setActiveTab("select-parts")}
        >
          Select Parts for PC Builds
        </button>
        <button
          type="button"
          className={tabButtonClass("new-build")}
          style={tabLabelStyle}
          onClick={() => setActiveTab("new-build")}
        >
          New PC Build
        </button>
        <button
          type="button"
          className={tabButtonClass("catalog")}
          style={tabLabelStyle}
          onClick={() => setActiveTab("catalog")}
        >
          Catalog
        </button>
      </nav>

      <main className="tab-content">
        {activeTab === "add-parts" && <AddPartsTab />}
        {activeTab === "select-parts" && <CatalogDashboard />}
        {activeTab === "new-build" && <NewPcBuildTab />}
        {activeTab === "catalog" && <CatalogTab />}
      </main>
    </div>
  );
};

export default App;