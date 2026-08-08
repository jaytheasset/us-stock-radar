import { NextRequest, NextResponse } from "next/server";
import { getSecDevRoomDetail } from "@/lib/development/secFormDevDashboard";
import { respondWithAdminReadAccess } from "@/lib/admin/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Development SEC dashboard is disabled in production." }, { status: 404 });
  }

  return respondWithAdminReadAccess(request, "system.read", async () => {
    const room = request.nextUrl.searchParams.get("room") || "";
    const detail = await getSecDevRoomDetail(room);
    return detail
      ? { ok: true, detail }
      : { ok: false, error: "Unknown SEC form room." };
  }, { status: (data) => data.ok ? 200 : 404 });
}
