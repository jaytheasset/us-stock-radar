import { NextRequest, NextResponse } from "next/server";
import { runCalendarAnalysisMatcher } from "@/lib/calendar-v1/analysisLinkRepository";
import { parseNormalizedCalendarRange } from "@/lib/calendar-v1/normalized";
import { sourceIngestAuthResponse } from "@/lib/sourceIngestRouteAuth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: NextRequest) {
  const unauthorized = sourceIngestAuthResponse(request);
  if (unauthorized) return unauthorized;
  const parsed = parseNormalizedCalendarRange(request.nextUrl.searchParams);
  if (!parsed.ok) return invalidRequest(parsed.error.message);
  return runMatch(parsed.range, true);
}

export async function POST(request: NextRequest) {
  const unauthorized = sourceIngestAuthResponse(request);
  if (unauthorized) return unauthorized;
  const body = await request.json().catch(() => null);
  if (!isRecord(body)) return invalidRequest("A JSON request body is required.");
  const allowedKeys = new Set(["from", "to", "dryRun", "persist"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return invalidRequest("The request contains unsupported fields.");
  }
  if (
    (body.dryRun !== undefined && typeof body.dryRun !== "boolean") ||
    (body.persist !== undefined && typeof body.persist !== "boolean") ||
    (body.persist === true && body.dryRun === true)
  ) {
    return invalidRequest("persist and dryRun must be non-contradictory booleans.");
  }
  const params = new URLSearchParams();
  if (typeof body.from === "string") params.set("from", body.from);
  if (typeof body.to === "string") params.set("to", body.to);
  const parsed = parseNormalizedCalendarRange(params);
  if (!parsed.ok) return invalidRequest(parsed.error.message);
  const dryRun = body.persist !== true || body.dryRun === true;
  return runMatch(parsed.range, dryRun);
}

async function runMatch(
  range: { from: string; to: string },
  dryRun: boolean,
) {
  try {
    const result = await runCalendarAnalysisMatcher({ dryRun, range });
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "CALENDAR_ANALYSIS_MATCH_FAILED",
        message: "Calendar analysis matching could not be completed.",
      },
      { headers: NO_STORE_HEADERS, status: 502 },
    );
  }
}

function invalidRequest(message: string) {
  return NextResponse.json(
    { ok: false, error: "INVALID_REQUEST", message },
    { headers: NO_STORE_HEADERS, status: 400 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
