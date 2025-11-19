import React, { useState, useEffect, useRef } from "react";
import {
  startCpuImport,
  getCpuImportStatus,
  StartImportResponse,
  ImportStatusResponse,
} from "../../../api/client";

type RunState = {
  runId: string | null;
  status: string;
  error: string | null;
  lastResult: ImportStatusResponse | null;
  isPolling: boolean;
};

const POLL_INTERVAL_MS = 10_000;

export function CpuImportPanel() {
  const [category, setCategory] = useState("cpu");
  const [maxProducts, setMaxProducts] = useState(10);
  const [searchPhrase, setSearchPhrase] = useState("intel");

  const [runState, setRunState] = useState<RunState>({
    runId: null,
    status: "no active run",
    error: null,
    lastResult: null,
    isPolling: false,
  });

  const pollTimer = useRef<number | null>(null);

  function clearPollTimer() {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  useEffect(() => {
    return () => {
      clearPollTimer();
    };
  }, []);

  async function pollOnce(runId: string) {
    try {
      const res = await getCpuImportStatus(runId, category, maxProducts);
      const terminal =
        res.runStatus !== "RUNNING" &&
        res.runStatus !== "READY" &&
        res.runStatus !== "UNKNOWN";

      setRunState((prev) => ({
        ...prev,
        status: res.runStatus,
        error: res.error ?? null,
        lastResult: res,
        isPolling: !terminal,
      }));

      if (terminal) {
        clearPollTimer();
      }
    } catch (err: any) {
      clearPollTimer();
      setRunState((prev) => ({
        ...prev,
        error: err?.message || "Polling failed",
        isPolling: false,
      }));
    }
  }

  async function handleStartClick() {
    try {
      clearPollTimer();
      setRunState({
        runId: null,
        status: "starting…",
        error: null,
        lastResult: null,
        isPolling: false,
      });

      const res: StartImportResponse = await startCpuImport(
        category,
        maxProducts,
        searchPhrase
      );

      if (!res.runId) {
        throw new Error(res.error || "No runId returned from API");
      }

      setRunState({
        runId: res.runId,
        status: res.runStatus || "READY",
        error: null,
        lastResult: null,
        isPolling: true,
      });

      pollTimer.current = window.setInterval(() => {
        pollOnce(res.runId);
      }, POLL_INTERVAL_MS);

      // Also poll immediately once so the user sees progress fast
      pollOnce(res.runId);
    } catch (err: any) {
      clearPollTimer();
      setRunState({
        runId: null,
        status: "error",
        error: err?.message || "Failed to start import",
        lastResult: null,
        isPolling: false,
      });
    }
  }

  const { runId, status, error, lastResult } = runState;

  return (
    <section
      style={{
        padding: 24,
        borderRadius: 12,
        backgroundColor: "#fafafa",
        border: "1px solid #e5e5e5",
      }}
    >
      <h2 style={{ marginTop: 0, marginBottom: 16 }}>
        CPU Import – PcPartPicker → Apify → DynamoDB
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 2fr",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <div>
          <label
            style={{ display: "block", fontWeight: 600, marginBottom: 4 }}
          >
            Category
          </label>
          <input
            type="text"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #ccc",
            }}
          />
        </div>

        <div>
          <label
            style={{ display: "block", fontWeight: 600, marginBottom: 4 }}
          >
            Max products
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={maxProducts}
            onChange={(e) =>
              setMaxProducts(Math.max(1, Number(e.target.value) || 1))
            }
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #ccc",
            }}
          />
        </div>

        <div>
          <label
            style={{ display: "block", fontWeight: 600, marginBottom: 4 }}
          >
            Search phrase
          </label>
          <input
            type="text"
            value={searchPhrase}
            onChange={(e) => setSearchPhrase(e.target.value)}
            placeholder="e.g. ryzen 5, i7 14700K"
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid #ccc",
            }}
          />
        </div>
      </div>

      <button
        onClick={handleStartClick}
        style={{
          padding: "10px 20px",
          borderRadius: 6,
          border: "none",
          backgroundColor: "#2563eb",
          color: "white",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Start Apify Import
      </button>

      <div style={{ marginTop: 16, fontSize: 14 }}>
        <div>
          <strong>Run ID:</strong>{" "}
          <span style={{ fontFamily: "monospace" }}>
            {runId || "none"}
          </span>
        </div>
        <div>
          <strong>Status:</strong>{" "}
          <span>{status || "no active run"}</span>
        </div>
        {lastResult && lastResult.received !== undefined && (
          <div style={{ marginTop: 4 }}>
            <strong>Received:</strong> {lastResult.received}{" "}
            <strong>Inserted:</strong> {lastResult.inserted ?? 0}
          </div>
        )}
      </div>

      {error && (
        <div
          style={{
            marginTop: 20,
            padding: 12,
            borderRadius: 6,
            backgroundColor: "#fee2e2",
            color: "#b91c1c",
            fontSize: 14,
          }}
        >
          <strong>Error:</strong> {error}
        </div>
      )}
    </section>
  );
}
