import { NextRequest, NextResponse } from "next/server";
import { runNewsEventAnalysisPreview } from "@/lib/ai/newsEventAnalysisPreview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const dryRun = searchParams.get("dryRun") === "true";
  const sourceUniqueId = normalizeSourceUniqueId(
    searchParams.get("sourceUniqueId") || searchParams.get("source_unique_id"),
  );
  const searchLimit = readNumber(searchParams.get("searchLimit") || searchParams.get("limit"), 1, 50);
  const result = await runNewsEventAnalysisPreview({ dryRun, sourceUniqueId, searchLimit });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}

function normalizeSourceUniqueId(value: string | null) {
  const normalized = value?.trim() || "";
  return /^\d{4,12}$/.test(normalized) ? normalized : undefined;
}

function readNumber(value: string | null, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
