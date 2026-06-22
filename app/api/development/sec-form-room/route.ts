import { NextRequest, NextResponse } from "next/server";
import { getSecDevRoomDetail } from "@/lib/development/secFormDevDashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Development SEC dashboard is disabled in production." }, { status: 404 });
  }

  const room = request.nextUrl.searchParams.get("room") || "";
  const detail = await getSecDevRoomDetail(room);
  if (!detail) {
    return NextResponse.json({ ok: false, error: "Unknown SEC form room." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, detail });
}
