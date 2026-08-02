import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  COMING_SOON_CONTENT_SECURITY_POLICY,
} from "./securityHeaders.ts";

test("production CSP preserves required app integrations without unsafe-eval", () => {
  const policy = buildContentSecurityPolicy({
    nodeEnv: "production",
    supabaseUrl: "https://project.supabase.co/rest/v1",
  });
  const scriptSources = readDirectiveSources(policy, "script-src");
  const imageSources = readDirectiveSources(policy, "img-src");
  const connectSources = readDirectiveSources(policy, "connect-src");
  const frameSources = readDirectiveSources(policy, "frame-src");
  const baseSources = readDirectiveSources(policy, "base-uri");

  assert.ok(scriptSources.includes("'unsafe-inline'"));
  assert.ok(!scriptSources.includes("'unsafe-eval'"));
  assert.ok(scriptSources.includes("https://pagead2.googlesyndication.com"));
  assert.ok(!scriptSources.includes("https:"));
  assert.ok(imageSources.includes("https:"));
  assert.ok(imageSources.includes("https://static.klipy.com"));
  assert.ok(connectSources.includes("https://project.supabase.co"));
  assert.ok(connectSources.includes("wss://project.supabase.co"));
  assert.ok(!connectSources.includes("https:"));
  assert.ok(!frameSources.includes("https:"));
  assert.deepEqual(baseSources, ["'self'", "https://www.sec.gov"]);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /form-action 'self'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /(?:^|\s)\*(?:\s|;|$)/);
});

test("development CSP permits HMR and local Supabase only in development", () => {
  const policy = buildContentSecurityPolicy({
    nodeEnv: "development",
    supabaseUrl: "http://127.0.0.1:56321",
  });

  assert.match(policy, /'unsafe-eval'/);
  assert.match(policy, /http:\/\/127\.0\.0\.1:56321/);
  assert.match(policy, /ws:\/\/127\.0\.0\.1:56321/);
  assert.match(policy, /ws:\/\/127\.0\.0\.1:\*/);
});

test("global response headers include browser isolation and privacy controls", () => {
  const headers = new Map(
    buildSecurityHeaders({ nodeEnv: "production" }).map((header) => [
      header.key,
      header.value,
    ]),
  );

  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(
    headers.get("Referrer-Policy"),
    "strict-origin-when-cross-origin",
  );
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(headers.get("Permissions-Policy") || "", /camera=\(\)/);
});

test("coming-soon keeps its standalone default-deny CSP", () => {
  assert.match(COMING_SOON_CONTENT_SECURITY_POLICY, /default-src 'none'/);
  assert.match(COMING_SOON_CONTENT_SECURITY_POLICY, /style-src 'unsafe-inline'/);
  assert.match(COMING_SOON_CONTENT_SECURITY_POLICY, /form-action 'self'/);
  assert.doesNotMatch(COMING_SOON_CONTENT_SECURITY_POLICY, /script-src/);
});

function readDirectiveSources(policy: string, directive: string) {
  const value = policy
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${directive} `));
  assert.ok(value, `${directive} is missing`);
  return value.slice(directive.length).trim().split(/\s+/);
}
