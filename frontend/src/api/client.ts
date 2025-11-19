export interface VendorOffer {
  image?: string | null;
  currency?: string | null;
  availability?: string | null;
  vendor?: string | null;
  price?: number | null;
  buyLink?: string | null;
}

export interface Part {
  id: string;
  name: string;
  category: string;
  vendor: string;
  price: number | null;
  availability: string | null;
  image?: string | null;
  specs?: Record<string, string | number | null>;
  vendorList?: VendorOffer[];
}

const API_BASE = "/api";

/**
 * Fetch parts for a given category and vendor filter.
 * In dev, Vite proxies /api/* to your deployed AWS API Gateway.
 */
export async function fetchParts(
  category: string,
  vendor: string = "all"
): Promise<{ category: string; vendor: string; parts: Part[] }> {
  const params = new URLSearchParams();
  params.set("category", category);
  params.set("vendor", vendor);

  const res = await fetch(`${API_BASE}/parts?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch parts (${res.status}): ${text}`);
  }

  return res.json();
}

export interface ImportStartResponse {
  message: string;
  category: string;
  runId: string;
  runStatus: string;
  pollUrlHint?: string;
}

export interface ImportStatusResponse {
  message: string;
  category: string;
  runId: string;
  runStatus: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | string;
  received?: number;
  inserted?: number;
}

/**
 * Kick off an Apify CPU import via the Lambda async endpoint.
 * Returns the Apify runId and initial runStatus (READY/RUNNING).
 */
export async function startCpuImport(
  category: string,
  maxProducts: number,
  search: string
): Promise<ImportStartResponse> {
  const params = new URLSearchParams();
  params.set("category", category);
  params.set("max", String(maxProducts));
  if (search.trim()) {
    params.set("search", search.trim());
  }

  const res = await fetch(`${API_BASE}/parts/import?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Import start failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Check the status of an existing Apify run from Lambda.
 */
export async function getCpuImportStatus(
  runId: string,
  category: string,
  maxProducts: number
): Promise<ImportStatusResponse> {
  const params = new URLSearchParams();
  params.set("action", "status");
  params.set("runId", runId);
  params.set("category", category);
  params.set("max", String(maxProducts));

  const res = await fetch(`${API_BASE}/parts/import?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Import status failed (${res.status}): ${text}`);
  }

  return res.json();
}