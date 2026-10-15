import { NextRequest, NextResponse } from "next/server";
import { sourceIngestAuthResponse } from "@/lib/sourceIngestRouteAuth";
export const dynamic = "force-dynamic";
function retired() {
  return NextResponse.json(
    { ok: false, error: "FMP_RETIRED", availability: "unavailable" },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
export async function GET(request: NextRequest) {
  const unauthorized = sourceIngestAuthResponse(request);
  if (unauthorized) return unauthorized;
  return retired();
}
export async function POST(request: NextRequest) {
  const unauthorized = sourceIngestAuthResponse(request);
  if (unauthorized) return unauthorized;
  return retired();
}
