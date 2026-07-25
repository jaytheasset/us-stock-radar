import { NextRequest, NextResponse } from "next/server";
import { getSourceJob, runSourceJob } from "@/lib/sourceJobs";
import { sourceIngestAuthResponse } from "@/lib/sourceIngestRouteAuth";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ source: string }> },
) {
  const unauthorized = sourceIngestAuthResponse(request);
  if (unauthorized) return unauthorized;

  const { source } = await context.params;
  const body = await request.json().catch(() => ({}));
  const useRequestOrigin = Boolean(getSourceJob(source)?.workflowLane);
  const result = await runSourceJob(source, body, {
    baseUrlOverride: useRequestOrigin ? request.nextUrl.origin : undefined,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}
