import { NextRequest, NextResponse } from "next/server";
import { runSecDevRoomTests } from "@/lib/development/secFormDevDashboard";
import { respondWithAdminReadAccess } from "@/lib/admin/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Development SEC dashboard is disabled in production." }, { status: 404 });
  }

  return respondWithAdminReadAccess(request, "data.run", async () => {
    const body = await request.json().catch(() => null);
    const room = readString((body as Record<string, unknown> | null)?.room);
    const detail = await runSecDevRoomTests(room);
    return detail
      ? { ok: true, detail }
      : { ok: false, error: "Unknown SEC form room." };
  }, { status: (data) => data.ok ? 200 : 404 });
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
