import { NextRequest, NextResponse } from "next/server";
import { fetchStockDilution } from "@/lib/dilution-registry/stockDilutionServer";
import { normalizeStockTicker } from "@/lib/watchlist/stockOverview";

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
    const data = await fetchStockDilution(symbol);
    return NextResponse.json(
      { data, ok: Boolean(data) },
      {
        headers: {
          "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=900",
        },
        status: data ? 200 : 404,
      },
    );
  } catch {
    return NextResponse.json(
      { error: "Dilution data is temporarily unavailable.", ok: false },
      { status: 503 },
    );
  }
}
