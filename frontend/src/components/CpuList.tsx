import { useEffect, useState } from "react"
import { fetchCpuParts, Part } from "../api/parts"

type Status = "idle" | "loading" | "error" | "success"

export default function CpuList() {
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const [parts, setParts] = useState<Part[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setStatus("loading")
        setError(null)
        const data = await fetchCpuParts()
        if (!cancelled) {
          setParts(data.parts ?? [])
          setStatus("success")
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Unknown error")
          setStatus("error")
        }
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (status === "loading" && parts.length === 0) {
    return <div>Loading CPU list…</div>
  }

  if (status === "error" && parts.length === 0) {
    return <div>Failed to load CPUs: {error}</div>
  }

  if (parts.length === 0) {
    return <div>No CPUs returned by API.</div>
  }

  return (
    <div style={{ marginTop: "1rem" }}>
      <h2>CPU Catalog</h2>
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          maxWidth: "1000px",
        }}
      >
        <thead>
          <tr>
            <th style={{ borderBottom: "1px solid #ccc", textAlign: "left", padding: "0.5rem" }}>Name</th>
            <th style={{ borderBottom: "1px solid #ccc", textAlign: "left", padding: "0.5rem" }}>Availability</th>
            <th style={{ borderBottom: "1px solid #ccc", textAlign: "left", padding: "0.5rem" }}>Vendor</th>
            <th style={{ borderBottom: "1px solid #ccc", textAlign: "right", padding: "0.5rem" }}>Price</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => (
            <tr key={p.id}>
              <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>{p.name}</td>
              <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>{p.availability}</td>
              <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem" }}>{p.vendor}</td>
              <td style={{ borderBottom: "1px solid #eee", padding: "0.5rem", textAlign: "right" }}>
                {p.price == null ? "-" : `$${p.price.toFixed(2)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {status === "error" && (
        <div style={{ marginTop: "0.5rem", color: "red" }}>Partial error: {error}</div>
      )}
    </div>
  )
}
