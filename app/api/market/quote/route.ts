import { NextRequest, NextResponse } from "next/server";
import { getMarketQuoteSnapshot } from "@/lib/market-data/currentPrice";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const quote = await getMarketQuoteSnapshot(symbol);
  return NextResponse.json(quote, {
    headers: { "Cache-Control": "no-store" },
  });
}
