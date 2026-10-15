import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
const chartRanges = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y"] as const;
type DashboardChartRange = (typeof chartRanges)[number];
export async function GET(request: NextRequest) {
  const symbol = normalizeSymbol(
    request.nextUrl.searchParams.get("symbol") || "AMD",
  );
  const range = normalizeRange(request.nextUrl.searchParams.get("range"));
  return NextResponse.json(
    {
      ok: false,
      error: "FMP_RETIRED",
      availability: "unavailable",
      symbol,
      range,
      points: [],
    },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
function normalizeRange(value: string | null): DashboardChartRange {
  return chartRanges.includes(value as DashboardChartRange)
    ? (value as DashboardChartRange)
    : "1D";
}
function normalizeSymbol(value: string) {
  return (
    value
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9.-]/g, "") || "AMD"
  );
}
