import { NextResponse } from "next/server";
import { getSourceJobRegistry } from "@/lib/sourceJobs";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    sources: getSourceJobRegistry(),
  });
}
