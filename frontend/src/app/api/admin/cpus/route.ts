import { NextResponse } from "next/server";

const API_BASE =
  process.env.CAD4LESS_API_BASE ??
  "https://i5txnpsovh.execute-api.us-west-1.amazonaws.com/Stage";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);

    const category = searchParams.get("category") ?? "cpu";
    const vendor = searchParams.get("vendor") ?? "all";

    const apiUrl = `${API_BASE}/parts?category=${encodeURIComponent(
      category
    )}&vendor=${encodeURIComponent(vendor)}`;

    const resp = await fetch(apiUrl, { cache: "no-store" });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(
        "Error calling backend /parts API",
        resp.status,
        resp.statusText,
        text
      );
      return NextResponse.json(
        { error: "Failed to fetch parts from backend" },
        { status: 502 }
      );
    }

    const data = (await resp.json()) as {
      category?: string;
      vendor?: string;
      parts?: any[];
    };

    const parts = Array.isArray(data.parts) ? data.parts : [];

    return NextResponse.json({
      items: parts,
      count: parts.length,
      category: data.category ?? category,
      vendor: data.vendor ?? vendor,
    });
  } catch (err) {
    console.error("Error in /api/admin/cpus route:", err);
    return NextResponse.json(
      {
        error: "Internal error in /api/admin/cpus",
      },
      { status: 500 }
    );
  }
}