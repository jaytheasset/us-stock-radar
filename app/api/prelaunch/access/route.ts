import { NextRequest, NextResponse } from "next/server.js";
import {
  PRELAUNCH_ACCESS_COOKIE,
  PRELAUNCH_ACCESS_MAX_AGE_SECONDS,
  createPrelaunchAccessProof,
  isPrelaunchMode,
  sanitizeInternalRedirect,
  verifyPrelaunchPassword,
} from "../../../../lib/prelaunch.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => null);
  const returnTo = sanitizeInternalRedirect(formData?.get("next"));

  if (!isPrelaunchMode()) {
    return redirectResponse(request, returnTo);
  }

  const configuredPassword = process.env.PRELAUNCH_PASSWORD || "";
  if (!configuredPassword) {
    return accessErrorResponse(request, returnTo, "unavailable");
  }

  const candidate = formData?.get("password");
  const password = typeof candidate === "string" ? candidate : "";
  if (!verifyPrelaunchPassword(password, configuredPassword)) {
    return accessErrorResponse(request, returnTo, "invalid");
  }

  const response = redirectResponse(request, returnTo);
  response.cookies.set({
    name: PRELAUNCH_ACCESS_COOKIE,
    value: createPrelaunchAccessProof(configuredPassword),
    httpOnly: true,
    maxAge: PRELAUNCH_ACCESS_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}

function accessErrorResponse(
  request: NextRequest,
  returnTo: string,
  error: "invalid" | "unavailable",
) {
  const destination = new URL("/coming-soon", request.url);
  destination.searchParams.set("error", error);
  if (returnTo !== "/") destination.searchParams.set("next", returnTo);
  return redirectResponse(request, destination);
}

function redirectResponse(
  request: NextRequest,
  destination: string | URL,
) {
  const url =
    destination instanceof URL
      ? destination
      : new URL(destination, request.url);
  const response = NextResponse.redirect(url, { status: 303 });
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, max-age=0, must-revalidate",
  );
  return response;
}
