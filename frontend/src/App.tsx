import React, { useState, useEffect } from "react";
import { fetchParts, Part, updatePartApproved } from "./api/client";
import { formatMoney, getBestPrice as baseGetBestPrice } from "./utils";

type SortKey = "name-asc" | "price-asc" | "price-desc";

const PAGE_SIZE = 10;

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
  const socketKey = Object.keys(specs).find((k) =>
    k.toLowerCase().includes("socket")
  );
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
  const deepSocket = deepFindString(anyPart, (key) =>
    key.toLowerCase().includes("socket")
  );
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
    if (availabilityRaw.includes("preorder") || availabilityRaw.includes("pre-order")) return false;
    if (availabilityRaw.includes("backorder") || availabilityRaw.includes("back-order")) return false;

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
  const [activeSource, setActiveSource] = useState<"cpu" | "motherboard" | "cooler" | null>(null);

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
    <div className="app-root">
      {/* Overview tile */}
      <section className="panel">
        <header className="panel-header">
          <h2>CAD4Less Catalog Admin</h2>
          <p className="panel-subtitle">
            Internal dashboard for CPUs, motherboards, and CPU coolers. Use the
            &quot;Use in builds&quot; column to mark parts that should be available
            for custom PC builds.
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
            View all CPUs currently available in your catalog. Tick{" "}
            <strong>&quot;Use in builds&quot;</strong> for processors you want to
            offer in custom PC builds.
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
            No CPUs found. Try changing the filters or running the CPU import job in
            the backend.
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
                        <td>{socket || "—"}</td>
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
            View all motherboards currently available in your catalog. Tick{" "}
            <strong>&quot;Use in builds&quot;</strong> for boards you want to use in
            PC builds.
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
            No motherboards found. Try changing the filters or running the motherboard
            import job in the backend.
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
                                alert("Failed to save selection for this motherboard.");
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
                        <td>{socket || "—"}</td>
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
            View all CPU coolers currently available in your catalog. Tick{" "}
            <strong>&quot;Use in builds&quot;</strong> for coolers you want to use in
            PC builds.
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
            No CPU coolers found. Try changing the filters or running the cooler import
            job in the backend.
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
                        <td>{socket || "—"}</td>
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

      {/* 4. Quick Build Calculator (placeholder) */}
      <section className="panel">
        <header className="panel-header">
          <h2>4. Quick Build Calculator</h2>
          <p className="panel-subtitle">
            In the next phase we will wire this up to choose a CPU, a compatible
            motherboard and cooler, and calculate a suggested selling price.
          </p>
        </header>
        <div className="panel-body">
          <p>
            Placeholder for the build calculator. For now, use the three catalogs above
            to choose matching parts.
          </p>
        </div>
      </section>
    </div>
  );
}

const App: React.FC = () => <CatalogDashboard />;

export default App;