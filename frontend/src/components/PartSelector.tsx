import React, { useEffect, useState } from "react";
import { fetchParts, Part } from "../api/client";

interface PartSelectorProps {
  category: string;
  label: string;
  selectedPartId?: string;
  onSelect: (part: Part) => void;
}

export const PartSelector: React.FC<PartSelectorProps> = ({
  category,
  label,
  selectedPartId,
  onSelect,
}) => {
  const [items, setItems] = useState<Part[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const parts = await fetchParts(category, "all");
        if (!cancelled) {
          setItems(parts);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load parts");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [category]);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h3>{label}</h3>
      {loading && <div>Loading {label}...</div>}
      {error && <div style={{ color: "red" }}>{error}</div>}

      {!loading && !error && (
        <select
          value={selectedPartId || ""}
          onChange={(e) => {
            const part = items.find((p) => p.partId === e.target.value);
            if (part) onSelect(part);
          }}
        >
          <option value="">Select {label}</option>
          {items.map((p) => {
            const cheapestVendor = p.vendorList?.reduce(
              (acc, v) => {
                if (!acc || (v.price ?? Infinity) < (acc.price ?? Infinity)) {
                  return v;
                }
                return acc;
              },
              undefined as any
            );

            const priceLabel = cheapestVendor
              ? `${cheapestVendor.price?.toFixed(2) ?? "N/A"} (${cheapestVendor.vendor})`
              : "Price unavailable";

            return (
              <option key={p.partId} value={p.partId}>
                {p.name} – {priceLabel}
              </option>
            );
          })}
        </select>
      )}
    </div>
  );
};
