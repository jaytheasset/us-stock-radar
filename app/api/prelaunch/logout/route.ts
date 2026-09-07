import { NextRequest, NextResponse } from "next/server.js";
import { rejectCrossOriginMutationRequest } from "../../../../lib/auth/mutationOrigin.ts";
import {
  PRELAUNCH_ACCESS_COOKIE,
  isPrelaunchMode,
  sanitizeInternalRedirect,
  shouldUseSecurePrelaunchCookie,
} from "../../../../lib/prelaunch.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originRejection = rejectCrossOriginMutationRequest(request);
  if (originRejection) return originRejection;
  const formData = await request.formData().catch(() => null);
  const returnTo = sanitizeInternalRedirect(formData?.get("next"));
  const destination = isPrelaunchMode() ? "/coming-soon" : returnTo;
  const response = NextResponse.redirect(
    new URL(destination, request.url),
    { status: 303 },
  );
  response.cookies.set({
    name: PRELAUNCH_ACCESS_COOKIE,
    value: "",
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecurePrelaunchCookie(request),
  });
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, max-age=0, must-revalidate",
  );
  return response;
}
