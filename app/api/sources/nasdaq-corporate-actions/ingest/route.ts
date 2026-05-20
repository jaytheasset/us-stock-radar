import { NextRequest, NextResponse } from "next/server";
import { runNasdaqCorporateActionsNewsIngest } from "@/lib/newsIngest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const bodyRecord = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
    const limit = readNumber(request.nextUrl.searchParams.get("limit"), bodyRecord.limit, 1, 20, 1);
    const dryRun = request.nextUrl.searchParams.get("dryRun") === "true" || bodyRecord.dryRun === true;
    const force = request.nextUrl.searchParams.get("force") === "true" || bodyRecord.force === true;
    const sourceUniqueId = readString(request.nextUrl.searchParams.get("sourceUniqueId")) || readString(bodyRecord.sourceUniqueId);
    const result = await runNasdaqCorporateActionsNewsIngest({ limit, dryRun, force, sourceUniqueId });

    return NextResponse.json(result, {
      status: responseStatus(result),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "route_exception",
        status: 500,
        error: error instanceof Error ? error.message : "Nasdaq Corporate Actions ingest route failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const limit = readNumber(request.nextUrl.searchParams.get("limit"), undefined, 1, 20, 1);
    const dryRun = request.nextUrl.searchParams.get("dryRun") !== "false";
    const force = request.nextUrl.searchParams.get("force") === "true";
    const sourceUniqueId = readString(request.nextUrl.searchParams.get("sourceUniqueId"));
    const result = await runNasdaqCorporateActionsNewsIngest({ limit, dryRun, force, sourceUniqueId });

    return NextResponse.json(result, {
      status: responseStatus(result),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        stage: "route_exception",
        status: 500,
        error: error instanceof Error ? error.message : "Nasdaq Corporate Actions ingest route failed",
      },
      { status: 500 },
    );
  }
}

function responseStatus(result: { ok: boolean; stage?: string; stats?: { event_upserted_count?: number } }) {
  if (result.ok) return 200;
  if ((result.stage === "complete" || result.stage === "dry_run") && (result.stats?.event_upserted_count || 0) > 0) {
    return 200;
  }
  return 502;
}

function readNumber(
  queryValue: string | null,
  bodyValue: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  const parsed = queryValue ? Number(queryValue) : Number(bodyValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
