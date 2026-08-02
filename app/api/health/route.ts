import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  return NextResponse.json({ ok: true }, { headers: HEADERS });
}

export async function HEAD() {
  return new NextResponse(null, { status: 200, headers: HEADERS });
}
