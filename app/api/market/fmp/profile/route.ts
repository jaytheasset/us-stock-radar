import { NextRequest, NextResponse } from "next/server";
import { fetchFmpProfile } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get("symbol") || "AAPL";
  const result = await fetchFmpProfile(symbol);

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}
