import { NextResponse } from "next/server";
import { normalizeStockTicker } from "@/lib/watchlist/stockOverview";
import { fetchStockForm4Transactions } from "@/lib/watchlist/stockForm4TransactionsServer";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await params;
  const ticker = normalizeStockTicker(rawTicker);
  if (!ticker || ticker !== rawTicker) {
    return NextResponse.json({ ok: false, data: [] }, { status: 400 });
  }
  try {
    const data = await fetchStockForm4Transactions(ticker);
    return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json(
      { ok: false, data: [], error: "Stored SEC Form 4 transactions are temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
