import { NextRequest, NextResponse } from "next/server";
import { fetchStockFundamentals } from "@/lib/watchlist/stockFundamentalsServer";
import { normalizeStockTicker } from "@/lib/watchlist/stockOverview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = normalizeStockTicker(
    request.nextUrl.searchParams.get("symbol"),
  );
  if (!symbol) {
    return NextResponse.json(
      { error: "A valid stock symbol is required.", ok: false },
      { status: 400 },
    );
  }

  const data = await fetchStockFundamentals(symbol);
  const anyAvailable = Object.values(data.sources).some(
    (source) => source.state === "ready",
  );

  return NextResponse.json(
    { data, ok: anyAvailable },
    {
      headers: {
        "Cache-Control":
          "public, max-age=0, s-maxage=900, stale-while-revalidate=3600",
      },
    },
  );
}
