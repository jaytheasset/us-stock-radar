import { NextRequest, NextResponse } from "next/server";
import { fetchStockSc13Ownership } from "@/lib/watchlist/stockSc13OwnershipServer";
import { normalizeStockTicker } from "@/lib/watchlist/stockOverview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = normalizeStockTicker(request.nextUrl.searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json(
      { error: "A valid stock symbol is required.", ok: false },
      { headers: { "Cache-Control": "no-store" }, status: 400 },
    );
  }

  try {
    const data = await fetchStockSc13Ownership(symbol);
    return NextResponse.json(
      { data, ok: data.status === "available" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Stored SEC ownership data is temporarily unavailable.", ok: false },
      { headers: { "Cache-Control": "no-store" }, status: 503 },
    );
  }
}
