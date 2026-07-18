import { NextResponse } from "next/server";
import { buildSecFormRoutingReleaseGate } from "@/lib/sources/sec/forms/releaseGate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Development SEC release gate is disabled in production." }, { status: 404 });
  }

  const result = buildSecFormRoutingReleaseGate();
  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}
