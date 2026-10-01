import { NextResponse } from "next/server";
import { normalizeStockTicker } from "@/lib/watchlist/stockOverview";
import { readStockListingStatus } from "@/lib/watchlist/stockListingStatusServer";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = await params;
  const ticker = normalizeStockTicker(rawTicker);
  const headers = { "Cache-Control": "no-store" };
  if (!ticker || ticker !== rawTicker)
    return NextResponse.json({ ok: false, error: "Invalid stock ticker." }, { status: 400, headers });
  const data = await readStockListingStatus(ticker);
  const ok = data.availability !== "unavailable";
  return NextResponse.json({ ok, data }, { status: ok ? 200 : 503, headers });
}
