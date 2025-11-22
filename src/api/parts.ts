// src/api/parts.ts
export const API_BASE =
  "https://i5txnpsovh.execute-api.us-west-1.amazonaws.com/v1";

export interface VendorEntry {
  image: string | null;
  currency: string | null;
  availability: string | null;
  vendor: string | null;
  price: number | null;
  buyLink: string | null;
}

export interface Part {
  approved: boolean;
  vendorList: VendorEntry[];
  image: string | null;
  updatedAt: string;
  category: string;
  id: string;
  inStock: boolean;
  price: number | null;
  name: string;
  vendor: string | null;
  availability: string | null;
  store: string | null;
}

interface PartsResponse {
  category: string;
  vendor: string;
  parts: Part[];
}

export async function fetchCpuParts(): Promise<Part[]> {
  const res = await fetch(`${API_BASE}/parts?category=cpu`);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = (await res.json()) as PartsResponse;
  return data.parts;
}