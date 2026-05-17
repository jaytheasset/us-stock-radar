import { NextRequest, NextResponse } from "next/server";
import { runNewsEventAnalysisPreview } from "@/lib/ai/newsEventAnalysisPreview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "true";
  const result = await runNewsEventAnalysisPreview({ dryRun });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}
