import { NextRequest, NextResponse } from "next/server";
import { runSecDevRoomTests } from "@/lib/development/secFormDevDashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, error: "Development SEC dashboard is disabled in production." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const room = readString((body as Record<string, unknown> | null)?.room);
  const detail = await runSecDevRoomTests(room);
  if (!detail) {
    return NextResponse.json({ ok: false, error: "Unknown SEC form room." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, detail });
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
