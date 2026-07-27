import { NextRequest, NextResponse } from "next/server";
import { AUTH_PRIVATE_HEADERS } from "@/lib/auth/authPolicy";
import {
  assertSameOriginAuthRequest,
  buildAuthCallbackUrl,
} from "@/lib/auth/authRequest";
import { resendSignupConfirmation } from "@/lib/auth/supabaseAuth";

export const dynamic = "force-dynamic";

const GENERIC_MESSAGE =
  "If this email is waiting for confirmation, a new link will arrive shortly.";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
    const body = await request.json().catch(() => null);
    const email = readEmail(body);
    if (email) {
      const callback = buildAuthCallbackUrl(request, "signup", "/account");
      await resendSignupConfirmation(email, callback).catch(() => undefined);
    }
  } catch {
    // The response intentionally does not reveal whether the account exists.
  }

  return NextResponse.json(
    { ok: true, message: GENERIC_MESSAGE },
    { headers: AUTH_PRIVATE_HEADERS },
  );
}

function readEmail(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const email = (body as Record<string, unknown>).email;
  if (typeof email !== "string") return "";
  const normalized = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}
