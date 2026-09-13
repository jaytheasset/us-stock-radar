import { NextRequest, NextResponse } from "next/server";
import { searchTickerCatalog } from "@/lib/alerts/tickers/getAlertTickersViewModel";
import { searchPublicStockTickerCatalog } from "@/lib/sec-ticker-resolution/publicTickerSearch";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q") || "";
    const isStockResearch = request.headers.get("x-stock-radar-search-surface") === "stock-research";
    const data = isStockResearch
      ? await searchPublicStockTickerCatalog(query)
      : await searchTickerCatalog(query);

    return NextResponse.json({ ok: true, data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "TICKER_SEARCH_FAILED",
        message: error instanceof Error ? error.message : "Failed to search tickers.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
