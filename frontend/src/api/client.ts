/**
 * frontend/src/api/client.ts
 * Typed wrapper around the CAD4Less backend HTTP API.
 */

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
  | "memory"
  | "Video Card"
  | "video-card"
  | "Power Supply"
  | "Case"
  | string;

// Base URL for the backend API. Prefer VITE_API_BASE if provided.
const RAW_API_BASE: string =
  (import.meta as any).env?.VITE_API_BASE ||
  "https://lhr6ymi61h.execute-api.us-west-1.amazonaws.com/v1";

export const API_BASE: string = RAW_API_BASE.replace(/\/+$/, "");

// Helpful for debugging in the browser console.
// eslint-disable-next-line no-console
console.log("CAD4Less API_BASE (client.ts):", API_BASE);

async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || undefined);

  // If the caller did not specify a Content-Type and is sending a body,
  // default to JSON. This allows callers to override Content-Type when needed.
  if (!headers.has("Content-Type") && init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers,
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
 * If category is undefined or an empty string, the category filter is omitted
 * and the backend is expected to return all parts (optionally filtered by store).
 *
 * `store` can be "all" or a specific store label.
 */
export async function fetchParts(
  category: PartCategory | undefined,
  store: string = "all"
): Promise<FetchPartsResponse> {
  const params = new URLSearchParams();

  // Only include category if it is a meaningful string. This prevents
  // accidental ?category=undefined when the caller wants all parts.
  if (typeof category === "string" && category.trim().length > 0) {
    params.set("category", category.trim());
  }

  // Preserve existing behavior for store: only include when not "all".
  if (store && store !== "all") {
    params.set("store", store);
  }

  const query = params.toString();
  const url =
    query.length > 0 ? `${API_BASE}/parts?${query}` : `${API_BASE}/parts`;

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
  const payload = { id, category, approved };

  await fetchJson<void>(url, {
    method: "POST",
    headers: {
      // Use a CORS-simple Content-Type to avoid preflight,
      // while still sending JSON in the body that the Lambda can parse.
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });
}

/**
 * Triggers an Apify-powered import for the given category.
 */
export async function runApifyImport(
  category: PartCategory
): Promise<unknown> {
  const url = `${API_BASE}/imports/apify/${encodeURIComponent(category)}`;
  return fetchJson(url, {
    method: "POST",
  });
}

/**
 * Imports parts via CSV text pasted/uploaded in the UI.
 * The backend is expected to parse the CSV and insert/update rows.
 */
export async function importPartsFromCsv(
  category: PartCategory,
  csvText: string
): Promise<unknown> {
  const url = `${API_BASE}/parts/import-csv`;
  const payload = { category, csv: csvText };

  return fetchJson(url, {
    method: "POST",
    headers: {
      // Use a CORS-simple Content-Type to avoid preflight,
      // while still sending JSON in the body that the Lambda can parse.
      "Content-Type": "text/plain;charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });
}

// Convenience object if you ever want to import a single ApiClient namespace.
export const ApiClient = {
  fetchParts,
  updatePartApproved,
  runApifyImport,
  importPartsFromCsv,
};