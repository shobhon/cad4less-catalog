"use client";

import React, { useEffect, useState } from "react";

const API_BASE = "https://lhr6ymi61h.execute-api.us-west-1.amazonaws.com/v1";

type ImportStatus = {
  message?: string;
  category?: string;
  runId?: string;
  runStatus?: string;
  received?: number;
  inserted?: number;
  error?: string;
};

export function CpuImportPanel() {
  const [search, setSearch] = useState("ryzen 5");
  const [max, setMax] = useState(10);
  const [runId, setRunId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string>("Idle");
  const [details, setDetails] = useState<ImportStatus | null>(null);
  const [starting, setStarting] = useState(false);

  const category = "cpu";

  async function startImport() {
    try {
      setStarting(true);
      setStatusText("Starting Apify run...");
      setDetails(null);

      const params = new URLSearchParams({
        category,
        max: String(max),
        search,
      });

      const res = await fetch(`${API_BASE}/parts/import?${params.toString()}`, {
        method: "GET",
      });

      const data: ImportStatus = await res.json();

      if (!res.ok) {
        setStatusText("Failed to start import");
        setDetails(data);
        setRunId(null);
        return;
      }

      if (!data.runId) {
        setStatusText("Unexpected response (no runId)");
        setDetails(data);
        setRunId(null);
        return;
      }

      setRunId(data.runId);
      setStatusText(
        `Run started: runId=${data.runId}, status=${data.runStatus ?? "UNKNOWN"}`
      );
      setDetails(data);
    } catch (err: any) {
      console.error("startImport error", err);
      setStatusText(`Error starting import: ${err.message ?? String(err)}`);
    } finally {
      setStarting(false);
    }
  }

  async function pollStatus(runIdToPoll: string) {
    const params = new URLSearchParams({
      action: "status",
      runId: runIdToPoll,
      category,
      max: String(max),
    });

    const res = await fetch(`${API_BASE}/parts/import?${params.toString()}`, {
      method: "GET",
    });

    const data: ImportStatus = await res.json();

    setDetails(data);

    if (data.runStatus) {
      setStatusText(
        `Run ${runIdToPoll} status: ${data.runStatus}${
          typeof data.inserted === "number"
            ? ` (inserted=${data.inserted}, received=${data.received})`
            : ""
        }`
      );
    } else if (data.message) {
      setStatusText(data.message);
    }

    return data;
  }

  useEffect(() => {
    if (!runId) return;

    let cancelled = false;

    async function loop() {
      while (!cancelled) {
        try {
          const data = await pollStatus(runId);
          const s = data.runStatus;
          if (s && s !== "RUNNING" && s !== "READY") {
            break;
          }
        } catch (err) {
          console.error("pollStatus loop error", err);
          setStatusText("Error while polling status (check console/logs)");
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }

    loop();

    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: "1px solid #ddd",
        background: "#fafafa",
        maxWidth: 720,
        marginTop: 16,
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 12 }}>
        CPU Import from PcPartPicker (via Apify)
      </h3>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>Search phrase</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ padding: 6, width: 220 }}
            placeholder="e.g. ryzen 5, ryzen 7, 14700K"
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span>Max products</span>
          <input
            type="number"
            value={max}
            min={1}
            max={50}
            onChange={(e) =>
              setMax(Math.min(50, Math.max(1, Number(e.target.value) || 10)))
            }
            style={{ padding: 6, width: 100 }}
          />
        </label>
      </div>

      <div style={{ marginTop: 12 }}>
        <button
          onClick={startImport}
          disabled={starting}
          style={{
            padding: "6px 14px",
            borderRadius: 4,
            border: "1px solid #333",
            background: starting ? "#888" : "#111",
            color: "white",
            cursor: starting ? "default" : "pointer",
          }}
        >
          {starting ? "Starting..." : "Start Import"}
        </button>
      </div>

      <div style={{ marginTop: 12 }}>
        <strong>Status:</strong> {statusText}
      </div>

      {runId && (
        <div style={{ marginTop: 8 }}>
          <strong>Run ID:</strong> <code>{runId}</code>
        </div>
      )}

      {details && (
        <pre
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 4,
            background: "#fff",
            border: "1px solid #eee",
            maxHeight: 260,
            overflow: "auto",
            fontSize: 12,
          }}
        >
{JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  );
}