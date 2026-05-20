import { NextRequest, NextResponse } from "next/server";
import { runNasdaqCorporateActionAnalysisPreview } from "@/lib/ai/nasdaqCorporateActionAnalysisPreview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const dryRun = params.get("dryRun") === "true";
  const sourceUniqueId = readString(params.get("sourceUniqueId") || params.get("source_unique_id"));
  const limit = readNumber(params.get("limit"), 1, 20);

  const result = await runNasdaqCorporateActionAnalysisPreview({
    dryRun,
    sourceUniqueId,
    limit,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}

function readString(value: string | null) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: string | null, min: number, max: number) {
  const parsed = value ? Number(value) : undefined;
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(min, Math.min(max, Math.floor(parsed as number)));
}
