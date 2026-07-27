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
import { config, proxy } from "../proxy.ts";
import {
  PRELAUNCH_ACCESS_COOKIE,
  PRELAUNCH_ACCESS_MAX_AGE_SECONDS,
  createPrelaunchAccessProof,
  isComingSoonPath,
  isPrelaunchBypassPath,
  isPrelaunchMode,
  prelaunchRobotsMetadata,
  sanitizeInternalRedirect,
  verifyPrelaunchAccessProof,
  verifyPrelaunchPassword,
} from "./prelaunch.ts";

const originalMode = process.env.PRELAUNCH_MODE;
const originalPassword = process.env.PRELAUNCH_PASSWORD;

test.afterEach(() => {
  restoreEnv("PRELAUNCH_MODE", originalMode);
  restoreEnv("PRELAUNCH_PASSWORD", originalPassword);
});

test("prelaunch mode is opt-in and only exact 1 enables it", () => {
  assert.equal(isPrelaunchMode({}), false);
  assert.equal(isPrelaunchMode({ PRELAUNCH_MODE: "0" }), false);
  assert.equal(isPrelaunchMode({ PRELAUNCH_MODE: "true" }), false);
  assert.equal(isPrelaunchMode({ PRELAUNCH_MODE: "1" }), true);
});

test("password comparison accepts only an exact configured password", () => {
  assert.equal(verifyPrelaunchPassword("correct", "correct"), true);
  assert.equal(verifyPrelaunchPassword("wrong", "correct"), false);
  assert.equal(verifyPrelaunchPassword("", "correct"), false);
  assert.equal(verifyPrelaunchPassword("correct", ""), false);
});

test("access proof is opaque and a password change invalidates it", () => {
  const password = "private password with spaces";
  const proof = createPrelaunchAccessProof(password);

  assert.match(proof, /^v1\.[A-Za-z0-9_-]+$/);
  assert.equal(proof.includes(password), false);
  assert.equal(verifyPrelaunchAccessProof(proof, password), true);
  assert.equal(verifyPrelaunchAccessProof(proof, `${password}!`), false);
  assert.equal(verifyPrelaunchAccessProof(undefined, password), false);
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

test("bypass path contract keeps operational and asset requests outside the gate", () => {
  for (const pathname of [
    "/api",
    "/api/cron/market-cache",
    "/.well-known/workflow",
    "/.well-known/workflow/v1/step",
    "/_next/static/chunk.js",
    "/coming-soon",
    "/favicon.ico",
    "/images/radar.svg",
  ]) {
    assert.equal(isPrelaunchBypassPath(pathname), true, pathname);
  }

  assert.equal(isPrelaunchBypassPath("/news"), false);
  assert.equal(isPrelaunchBypassPath("/coming-soon/details"), false);
  assert.equal(isPrelaunchBypassPath("/apiary"), false);
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
});

test("proxy accepts a valid proof and bypasses API and Workflow requests", async () => {
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

  for (const path of [
    "/api/health",
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
  assert.match(cookie, new RegExp(`^${PRELAUNCH_ACCESS_COOKIE}=v1\\.`));
  assert.equal(cookie.includes("preview-secret"), false);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
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
      method: "POST",
    }),
  );
  assert.equal(
    getRedirectUrl(logoutResponse),
    "https://radar.example/coming-soon",
  );
  assert.match(logoutResponse.headers.get("set-cookie") || "", /Max-Age=0/);
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
  ]);

  const layout = readProjectFile("app/layout.tsx");
  assert.match(layout, /prelaunchRobotsMetadata\(isPrelaunchMode\(\)\)/);

  const comingSoonRoute = readProjectFile("app/coming-soon/route.ts");
  assert.equal(comingSoonRoute.includes("ThemeToggle"), false);
  assert.equal(comingSoonRoute.includes("AdSensePublisherLoader"), false);
  assert.match(comingSoonRoute, /Content-Security-Policy/);

  const environmentExample = readProjectFile(".env.local.example");
  assert.match(environmentExample, /^PRELAUNCH_MODE=0$/m);
  assert.match(environmentExample, /^PRELAUNCH_PASSWORD=$/m);
  assert.equal(environmentExample.includes("NEXT_PUBLIC_PRELAUNCH"), false);

  const robots = readProjectFile("app/robots.ts");
  assert.match(robots, /disallow: "\/"/);
  assert.match(robots, /allow: "\/"/);
});

async function accessRequest(password: string, next: string) {
  const form = new FormData();
  form.set("password", password);
  form.set("next", next);
  return access(
    new NextRequest("https://radar.example/api/prelaunch/access", {
      body: form,
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
