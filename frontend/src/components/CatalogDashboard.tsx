import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  fetchParts,
  getCpuImportStatus,
  startCpuImport,
  ImportStatusResponse,
  Part,
} from "../api/client";

// Store / vendor filter options
export type VendorFilter = "all" | "amazon" | "pcpartpicker";

// Sorting options for the CPU table
export type SortKey = "name-asc" | "price-asc" | "price-desc" | "cores-desc";

const CPU_PAGE_SIZE = 20;

const CatalogDashboard: React.FC = () => {
  // -------------------- CPU catalog state --------------------
  const [parts, setParts] = useState<Part[]>([]);
  const [loadingParts, setLoadingParts] = useState(false);
  const [partsError, setPartsError] = useState<string | null>(null);
  const [vendorFilter, setVendorFilter] = useState<VendorFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name-asc");
  const [nameFilter, setNameFilter] = useState("");
  const [cpuPage, setCpuPage] = useState(1);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  // -------------------- CPU import state --------------------
  const [searchTerm, setSearchTerm] = useState("intel");
  const [maxProducts, setMaxProducts] = useState(50);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [importStatus, setImportStatus] =
    useState<ImportStatusResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importInProgress, setImportInProgress] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // -------------------- Helper functions --------------------
  const getBestPrice = (p: Part): number | null => {
    if (typeof p.price === "number") return p.price;

    if (Array.isArray(p.vendorList)) {
      const candidates = p.vendorList.filter(
        (v: any) => typeof v?.price === "number"
      );
      if (candidates.length > 0) {
        return candidates.reduce(
          (acc: number, v: any) => (v.price < acc ? v.price : acc),
          candidates[0].price
        );
      }
    }

    return null;
  };

  const getCoreCount = (p: Part): number | null => {
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

  const formatMoney = (value: number): string =>
    value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });

  // -------------------- Data loading --------------------
  const loadParts = useCallback(async () => {
    try {
      setLoadingParts(true);
      setPartsError(null);
      const data = await fetchParts("cpu", vendorFilter);
      setParts(data.parts ?? []);
      setLastRefreshTime(new Date());
    } catch (err: any) {
      console.error("Failed to fetch CPUs", err);
      setPartsError(err?.message ?? "Failed to fetch processors");
    } finally {
      setLoadingParts(false);
    }
  }, [vendorFilter]);

  useEffect(() => {
    void loadParts();
  }, [loadParts]);

  // Reset to first page when filters change
  useEffect(() => {
    setCpuPage(1);
  }, [vendorFilter, nameFilter, sortKey]);

  // -------------------- Import handling --------------------
  const handleStartImport = async () => {
    try {
      setImportError(null);
      setImportStatus(null);
      setImportInProgress(true);

      const resp = await startCpuImport("cpu", maxProducts, searchTerm);
      setCurrentRunId(resp.runId);
      setImportStatus({
        message: resp.message,
        category: resp.category,
        runId: resp.runId,
        runStatus: resp.runStatus,
      });
    } catch (err: any) {
      console.error("Failed to start CPU import", err);
      setImportError(err?.message ?? "Failed to start CPU import");
      setImportInProgress(false);
    }
  };

  const pollStatusOnce = useCallback(async () => {
    if (!currentRunId) return;

    try {
      const status = await getCpuImportStatus(currentRunId, "cpu");
      setImportStatus(status);

      if (status.runStatus === "completed" || status.runStatus === "failed") {
        setImportInProgress(false);
        void loadParts();
      }
    } catch (err: any) {
      console.error("Failed to fetch CPU import status", err);
      setImportError(err?.message ?? "Failed to check CPU import status");
      setImportInProgress(false);
    }
  }, [currentRunId, loadParts]);

  useEffect(() => {
    if (!autoRefresh || !importInProgress || !currentRunId) return;

    const id = window.setInterval(() => {
      void pollStatusOnce();
    }, 8000);

    return () => window.clearInterval(id);
  }, [autoRefresh, importInProgress, currentRunId, pollStatusOnce]);

  // -------------------- CPU filtering / sorting / paging --------------------
  const filteredParts = useMemo(() => {
    const search = nameFilter.trim().toLowerCase();

    return parts.filter((p) => {
      // Vendor / store filter
      if (vendorFilter !== "all") {
        const directVendor = (p.vendor ?? "").toLowerCase();
        const hasDirectMatch = directVendor.includes(vendorFilter);

        const hasListMatch =
          Array.isArray(p.vendorList) &&
          p.vendorList.some((v: any) =>
            String(v?.vendor ?? "").toLowerCase().includes(vendorFilter)
          );

        if (!hasDirectMatch && !hasListMatch) {
          return false;
        }
      }

      if (!search) return true;

      const socket =
        (p.specs?.socket as string | undefined) ||
        (p.specs?.Socket as string | undefined) ||
        "";

      const haystack = `${String(p.name ?? "").toLowerCase()} ${socket.toLowerCase()}`;
      return haystack.includes(search);
    });
  }, [parts, vendorFilter, nameFilter]);

  const sortedParts = useMemo(() => {
    const arr = [...filteredParts];

    arr.sort((a, b) => {
      if (sortKey === "name-asc") {
        return String(a.name ?? "").localeCompare(String(b.name ?? ""));
      }

      const priceA = getBestPrice(a);
      const priceB = getBestPrice(b);

      if (sortKey === "price-asc") {
        if (priceA == null && priceB == null) return 0;
        if (priceA == null) return 1;
        if (priceB == null) return -1;
        return priceA - priceB;
      }

      if (sortKey === "price-desc") {
        if (priceA == null && priceB == null) return 0;
        if (priceA == null) return 1;
        if (priceB == null) return -1;
        return priceB - priceA;
      }

      if (sortKey === "cores-desc") {
        const coresA = getCoreCount(a) ?? 0;
        const coresB = getCoreCount(b) ?? 0;
        return coresB - coresA;
      }

      return 0;
    });

    return arr;
  }, [filteredParts, sortKey]);

  const pageCount = Math.max(1, Math.ceil(sortedParts.length / CPU_PAGE_SIZE));
  const safePage = Math.min(cpuPage, pageCount);

  const visibleParts = useMemo(
    () =>
      sortedParts.slice(
        (safePage - 1) * CPU_PAGE_SIZE,
        safePage * CPU_PAGE_SIZE
      ),
    [sortedParts, safePage]
  );

  const totalMatching = filteredParts.length;

  // -------------------- Render --------------------
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8">
        <header>
          <h1 className="text-2xl font-semibold">
            CAD4Less – Product Catalog &amp; Pricing Manager for Shopify
          </h1>
          <p className="mt-1 text-sm text-slate-300">
            Bring the latest CPUs into your catalog and prepare them for Shopify
            import.
          </p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          {/* Import panel */}
          <div className="rounded-xl bg-slate-900/80 p-4 shadow-sm ring-1 ring-slate-800">
            <h2 className="text-lg font-semibold">1. Import New CPUs</h2>
            <p className="mt-1 text-xs text-slate-300">
              Download fresh CPUs from external sources into the CAD4Less catalog.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="flex flex-1 flex-col text-xs text-slate-200">
                  Search term for CPUs
                  <input
                    className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-50"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </label>

                <label className="flex w-40 flex-col text-xs text-slate-200">
                  Maximum CPUs to download
                  <input
                    type="number"
                    min={1}
                    className="mt-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-50"
                    value={maxProducts}
                    onChange={(e) =>
                      setMaxProducts(parseInt(e.target.value || "0", 10) || 0)
                    }
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleStartImport}
                  disabled={importInProgress}
                >
                  Start CPU import
                </button>

                <button
                  type="button"
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void pollStatusOnce()}
                  disabled={!currentRunId}
                >
                  Check CPU import status
                </button>

                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    className="h-3 w-3 rounded border-slate-600 bg-slate-900"
                    checked={autoRefresh}
                    onChange={(e) => setAutoRefresh(e.target.checked)}
                  />
                  Auto-check every 8 s
                </label>
              </div>

              <div className="mt-2 text-xs text-slate-300">
                <div>
                  CPU import job ID: {currentRunId ?? "none yet"}
                </div>
                <div>
                  CPU import status: {importStatus?.runStatus ?? "n/a"}
                </div>
                {importError && (
                  <div className="mt-1 text-xs text-red-400">{importError}</div>
                )}
              </div>
            </div>
          </div>

          {/* CPU catalog panel */}
          <div className="rounded-xl bg-slate-900/80 p-4 shadow-sm ring-1 ring-slate-800">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">2. CPU Catalog (Live Data)</h2>
              <button
                type="button"
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800 disabled:opacity-60"
                onClick={() => void loadParts()}
                disabled={loadingParts}
              >
                Reload list
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-300">
              View and filter all processors currently available in your
              catalog.
            </p>

            <div className="mt-4 flex flex-wrap gap-3 text-xs">
              <label className="flex items-center gap-2">
                <span className="whitespace-nowrap">Store filter</span>
                <select
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-50"
                  value={vendorFilter}
                  onChange={(e) =>
                    setVendorFilter(e.target.value as VendorFilter)
                  }
                >
                  <option value="all">All stores</option>
                  <option value="amazon">Amazon only</option>
                  <option value="pcpartpicker">PCPartPicker only</option>
                </select>
              </label>

              <label className="flex min-w-[180px] flex-1 items-center gap-2">
                <span className="whitespace-nowrap">Search by name / socket</span>
                <input
                  className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-50"
                  placeholder="e.g. i7, 14700K, LGA1700"
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                />
              </label>

              <label className="flex items-center gap-2">
                <span className="whitespace-nowrap">Sort by</span>
                <select
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-50"
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                >
                  <option value="name-asc">Name (A → Z)</option>
                  <option value="price-asc">Price (low → high)</option>
                  <option value="price-desc">Price (high → low)</option>
                  <option value="cores-desc">Cores (high → low)</option>
                </select>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
              <div>
                Processors in stock: {parts.length} · Matching filters: {" "}
                {totalMatching} · Showing {visibleParts.length} of {totalMatching} (
                page {safePage} / {pageCount})
              </div>
              <div>
                Last refresh:{" "}
                {lastRefreshTime
                  ? lastRefreshTime.toLocaleTimeString()
                  : "not yet"}
              </div>
            </div>

            <div className="mt-3 overflow-hidden rounded-lg border border-slate-800 bg-slate-950/70">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-200">
                  <tr>
                    <th className="px-3 py-2 font-medium">Processor</th>
                    <th className="px-3 py-2 font-medium">Socket</th>
                    <th className="px-3 py-2 font-medium">Cores</th>
                    <th className="px-3 py-2 font-medium">Store</th>
                    <th className="px-3 py-2 font-medium">Price</th>
                    <th className="px-3 py-2 font-medium">Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingParts && (
                    <tr>
                      <td
                        className="px-3 py-3 text-center text-slate-300"
                        colSpan={6}
                      >
                        Loading processors…
                      </td>
                    </tr>
                  )}

                  {!loadingParts && partsError && (
                    <tr>
                      <td
                        className="px-3 py-3 text-center text-red-400"
                        colSpan={6}
                      >
                        {partsError}
                      </td>
                    </tr>
                  )}

                  {!loadingParts && !partsError && visibleParts.length === 0 && (
                    <tr>
                      <td
                        className="px-3 py-3 text-center text-slate-300"
                        colSpan={6}
                      >
                        No processors found. Try changing the filters or
                        importing new data.
                      </td>
                    </tr>
                  )}

                  {!loadingParts && !partsError &&
                    visibleParts.map((p) => {
                      const price = getBestPrice(p);
                      const store =
                        (p.vendor as string | undefined) ||
                        (p.store as string | undefined) ||
                        (Array.isArray(p.vendorList) &&
                          p.vendorList[0]?.vendor) ||
                        "";

                      const availability =
                        (p.availability as string | undefined) ||
                        (Array.isArray(p.vendorList) &&
                          (p.vendorList[0]?.availability as string | undefined)) ||
                        "";

                      const socket =
                        (p.specs?.socket as string | undefined) ||
                        (p.specs?.Socket as string | undefined) ||
                        (p.specs?.["CPU Socket"] as string | undefined) ||
                        "";

                      const cores = getCoreCount(p);

                      return (
                        <tr
                          key={String(p.id)}
                          className="odd:bg-slate-900/40 even:bg-slate-900/10"
                        >
                          <td className="px-3 py-2 align-top text-slate-50">
                            <div className="max-w-xs truncate text-xs font-medium">
                              {p.name}
                            </div>
                            {p.id && (
                              <div className="mt-0.5 text-[10px] text-slate-500">
                                {p.id}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 align-top text-slate-200">
                            {socket || "—"}
                          </td>
                          <td className="px-3 py-2 align-top text-slate-200">
                            {cores ?? "—"}
                          </td>
                          <td className="px-3 py-2 align-top text-slate-200">
                            {store || "—"}
                          </td>
                          <td className="px-3 py-2 align-top text-slate-200">
                            {price != null ? formatMoney(price) : "—"}
                          </td>
                          <td className="px-3 py-2 align-top text-slate-200">
                            {availability || (p.inStock ? "In stock" : "") ||
                              "—"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={safePage <= 1}
                  onClick={() => setCpuPage((p) => Math.max(1, p - 1))}
                >
                  Previous page
                </button>
                <button
                  type="button"
                  className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={safePage >= pageCount}
                  onClick={() =>
                    setCpuPage((p) => Math.min(pageCount, p + 1))
                  }
                >
                  Next page
                </button>
              </div>
              <div>
                Page {safePage} of {pageCount}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default CatalogDashboard;