import { NextRequest, NextResponse } from "next/server.js";
import {
  PRELAUNCH_ACCESS_COOKIE,
  isComingSoonPath,
  isPrelaunchApiPath,
  isPrelaunchBypassPath,
  isPrelaunchMode,
  sanitizeInternalRedirect,
  verifyPrelaunchAccessProof,
} from "./lib/prelaunch.ts";
import {
  PRELAUNCH_INTERNAL_PROOF_HEADER,
  authorizePrelaunchInternalRequest,
} from "./lib/prelaunchInternalAccess.ts";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
  clearAuthSessionCookies,
  setAuthSessionCookies,
} from "./lib/auth/authCookies.ts";
import {
  AUTH_PRIVATE_HEADERS,
  shouldRefreshAuthSession,
} from "./lib/auth/authPolicy.ts";
import {
  ProxyAuthRefreshError,
  refreshProxyAuthSession,
} from "./lib/auth/proxySession.ts";

type PrelaunchProxyDependencies = {
  authorizeInternalRequest?: (request: Request) => Promise<boolean>;
};

export async function proxy(request: NextRequest) {
  return proxyWithDependencies(request);
}

export async function proxyWithDependencies(
  request: NextRequest,
  dependencies: PrelaunchProxyDependencies = {},
) {
  const pathname = request.nextUrl.pathname;
  const hasInternalProof = request.headers.has(
    PRELAUNCH_INTERNAL_PROOF_HEADER,
  );

  if (isComingSoonPath(pathname)) {
    return privatePrelaunchResponse(
      nextResponse(request, { stripInternalProof: hasInternalProof }),
    );
  }

  if (isPrelaunchMode() && !isPrelaunchBypassPath(pathname)) {
    const internalAuthorized = hasInternalProof
      ? await (
          dependencies.authorizeInternalRequest ??
          authorizePrelaunchInternalRequest
        )(request)
      : false;
    const configuredPassword = process.env.PRELAUNCH_PASSWORD || "";
    const accessProof = request.cookies.get(PRELAUNCH_ACCESS_COOKIE)?.value;
    if (
      !internalAuthorized &&
      !verifyPrelaunchAccessProof(accessProof, configuredPassword)
    ) {
      if (isPrelaunchApiPath(pathname)) {
        return prelaunchApiAccessRequired();
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
      return privatePrelaunchResponse(NextResponse.redirect(destination));
    }
  }

  return refreshAuthSessionForRequest(request, hasInternalProof);
}

export const config = {
  matcher: "/:path*",
};

function privatePrelaunchResponse(response: NextResponse) {
  response.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, max-age=0, must-revalidate",
  );
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

function prelaunchApiAccessRequired() {
  return privatePrelaunchResponse(
    NextResponse.json(
      {
        ok: false,
        error: {
          code: "PRELAUNCH_ACCESS_REQUIRED",
          message: "Private preview access is required.",
          status: 401,
        },
      },
      { status: 401 },
    ),
  );
}

async function refreshAuthSessionForRequest(
  request: NextRequest,
  stripInternalProof = false,
) {
  const pathname = request.nextUrl.pathname;
  if (shouldSkipAuthRefresh(pathname)) {
    return nextResponse(request, { stripInternalProof });
  }

  const accessToken = request.cookies.get(AUTH_ACCESS_COOKIE)?.value || "";
  const refreshToken = request.cookies.get(AUTH_REFRESH_COOKIE)?.value || "";
  const hasAuthCookies = Boolean(accessToken || refreshToken);

  if (
    !hasAuthCookies ||
    !shouldRefreshAuthSession(accessToken)
  ) {
    return withPrivateAuthHeaders(
      nextResponse(request, { stripInternalProof }),
      hasAuthCookies,
    );
  }

  try {
    const session = await refreshProxyAuthSession(refreshToken);
    request.cookies.set(AUTH_ACCESS_COOKIE, session.access_token || "");
    request.cookies.set(AUTH_REFRESH_COOKIE, session.refresh_token || "");

    const response = nextResponse(request, {
      forwardHeaders: true,
      stripInternalProof,
    });
    setAuthSessionCookies(response, {
      accessToken: session.access_token || "",
      refreshToken: session.refresh_token,
      expiresIn: session.expires_in,
    });
    return withPrivateAuthHeaders(response, true);
  } catch (error) {
    const response = nextResponse(request, { stripInternalProof });
    if (
      error instanceof ProxyAuthRefreshError &&
      error.clearSession
    ) {
      clearAuthSessionCookies(response);
    }
    return withPrivateAuthHeaders(response, true);
  }
}

function shouldSkipAuthRefresh(pathname: string) {
  return (
    pathname === "/api/auth" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    /\.(?:avif|css|eot|gif|ico|jpe?g|js|map|mjs|png|svg|ttf|webp|woff2?)$/i.test(pathname)
  );
}

function withPrivateAuthHeaders(response: NextResponse, authenticated: boolean) {
  if (authenticated) {
    for (const [name, value] of Object.entries(AUTH_PRIVATE_HEADERS)) {
      response.headers.set(name, value);
    }
  }
  return isPrelaunchMode() ? privatePrelaunchResponse(response) : response;
}

function nextResponse(
  request: NextRequest,
  options: { forwardHeaders?: boolean; stripInternalProof?: boolean },
) {
  if (!options.forwardHeaders && !options.stripInternalProof) {
    return NextResponse.next();
  }
  const headers = new Headers(request.headers);
  if (options.stripInternalProof) {
    headers.delete(PRELAUNCH_INTERNAL_PROOF_HEADER);
  }
  return NextResponse.next({ request: { headers } });
}
