export interface VendorInfo {
  image: string | null
  currency: string
  availability: string
  vendor: string
  price: number | null
  buyLink: string
}

export interface Part {
  approved: boolean
  vendorList: VendorInfo[]
  image: string | null
  updatedAt: string
  category: string
  id: string
  inStock: boolean
  price: number | null
  name: string
  vendor: string
  availability: string
  store: string
}

export interface PartsResponse {
  category: string
  vendor: string
  parts: Part[]
}

export interface DeletePartResponse {
  message: string
  id: string
  deletedAt: string
}

// 🔹 Export API_BASE so all API helpers (including Add Parts) can share it
export const API_BASE =
  import.meta.env.VITE_API_BASE ??
  import.meta.env.VITE_API_BASE_URL ??
  "https://lhr6ymi61h.execute-api.us-west-1.amazonaws.com/v1"

// 🔹 Shared helper for consistent error handling and nicer messages
async function handleJsonResponse<T>(res: Response, context: string): Promise<T> {
  let bodyText = ""
  let parsed: any = null

  try {
    bodyText = await res.text()
    if (bodyText) {
      parsed = JSON.parse(bodyText)
    }
  } catch {
    // If body isn't valid JSON, we'll fall back to plain text in the error message
  }

  if (!res.ok) {
    let details = ""

    if (parsed && typeof parsed === "object") {
      if ("error" in parsed && (parsed as any).error) {
        details = ` – ${(parsed as any).error}`
      } else if ("message" in parsed && (parsed as any).message) {
        details = ` – ${(parsed as any).message}`
      }
    } else if (bodyText) {
      details = ` – ${bodyText}`
    }

    console.error(`${context} raw error`, {
      status: res.status,
      statusText: res.statusText,
      bodyText,
    })

    throw new Error(`${context}: ${res.status} ${res.statusText}${details}`)
  }

  // For successful responses, return parsed JSON if we have it; otherwise return an empty object
  return (parsed ?? {}) as T
}

// Existing CPU fetch with improved error handling
export async function fetchCpuParts(): Promise<PartsResponse> {
  const res = await fetch(`${API_BASE}/parts?category=cpu`)
  return handleJsonResponse<PartsResponse>(res, "Failed to fetch CPUs")
}

// General fetch used by the Select Parts for PC Builds tab
export async function fetchParts(): Promise<PartsResponse[]> {
  const res = await fetch(`${API_BASE}/parts/approved`)
  return handleJsonResponse<PartsResponse[]>(res, "Failed to fetch parts")
}

export async function deletePart(id: string): Promise<DeletePartResponse> {
  // Use POST /parts/delete?id=... to avoid CORS preflight complexity with DELETE
  const res = await fetch(
    `${API_BASE}/parts/delete?id=${encodeURIComponent(id)}`,
    {
      method: "POST",
    }
  )
  return handleJsonResponse<DeletePartResponse>(res, "Failed to delete part")
}