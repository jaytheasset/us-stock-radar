import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getRedirectUrl,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server.js";
import { NextRequest } from "next/server.js";
import { POST as access } from "../app/api/prelaunch/access/route.ts";
import { POST as logout } from "../app/api/prelaunch/logout/route.ts";
import { GET as comingSoon } from "../app/coming-soon/route.ts";
import { config, proxy, proxyWithDependencies } from "../proxy.ts";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
} from "./auth/authCookies.ts";
import {
  PRELAUNCH_ACCESS_COOKIE,
  PRELAUNCH_ACCESS_MAX_AGE_SECONDS,
  createPrelaunchAccessProof,
  isComingSoonPath,
  isPrelaunchApiPath,
  isPrelaunchBypassPath,
  isPrelaunchMode,
  prelaunchRobotsMetadata,
  sanitizeInternalRedirect,
  verifyPrelaunchAccessProof,
  verifyPrelaunchPassword,
} from "./prelaunch.ts";
import {
  PRELAUNCH_INTERNAL_PROOF_HEADER,
  PRELAUNCH_INTERNAL_PROOF_MAX_AGE_SECONDS,
  authorizePrelaunchInternalRequest,
  createPrelaunchInternalProof,
  prelaunchInternalRequestHeaders,
} from "./prelaunchInternalAccess.ts";

const originalMode = process.env.PRELAUNCH_MODE;
const originalPassword = process.env.PRELAUNCH_PASSWORD;
const originalVercelEnvironment = process.env.VERCEL_ENV;
const originalCronSecret = process.env.CRON_SECRET;

test.afterEach(() => {
  restoreEnv("PRELAUNCH_MODE", originalMode);
  restoreEnv("PRELAUNCH_PASSWORD", originalPassword);
  restoreEnv("VERCEL_ENV", originalVercelEnvironment);
  restoreEnv("CRON_SECRET", originalCronSecret);
});

test("prelaunch mode fails closed on Vercel production and uses explicit overrides", () => {
  assert.equal(isPrelaunchMode({}), false);
  assert.equal(isPrelaunchMode({ PRELAUNCH_MODE: "0" }), false);
  assert.equal(isPrelaunchMode({ PRELAUNCH_MODE: "true" }), false);
  assert.equal(isPrelaunchMode({ PRELAUNCH_MODE: "1" }), true);
  assert.equal(isPrelaunchMode({ VERCEL_ENV: "preview" }), false);
  assert.equal(isPrelaunchMode({ VERCEL_ENV: "production" }), true);
  assert.equal(
    isPrelaunchMode({ VERCEL_ENV: "production", PRELAUNCH_MODE: "0" }),
    false,
  );
});

test("password comparison accepts only an exact configured password", () => {
  assert.equal(verifyPrelaunchPassword("correct", "correct"), true);
  assert.equal(verifyPrelaunchPassword("wrong", "correct"), false);
  assert.equal(verifyPrelaunchPassword("", "correct"), false);
  assert.equal(verifyPrelaunchPassword("correct", ""), false);
});

test("access proof is opaque, expires server-side, and rejects tampering", () => {
  const password = "private password with spaces";
  const now = Date.UTC(2026, 8, 7, 12, 0, 0);
  const proof = createPrelaunchAccessProof(password, now);

  assert.match(proof, /^v2\.\d{10}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(proof.includes(password), false);
  assert.equal(verifyPrelaunchAccessProof(proof, password, now), true);
  assert.equal(
    verifyPrelaunchAccessProof(
      proof,
      password,
      now + (PRELAUNCH_ACCESS_MAX_AGE_SECONDS - 1) * 1000,
    ),
    true,
  );
  assert.equal(
    verifyPrelaunchAccessProof(
      proof,
      password,
      now + PRELAUNCH_ACCESS_MAX_AGE_SECONDS * 1000,
    ),
    false,
  );
  assert.equal(verifyPrelaunchAccessProof(proof, `${password}!`, now), false);
  const tamperedProof = `${proof.slice(0, -1)}${proof.endsWith("A") ? "B" : "A"}`;
  assert.equal(
    verifyPrelaunchAccessProof(tamperedProof, password, now),
    false,
  );
  assert.equal(verifyPrelaunchAccessProof(undefined, password, now), false);
});

test("redirect sanitizer allows internal paths and rejects open redirects", () => {
  assert.equal(
    sanitizeInternalRedirect("/news?range=1D#latest"),
    "/news?range=1D#latest",
  );
  assert.equal(sanitizeInternalRedirect("https://evil.example/a"), "/");
  assert.equal(sanitizeInternalRedirect("//evil.example/a"), "/");
  assert.equal(sanitizeInternalRedirect("/\\evil.example/a"), "/");
  assert.equal(sanitizeInternalRedirect("/coming-soon?next=/news"), "/");
  assert.equal(sanitizeInternalRedirect(null, "/dashboard"), "/dashboard");
});

test("bypass path contract is limited to gate, infrastructure, and immutable assets", () => {
  for (const pathname of [
    "/api/prelaunch/access",
    "/api/prelaunch/logout",
    "/api/cron/market-cache",
    "/api/cron/source-ingest/sec",
    "/api/sources/sec/ingest",
    "/api/webhooks",
    "/api/webhooks/snaptrade",
    "/api/telegram/webhook",
    "/api/alerts/email/unsubscribe",
    "/.well-known/workflow",
    "/.well-known/workflow/v1/step",
    "/_next/static/chunks/app.js",
    "/_next/media/font.woff2",
    "/coming-soon",
    "/favicon.ico",
    "/robots.txt",
  ]) {
    assert.equal(isPrelaunchBypassPath(pathname), true, pathname);
  }

  for (const pathname of [
    "/api",
    "/api/health",
    "/api/tickers/search.json",
    "/api/cron/unconfigured",
    "/api/cron/source-ingest/sec/extra",
    "/api/sources/sec/raw-preview",
    "/api/sources/sec/ingest/extra",
    "/auth/callback",
    "/news",
    "/images/radar.svg",
    "/sitemap.xml",
    "/coming-soon/details",
    "/apiary",
  ]) {
    assert.equal(isPrelaunchBypassPath(pathname), false, pathname);
  }
  assert.equal(isPrelaunchApiPath("/api"), true);
  assert.equal(isPrelaunchApiPath("/api/health"), true);
  assert.equal(isPrelaunchApiPath("/apiary"), false);
  assert.equal(isComingSoonPath("/coming-soon"), true);
  assert.equal(isComingSoonPath("/coming-soon/details"), false);
  assert.equal(isComingSoonPath("/coming-sooner"), false);
});

test("metadata robots contract changes with prelaunch mode", () => {
  assert.deepEqual(prelaunchRobotsMetadata(false), {
    follow: true,
    index: true,
  });
  assert.deepEqual(prelaunchRobotsMetadata(true), {
    follow: false,
    index: false,
    nocache: true,
    googleBot: {
      follow: false,
      index: false,
      noimageindex: true,
    },
  });
});

test("proxy matcher covers page, API, and Workflow paths", () => {
  for (const url of [
    "https://radar.example/news",
    "https://radar.example/api/health",
    "https://radar.example/.well-known/workflow/v1/run",
  ]) {
    assert.equal(
      unstable_doesMiddlewareMatch({ config, nextConfig: {}, url }),
      true,
      url,
    );
  }
});

test("proxy is off by default and redirects ordinary pages when enabled", async () => {
  delete process.env.PRELAUNCH_MODE;
  let response = await proxy(new NextRequest("https://radar.example/news"));
  assert.equal(getRedirectUrl(response), null);

  process.env.PRELAUNCH_MODE = "1";
  process.env.PRELAUNCH_PASSWORD = "preview-secret";
  response = await proxy(
    new NextRequest("https://radar.example/news?range=1D"),
  );
  assert.equal(
    getRedirectUrl(response),
    "https://radar.example/coming-soon?next=%2Fnews%3Frange%3D1D",
  );
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.match(response.headers.get("cache-control") || "", /no-store/);
});

test("internal request credentials are separate, short-lived, and target-bound", () => {
  const target = "https://radar.example/api/market/chart?symbol=AAPL&range=1D";
  assert.deepEqual(prelaunchInternalRequestHeaders(target, "GET", {}), {});
  assert.deepEqual(
    prelaunchInternalRequestHeaders(target, "GET", {
      PRELAUNCH_MODE: "1",
    }),
    {},
  );

  const headers = prelaunchInternalRequestHeaders(target, "GET", {
    CRON_SECRET: "cron-secret",
    PRELAUNCH_MODE: "1",
    PRELAUNCH_PASSWORD: "visitor-secret-must-not-be-used",
  });
  assert.match(
    headers[PRELAUNCH_INTERNAL_PROOF_HEADER] || "",
    /^v1\.\d{10}\.\d{10}\.[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/,
  );
  assert.equal("Cookie" in headers, false);
  assert.equal(
    (headers[PRELAUNCH_INTERNAL_PROOF_HEADER] || "").includes("cron-secret"),
    false,
  );
  assert.throws(
    () =>
      createPrelaunchInternalProof({
        requestUrl: "https://radar.example/api/tickers/search?q=AAPL",
        secret: "cron-secret",
      }),
    /not an allowed prelaunch internal target/,
  );
});

test("internal capability cannot become visitor, product, Auth, or Admin access", async () => {
  process.env.PRELAUNCH_MODE = "1";
  process.env.PRELAUNCH_PASSWORD = "visitor-secret";
  process.env.CRON_SECRET = "cron-secret";
  const now = Date.UTC(2026, 8, 7, 12, 0, 0);
  const target = "https://radar.example/api/market/chart?symbol=AAPL&range=1D";
  const proof = createPrelaunchInternalProof({
    nonce: "abcdefghijklmnopqrstuvwx",
    now,
    requestUrl: target,
    secret: "cron-secret",
  });
  const authorize = buildInternalAuthorizer(now);

  for (const path of ["/news", "/admin", "/auth/callback"]) {
    const response = await proxyWithDependencies(
      internalRequest(`https://radar.example${path}`, proof),
      { authorizeInternalRequest: authorize },
    );
    assert.match(getRedirectUrl(response) || "", /\/coming-soon/, path);
  }

  for (const path of [
    "/api/tickers/search?q=AAPL",
    "/api/admin/system/health",
    "/api/auth/me",
  ]) {
    const response = await proxyWithDependencies(
      internalRequest(`https://radar.example${path}`, proof),
      { authorizeInternalRequest: authorize },
    );
    assert.equal(response.status, 401, path);
    assert.match(await response.text(), /PRELAUNCH_ACCESS_REQUIRED/, path);
  }

  const cookieOnly = await proxyWithDependencies(
    new NextRequest("https://radar.example/news", {
      headers: { cookie: `${PRELAUNCH_ACCESS_COOKIE}=${proof}` },
    }),
    { authorizeInternalRequest: authorize },
  );
  assert.match(getRedirectUrl(cookieOnly) || "", /\/coming-soon/);
});

test("internal capability is exact-scope, one-time, and tamper/expiry safe", async () => {
  process.env.PRELAUNCH_MODE = "1";
  process.env.PRELAUNCH_PASSWORD = "visitor-secret";
  process.env.CRON_SECRET = "cron-secret";
  const now = Date.UTC(2026, 8, 7, 12, 0, 0);
  const target = "https://radar.example/api/market/chart?symbol=AAPL&range=1D";
  const proof = createPrelaunchInternalProof({
    nonce: "abcdefghijklmnopqrstuvwx",
    now,
    requestUrl: target,
    secret: "cron-secret",
  });
  const consumed = new Set<string>();
  const authorize = buildInternalAuthorizer(now, consumed);

  const accepted = await proxyWithDependencies(internalRequest(target, proof), {
    authorizeInternalRequest: authorize,
  });
  assert.equal(accepted.status, 200);
  assert.equal(getRedirectUrl(accepted), null);
  assert.equal(
    accepted.headers
      .get("x-middleware-override-headers")
      ?.includes(PRELAUNCH_INTERNAL_PROOF_HEADER) ?? false,
    false,
  );
  assert.equal(
    accepted.headers.get(
      `x-middleware-request-${PRELAUNCH_INTERNAL_PROOF_HEADER}`,
    ),
    null,
  );

  const replayed = await proxyWithDependencies(internalRequest(target, proof), {
    authorizeInternalRequest: authorize,
  });
  assert.equal(replayed.status, 401);

  const changedQuery = await proxyWithDependencies(
    internalRequest(
      "https://radar.example/api/market/chart?symbol=TSLA&range=1D",
      proof,
    ),
    { authorizeInternalRequest: buildInternalAuthorizer(now) },
  );
  assert.equal(changedQuery.status, 401);

  const changedOrigin = await proxyWithDependencies(
    internalRequest(
      "https://preview.example/api/market/chart?symbol=AAPL&range=1D",
      proof,
    ),
    { authorizeInternalRequest: buildInternalAuthorizer(now) },
  );
  assert.equal(changedOrigin.status, 401);

  const changedMethod = await proxyWithDependencies(
    new NextRequest(target, {
      headers: { [PRELAUNCH_INTERNAL_PROOF_HEADER]: proof },
      method: "POST",
    }),
    { authorizeInternalRequest: buildInternalAuthorizer(now) },
  );
  assert.equal(changedMethod.status, 401);

  const tampered = `${proof.slice(0, -1)}${proof.endsWith("A") ? "B" : "A"}`;
  const tamperedResponse = await proxyWithDependencies(
    internalRequest(target, tampered),
    { authorizeInternalRequest: buildInternalAuthorizer(now) },
  );
  assert.equal(tamperedResponse.status, 401);

  const expiredProof = createPrelaunchInternalProof({
    nonce: "zyxwvutsrqponmlkjihgfedc",
    now: now - PRELAUNCH_INTERNAL_PROOF_MAX_AGE_SECONDS * 1000,
    requestUrl: target,
    secret: "cron-secret",
  });
  const expiredResponse = await proxyWithDependencies(
    internalRequest(target, expiredProof),
    { authorizeInternalRequest: buildInternalAuthorizer(now) },
  );
  assert.equal(expiredResponse.status, 401);

  const visitorProof = createPrelaunchAccessProof("visitor-secret", now);
  const roleConfusion = await proxyWithDependencies(
    internalRequest(target, visitorProof),
    { authorizeInternalRequest: buildInternalAuthorizer(now) },
  );
  assert.equal(roleConfusion.status, 401);
});

test("Cron, Workflow, source ingest, and signed webhook paths keep gate bypass", async () => {
  process.env.PRELAUNCH_MODE = "1";
  process.env.PRELAUNCH_PASSWORD = "visitor-secret";

  for (const path of [
    "/api/cron/market-cache",
    "/api/cron/dashboard-movers",
    "/api/cron/source-ingest/sec",
    "/api/sources/sec/ingest",
    "/api/webhooks",
    "/api/webhooks/snaptrade",
    "/api/telegram/webhook",
    "/.well-known/workflow/v1/run",
  ]) {
    const response = await proxy(
      new NextRequest(`https://radar.example${path}`),
    );
    assert.equal(response.status, 200, path);
    assert.equal(getRedirectUrl(response), null, path);
  }
});

test("nonce consumer migration is atomic, bounded, and service-role only", () => {
  const migration = readProjectFile(
    "supabase/migrations/20260907080000_prelaunch_internal_access_nonce.sql",
  );
  assert.match(migration, /consume_prelaunch_internal_nonce/);
  assert.match(migration, /on conflict \(lock_key\) do nothing/i);
  assert.match(migration, /locked_until <= now\(\)/i);
  assert.match(migration, /interval '60 seconds'/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /revoke all .* from anon/i);
  assert.match(migration, /revoke all .* from authenticated/i);
  assert.match(migration, /grant execute .* to service_role/i);
});

test("Vercel production fails closed when gate configuration is missing", async () => {
  delete process.env.PRELAUNCH_MODE;
  delete process.env.PRELAUNCH_PASSWORD;
  process.env.VERCEL_ENV = "production";

  const pageResponse = await proxy(
    new NextRequest("https://radar.example/stocks/VEEA"),
  );
  assert.equal(
    getRedirectUrl(pageResponse),
    "https://radar.example/coming-soon?next=%2Fstocks%2FVEEA",
  );

  const apiResponse = await proxy(
    new NextRequest("https://radar.example/api/tickers/search?q=AAPL"),
  );
  assert.equal(apiResponse.status, 401);
  assert.match(await apiResponse.text(), /PRELAUNCH_ACCESS_REQUIRED/);
});

test("proxy accepts a valid proof while unauthenticated product APIs fail closed", async () => {
  process.env.PRELAUNCH_MODE = "1";
  process.env.PRELAUNCH_PASSWORD = "preview-secret";
  const proof = createPrelaunchAccessProof("preview-secret");
  const authenticated = await proxy(
    new NextRequest("https://radar.example/news", {
      headers: {
        cookie: `${PRELAUNCH_ACCESS_COOKIE}=${proof}`,
      },
    }),
  );
  assert.equal(getRedirectUrl(authenticated), null);
  assert.equal(
    authenticated.headers.get("x-robots-tag"),
    "noindex, nofollow",
  );
  assert.match(authenticated.headers.get("cache-control") || "", /no-store/);

  const protectedApi = await proxy(
    new NextRequest("https://radar.example/api/tickers/search?q=AAPL"),
  );
  assert.equal(protectedApi.status, 401);
  assert.deepEqual(await protectedApi.json(), {
    ok: false,
    error: {
      code: "PRELAUNCH_ACCESS_REQUIRED",
      message: "Private preview access is required.",
      status: 401,
    },
  });
  assert.match(protectedApi.headers.get("cache-control") || "", /no-store/);

  const authenticatedApi = await proxy(
    new NextRequest("https://radar.example/api/tickers/search?q=AAPL", {
      headers: {
        cookie: `${PRELAUNCH_ACCESS_COOKIE}=${proof}`,
      },
    }),
  );
  assert.equal(authenticatedApi.status, 200);

  for (const path of [
    "/api/prelaunch/access",
    "/api/cron/market-cache",
    "/api/webhooks",
    "/.well-known/workflow/v1/run",
    "/_next/static/chunk.js",
    "/favicon.ico",
  ]) {
    const response = await proxy(
      new NextRequest(`https://radar.example${path}`),
    );
    assert.equal(getRedirectUrl(response), null, path);
  }
});

test("email auth callback keeps its deep link but still requires gate access", async () => {
  process.env.PRELAUNCH_MODE = "1";
  process.env.PRELAUNCH_PASSWORD = "preview-secret";

  const callbackResponse = await proxy(
    new NextRequest(
      "https://radar.example/auth/callback?type=signup&next=%2Faccount",
    ),
  );
  assert.equal(
    getRedirectUrl(callbackResponse),
    "https://radar.example/coming-soon?next=%2Fauth%2Fcallback%3Ftype%3Dsignup%26next%3D%252Faccount",
  );

  const nestedResponse = await proxy(
    new NextRequest("https://radar.example/auth/callback/extra"),
  );
  assert.equal(
    getRedirectUrl(nestedResponse),
    "https://radar.example/coming-soon?next=%2Fauth%2Fcallback%2Fextra",
  );
});

test("authenticated static assets keep shared cache headers and skip auth refresh", async () => {
  delete process.env.PRELAUNCH_MODE;
  const cookie = [
    `${AUTH_ACCESS_COOKIE}=malformed-access-token`,
    `${AUTH_REFRESH_COOKIE}=refresh-token-that-must-not-be-used`,
  ].join("; ");

  for (const path of [
    "/_next/static/chunks/app.js",
    "/styles/site.css",
    "/images/radar.svg",
  ]) {
    const response = await proxy(
      new NextRequest(`https://radar.example${path}`, {
        headers: { cookie },
      }),
    );
    assert.equal(response.headers.get("cache-control"), null, path);
    assert.equal(response.headers.get("set-cookie"), null, path);
  }
});

test("coming-soon request passes through with noindex", async () => {
  process.env.PRELAUNCH_MODE = "1";
  const response = await proxy(
    new NextRequest("https://radar.example/coming-soon"),
  );

  assert.equal(getRedirectUrl(response), null);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
});

test("coming-soon route is standalone HTML without global UI client code", async () => {
  const response = comingSoon(
    new NextRequest(
      "https://radar.example/coming-soon?error=invalid&next=%2Fnews",
    ),
  );
  const html = await response.text();

  assert.match(html, /US Stock Radar — In Development/);
  assert.match(html, /That password was not recognized\./);
  assert.match(html, /name="next" value="\/news"/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.equal(html.includes("ThemeToggle"), false);
  assert.equal(html.includes("theme-toggle"), false);
  assert.equal(html.includes("AdSensePublisherLoader"), false);
  assert.equal(html.includes("adsbygoogle"), false);
  assert.match(
    response.headers.get("content-security-policy") || "",
    /default-src 'none'/,
  );
});

test("access route returns unavailable and invalid errors without a cookie", async () => {
  process.env.PRELAUNCH_MODE = "1";
  delete process.env.PRELAUNCH_PASSWORD;

  let response = await accessRequest("anything", "/news");
  assert.equal(response.status, 303);
  assert.equal(
    getRedirectUrl(response),
    "https://radar.example/coming-soon?error=unavailable&next=%2Fnews",
  );
  assert.equal(response.headers.get("set-cookie"), null);

  process.env.PRELAUNCH_PASSWORD = "preview-secret";
  response = await accessRequest("wrong", "/news");
  assert.equal(response.status, 303);
  assert.equal(
    getRedirectUrl(response),
    "https://radar.example/coming-soon?error=invalid&next=%2Fnews",
  );
  assert.equal(response.headers.get("set-cookie"), null);
});

test("access route sets an opaque hardened cookie after successful authentication", async () => {
  process.env.PRELAUNCH_MODE = "1";
  process.env.PRELAUNCH_PASSWORD = "preview-secret";

  const response = await accessRequest("preview-secret", "/news");
  const cookie = response.headers.get("set-cookie") || "";

  assert.equal(response.status, 303);
  assert.equal(getRedirectUrl(response), "https://radar.example/news");
  assert.match(cookie, new RegExp(`^${PRELAUNCH_ACCESS_COOKIE}=v2\\.`));
  assert.equal(cookie.includes("preview-secret"), false);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Secure/i);
  assert.match(
    cookie,
    new RegExp(`Max-Age=${PRELAUNCH_ACCESS_MAX_AGE_SECONDS}`),
  );
  assert.match(response.headers.get("cache-control") || "", /no-store/);
});

test("access route rejects external return targets and logout clears the cookie", async () => {
  process.env.PRELAUNCH_MODE = "1";
  process.env.PRELAUNCH_PASSWORD = "preview-secret";

  const accessResponse = await accessRequest(
    "preview-secret",
    "https://evil.example/",
  );
  assert.equal(getRedirectUrl(accessResponse), "https://radar.example/");

  const form = new FormData();
  form.set("next", "/news");
  const logoutResponse = await logout(
    new NextRequest("https://radar.example/api/prelaunch/logout", {
      body: form,
      headers: {
        origin: "https://radar.example",
        "sec-fetch-site": "same-origin",
      },
      method: "POST",
    }),
  );
  assert.equal(
    getRedirectUrl(logoutResponse),
    "https://radar.example/coming-soon",
  );
  assert.match(logoutResponse.headers.get("set-cookie") || "", /Max-Age=0/);
  assert.match(logoutResponse.headers.get("set-cookie") || "", /HttpOnly/i);
  assert.match(logoutResponse.headers.get("set-cookie") || "", /SameSite=Lax/i);
  assert.match(logoutResponse.headers.get("set-cookie") || "", /Secure/i);
});

test("prelaunch cookie mutations reject cross-origin requests", async () => {
  const form = new FormData();
  form.set("password", "preview-secret");
  const response = await access(
    new NextRequest("https://radar.example/api/prelaunch/access", {
      body: form,
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
      method: "POST",
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("wiring keeps source schedules disabled and prelaunch routes server-only", () => {
  const vercelConfig = JSON.parse(readProjectFile("vercel.json")) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  assert.deepEqual(vercelConfig.crons, [
    {
      path: "/api/cron/market-cache",
      schedule: "*/5 * * * *",
    },
    {
      path: "/api/cron/alert-delivery",
      schedule: "*/5 * * * *",
    },
  ]);

  const layout = readProjectFile("app/layout.tsx");
  assert.match(layout, /buildRootMetadata\(isPrelaunchMode\(\)\)/);

  const comingSoonRoute = readProjectFile("app/coming-soon/route.ts");
  assert.equal(comingSoonRoute.includes("ThemeToggle"), false);
  assert.equal(comingSoonRoute.includes("AdSensePublisherLoader"), false);
  assert.match(comingSoonRoute, /Content-Security-Policy/);

  const environmentExample = readProjectFile(".env.local.example");
  assert.match(environmentExample, /^PRELAUNCH_MODE=0$/m);
  assert.match(environmentExample, /^PRELAUNCH_PASSWORD=$/m);
  assert.equal(environmentExample.includes("NEXT_PUBLIC_PRELAUNCH"), false);

  const robots = readProjectFile("app/robots.ts");
  assert.match(robots, /buildRobots\(isPrelaunchMode\(\)\)/);
});

function buildInternalAuthorizer(
  now: number,
  consumed = new Set<string>(),
) {
  return (request: Request) =>
    authorizePrelaunchInternalRequest(request, {
      now,
      secret: "cron-secret",
      consumeNonce: async ({ nonceDigest }) => {
        if (consumed.has(nonceDigest)) return false;
        consumed.add(nonceDigest);
        return true;
      },
    });
}

function internalRequest(url: string, proof: string) {
  return new NextRequest(url, {
    headers: { [PRELAUNCH_INTERNAL_PROOF_HEADER]: proof },
  });
}

async function accessRequest(password: string, next: string) {
  const form = new FormData();
  form.set("password", password);
  form.set("next", next);
  return access(
    new NextRequest("https://radar.example/api/prelaunch/access", {
      body: form,
      headers: {
        origin: "https://radar.example",
        "sec-fetch-site": "same-origin",
      },
      method: "POST",
    }),
  );
}

function readProjectFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
