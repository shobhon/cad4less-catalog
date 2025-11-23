export interface VendorOffer {
  vendor: string;
  buyLink?: string | null;
  price?: number | null;
  priceCurrency?: string | null;
  availability?: string | null;
  image?: string | null;
}

export interface Part {
  id: string;
  category: string;
  name: string;
  image?: string | null;
  vendor?: string | null;
  store?: string | null;
  price?: number | null;
  availability?: string | null;
  inStock?: boolean | null;
  approved?: boolean | null;
  updatedAt?: string | null;
  specs?: Record<string, any> | null;
  vendorList?: VendorOffer[] | null;
}

export interface PartsResponse {
  category?: string;
  vendor?: string;
  count?: number;
  parts: Part[];
}

function getApiBase(): string {
  const anyImportMeta = import.meta as any;
  const fromEnv = anyImportMeta?.env?.VITE_CAD4LESS_API_BASE;
  if (fromEnv && String(fromEnv).length > 0) {
    return String(fromEnv);
  }
  return "https://i5txnpsovh.execute-api.us-west-1.amazonaws.com/Stage";
}

const API_BASE = getApiBase();

export async function fetchParts(
  category: string,
  vendor: string = "all"
): Promise<PartsResponse> {
  const url = new URL(`${API_BASE}/parts`);

  if (category) {
    url.searchParams.set("category", category);
  }
  if (vendor && vendor !== "all") {
    url.searchParams.set("vendor", vendor);
  }

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      // ignore
    }
    throw new Error(
      `Failed to fetch parts (${res.status}): ${text || res.statusText}`
    );
  }

  const data: any = await res.json();
  const parts: Part[] = Array.isArray(data.parts) ? data.parts : [];

  return {
    category: data.category ?? category,
    vendor: data.vendor ?? vendor,
    count: data.count ?? parts.length,
    parts,
  };
}

export interface UpdateApprovedPayload {
  id: string;
  category?: string;
  approved: boolean;
}

export async function updatePartApproved(
  payload: UpdateApprovedPayload
): Promise<Part> {
  try {
    const res = await fetch(`${API_BASE}/parts/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    let rawText = "";
    let parsed: any = null;

    try {
      rawText = await res.text();
      if (rawText) {
        parsed = JSON.parse(rawText);
      }
    } catch {
      // If the body isn't JSON, keep rawText for logging only
    }

    if (!res.ok) {
      console.error(
        "updatePartApproved failed",
        res.status,
        res.statusText,
        rawText
      );
      // Optimistic local update so the UI doesn't break, even if the backend fails
      return {
        id: payload.id,
        category: payload.category ?? "",
        approved: payload.approved,
      } as Part;
    }

    if (parsed && typeof parsed === "object") {
      if ("part" in parsed && parsed.part) {
        return parsed.part as Part;
      }
      return {
        ...(parsed as object),
        id: payload.id,
        category: payload.category ?? "",
      } as Part;
    }

    return {
      id: payload.id,
      category: payload.category ?? "",
      approved: payload.approved,
    } as Part;
  } catch (err) {
    console.error("updatePartApproved encountered an error", err);
    return {
      id: payload.id,
      category: payload.category ?? "",
      approved: payload.approved,
    } as Part;
  }
}

export function getBestOffer(part: Part | null | undefined): VendorOffer | null {
  if (!part) return null;

  if (Array.isArray(part.vendorList) && part.vendorList.length > 0) {
    const priced = part.vendorList.filter(
      (o) => typeof o.price === "number" && o.price != null
    );

    if (priced.length > 0) {
      return priced.reduce((best, o) => {
        if (best.price == null) return o;
        if (o.price == null) return best;
        return o.price < best.price ? o : best;
      }, priced[0]);
    }

    return part.vendorList[0];
  }

  if (typeof part.price === "number") {
    return {
      vendor: part.store ?? part.vendor ?? "unknown",
      price: part.price,
      priceCurrency: "USD",
      availability: part.availability ?? undefined,
      image: part.image ?? undefined,
      buyLink: undefined,
    };
  }

  return null;
}