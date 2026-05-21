import { NextResponse } from "next/server";
import { clearAuthSessionCookies } from "@/lib/auth/sessionCookies";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST() {
  const response = NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });
  clearAuthSessionCookies(response);
  return response;
}
