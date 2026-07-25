import { NextRequest, NextResponse } from "next/server";
import { probeSourceJobs } from "@/lib/sourceJobs";
import { sourceDiagnosticAuthResponse } from "@/lib/sourceIngestRouteAuth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const unauthorized = sourceDiagnosticAuthResponse(request);
  if (unauthorized) return unauthorized;

  const full = request.nextUrl.searchParams.get("full") === "true";
  const sources = await probeSourceJobs(full);

  return NextResponse.json({
    ok: sources.every((source) => source.ok),
    full,
    sources,
  });
}
