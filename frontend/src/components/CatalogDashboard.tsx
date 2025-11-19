import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchParts,
  getCpuImportStatus,
  startCpuImport,
  ImportStatusResponse,
  Part,
} from "../api/client";

type VendorFilter = "all" | "amazon" | "pcpartpicker";
type SortKey = "name-asc" | "price-asc" | "price-desc" | "cores-desc";
const CPU_PAGE_SIZE = 10;

const CatalogDashboard: React.FC = () => {
  // ---- CPU / data state ----
  const [category] = useState<"cpu">("cpu");
  const [vendorFilter, setVendorFilter] = useState<VendorFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name-asc");
  const [nameFilter, setNameFilter] = useState<string>("");
  const [parts, setParts] = useState<Part[]>([]);
  const [loadingParts, setLoadingParts] = useState(false);
  const [partsError, setPartsError] = useState<string | null>(null);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  // ---- Import state (CPU) ----
  const [searchTerm, setSearchTerm] = useState("intel");
  const [maxProducts, setMaxProducts] = useState(50);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<ImportStatusResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importInProgress, setImportInProgress] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // ---- Motherboard import state ----
  const [mbSearchTerm, setMbSearchTerm] = useState("Z790 motherboard");
  const [mbMaxProducts, setMbMaxProducts] = useState(50);
  const [mbRunId, setMbRunId] = useState<string | null>(null);
  const [mbImportStatus, setMbImportStatus] = useState<ImportStatusResponse | null>(null);
  const [mbImportError, setMbImportError] = useState<string | null>(null);
  const [mbImportInProgress, setMbImportInProgress] = useState(false);

  // ---- Builder state (PC configuration) ----
  const [builderCpuId, setBuilderCpuId] = useState<string>("");
  const [builderMarginPct, setBuilderMarginPct] = useState<number>(20);
  const [cpuPage, setCpuPage] = useState<number>(1);

  // ---- Motherboard catalog state ----
  const [mbVendorFilter, setMbVendorFilter] = useState<VendorFilter>("all");
  const [mbSortKey, setMbSortKey] = useState<SortKey>("name-asc");
  const [mbNameFilter, setMbNameFilter] = useState<string>("");
  const [motherboards, setMotherboards] = useState<Part[]>([]);
  const [loadingMbs, setLoadingMbs] = useState(false);
  const [mbError, setMbError] = useState<string | null>(null);
  const [lastMbRefreshTime, setLastMbRefreshTime] = useState<Date | null>(null);

  // ---- Builder motherboard selection ----
  const [builderMotherboardId, setBuilderMotherboardId] = useState<string>("");

  // ---- Helpers ----
  const getBestPrice = (p: Part): number | null => {
    if (typeof p.price === "number") {
      return p.price;
    }
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

  const getSocket = (p: Part): string => {
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

    const socketKey = Object.keys(specs).find((k) =>
      k.toLowerCase().includes("socket")
    );
    if (socketKey) {
      return String(specs[socketKey as keyof typeof specs] ?? "").trim();
    }
    return "";
  };

  const normalizeSocket = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

  const formatMoney = (value: number): string =>
    value.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });

  // ---- Load CPUs from backend ----
  const loadParts = useCallback(async () => {
    try {
      setLoadingParts(true);
      setPartsError(null);
      const data = await fetchParts(category, vendorFilter);
      setParts(data.parts ?? []);
      setLastRefreshTime(new Date());
    } catch (err: any) {
      console.error("Failed to fetch parts", err);
      setPartsError(err?.message ?? "Failed to fetch processors");
    } finally {
      setLoadingParts(false);
    }
  }, [category, vendorFilter]);

  // ---- Load motherboards from backend ----
  const loadMotherboards = useCallback(async () => {
    try {
      setLoadingMbs(true);
      setMbError(null);
      const data = await fetchParts("motherboard" as any, mbVendorFilter);
      setMotherboards(data.parts ?? []);
      setLastMbRefreshTime(new Date());
    } catch (err: any) {
      console.error("Failed to fetch motherboards", err);
      setMbError(err?.message ?? "Failed to fetch motherboards");
    } finally {
      setLoadingMbs(false);
    }
  }, [mbVendorFilter]);

  useEffect(() => {
    void loadParts();
  }, [loadParts]);

  useEffect(() => {
    void loadMotherboards();
  }, [loadMotherboards]);

  // ---- Start CPU import ----
  const handleStartImport = async () => {
    try {
      setImportError(null);
      setImportStatus(null);
      setImportInProgress(true);

      const resp = await startCpuImport(category, maxProducts, searchTerm);
      setCurrentRunId(resp.runId);
      setImportStatus({
        message: resp.message,
        category: resp.category,
        runId: resp.runId,
        runStatus: resp.runStatus,
      });
    } catch (err: any) {
      console.error("Failed to start import", err);
      setImportError(err?.message ?? "Failed to start processor import");
      setImportInProgress(false);
    }
  };

  // ---- Start motherboard import ----
  const handleStartMotherboardImport = async () => {
    try {
      setMbImportError(null);
      setMbImportStatus(null);
      setMbImportInProgress(true);

      const resp = await startCpuImport(
        "motherboard" as any,
        mbMaxProducts,
        mbSearchTerm
      );
      setMbRunId(resp.runId);
      setMbImportStatus({
        message: resp.message,
        category: resp.category,
        runId: resp.runId,
        runStatus: resp.runStatus,
      });
    } catch (err: any) {
      console.error("Failed to start motherboard import", err);
      setMbImportError(err?.message ?? "Failed to start board import");
      setMbImportInProgress(false);
    }
  };

  // ---- Poll CPU import status once ----
  const pollStatusOnce = useCallback(async () => {
    if (!currentRunId) return;

    try {
      const status = await getCpuImportStatus(
        currentRunId,
        category,
        maxProducts
      );
      setImportStatus(status);

      if (status.runStatus === "SUCCEEDED") {
        setImportInProgress(false);
        await loadParts();
      } else if (
        status.runStatus === "FAILED" ||
        status.runStatus === "TIMED_OUT"
      ) {
        setImportInProgress(false);
      }
    } catch (err: any) {
      console.error("Failed to get import status", err);
      setImportError(err?.message ?? "Failed to check import status");
      setImportInProgress(false);
    }
  }, [currentRunId, category, maxProducts, loadParts]);

  // ---- Poll board import status once ----
  const pollMotherboardStatusOnce = useCallback(async () => {
    if (!mbRunId) return;

    try {
      const status = await getCpuImportStatus(
        mbRunId,
        "motherboard" as any,
        mbMaxProducts
      );
      setMbImportStatus(status);

      if (status.runStatus === "SUCCEEDED") {
        setMbImportInProgress(false);
        await loadMotherboards();
      } else if (
        status.runStatus === "FAILED" ||
        status.runStatus === "TIMED_OUT"
      ) {
        setMbImportInProgress(false);
      }
    } catch (err: any) {
      console.error("Failed to get board import status", err);
      setMbImportError(err?.message ?? "Failed to check board import status");
      setMbImportInProgress(false);
    }
  }, [mbRunId, mbMaxProducts, loadMotherboards]);

  // ---- Auto-check for CPU import while running ----
  useEffect(() => {
    if (!autoRefresh || !currentRunId || !importInProgress) return;

    const id = window.setInterval(() => {
      void pollStatusOnce();
    }, 8000);

    return () => window.clearInterval(id);
  }, [autoRefresh, currentRunId, importInProgress, pollStatusOnce]);

  // ---- Derived CPU lists & counts ----
  const visibleParts = useMemo(
    () =>
      parts.filter(
        (p) => (p.availability ?? "").toLowerCase().trim() === "in stock"
      ),
    [parts]
  );

  const filteredParts = useMemo(() => {
    if (!nameFilter.trim()) return visibleParts;
    const q = nameFilter.toLowerCase();
    return visibleParts.filter((p) => {
      const name = (p.name ?? "").toLowerCase();
      const manu = ((p.specs?.Manufacturer as string) || "").toLowerCase();
      const socket = getSocket(p).toLowerCase();
      return name.includes(q) || manu.includes(q) || socket.includes(q);
    });
  }, [visibleParts, nameFilter]);

  const sortedParts = useMemo(() => {
    const arr = [...filteredParts];
    arr.sort((a, b) => {
      if (sortKey === "name-asc") {
        return (a.name || "").localeCompare(b.name || "");
      }

      const priceA = getBestPrice(a) ?? Number.POSITIVE_INFINITY;
      const priceB = getBestPrice(b) ?? Number.POSITIVE_INFINITY;

      if (sortKey === "price-asc") {
        return priceA - priceB;
      }
      if (sortKey === "price-desc") {
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

  useEffect(() => {
    setCpuPage(1);
  }, [nameFilter, sortKey, vendorFilter]);

  const totalCpuPages = Math.max(
    1,
    Math.ceil(sortedParts.length / CPU_PAGE_SIZE)
  );

  const pagedCpus = useMemo(() => {
    const start = (cpuPage - 1) * CPU_PAGE_SIZE;
    return sortedParts.slice(start, start + CPU_PAGE_SIZE);
  }, [sortedParts, cpuPage]);

  const intelCount = useMemo(
    () =>
      visibleParts.filter(
        (p) =>
          /intel/i.test(p.name ?? "") ||
          /intel/i.test((p.specs?.Manufacturer as string) ?? "")
      ).length,
    [visibleParts]
  );

  // ---- Builder derived values (CPU + socket) ----
  const builderCpu = useMemo(
    () => sortedParts.find((p) => p.id === builderCpuId) ?? null,
    [sortedParts, builderCpuId]
  );

  const builderCpuSocket = useMemo(
    () => (builderCpu ? getSocket(builderCpu) : ""),
    [builderCpu]
  );

  const builderCpuSocketNorm = useMemo(
    () => (builderCpuSocket ? normalizeSocket(builderCpuSocket) : ""),
    [builderCpuSocket]
  );

  // ---- Motherboard helpers & derived lists ----
  const baseMotherboards = useMemo(() => motherboards, [motherboards]);

  const inStockMotherboardsCount = useMemo(
    () =>
      baseMotherboards.filter(
        (p) => (p.availability ?? "").toLowerCase().trim() === "in stock"
      ).length,
    [baseMotherboards]
  );

  const cpuFilteredMotherboards = useMemo(() => {
    if (!builderCpuSocketNorm) {
      return baseMotherboards;
    }

    const candidates = baseMotherboards.filter((mb) => {
      const mbSocket = getSocket(mb);
      if (!mbSocket) return false;
      const mbNorm = normalizeSocket(mbSocket);
      return (
        mbNorm === builderCpuSocketNorm ||
        mbNorm.includes(builderCpuSocketNorm) ||
        builderCpuSocketNorm.includes(mbNorm)
      );
    });

    return candidates;
  }, [baseMotherboards, builderCpuSocketNorm]);

  const filteredMotherboards = useMemo(() => {
    const source = cpuFilteredMotherboards;
    if (!mbNameFilter.trim()) return source;
    const q = mbNameFilter.toLowerCase();
    return source.filter((p) => {
      const name = (p.name ?? "").toLowerCase();
      const manu = ((p.specs?.Manufacturer as string) || "").toLowerCase();
      const socket = getSocket(p).toLowerCase();
      return name.includes(q) || manu.includes(q) || socket.includes(q);
    });
  }, [cpuFilteredMotherboards, mbNameFilter]);

  const sortedMotherboards = useMemo(() => {
    const arr = [...filteredMotherboards];
    arr.sort((a, b) => {
      if (mbSortKey === "name-asc") {
        return (a.name || "").localeCompare(b.name || "");
      }

      const priceA = getBestPrice(a) ?? Number.POSITIVE_INFINITY;
      const priceB = getBestPrice(b) ?? Number.POSITIVE_INFINITY;

      if (mbSortKey === "price-asc") {
        return priceA - priceB;
      }
      if (mbSortKey === "price-desc") {
        return priceB - priceA;
      }

      return 0;
    });
    return arr;
  }, [filteredMotherboards, mbSortKey]);

  const visibleMotherboards = sortedMotherboards;

  const builderMotherboard = useMemo(
    () => sortedMotherboards.find((p) => p.id === builderMotherboardId) ?? null,
    [sortedMotherboards, builderMotherboardId]
  );

  const noCompatibleBoards =
    !!builderCpuSocketNorm && cpuFilteredMotherboards.length === 0;

  const builderPartsCost = useMemo(() => {
    let total = 0;
    if (builderCpu) {
      const cost = getBestPrice(builderCpu);
      if (cost != null) total += cost;
    }
    if (builderMotherboard) {
      const cost = getBestPrice(builderMotherboard);
      if (cost != null) total += cost;
    }
    return total;
  }, [builderCpu, builderMotherboard]);

  const builderSellingPrice = useMemo(() => {
    if (builderPartsCost <= 0) return 0;
    const marginMultiplier = 1 + (builderMarginPct || 0) / 100;
    return builderPartsCost * marginMultiplier;
  }, [builderPartsCost, builderMarginPct]);

  // ---- Render ----
  return (
    <div style={pageStyles}>
      <header style={headerStyles}>
        <h1 style={{ margin: 0, fontSize: 32 }}>
          CAD4Less – Product Catalog &amp; Pricing Manager for Shopify
        </h1>
        <p style={{ margin: "4px 0 0", color: "#555" }}>
          Bring the latest CPUs and motherboards into your catalog.
        </p>
      </header>

      {/* Top grid: Import + CPU catalog */}
      <main style={mainGridStyles}>
        {/* LEFT: Import control */}
        <section style={panelStyles}>
          <h2 style={sectionTitleStyles}>1. Import New CPUs</h2>
          <p style={hintTextStyles}>
            Bring the latest CPUs and motherboards into your catalog.
          </p>

          <div style={fieldRowStyles}>
            <label style={labelStyles}>
              <span style={labelTitleStyles}>Search term for CPUs</span>
              <input
                style={inputStyles}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </label>

            <label style={labelStyles}>
              <span style={labelTitleStyles}>Maximum CPUs to download</span>
              <input
                style={inputStyles}
                type="number"
                min={1}
                max={200}
                value={maxProducts}
                onChange={(e) =>
                  setMaxProducts(Number(e.target.value) || 1)
                }
              />
            </label>
          </div>

          <div style={buttonRowStyles}>
            <button
              style={primaryButtonStyles}
              onClick={() => void handleStartImport()}
              disabled={importInProgress}
            >
              {importInProgress ? "Import running…" : "Start CPU import"}
            </button>

            <button
              style={secondaryButtonStyles}
              onClick={() => void pollStatusOnce()}
              disabled={!currentRunId}
            >
              Check CPU import status
            </button>

            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              Auto-check every 8 s
            </label>
          </div>

          <div style={{ marginTop: 12, fontSize: 14 }}>
            <div>
              <strong>CPU import job ID:</strong>{" "}
              {currentRunId ?? <span style={{ color: "#888" }}>none yet</span>}
            </div>
            <div>
              <strong>CPU import status:</strong>{" "}
              {importStatus?.runStatus ?? <span style={{ color: "#888" }}>n/a</span>}
            </div>
            {typeof importStatus?.received === "number" && (
              <div>
                <strong>Received:</strong> {importStatus.received}
              </div>
            )}
            {typeof importStatus?.inserted === "number" && (
              <div>
                <strong>Inserted into catalog:</strong> {importStatus.inserted}
              </div>
            )}
          </div>

          {importError && (
            <div style={errorBoxStyles}>
              <strong>CPU import error:</strong> {importError}
            </div>
          )}

          <hr style={{ margin: "16px 0" }} />

          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Import Motherboards</h3>
          <p style={hintTextStyles}>
            Run a separate import for motherboards (for example “Z790”, “B760”) to keep your board catalog up to date.
          </p>

          <div style={fieldRowStyles}>
            <label style={labelStyles}>
              <span style={labelTitleStyles}>Search term for boards</span>
              <input
                style={inputStyles}
                type="text"
                value={mbSearchTerm}
                onChange={(e) => setMbSearchTerm(e.target.value)}
              />
            </label>

            <label style={labelStyles}>
              <span style={labelTitleStyles}>Maximum boards to download</span>
              <input
                style={inputStyles}
                type="number"
                min={1}
                max={200}
                value={mbMaxProducts}
                onChange={(e) =>
                  setMbMaxProducts(Number(e.target.value) || 1)
                }
              />
            </label>
          </div>

          <div style={buttonRowStyles}>
            <button
              style={primaryButtonStyles}
              onClick={() => void handleStartMotherboardImport()}
              disabled={mbImportInProgress}
            >
              {mbImportInProgress ? "Import running…" : "Start board import"}
            </button>

            <button
              style={secondaryButtonStyles}
              onClick={() => void pollMotherboardStatusOnce()}
              disabled={!mbRunId}
            >
              Check board import status
            </button>
          </div>

          <div style={{ marginTop: 12, fontSize: 14 }}>
            <div>
              <strong>Board import job ID:</strong>{" "}
              {mbRunId ?? <span style={{ color: "#888" }}>none yet</span>}
            </div>
            <div>
              <strong>Board import status:</strong>{" "}
              {mbImportStatus?.runStatus ?? <span style={{ color: "#888" }}>n/a</span>}
            </div>
            {typeof mbImportStatus?.received === "number" && (
              <div>
                <strong>Received:</strong> {mbImportStatus.received}
              </div>
            )}
            {typeof mbImportStatus?.inserted === "number" && (
              <div>
                <strong>Inserted into catalog:</strong> {mbImportStatus.inserted}
              </div>
            )}
          </div>

          {mbImportError && (
            <div style={errorBoxStyles}>
              <strong>Board import error:</strong> {mbImportError}
            </div>
          )}
        </section>

        {/* RIGHT: CPU table */}
        <section style={panelStyles}>
          <h2 style={sectionTitleStyles}>2. CPU Catalog (Live Data)</h2>
          <p style={hintTextStyles}>
            View and filter all the processors currently in your catalog.
          </p>

          <div style={fieldRowStyles}>
            <label style={labelStyles}>
              <span style={labelTitleStyles}>Store filter</span>
              <select
                style={inputStyles}
                value={vendorFilter}
                onChange={(e) => setVendorFilter(e.target.value as VendorFilter)}
              >
                <option value="all">All stores</option>
                <option value="amazon">Amazon only</option>
                <option value="pcpartpicker">PcPartPicker only</option>
              </select>
            </label>

            <label style={labelStyles}>
              <span style={labelTitleStyles}>Search by name, socket or brand</span>
              <input
                style={inputStyles}
                type="text"
                placeholder="e.g. i7, 14700K, LGA1700"
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value)}
              />
            </label>

            <label style={labelStyles}>
              <span style={labelTitleStyles}>Sort by</span>
              <select
                style={inputStyles}
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
              >
                <option value="name-asc">Name (A → Z)</option>
                <option value="price-asc">Price (low → high)</option>
                <option value="price-desc">Price (high → low)</option>
                <option value="cores-desc">Cores (high → low)</option>
              </select>
            </label>

            <button
              style={secondaryButtonStyles}
              onClick={() => void loadParts()}
              disabled={loadingParts}
            >
              {loadingParts ? "Reloading…" : "Reload list"}
            </button>
          </div>

          <div style={{ fontSize: 14, marginBottom: 8 }}>
            <strong>Processors in stock:</strong> {visibleParts.length}{" "}
            <span style={{ marginLeft: 16 }}>
              <strong>Matching “Intel”:</strong> {intelCount}
            </span>
            <span style={{ marginLeft: 16 }}>
              <strong>Showing:</strong> {pagedCpus.length} of {sortedParts.length} (page {cpuPage} / {totalCpuPages})
            </span>
            {lastRefreshTime && (
              <span style={{ marginLeft: 16, color: "#666" }}>
                Last refresh: {lastRefreshTime.toLocaleTimeString()}
              </span>
            )}
          </div>

          {partsError && (
            <div style={errorBoxStyles}>
              <strong>Load error:</strong> {partsError}
            </div>
          )}

          <div style={tableWrapperStyles}>
            <table style={tableStyles}>
              <thead>
                <tr>
                  <th style={thStyles}>Processor</th>
                  <th style={thStyles}>Socket Type</th>
                  <th style={thStyles}>Cores / Threads</th>
                  <th style={thStyles}>Store</th>
                  <th style={thStyles}>Price</th>
                  <th style={thStyles}>Availability</th>
                </tr>
              </thead>
              <tbody>
                {pagedCpus.map((p) => {
                  const socket = getSocket(p);
                  const cores =
                    (p.specs?.cores as string) ??
                    (p.specs?.["Core Count"] as string) ??
                    "";
                  const threads =
                    (p.specs?.threads as string) ??
                    (p.specs?.["Thread Count"] as string) ??
                    "";
                  const price =
                    p.price != null
                      ? `$${p.price}`
                      : p.vendorList && p.vendorList[0]?.price != null
                      ? `$${p.vendorList[0].price}`
                      : "—";

                  return (
                    <tr key={p.id}>
                      <td style={tdStyles}>{p.name}</td>
                      <td style={tdStyles}>{socket}</td>
                      <td style={tdStyles}>
                        {cores || threads
                          ? `${cores || "?"}c / ${threads || "?"}t`
                          : "—"}
                      </td>
                      <td style={tdStyles}>{p.vendor}</td>
                      <td style={tdStyles}>{price}</td>
                      <td style={tdStyles}>{p.availability ?? "unknown"}</td>
                    </tr>
                  );
                })}

                {sortedParts.length === 0 && !loadingParts && (
                  <tr>
                    <td style={tdStyles} colSpan={6}>
                      No in-stock processors found. Try changing the filters or importing new data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div style={paginationRowStyles}>
            <button
              style={secondaryButtonStyles}
              onClick={() => setCpuPage((p) => Math.max(1, p - 1))}
              disabled={cpuPage <= 1}
            >
              Previous page
            </button>
            <span style={{ fontSize: 12 }}>Page {cpuPage} of {totalCpuPages}</span>
            <button
              style={secondaryButtonStyles}
              onClick={() => setCpuPage((p) => Math.min(totalCpuPages, p + 1))}
              disabled={cpuPage >= totalCpuPages}
            >
              Next page
            </button>
          </div>
        </section>
      </main>

      {/* Section 3: Quick Build */}
      <section style={{ ...panelStyles, marginTop: 16 }}>
        <h2 style={sectionTitleStyles}>3. Quick Build Calculator</h2>
        <p style={hintTextStyles}>
          Pick a CPU and a matching motherboard, set your margin, and see a suggested selling price.
        </p>

        <div style={fieldRowStyles}>
          <label style={labelStyles}>
            <span style={labelTitleStyles}>Select CPU</span>
            <select
              style={inputStyles}
              value={builderCpuId}
              onChange={(e) => {
                const id = e.target.value;
                setBuilderCpuId(id);
                setBuilderMotherboardId("");
                setMbNameFilter("");
              }}
            >
              <option value="">– Select CPU –</option>
              {sortedParts.map((p) => {
                const basePrice = getBestPrice(p);
                const labelPrice = basePrice != null ? ` • ${formatMoney(basePrice)}` : "";
                return (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {labelPrice}
                  </option>
                );
              })}
            </select>
          </label>

          <label style={labelStyles}>
            <span style={labelTitleStyles}>Select compatible board</span>
            <select
              style={inputStyles}
              value={builderMotherboardId}
              onChange={(e) => setBuilderMotherboardId(e.target.value)}
              disabled={!builderCpu}
            >
              <option value="">
                {builderCpu ? `– Select board for ${builderCpuSocket || "this CPU"} –` : "Select a CPU first"}
              </option>
              {visibleMotherboards.map((p) => {
                const basePrice = getBestPrice(p);
                const labelPrice = basePrice != null ? ` • ${formatMoney(basePrice)}` : "";
                const socket = getSocket(p);
                return (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {socket ? ` [${socket}]` : ""}
                    {labelPrice}
                  </option>
                );
              })}
            </select>
          </label>

          <label style={labelStyles}>
            <span style={labelTitleStyles}>Profit margin (%)</span>
            <input
              style={inputStyles}
              type="number"
              min={0}
              max={200}
              value={builderMarginPct}
              onChange={(e) => setBuilderMarginPct(Number(e.target.value) || 0)}
            />
          </label>
        </div>

        <div style={{ fontSize: 14, marginTop: 8 }}>
          <h3 style={{ margin: "8px 0" }}>Your selected components</h3>
          <table style={tableStyles}>
            <thead>
              <tr>
                <th style={thStyles}>Component</th>
                <th style={thStyles}>Part</th>
                <th style={thStyles}>Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={tdStyles}>CPU</td>
                <td style={tdStyles}>{builderCpu ? builderCpu.name : "Not selected"}</td>
                <td style={tdStyles}>
                  {builderCpu && getBestPrice(builderCpu) != null
                    ? formatMoney(getBestPrice(builderCpu) as number)
                    : "—"}
                </td>
              </tr>
              <tr>
                <td style={tdStyles}>Motherboard</td>
                <td style={tdStyles}>{builderMotherboard ? builderMotherboard.name : "Not selected"}</td>
                <td style={tdStyles}>
                  {builderMotherboard && getBestPrice(builderMotherboard) != null
                    ? formatMoney(getBestPrice(builderMotherboard) as number)
                    : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          style={{
            marginTop: 12,
            padding: 12,
            borderRadius: 8,
            background: "#f8fafc",
            fontSize: 14,
          }}
        >
          <div>
            <strong>Total cost of parts:</strong>{" "}
            {builderPartsCost > 0 ? formatMoney(builderPartsCost) : "—"}
          </div>
          <div>
            <strong>Desired margin:</strong> {builderMarginPct.toFixed(1)}%
          </div>
          <div style={{ marginTop: 4, fontSize: 16 }}>
            <strong>Suggested retail price:</strong>{" "}
            {builderSellingPrice > 0 ? formatMoney(builderSellingPrice) : "—"}
          </div>
        </div>
      </section>

      {/* Section 4: Motherboard Catalog */}
      <section style={{ ...panelStyles, marginTop: 16 }}>
        <h2 style={sectionTitleStyles}>4. Motherboard Catalog (Live Data)</h2>
        <p style={hintTextStyles}>
          Browse all boards in your catalog. When a CPU is selected above, only compatible ones will be shown.
        </p>

        <div style={fieldRowStyles}>
          <label style={labelStyles}>
            <span style={labelTitleStyles}>Store filter</span>
            <select
              style={inputStyles}
              value={mbVendorFilter}
              onChange={(e) => setMbVendorFilter(e.target.value as VendorFilter)}
            >
              <option value="all">All stores</option>
              <option value="amazon">Amazon only</option>
              <option value="pcpartpicker">PcPartPicker only</option>
            </select>
          </label>

          <label style={labelStyles}>
            <span style={labelTitleStyles}>Search boards by name, socket or brand</span>
            <input
              style={inputStyles}
              type="text"
              placeholder="e.g. Z790, LGA1700, ASUS"
              value={mbNameFilter}
              onChange={(e) => setMbNameFilter(e.target.value)}
            />
          </label>

          <label style={labelStyles}>
            <span style={labelTitleStyles}>Sort by</span>
            <select
              style={inputStyles}
              value={mbSortKey}
              onChange={(e) => setMbSortKey(e.target.value as SortKey)}
            >
              <option value="name-asc">Name (A → Z)</option>
              <option value="price-asc">Price (low → high)</option>
              <option value="price-desc">Price (high → low)</option>
            </select>
          </label>

          <button
            style={secondaryButtonStyles}
            onClick={() => void loadMotherboards()}
            disabled={loadingMbs}
          >
            {loadingMbs ? "Reloading…" : "Reload list"}
          </button>
        </div>

        <div style={{ fontSize: 14, marginBottom: 8 }}>
          <strong>Boards in catalog:</strong> {visibleMotherboards.length}
          <span style={{ marginLeft: 16 }}>
            <strong>In stock:</strong> {inStockMotherboardsCount}
          </span>
          {lastMbRefreshTime && (
            <span style={{ marginLeft: 16, color: "#666" }}>
              Last refresh: {lastMbRefreshTime.toLocaleTimeString()}
            </span>
          )}
        </div>

        {mbError && (
          <div style={errorBoxStyles}>
            <strong>Load error:</strong> {mbError}
          </div>
        )}

        <div style={tableWrapperStyles}>
          <table style={tableStyles}>
            <thead>
              <tr>
                <th style={thStyles}>Board</th>
                <th style={thStyles}>Socket Type</th>
                <th style={thStyles}>Form Factor</th>
                <th style={thStyles}>Chipset</th>
                <th style={thStyles}>Store</th>
                <th style={thStyles}>Price</th>
                <th style={thStyles}>Availability</th>
              </tr>
            </thead>
            <tbody>
              {visibleMotherboards.map((p) => {
                const socket = getSocket(p);
                const formFactor = (p.specs?.["Form Factor"] as string) ?? "";
                const chipset = (p.specs?.["Chipset"] as string) ?? "";
                const price =
                  p.price != null
                    ? `$${p.price}`
                    : p.vendorList && p.vendorList[0]?.price != null
                    ? `$${p.vendorList[0].price}`
                    : "—";
                const isSelected = p.id === builderMotherboardId;

                return (
                  <tr
                    key={p.id}
                    onClick={() => setBuilderMotherboardId(p.id)}
                    style={{
                      backgroundColor: isSelected ? "#eff6ff" : "white",
                      cursor: "pointer",
                    }}
                  >
                    <td style={tdStyles}>{p.name}</td>
                    <td style={tdStyles}>{socket}</td>
                    <td style={tdStyles}>{formFactor}</td>
                    <td style={tdStyles}>{chipset}</td>
                    <td style={tdStyles}>{p.vendor}</td>
                    <td style={tdStyles}>{price}</td>
                    <td style={tdStyles}>{p.availability ?? "unknown"}</td>
                  </tr>
                );
              })}

              {visibleMotherboards.length === 0 && !loadingMbs && (
                <tr>
                  <td style={tdStyles} colSpan={7}>
                    {noCompatibleBoards
                      ? "No compatible motherboards found for the selected CPU. Please pick a different processor or import more boards."
                      : "No boards matched your filters. Try clearing the search or adding more boards."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default CatalogDashboard;

// ---- Inline styles ----

const pageStyles: React.CSSProperties = {
  minHeight: "100vh",
  padding: "24px",
  background: "#0f172a",
  color: "#0f172a",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, -apple-system, sans-serif',
};

const headerStyles: React.CSSProperties = {
  background: "white",
  padding: "16px 20px",
  borderRadius: 12,
  marginBottom: 16,
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.3)",
};

const mainGridStyles: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.4fr)",
  gap: 16,
  alignItems: "flex-start",
};

const panelStyles: React.CSSProperties = {
  background: "white",
  borderRadius: 12,
  padding: 20,
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.25)",
};

const sectionTitleStyles: React.CSSProperties = {
  margin: 0,
  marginBottom: 8,
  fontSize: 20,
};

const hintTextStyles: React.CSSProperties = {
  marginTop: 0,
  marginBottom: 16,
  fontSize: 13,
  color: "#444",
  backgroundColor: "#f9fafb",
  borderLeft: "3px solid #bfdbfe",
  padding: "6px 10px",
  borderRadius: 6,
};

const fieldRowStyles: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "flex-end",
  marginBottom: 12,
  flexWrap: "wrap",
};

const labelStyles: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
};

const inputStyles: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  fontSize: 13,
  minWidth: 120,
};

const primaryButtonStyles: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: "#2563eb",
  color: "white",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const secondaryButtonStyles: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "white",
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const buttonRowStyles: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  marginTop: 8,
  marginBottom: 4,
  flexWrap: "wrap",
};

const paginationRowStyles: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 10px",
  borderTop: "1px solid #e2e8f0",
  background: "#f8fafc",
  gap: 8,
};

const tableWrapperStyles: React.CSSProperties = {
  marginTop: 8,
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  overflow: "hidden",
};

const tableStyles: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

const thStyles: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  background: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const tdStyles: React.CSSProperties = {
  padding: "7px 10px",
  borderBottom: "1px solid #e2e8f0",
  verticalAlign: "top",
};

const errorBoxStyles: React.CSSProperties = {
  marginTop: 12,
  padding: 10,
  borderRadius: 8,
  background: "#fef2f2",
  color: "#b91c1c",
  fontSize: 13,
};
const labelTitleStyles: React.CSSProperties = {
  fontWeight: 600,
};