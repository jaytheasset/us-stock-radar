import { NextResponse } from "next/server";
import { readIssuerBoundPublicStockTickerProjection } from "@/lib/sec-ticker-resolution/publicTickerSearch";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const bound = await readIssuerBoundPublicStockTickerProjection(ticker);
  if (bound.status === "unavailable") {
    return NextResponse.json(
      { ok: false, error: "SEC_TICKER_PROJECTION_UNAVAILABLE", data: [] },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  if (bound.status === "not_found") {
    return NextResponse.json(
      { ok: true, currentTicker: null, historicalTickers: [], data: [] },
      { headers: NO_STORE_HEADERS },
    );
  }
  const projection = bound.projection;
  return NextResponse.json(
    {
      ok: true,
      currentTicker: projection.currentTicker,
      historicalTickers: projection.historicalTickers,
      data: projection.sourceFilings,
    },
    { headers: NO_STORE_HEADERS },
  );
}
