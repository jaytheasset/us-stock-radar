import { NextRequest, NextResponse } from "next/server";
import { normalizeStockTicker } from "@/lib/watchlist/stockOverview";
import { fetchStockFinancials } from "@/lib/watchlist/stockFinancialsServer";
import { buildUnavailableStockFinancialsSnapshot } from "@/lib/watchlist/stockFinancials";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = normalizeStockTicker(request.nextUrl.searchParams.get("symbol"));
  if (!symbol) {
    return NextResponse.json(
      { error: "A valid stock symbol is required.", ok: false },
      { status: 400 },
    );
  }

  try {
    const data = await fetchStockFinancials(symbol);
    const ok = [...data.quarterly.rows, ...data.quarterly.ytdRows, ...data.annual.rows]
      .some((row) => row.status === "AVAILABLE");
    return NextResponse.json(
      { data, ok },
      {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=3600",
        },
      },
    );
  } catch {
    const data = buildUnavailableStockFinancialsSnapshot({
      detail: "Stored SEC financial facts could not be read safely.",
      reason: "SEC_STORAGE_READ_FAILED",
      symbol,
    });
    return NextResponse.json(
      { data, ok: false },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
