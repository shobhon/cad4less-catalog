const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ||
  "https://i5txnpsovh.execute-api.us-west-1.amazonaws.com/Stage";

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

export type Category = "cpu" | "motherboard" | "cpu-cooler";

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

  const res = await fetch(`${API_BASE}/parts?${params.toString()}`);
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