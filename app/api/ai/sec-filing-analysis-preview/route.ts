import { NextRequest, NextResponse } from "next/server";
import { runSecFilingAnalysisPreview } from "@/lib/ai/secFilingAnalysisPreview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const result = await runSecFilingAnalysisPreview({
    dryRun: params.get("dryRun") === "true",
    rawItemId: params.get("rawItemId") || undefined,
    accessionNumber: params.get("accessionNumber") || undefined,
    ticker: params.get("ticker") || undefined,
    calendarCandidate: params.get("calendarCandidate") === "true",
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}
