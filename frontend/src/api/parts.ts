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

// 🔹 Export API_BASE so all API helpers (including Add Parts) can share it
export const API_BASE =
  import.meta.env.VITE_API_BASE_URL ??
  "https://i5txnpsovh.execute-api.us-west-1.amazonaws.com/Stage"

// 🔹 Shared helper for consistent error handling and nicer messages
async function handleJsonResponse<T>(
  res: Response,
  context: string
): Promise<T> {
  if (!res.ok) {
    let details = ""

    try {
      const data = await res.json()
      if (data && typeof data === "object" && "error" in data) {
        details = ` – ${(data as any).error}`
      }
    } catch {
      // ignore JSON parse errors; keep basic status info
    }

    throw new Error(`${context}: ${res.status} ${res.statusText}${details}`)
  }

  return (await res.json()) as T
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