import { NextRequest, NextResponse } from "next/server";
import { cancelSourceIngestWorkflowRun } from "@/lib/sourceIngestCancellation";
import { sourceIngestAuthResponse } from "@/lib/sourceIngestRouteAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST(request: NextRequest) {
  const authResponse = sourceIngestAuthResponse(request);
  if (authResponse) return authResponse;

  const body = await request.json().catch(() => null) as {
    workflowRunId?: unknown;
  } | null;
  const workflowRunId = typeof body?.workflowRunId === "string"
    ? body.workflowRunId
    : "";

  try {
    const result = await cancelSourceIngestWorkflowRun(workflowRunId);
    return NextResponse.json(
      { ok: true, ...result },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "SOURCE_INGEST_CANCELLATION_FAILED",
      },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
}
