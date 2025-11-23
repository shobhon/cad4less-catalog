// frontend/src/api/client.ts

export type VendorOffer = {
  vendor: string;
  price: number | null;
  currency?: string | null;
  availability?: string | null;
  image?: string | null;
  buyLink?: string | null;
};

export type Part = {
  id: string;
  category: string;
  name: string;
  image?: string | null;
  availability?: string | null;
  vendor?: string | null;
  store?: string | null;
  price?: number | null;
  vendorList?: VendorOffer[] | null;
  specs?: Record<string, unknown> | null;
  inStock?: boolean;
  approved?: boolean; // persisted flag from DynamoDB
  updatedAt?: string;
};

export type PartsResponse = {
  category: string;
  vendor: string;
  parts: Part[];
};

const API_BASE: string =
  (import.meta as any)?.env?.VITE_CAD4LESS_API_BASE ||
  (typeof process !== "undefined" && (process as any).env?.VITE_CAD4LESS_API_BASE) ||
  "https://i5txnpsovh.execute-api.us-west-1.amazonaws.com/Stage";

async function doFetch(path: string, init?: RequestInit): Promise<any> {
  const url = API_BASE.replace(/\/$/, "") + path;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init && init.headers ? init.headers : {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request to ${url} failed with ${res.status}: ${text}`);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return res.json();
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function fetchParts(
  category: "cpu" | "motherboard" | "cpu-cooler",
  vendorFilter: "all" | "amazon" | "pcpartpicker" | string = "all"
): Promise<PartsResponse> {
  const qs = new URLSearchParams();
  if (category) qs.set("category", category);
  if (vendorFilter) qs.set("vendor", vendorFilter);

  const json = await doFetch(`/parts?${qs.toString()}`);

  const rawParts: any[] = Array.isArray(json.parts) ? json.parts : [];

  const parts: Part[] = rawParts.map((p) => {
    const vendorList: VendorOffer[] | null = Array.isArray(p.vendorList)
      ? p.vendorList.map((v: any) => ({
          vendor: String(v.vendor ?? "unknown"),
          price:
            typeof v.price === "number" && Number.isFinite(v.price)
              ? v.price
              : null,
          currency: v.priceCurrency ?? v.currency ?? null,
          availability: v.availability ?? null,
          image: v.image ?? null,
          buyLink: v.buyLink ?? null,
        }))
      : null;

    return {
      id: String(p.id),
      category: String(p.category ?? category),
      name: String(p.name ?? "Unnamed part"),
      image: p.image ?? null,
      availability: p.availability ?? null,
      vendor: p.vendor ?? null,
      store: p.store ?? null,
      price:
        typeof p.price === "number" && Number.isFinite(p.price)
          ? p.price
          : null,
      vendorList,
      specs: p.specs ?? null,
      inStock: p.inStock === true,
      approved: p.approved === true, // IMPORTANT: persist approved from backend
      updatedAt: p.updatedAt ?? undefined,
    };
  });

  return {
    category: String(json.category ?? category ?? "all"),
    vendor: String(json.vendor ?? vendorFilter ?? "all"),
    parts,
  };
}

export async function updatePartApproved(
  id: string,
  approved: boolean
): Promise<{ success: boolean; id: string; approved: boolean }> {
  if (!id) {
    throw new Error("Part id is required for updatePartApproved");
  }

  const qs = new URLSearchParams();
  qs.set("action", "updateApproved");
  qs.set("id", id);
  qs.set("approved", approved ? "true" : "false");

  const json = await doFetch(`/parts?${qs.toString()}`);

  // Backend may return either {success:true,id,approved} or {message:"Approved flag updated", id, approved}
  return {
    success: json.success === true || json.message === "Approved flag updated",
    id: json.id ?? id,
    approved: json.approved === true,
  };
}