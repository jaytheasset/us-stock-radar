import { NextRequest, NextResponse } from "next/server";
import { runSourceJob } from "@/lib/sourceJobs";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ source: string }> },
) {
  const { source } = await context.params;
  const body = await request.json().catch(() => ({}));
  const result = await runSourceJob(source, body, {
    baseUrlOverride: source === "globe" ? request.nextUrl.origin : undefined,
  });

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}
