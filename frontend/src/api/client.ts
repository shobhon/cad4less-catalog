
import { API_BASE as PARTS_API_BASE } from "./parts";

const API_BASE =
  import.meta.env.VITE_API_BASE ??
  PARTS_API_BASE ??
  "https://lhr6ymi61h.execute-api.us-west-1.amazonaws.com/v1";

// Debug: log the API base in development so we can verify which backend is used
if (typeof import.meta !== "undefined" && (import.meta as any).env?.DEV) {
  // eslint-disable-next-line no-console
  console.log("CAD4Less API_BASE (client.ts):", API_BASE);
}

// LocalStorage-based persistence for "Use in builds" state
const LOCAL_IN_BUILDS_KEY = "cad4less_inBuilds_v1";

type LocalInBuildsEntry = {
  id: string;
  category: Category;
};

function loadLocalInBuilds(): LocalInBuildsEntry[] {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_IN_BUILDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: any) =>
        e &&
        typeof e.id === "string" &&
        typeof e.category === "string"
    ) as LocalInBuildsEntry[];
  } catch {
    return [];
  }
}

function saveLocalInBuilds(entries: LocalInBuildsEntry[]): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LOCAL_IN_BUILDS_KEY, JSON.stringify(entries));
  } catch {
    // ignore storage errors
  }
}

function setLocalInBuilds(id: string, category: Category, inBuilds: boolean): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  const existing = loadLocalInBuilds();
  const map = new Map<string, LocalInBuildsEntry>();
  for (const entry of existing) {
    map.set(`${entry.category}:${entry.id}`, entry);
  }
  const key = `${category}:${id}`;
  if (inBuilds) {
    map.set(key, { id, category });
  } else {
    map.delete(key);
  }
  saveLocalInBuilds(Array.from(map.values()));
}

export type Category =
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

export interface VendorOffer {
  vendor: string;
  buyLink: string;
  price: number | null;
  priceCurrency?: string;
  availability?: string;
  image?: string | null;
}

export interface Part {
  id: string;
  category: Category;
  name: string;
  vendor: string;
  store: string | null;
  price: number | null;
  availability?: string | null;
  image?: string | null;
  specs?: Record<string, any> | null;
  vendorList?: VendorOffer[];
  approved?: boolean;
  inBuilds?: boolean; // derived from approved + local selection
}

export interface PartsResponse {
  category: Category;
  vendor?: string;
  parts: Part[];
}

export async function fetchParts(
  category: Category,
  vendor: string = "all"
): Promise<PartsResponse> {
  const params = new URLSearchParams({ category });
  if (vendor && vendor !== "all") params.set("vendor", vendor);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/parts?${params.toString()}`);
  } catch (err) {
    throw new Error(
      `Network error while fetching parts for ${category}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (!res.ok) {
    throw new Error(
      `Failed to fetch parts for ${category}: ${res.status} ${res.statusText}`
    );
  }
  const data = (await res.json()) as PartsResponse;

  // Merge backend-approved flag with locally persisted "in builds" selections
  const localEntries = loadLocalInBuilds();
  const localSet = new Set(localEntries.map((e) => `${e.category}:${e.id}`));

  data.parts = data.parts.map((p) => {
    const backendInBuilds = p.approved ?? false;
    const localInBuilds = localSet.has(`${p.category}:${p.id}`);
    return {
      ...p,
      inBuilds: backendInBuilds || localInBuilds,
    };
  });

  return data;
}

export async function updatePartApproved(
  id: string,
  category: Category,
  approved: boolean
): Promise<void> {
  // Optimistic local persistence so selections survive reloads immediately
  setLocalInBuilds(id, category, approved);

  // Call the existing GET endpoint: /parts?action=updateApproved&id=...&approved=...&category=...
  try {
    const params = new URLSearchParams({
      action: "updateApproved",
      id,
      approved: approved ? "true" : "false",
      category,
    });

    const res = await fetch(`${API_BASE}/parts?${params.toString()}`, {
      method: "GET",
    });

    if (!res.ok) {
      // Log but don't break the UI
      try {
        const text = await res.text();
        console.warn(
          "Backend updatePartApproved failed:",
          res.status,
          res.statusText,
          text
        );
      } catch {
        console.warn(
          "Backend updatePartApproved failed:",
          res.status,
          res.statusText
        );
      }
      return;
    }

    // If backend returns a definitive approved flag, sync local storage with it
    try {
      const json = await res.json();
      if (json && typeof json.approved === "boolean") {
        setLocalInBuilds(id, category, json.approved);
      }
    } catch {
      // ignore JSON parse errors; local state is already set
    }
  } catch (err) {
    console.warn("Backend updatePartApproved error:", err);
  }
}

export async function runApifyImport(
  category: Category,
  datasetId: string
): Promise<{
  status: string;
  category: string;
  datasetId: string;
  itemCount: number;
  items?: unknown[];
}> {
  const csvGuess = datasetId.trim();
  const result = await importPartsFromCsv(category, csvGuess);

  return {
    status: result.message,
    category,
    datasetId,
    itemCount: typeof result.succeeded === "number"
      ? result.succeeded
      : result.attempted,
    items: [],
  };
}

export interface ImportCsvResult {
  message: string;
  attempted: number;
  succeeded: number;
  failed: number;
  skippedNotInStock: number;
  errors: unknown[];
}

export async function importPartsFromCsv(
  category: Category,
  csv: string
): Promise<ImportCsvResult> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/parts/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, csv }),
    });
  } catch (err) {
    throw new Error(
      `Network error while importing CSV parts for ${category}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `CSV parts import failed (${res.status} ${res.statusText}): ${text}`
    );
  }

  const json = (await res.json()) as ImportCsvResult;
  console.log("CSV import /parts/import-csv raw response:", json);
  return json;
}