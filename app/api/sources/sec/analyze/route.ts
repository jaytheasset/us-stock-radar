import { NextRequest, NextResponse } from "next/server";
import { runSecFilingAnalysisIngest } from "@/lib/secFilingAnalysisIngest";
import { sourceIngestAuthResponse } from "@/lib/sourceIngestRouteAuth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const unauthorized = sourceIngestAuthResponse(request);
  if (unauthorized) return unauthorized;

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
    llmProvider: params.get("llmProvider") || stringValue(bodyRecord.llmProvider) || undefined,
    llmModel: params.get("llmModel") || stringValue(bodyRecord.llmModel) || undefined,
    secPromptVariant: params.get("secPromptVariant") || stringValue(bodyRecord.secPromptVariant) || undefined,
    suppressAlerts:
      params.get("suppressAlerts") === "true" ||
      params.get("alerts") === "false" ||
      bodyRecord.suppressAlerts === true ||
      bodyRecord.alerts === false,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}

export async function GET(request: NextRequest) {
  const unauthorized = sourceIngestAuthResponse(request);
  if (unauthorized) return unauthorized;

  const params = request.nextUrl.searchParams;
  const result = await runSecFilingAnalysisIngest({
    rawItemId: params.get("rawItemId") || undefined,
    accessionNumber: params.get("accessionNumber") || undefined,
    ticker: params.get("ticker") || undefined,
    calendarCandidate: params.get("calendarCandidate") === "true",
    dryRun: params.get("dryRun") !== "false",
    force: params.get("force") === "true",
    llmProvider: params.get("llmProvider") || undefined,
    llmModel: params.get("llmModel") || undefined,
    secPromptVariant: params.get("secPromptVariant") || undefined,
    suppressAlerts: params.get("suppressAlerts") === "true" || params.get("alerts") === "false",
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
