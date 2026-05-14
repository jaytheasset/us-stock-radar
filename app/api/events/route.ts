import { NextRequest, NextResponse } from "next/server";
import { fetchEvents } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const limit = Number(searchParams.get("limit") || 50);
  const ticker = searchParams.get("ticker") || "";
  const impact = searchParams.get("impact") || "";
  const eventType = searchParams.get("event_type") || "";
  const sourceGroup = normalizeSourceGroup(searchParams.get("source_group"));
  const deliveryLevel = normalizeDeliveryLevel(searchParams.get("delivery_level"));
  const signal = normalizeSignal(searchParams.get("signal"));

  const result = await fetchEvents({
    limit,
    ticker,
    impact,
    eventType,
    sourceGroup,
    deliveryLevel,
    signal,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}

function normalizeSourceGroup(value: string | null) {
  if (value === "news" || value === "filings" || value === "market") return value;
  return undefined;
}

function normalizeDeliveryLevel(value: string | null) {
  if (value === "archive" || value === "feed" || value === "alert") return value;
  return undefined;
}

function normalizeSignal(value: string | null) {
  if (value === "bullish" || value === "bearish" || value === "volatile" || value === "neutral") {
    return value;
  }
  return undefined;
}
