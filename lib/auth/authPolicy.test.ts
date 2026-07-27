import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextResponse } from "next/server.js";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
  AUTH_REFRESH_COOKIE_MAX_AGE,
  clearAuthSessionCookies,
  setAuthSessionCookies,
} from "./authCookies.ts";
import {
  getResolvedAuthSessionState,
  shouldClearAuthSessionForError,
  shouldClearAuthSessionForStatus,
} from "./authFailure.ts";
import {
  AUTH_LOCAL_CALLBACK_ORIGIN,
  AUTH_PRODUCTION_CALLBACK_ORIGIN,
  buildGoogleOAuthAuthorizeUrl,
  buildGoogleOAuthCallbackUrl,
  isSameOriginAuthRequest,
  normalizeAuthCallbackType,
  resolveAuthRequestUrl,
  sanitizeAuthRedirect,
  shouldRefreshAuthSession,
} from "./authPolicy.ts";
import {
  ProxyAuthRefreshError,
  refreshProxyAuthSession,
} from "./proxySession.ts";

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const originalFetch = globalThis.fetch;

test.afterEach(() => {
  restoreEnv("SUPABASE_URL", originalSupabaseUrl);
  restoreEnv("SUPABASE_ANON_KEY", originalSupabaseAnonKey);
  globalThis.fetch = originalFetch;
});

test("auth redirect sanitizer accepts only internal non-callback destinations", () => {
  assert.equal(sanitizeAuthRedirect("/account?confirmed=1"), "/account?confirmed=1");
  assert.equal(sanitizeAuthRedirect("https://evil.example/"), "/account");
  assert.equal(sanitizeAuthRedirect("//evil.example/"), "/account");
  assert.equal(sanitizeAuthRedirect("/\\evil.example/"), "/account");
  assert.equal(sanitizeAuthRedirect("/auth/callback?next=/account"), "/account");
  assert.equal(sanitizeAuthRedirect(null, "/alerts"), "/alerts");
  const authForm = readProjectFile("components/AuthForm.tsx");
  const loginPage = readProjectFile("app/login/page.tsx");
  const signupPage = readProjectFile("app/signup/page.tsx");
  assert.match(authForm, /sanitizeAuthRedirect\(next, "\/alerts"\)/);
  assert.doesNotMatch(authForm, /window\.location\.search/);
  assert.match(loginPage, /<AuthForm mode="login" next=\{next\}/);
  assert.match(signupPage, /<AuthForm mode="signup" next=\{next\}/);
});

test("Google OAuth uses the canonical callback contract and preserves only safe next paths", () => {
  const productionCallback = new URL(
    buildGoogleOAuthCallbackUrl({
      next: "/watchlist?view=events",
      production: true,
    }),
  );
  assert.equal(productionCallback.origin, AUTH_PRODUCTION_CALLBACK_ORIGIN);
  assert.equal(productionCallback.pathname, "/auth/callback");
  assert.equal(
    productionCallback.searchParams.get("next"),
    "/watchlist?view=events",
  );

  const localCallback = new URL(
    buildGoogleOAuthCallbackUrl({
      next: "https://evil.example/steal",
      production: false,
    }),
  );
  assert.equal(localCallback.origin, AUTH_LOCAL_CALLBACK_ORIGIN);
  assert.equal(localCallback.pathname, "/auth/callback");
  assert.equal(localCallback.searchParams.get("next"), "/alerts");

  const authorizeUrl = new URL(
    buildGoogleOAuthAuthorizeUrl({
      codeChallenge: "pkce_challenge",
      redirectTo: productionCallback.toString(),
      supabaseUrl: "https://project.supabase.co/rest/v1",
    }),
  );
  assert.equal(
    authorizeUrl.toString().startsWith(
      "https://project.supabase.co/auth/v1/authorize?",
    ),
    true,
  );
  assert.equal(authorizeUrl.searchParams.get("provider"), "google");
  assert.equal(
    authorizeUrl.searchParams.get("redirect_to"),
    productionCallback.toString(),
  );
  assert.equal(
    authorizeUrl.searchParams.get("code_challenge"),
    "pkce_challenge",
  );
  assert.equal(authorizeUrl.searchParams.get("code_challenge_method"), "s256");
});

test("callback type and same-origin request policy reject untrusted input", () => {
  assert.equal(normalizeAuthCallbackType("signup"), "signup");
  assert.equal(normalizeAuthCallbackType("recovery"), "recovery");
  assert.equal(normalizeAuthCallbackType("invite"), null);

  assert.equal(
    isSameOriginAuthRequest({
      requestUrl: "https://radar.example/api/auth/session",
      origin: "https://radar.example",
      secFetchSite: "same-origin",
    }),
    true,
  );
  assert.equal(
    isSameOriginAuthRequest({
      requestUrl: "https://radar.example/api/auth/session",
      origin: "https://evil.example",
      secFetchSite: "cross-site",
    }),
    false,
  );
  assert.equal(
    isSameOriginAuthRequest({
      requestUrl: "https://radar.example/api/auth/session",
      origin: null,
      secFetchSite: null,
    }),
    false,
  );

  assert.equal(
    resolveAuthRequestUrl({
      requestUrl: "http://localhost:3110/api/auth/oauth/google",
      host: "127.0.0.1:3110",
      forwardedHost: null,
      forwardedProto: null,
    }),
    "http://127.0.0.1:3110/api/auth/oauth/google",
  );
  assert.equal(
    resolveAuthRequestUrl({
      requestUrl: "http://localhost:3000/api/auth/login",
      host: "us-stock-radar.com",
      forwardedHost: null,
      forwardedProto: "https",
    }),
    "https://us-stock-radar.com/api/auth/login",
  );
});

test("JWT timing policy refreshes missing, malformed, expired, and near-expiry access tokens", () => {
  const now = 2_000_000_000;
  assert.equal(shouldRefreshAuthSession("", now), true);
  assert.equal(shouldRefreshAuthSession("not-a-jwt", now), true);
  assert.equal(shouldRefreshAuthSession(jwtWithExpiry(now - 1), now), true);
  assert.equal(shouldRefreshAuthSession(jwtWithExpiry(now + 30), now), true);
  assert.equal(shouldRefreshAuthSession(jwtWithExpiry(now + 3600), now), false);
});

test("auth cookies are HttpOnly, Lax, rotated, and locally clearable", () => {
  assert.equal(AUTH_REFRESH_COOKIE_MAX_AGE, 60 * 60 * 24 * 30);
  const response = NextResponse.json({ ok: true });
  setAuthSessionCookies(response, {
    accessToken: "access-value",
    refreshToken: "refresh-value",
    expiresIn: 3600,
  });
  const cookie = response.headers.get("set-cookie") || "";
  assert.match(cookie, new RegExp(`${AUTH_ACCESS_COOKIE}=access-value`));
  assert.match(cookie, new RegExp(`${AUTH_REFRESH_COOKIE}=refresh-value`));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, new RegExp(`Max-Age=${AUTH_REFRESH_COOKIE_MAX_AGE}`));

  const logoutResponse = NextResponse.json({ ok: true });
  clearAuthSessionCookies(logoutResponse);
  assert.match(logoutResponse.headers.get("set-cookie") || "", /Max-Age=0/);
});

test("proxy refresh grant returns and preserves rotated tokens without logging them", async () => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "public-anon-key";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json({
      access_token: "rotated-access",
      refresh_token: "rotated-refresh",
      expires_in: 3600,
      user: { id: "00000000-0000-4000-8000-000000000123" },
    });
  }) as typeof fetch;

  const session = await refreshProxyAuthSession("current-refresh");
  assert.equal(session.access_token, "rotated-access");
  assert.equal(session.refresh_token, "rotated-refresh");
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /grant_type=refresh_token/);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    refresh_token: "current-refresh",
  });
});

test("refresh failures clear only invalid sessions and preserve transient failures", async () => {
  process.env.SUPABASE_URL = "https://project.supabase.co";
  process.env.SUPABASE_ANON_KEY = "public-anon-key";

  assert.equal(shouldClearAuthSessionForStatus(401), true);
  assert.equal(shouldClearAuthSessionForStatus(503), false);
  assert.equal(shouldClearAuthSessionForError({ status: 401 }), true);
  assert.equal(shouldClearAuthSessionForError({ status: 503 }), false);
  assert.equal(shouldClearAuthSessionForError({ status: 403 }), true);
  assert.equal(shouldClearAuthSessionForError(new TypeError("network")), false);

  await assert.rejects(
    refreshProxyAuthSession(""),
    (error: unknown) => {
      assert.ok(error instanceof ProxyAuthRefreshError);
      assert.equal(error.status, 401);
      assert.equal(error.clearSession, true);
      return true;
    },
  );

  for (const expectation of [
    { status: 401, clearSession: true },
    { status: 503, clearSession: false },
  ]) {
    globalThis.fetch = (async () =>
      new Response("{}", { status: expectation.status })) as typeof fetch;
    await assert.rejects(
      refreshProxyAuthSession("current-refresh"),
      (error: unknown) => {
        assert.ok(error instanceof ProxyAuthRefreshError);
        assert.equal(error.status, expectation.status);
        assert.equal(error.clearSession, expectation.clearSession);
        return true;
      },
    );
  }

  globalThis.fetch = (async () => {
    throw new TypeError("network unavailable");
  }) as typeof fetch;
  await assert.rejects(
    refreshProxyAuthSession("current-refresh"),
    (error: unknown) => {
      assert.ok(error instanceof ProxyAuthRefreshError);
      assert.equal(error.status, null);
      assert.equal(error.clearSession, false);
      return true;
    },
  );
});

test("password update distinguishes invalid and temporarily unavailable sessions", () => {
  assert.equal(
    getResolvedAuthSessionState({
      hasUser: false,
      shouldClearCookies: true,
    }),
    "invalid",
  );
  assert.equal(
    getResolvedAuthSessionState({
      hasUser: false,
      shouldClearCookies: false,
    }),
    "unavailable",
  );

  const updateRoute = readProjectFile(
    "app/api/auth/password/update/route.ts",
  );
  assert.match(
    updateRoute,
    /authSessionState === "invalid"[\s\S]*clearAuthSessionCookies\(response\)/,
  );
  assert.match(
    updateRoute,
    /authSessionState === "unavailable"[\s\S]*errorResponse\(\s*503,\s*"AUTH_TEMPORARILY_UNAVAILABLE"/,
  );
});

test("auth route contract covers callback verification, revoke, reset, and private responses", () => {
  const sessionRoute = readProjectFile("app/api/auth/session/route.ts");
  const meRoute = readProjectFile("app/api/auth/me/route.ts");
  const logoutRoute = readProjectFile("app/api/auth/logout/route.ts");
  const resetRequestRoute = readProjectFile(
    "app/api/auth/password/reset-request/route.ts",
  );
  const resendRoute = readProjectFile("app/api/auth/resend/route.ts");
  const updateRoute = readProjectFile("app/api/auth/password/update/route.ts");
  const loginRoute = readProjectFile("app/api/auth/login/route.ts");
  const callbackClient = readProjectFile("components/AuthCallbackClient.tsx");
  const supabaseAuth = readProjectFile("lib/auth/supabaseAuth.ts");
  const signupRoute = readProjectFile("app/api/auth/signup/route.ts");
  const oauthStartRoute = readProjectFile(
    "app/api/auth/oauth/google/route.ts",
  );
  const oauthCallbackRoute = readProjectFile(
    "app/api/auth/oauth/callback/route.ts",
  );
  const oauthPkce = readProjectFile("lib/auth/oauthPkce.ts");
  const sessionResolution = readProjectFile("lib/auth/sessionResolution.ts");

  for (const stateChangingRoute of [
    signupRoute,
    loginRoute,
    sessionRoute,
    resendRoute,
    resetRequestRoute,
    updateRoute,
    logoutRoute,
    oauthStartRoute,
    oauthCallbackRoute,
  ]) {
    assert.match(stateChangingRoute, /assertSameOriginAuthRequest/);
  }
  assert.match(sessionRoute, /getSupabaseAuthUser\(input\.accessToken\)/);
  assert.match(sessionRoute, /refreshSupabaseSession\(input\.refreshToken\)/);
  assert.match(sessionRoute, /refreshed\.user\.id !== accessUser\.id/);
  assert.match(sessionRoute, /setAuthSessionCookies/);
  assert.match(sessionRoute, /NextResponse\.json\(\s*\{ ok: true, next \}/);
  assert.doesNotMatch(sessionRoute, /\{ ok: true, next,\s*(?:access|refresh)Token/);

  assert.match(logoutRoute, /revokeSupabaseSession/);
  assert.match(logoutRoute, /clearAuthSessionCookies/);
  const logoutOriginCheck = logoutRoute.indexOf(
    "assertSameOriginAuthRequest(request)",
  );
  const logoutResponseCreation = logoutRoute.indexOf(
    "const response = NextResponse.json",
  );
  assert.ok(
    logoutOriginCheck >= 0 && logoutOriginCheck < logoutResponseCreation,
    "cross-site logout requests must be rejected before cookies are cleared",
  );
  assert.match(logoutRoute, /status: 403/);
  assert.match(supabaseAuth, /\/auth\/v1\/logout\?scope=local/);
  assert.match(supabaseAuth, /grant_type=refresh_token/);
  assert.match(supabaseAuth, /grant_type=pkce/);
  assert.match(supabaseAuth, /auth_code: authCode/);
  assert.match(supabaseAuth, /code_verifier: codeVerifier/);
  assert.match(signupRoute, /ensureUserBootstrap\(session\.user\)/);
  assert.match(sessionResolution, /shouldClearAuthSessionForError/);
  assert.match(
    sessionResolution,
    /function unavailableSession\(\)[\s\S]*shouldClearCookies: false/,
  );
  assert.match(
    meRoute,
    /else if \(resolved\.shouldClearCookies\)[\s\S]*clearAuthSessionCookies/,
  );

  assert.match(resetRequestRoute, /account exists/);
  assert.match(resetRequestRoute, /catch\(\(\) => undefined\)/);
  assert.match(updateRoute, /updateSupabasePassword/);
  assert.match(updateRoute, /password\.length < 8/);

  const historyPosition = callbackClient.indexOf("window.history.replaceState");
  const fetchPosition = callbackClient.indexOf(
    "const response = await fetch(request.endpoint",
  );
  assert.ok(historyPosition >= 0 && historyPosition < fetchPosition);
  assert.match(callbackClient, /endpoint: "\/api\/auth\/oauth\/callback"/);
  assert.match(callbackClient, /endpoint: "\/api\/auth\/session"/);
  assert.equal(callbackClient.includes("console."), false);

  assert.match(oauthStartRoute, /buildGoogleOAuthCallbackUrl/);
  assert.match(oauthStartRoute, /buildGoogleOAuthAuthorizeUrl/);
  assert.match(oauthStartRoute, /setOAuthPkceCookie/);
  assert.doesNotMatch(oauthStartRoute, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(oauthStartRoute, /GOOGLE_CLIENT_SECRET/);
  assert.match(oauthCallbackRoute, /exchangeSupabaseAuthCode/);
  assert.match(oauthCallbackRoute, /setAuthSessionCookies/);
  assert.match(oauthCallbackRoute, /clearOAuthPkceCookie/);
  const oauthCallbackOriginCheck = oauthCallbackRoute.indexOf(
    "assertSameOriginAuthRequest(request)",
  );
  const oauthCallbackCookieClear = oauthCallbackRoute.indexOf(
    "clearOAuthPkceCookie(response)",
  );
  assert.ok(
    oauthCallbackOriginCheck >= 0 &&
      oauthCallbackOriginCheck < oauthCallbackCookieClear,
    "cross-site OAuth callback requests must be rejected before the PKCE cookie is cleared",
  );
  assert.match(oauthPkce, /httpOnly: true/);
  assert.match(oauthPkce, /sameSite: "lax"/);
  assert.match(oauthPkce, /randomBytes\(32\)/);
  assert.match(oauthPkce, /createHash\("sha256"\)/);

  const authForm = readProjectFile("components/AuthForm.tsx");
  assert.match(authForm, /Continue with Google/);
  assert.match(authForm, /fetch\("\/api\/auth\/oauth\/google"/);
  assert.match(authForm, /JSON\.stringify\(\{ next: nextPath \}\)/);
  assert.match(authForm, /mode === "signup"/);

  for (const source of [
    sessionRoute,
    logoutRoute,
    resetRequestRoute,
    updateRoute,
    oauthStartRoute,
    oauthCallbackRoute,
  ]) {
    assert.match(source, /AUTH_PRIVATE_HEADERS/);
  }
});

function jwtWithExpiry(exp: number) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ exp })}.signature`;
}

function readProjectFile(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
