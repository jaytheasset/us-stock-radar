import { NextRequest, NextResponse } from "next/server";
import { AUTH_PRIVATE_HEADERS } from "@/lib/auth/authPolicy";
import {
  assertSameOriginAuthRequest,
  buildAuthCallbackUrl,
} from "@/lib/auth/authRequest";
import { requestPasswordRecovery } from "@/lib/auth/supabaseAuth";

export const dynamic = "force-dynamic";

const GENERIC_MESSAGE =
  "If an account exists for that email, a password reset link will arrive shortly.";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
    const body = await request.json().catch(() => null);
    const email = readEmail(body);
    if (email) {
      const callback = buildAuthCallbackUrl(
        request,
        "recovery",
        "/account/update-password",
      );
      await requestPasswordRecovery(email, callback).catch(() => undefined);
    }
  } catch {
    // Always return the same response to avoid account enumeration.
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
