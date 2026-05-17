import { NextRequest, NextResponse } from "next/server";
import { runSecFilingAnalysisIngest } from "@/lib/secFilingAnalysisIngest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const bodyRecord =
    body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const params = request.nextUrl.searchParams;
  const result = await runSecFilingAnalysisIngest({
    rawItemId: params.get("rawItemId") || stringValue(bodyRecord.rawItemId) || undefined,
    accessionNumber: params.get("accessionNumber") || stringValue(bodyRecord.accessionNumber) || undefined,
    ticker: params.get("ticker") || stringValue(bodyRecord.ticker) || undefined,
    calendarCandidate: params.get("calendarCandidate") === "true" || bodyRecord.calendarCandidate === true,
    dryRun: params.get("dryRun") === "true" || bodyRecord.dryRun === true,
    force: params.get("force") === "true" || bodyRecord.force === true,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const result = await runSecFilingAnalysisIngest({
    rawItemId: params.get("rawItemId") || undefined,
    accessionNumber: params.get("accessionNumber") || undefined,
    ticker: params.get("ticker") || undefined,
    calendarCandidate: params.get("calendarCandidate") === "true",
    dryRun: params.get("dryRun") !== "false",
    force: params.get("force") === "true",
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
