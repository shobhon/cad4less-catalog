  import React, { useState } from "react";
  import { PartSelector } from "./PartSelector";
  import type { Part } from "../api/client";

  export const Wizard: React.FC = () => {
    const [selectedParts, setSelectedParts] = useState<Record<string, Part>>({});

    function handleSelect(category: string, part: Part) {
      setSelectedParts((prev) => ({ ...prev, [category]: part }));
    }

    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem" }}>
        <h1>CAD4Less PC Configurator (Admin)</h1>

        <PartSelector
          category="cpu"
          label="CPU"
          selectedPartId={selectedParts.cpu?.partId}
          onSelect={(p) => handleSelect("cpu", p)}
        />

        <PartSelector
          category="motherboard"
          label="Motherboard"
          selectedPartId={selectedParts.motherboard?.partId}
          onSelect={(p) => handleSelect("motherboard", p)}
        />

        <PartSelector
          category="ram"
          label="Memory (RAM)"
          selectedPartId={selectedParts.ram?.partId}
          onSelect={(p) => handleSelect("ram", p)}
        />

        {/* Add GPU, PSU, case, storage, etc. similarly */}

        <h2>Selected Parts</h2>
        <pre
          style={{
            background: "#111",
            color: "#eee",
            padding: "1rem",
            borderRadius: 4,
            fontSize: 12,
            overflowX: "auto",
          }}
        >
{JSON.stringify(
  Object.fromEntries(
    Object.entries(selectedParts).map(([k, v]) => [k, v.partId])
  ),
  null,
  2
)}
        </pre>
      </div>
    );
  };
