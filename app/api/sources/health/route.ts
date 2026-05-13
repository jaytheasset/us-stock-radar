import { NextRequest, NextResponse } from "next/server";
import { probeSourceJobs } from "@/lib/sourceJobs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const full = request.nextUrl.searchParams.get("full") === "true";
  const sources = await probeSourceJobs(full);

  return NextResponse.json({
    ok: sources.every((source) => source.ok),
    full,
    sources,
  });
}
