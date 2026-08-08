import { NextRequest, NextResponse } from "next/server";
import {
  filingsV2DateOptions,
  filingsV2EventOptions,
  filingsV2ImpactOptions,
  filingsV2MarketCapOptions,
  filingsV2SignalOptions,
  type FilingsV2Cursor,
  type FilingsV2FilterState,
} from "@/lib/filingsV2Model";
import { filingsV2FilingGroupValues } from "@/lib/filingsV2FilingGroups";
import { loadFilingsV2Page } from "@/lib/filingsV2Data";

export const dynamic = "force-dynamic";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filters = readFilters(searchParams);
  const cursor = readCursor(searchParams);
  const result = await loadFilingsV2Page({
    cursor,
    filters,
    includeTotal: searchParams.get("include_total") !== "false",
    query: (searchParams.get("query") || "").slice(0, 200),
  });

  return NextResponse.json(result, {
    status: result.state === "ready" ? 200 : 502,
  });
}

function readFilters(searchParams: URLSearchParams): FilingsV2FilterState {
  return {
    dateRanges: readValues(searchParams, "date_ranges", filingsV2DateOptions),
    eventTypes: readValues(searchParams, "event_types", filingsV2EventOptions),
    filingGroups: readValues(
      searchParams,
      "filing_groups",
      filingsV2FilingGroupValues,
    ),
    impacts: readValues(searchParams, "impacts", filingsV2ImpactOptions),
    marketCaps: readValues(searchParams, "market_caps", filingsV2MarketCapOptions),
    signals: readValues(searchParams, "signals", filingsV2SignalOptions),
  };
}

function readValues<const T extends readonly string[]>(
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

function readCursor(searchParams: URLSearchParams): FilingsV2Cursor | null {
  const id = searchParams.get("cursor_id")?.trim() || "";
  const publishedAt = searchParams.get("cursor_published_at")?.trim() || "";
  if (!uuidPattern.test(id) || !publishedAt || !Number.isFinite(Date.parse(publishedAt))) {
    return null;
  }
  return { id, publishedAt };
}
