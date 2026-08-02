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

  assert.match(policy, /script-src[^;]+'unsafe-inline'/);
  assert.doesNotMatch(policy, /'unsafe-eval'/);
  assert.match(policy, /https:\/\/pagead2\.googlesyndication\.com/);
  assert.match(policy, /https:\/\/static\.klipy\.com/);
  assert.match(policy, /https:\/\/project\.supabase\.co/);
  assert.match(policy, /wss:\/\/project\.supabase\.co/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /form-action 'self'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.doesNotMatch(policy, /(?:^|\s)https:(?:\s|;|$)/);
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
