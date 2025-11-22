export type VendorInfo = {
  vendor?: string | null;
  price?: number | null;
  availability?: string | null;
  currency?: string | null;
  buyLink?: string | null;
  image?: string | null;
};

export type Part = {
  id: string;
  name: string;
  category?: string;
  image?: string | null;
  price?: number | null;
  vendor?: string | null;
  availability?: string | null;
  inStock?: boolean;
  approved?: boolean;
  store?: string | null;
  updatedAt?: string | null;
  vendorList?: VendorInfo[];
  specs?: Record<string, unknown>;
};

export type ImportStatusResponse = {
  runId: string;
  category: string;
  runStatus: string;
  message?: string;
  importedCount?: number;
  totalFound?: number;
};

const API_BASE =
  (import.meta as any).env?.VITE_CAD4LESS_API_BASE ??
  "https://i5txnpsovh.execute-api.us-west-1.amazonaws.com/Stage";

type PartsResponse = {
  category?: string;
  vendor?: string;
  parts?: Part[];
};

export async function fetchParts(
  category: string,
  vendor: "all" | "amazon" | "pcpartpicker" = "all"
): Promise<{
  parts: Part[];
  category: string;
  vendor: string;
}> {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (vendor && vendor !== "all") params.set("vendor", vendor);

  const url = `${API_BASE}/parts?${params.toString()}`;

  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Backend /parts failed: ${res.status} ${res.statusText} ${text}`
    );
  }

  const data = (await res.json()) as PartsResponse;
  const parts = Array.isArray(data.parts) ? data.parts : [];

  return {
    parts,
    category: data.category ?? category,
    vendor: data.vendor ?? vendor,
  };
}

// --- Import helpers wired to /parts/import ---

export async function startCpuImport(
  category: string,
  maxProducts: number,
  searchTerm: string
): Promise<ImportStatusResponse> {
  const body = { category, maxProducts, searchTerm };
  const res = await fetch(`${API_BASE}/parts/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Backend /parts/import failed: ${res.status} ${res.statusText} ${text}`
    );
  }

  const data = (await res.json()) as ImportStatusResponse;
  return data;
}

export async function getCpuImportStatus(
  runId: string
): Promise<ImportStatusResponse> {
  const url = `${API_BASE}/parts/import?runId=${encodeURIComponent(runId)}`;
  const res = await fetch(url, { method: "GET" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Backend /parts/import status failed: ${res.status} ${res.statusText} ${text}`
    );
  }

  const data = (await res.json()) as ImportStatusResponse;
  return data;
}