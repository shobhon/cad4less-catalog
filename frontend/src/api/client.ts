// frontend/src/api/client.ts
// Typed wrapper around the CAD4Less backend HTTP API.

export interface Part {
  id?: string;
  name?: string;
  approved?: boolean;
  productLink?: string;
  price?: number;
  availability?: string;
  vendor?: string;
  // Allow arbitrary additional properties coming from Apify / backend
  // without breaking TypeScript usage in the frontend.
  [key: string]: any;
}

export type PartCategory =
  | "cpu"
  | "cpu-cooler"
  | "motherboard"
  | string;

// Base URL for the backend API. Prefer VITE_API_BASE if provided.
const RAW_API_BASE: string =
  (import.meta as any).env?.VITE_API_BASE ||
  "https://lhr6ymi6ih.execute-api.us-west-1.amazonaws.com/v1";

export const API_BASE: string = RAW_API_BASE.replace(/\/+$/, "");

// Helpful for debugging in the browser console.
// eslint-disable-next-line no-console
console.log("CAD4Less API_BASE (client.ts):", API_BASE);

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init && init.headers ? init.headers : {}),
    },
  });

  if (!response.ok) {
    let detail = "";
    try {
      const text = await response.text();
      detail = text || response.statusText;
    } catch {
      detail = response.statusText;
    }
    throw new Error(`Request to ${url} failed: ${response.status} ${detail}`);
  }

  // Some endpoints may return no body.
  const text = await response.text();
  if (!text) return {} as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    // If it is not JSON, just return as any.
    return text as unknown as T;
  }
}

export interface FetchPartsResponse {
  parts: Part[];
}

/**
 * Fetches parts for a given category from the backend.
 *
 * `store` can be "all" or a specific store label.
 */
export async function fetchParts(
  category: PartCategory,
  store: string = "all"
): Promise<FetchPartsResponse> {
  const params = new URLSearchParams();
  params.set("category", String(category));
  if (store && store !== "all") {
    params.set("store", store);
  }

  const url = `${API_BASE}/parts?${params.toString()}`;
  return fetchJson<FetchPartsResponse>(url);
}

/**
 * Updates the `approved` flag for a part so it can be used in builds.
 */
export async function updatePartApproved(
  id: string,
  category: PartCategory,
  approved: boolean
): Promise<void> {
  const url = `${API_BASE}/parts/approved`;
  await fetchJson<void>(url, {
    method: "POST",
    body: JSON.stringify({ id, category, approved }),
  });
}

/**
 * Triggers an Apify-powered import for the given category.
 * (Currently not heavily used by the UI but kept for future actions.)
 */
export async function runApifyImport(
  category: PartCategory
): Promise<unknown> {
  const url = `${API_BASE}/apify/import`;
  return fetchJson(url, {
    method: "POST",
    body: JSON.stringify({ category }),
  });
}

/**
 * Imports parts via CSV text pasted/uploaded in the UI.
 * The backend is expected to parse the CSV and insert/update rows.
 */
export async function importPartsFromCsv(
  category: PartCategory,
  csv: string
): Promise<unknown> {
  const url = `${API_BASE}/parts/import/csv`;
  return fetchJson(url, {
    method: "POST",
    body: JSON.stringify({ category, csv }),
  });
}

// Re-exporting key helpers as a single object can sometimes help with tooling,
// but the app primarily uses the named exports above.
export const ApiClient = {
  fetchParts,
  updatePartApproved,
  runApifyImport,
  importPartsFromCsv,
};