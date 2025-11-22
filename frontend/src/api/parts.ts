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

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ??
  "https://i5txnpsovh.execute-api.us-west-1.amazonaws.com/Stage"

export async function fetchCpuParts(): Promise<PartsResponse> {
  const res = await fetch(`${API_BASE}/parts?category=cpu`)
  if (!res.ok) {
    throw new Error(`Failed to fetch CPUs: ${res.status} ${res.statusText}`)
  }
  const data = (await res.json()) as PartsResponse
  return data
}
