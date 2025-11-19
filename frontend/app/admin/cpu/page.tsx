import React from "react";
import { CpuImportPanel } from "../components/CpuImportPanel";

export default function CpuAdminPage() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 8 }}>CPU Admin</h1>
      <p style={{ marginBottom: 16 }}>
        Use this panel to import CPU data from PcPartPicker via Apify into the
        <code> Cad4LessPartsLive </code> table, then review in your catalog.
      </p>

      <CpuImportPanel />

      {/* 
        Below here you can render your existing CPU list,
        e.g. a table that hits GET /parts?category=cpu&vendor=all
      */}
    </main>
  );
}