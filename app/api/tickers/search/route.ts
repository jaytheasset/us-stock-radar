import { NextRequest, NextResponse } from "next/server";
import { readTickerCatalogSearch } from "@/lib/alerts/tickers/getAlertTickersViewModel";
import { readPublicStockTickerCatalogSearch } from "@/lib/sec-ticker-resolution/publicTickerSearch";
import { TickerSearchUnavailableError, TICKER_SEARCH_UNAVAILABLE_MESSAGE } from "@/lib/tickerSearchContract";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: NextRequest) {
  try {
    const query = request.nextUrl.searchParams.get("q") || "";
    const isStockResearch = request.headers.get("x-stock-radar-search-surface") === "stock-research";
    const result = isStockResearch
      ? await readPublicStockTickerCatalogSearch(query)
      : await readTickerCatalogSearch(query);

    return NextResponse.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof TickerSearchUnavailableError ? error.code : "TICKER_SEARCH_FAILED",
        message: TICKER_SEARCH_UNAVAILABLE_MESSAGE,
      },
      { status: error instanceof TickerSearchUnavailableError ? 503 : 500, headers: NO_STORE_HEADERS },
    );
  }
}
