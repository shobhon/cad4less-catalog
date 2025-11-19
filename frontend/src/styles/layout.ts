import type React from "react";

export const pageStyles: React.CSSProperties = {
  minHeight: "100vh",
  padding: "24px",
  background: "#0f172a",
  color: "#0f172a",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, -apple-system, sans-serif',
};

export const headerStyles: React.CSSProperties = {
  background: "white",
  padding: "16px 20px",
  borderRadius: 12,
  marginBottom: 16,
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.3)",
};

export const mainGridStyles: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1.4fr)",
  gap: 16,
  alignItems: "flex-start",
};

export const panelStyles: React.CSSProperties = {
  background: "white",
  borderRadius: 12,
  padding: 20,
  boxShadow: "0 10px 30px rgba(15, 23, 42, 0.25)",
};

export const sectionTitleStyles: React.CSSProperties = {
  margin: 0,
  marginBottom: 8,
  fontSize: 20,
};

export const hintTextStyles: React.CSSProperties = {
  marginTop: 0,
  marginBottom: 16,
  fontSize: 13,
  color: "#555",
};

export const fieldRowStyles: React.CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "flex-end",
  marginBottom: 12,
  flexWrap: "wrap",
};

export const labelStyles: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 13,
};

export const inputStyles: React.CSSProperties = {
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  fontSize: 13,
  minWidth: 120,
};

export const primaryButtonStyles: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  background: "#2563eb",
  color: "white",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const secondaryButtonStyles: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "white",
  color: "#0f172a",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export const buttonRowStyles: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  marginTop: 8,
  marginBottom: 4,
  flexWrap: "wrap",
};

export const paginationRowStyles: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 10px",
  borderTop: "1px solid #e2e8f0",
  background: "#f8fafc",
  gap: 8,
};

export const tableWrapperStyles: React.CSSProperties = {
  marginTop: 8,
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  overflow: "hidden",
};

export const tableStyles: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 13,
};

export const thStyles: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  background: "#f8fafc",
  borderBottom: "1px solid #e2e8f0",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

export const tdStyles: React.CSSProperties = {
  padding: "7px 10px",
  borderBottom: "1px solid #e2e8f0",
  verticalAlign: "top",
};

export const errorBoxStyles: React.CSSProperties = {
  marginTop: 12,
  padding: 10,
  borderRadius: 8,
  background: "#fef2f2",
  color: "#b91c1c",
  fontSize: 13,
};
