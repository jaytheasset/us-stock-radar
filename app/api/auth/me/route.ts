import { NextResponse } from "next/server";
import { getAuthAccessTokenFromCookies } from "@/lib/auth/sessionCookies";
import { getSupabaseAuthUser } from "@/lib/auth/supabaseAuth";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET() {
  const token = await getAuthAccessTokenFromCookies();
  const user = token ? await getSupabaseAuthUser(token) : null;

  return NextResponse.json(
    {
      ok: true,
      user: user ? { id: user.id, email: user.email || null } : null,
    },
    { headers: NO_STORE_HEADERS },
  );
}
