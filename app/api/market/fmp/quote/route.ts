import { NextRequest, NextResponse } from "next/server";
import { fetchFmpQuote, fetchFmpQuotes } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const symbols = request.nextUrl.searchParams.get("symbols");
  const result = symbols
    ? await fetchFmpQuotes(symbols.split(","))
    : await fetchFmpQuote(symbol);

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}
