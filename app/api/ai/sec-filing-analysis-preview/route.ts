import { NextRequest, NextResponse } from "next/server";
import {
  runSecFilingAnalysisPreview,
  runSecFilingAnalysisPreviewForRawItem,
} from "@/lib/ai/secFilingAnalysisPreview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const result = await runSecFilingAnalysisPreview({
    dryRun: params.get("dryRun") === "true",
    rawItemId: params.get("rawItemId") || undefined,
    accessionNumber: params.get("accessionNumber") || undefined,
    ticker: params.get("ticker") || undefined,
    calendarCandidate: params.get("calendarCandidate") === "true",
    llmProvider: params.get("llmProvider") || undefined,
    llmModel: params.get("llmModel") || undefined,
    secPromptVariant: params.get("secPromptVariant") || undefined,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const rawItem = readRecord(body?.rawItem) || readRecord(body?.raw_item);
  if (!rawItem) {
    return NextResponse.json(
      {
        ok: false,
        stage: "raw_item",
        status: 400,
        error: "rawItem is required",
      },
      { status: 400 },
    );
  }

  const result = await runSecFilingAnalysisPreviewForRawItem(rawItem, {
    dryRun: body?.dryRun !== false,
    llmProvider: stringValue(body?.llmProvider) || undefined,
    llmModel: stringValue(body?.llmModel) || undefined,
    secPromptVariant: stringValue(body?.secPromptVariant) || undefined,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : readResultStatus(result),
  });
}

function readResultStatus(result: unknown) {
  const record = readRecord(result);
  return typeof record?.status === "number" && record.status > 0 ? record.status : 502;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
