import { NextRequest, NextResponse } from "next/server";
import {
  newsV2MarketCapBands,
  newsV2Signals,
  type NewsV2Cursor,
  type NewsV2FilterState,
} from "@/lib/newsV2";
import { loadNewsV2Page } from "@/lib/newsV2Data";

export const dynamic = "force-dynamic";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const result = await loadNewsV2Page({
    cursor: readCursor(searchParams),
    filters: readFilters(searchParams),
    includeTotal: searchParams.get("include_total") !== "false",
    query: (searchParams.get("query") || "").slice(0, 200),
  });

  return NextResponse.json(result, {
    status: result.error ? 502 : 200,
  });
}

function readFilters(searchParams: URLSearchParams): NewsV2FilterState {
  return {
    sentiments: readAllowedValues(searchParams, "sentiments", newsV2Signals),
    marketCaps: readAllowedValues(searchParams, "market_caps", newsV2MarketCapBands),
    eventTypes: readStringValues(searchParams, "event_types"),
    sources: readStringValues(searchParams, "sources"),
    sectors: readStringValues(searchParams, "sectors"),
    themes: readStringValues(searchParams, "themes"),
  };
}

function readAllowedValues<const T extends readonly string[]>(
  searchParams: URLSearchParams,
  name: string,
  allowedValues: T,
): Array<T[number]> {
  const allowed = new Set<string>(allowedValues);
  return readStringValues(searchParams, name)
    .filter((value): value is T[number] => allowed.has(value));
}

function readStringValues(searchParams: URLSearchParams, name: string) {
  return Array.from(
    new Set(
      searchParams
        .getAll(name)
        .flatMap((value) => value.split(","))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, 25);
}

function readCursor(searchParams: URLSearchParams): NewsV2Cursor | null {
  const id = searchParams.get("cursor_id")?.trim() || "";
  const publishedAt = searchParams.get("cursor_published_at")?.trim() || "";
  if (!uuidPattern.test(id) || !publishedAt || !Number.isFinite(Date.parse(publishedAt))) {
    return null;
  }
  return { id, publishedAt };
}
