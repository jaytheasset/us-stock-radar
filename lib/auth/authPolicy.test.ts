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
  isSameOriginAuthRequest,
  normalizeAuthCallbackType,
  sanitizeAuthRedirect,
  shouldRefreshAuthSession,
} from "./authPolicy.ts";
import { refreshProxyAuthSession } from "./proxySession.ts";

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
  assert.match(authForm, /sanitizeAuthRedirect\(value, "\/alerts"\)/);
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

test("auth route contract covers callback verification, revoke, reset, and private responses", () => {
  const sessionRoute = readProjectFile("app/api/auth/session/route.ts");
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

  for (const stateChangingRoute of [
    signupRoute,
    loginRoute,
    sessionRoute,
    resendRoute,
    resetRequestRoute,
    updateRoute,
    logoutRoute,
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
  assert.match(signupRoute, /ensureUserBootstrap\(session\.user\)/);

  assert.match(resetRequestRoute, /account exists/);
  assert.match(resetRequestRoute, /catch\(\(\) => undefined\)/);
  assert.match(updateRoute, /updateSupabasePassword/);
  assert.match(updateRoute, /password\.length < 8/);

  const historyPosition = callbackClient.indexOf("window.history.replaceState");
  const fetchPosition = callbackClient.indexOf('fetch("/api/auth/session"');
  assert.ok(historyPosition >= 0 && historyPosition < fetchPosition);
  assert.equal(callbackClient.includes("console."), false);

  for (const source of [
    sessionRoute,
    logoutRoute,
    resetRequestRoute,
    updateRoute,
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
