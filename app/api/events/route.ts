import { NextRequest, NextResponse } from "next/server";
import { fetchEvents } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = Number(searchParams.get("limit") || 50);
  const ticker = searchParams.get("ticker") || "";
  const impact = searchParams.get("impact") || "";
  const eventType = searchParams.get("event_type") || "";

  const result = await fetchEvents({
    limit,
    ticker,
    impact,
    eventType,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}
