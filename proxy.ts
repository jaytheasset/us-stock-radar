import { NextRequest, NextResponse } from "next/server.js";
import {
  PRELAUNCH_ACCESS_COOKIE,
  isComingSoonPath,
  isPrelaunchBypassPath,
  isPrelaunchMode,
  sanitizeInternalRedirect,
  verifyPrelaunchAccessProof,
} from "./lib/prelaunch.ts";

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (isComingSoonPath(pathname)) {
    return noIndexResponse(NextResponse.next());
  }
  if (!isPrelaunchMode() || isPrelaunchBypassPath(pathname)) {
    return NextResponse.next();
  }

  const configuredPassword = process.env.PRELAUNCH_PASSWORD || "";
  const accessProof = request.cookies.get(PRELAUNCH_ACCESS_COOKIE)?.value;
  if (verifyPrelaunchAccessProof(accessProof, configuredPassword)) {
    return noIndexResponse(NextResponse.next());
  }

  const destination = request.nextUrl.clone();
  destination.pathname = "/coming-soon";
  destination.search = "";
  const requestedPath = sanitizeInternalRedirect(
    `${pathname}${request.nextUrl.search}`,
  );
  if (requestedPath !== "/") {
    destination.searchParams.set("next", requestedPath);
  }
  return noIndexResponse(NextResponse.redirect(destination));
}

export const config = {
  matcher: "/:path*",
};

function noIndexResponse(response: NextResponse) {
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}
