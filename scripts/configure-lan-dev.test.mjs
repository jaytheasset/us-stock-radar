import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLanDevelopmentValues,
  rewriteLocalEnv,
  rewriteSupabaseAuthConfig,
} from "./configure-lan-dev-lib.mjs";

test("LAN values accept only a private IPv4 address", () => {
  assert.deepEqual(buildLanDevelopmentValues("192.168.50.25"), {
    appOrigin: "http://192.168.50.25:3110",
    supabaseOrigin: "http://192.168.50.25:56321",
    devAllowedOrigins:
      "http://192.168.50.25:3110,http://192.168.50.25:56321",
  });
  assert.throws(() => buildLanDevelopmentValues("8.8.8.8"), /RFC1918/);
  assert.throws(() => buildLanDevelopmentValues("example.com"), /IPv4/);
});

test("env rewrite preserves secrets and updates only local URL settings", () => {
  const secret = "SUPABASE_SERVICE_ROLE_KEY=do-not-log-or-change";
  const original = [
    secret,
    "OPENAI_API_KEY=also-unchanged",
    "SUPABASE_URL=http://127.0.0.1:56321",
    "APP_BASE_URL=https://us-stock-radar.com",
    "",
  ].join("\r\n");
  const values = buildLanDevelopmentValues("192.168.10.20");
  const rewritten = rewriteLocalEnv(original, values);

  assert.match(rewritten, new RegExp(secret));
  assert.match(rewritten, /OPENAI_API_KEY=also-unchanged/);
  assert.match(rewritten, /SUPABASE_URL=http:\/\/192\.168\.10\.20:56321/);
  assert.match(rewritten, /APP_BASE_URL=http:\/\/192\.168\.10\.20:3110/);
  assert.match(rewritten, /DEV_ALLOWED_ORIGINS=http:\/\/192\.168\.10\.20:3110,http:\/\/192\.168\.10\.20:56321/);
});

test("env rewrite uses the final active duplicate and leaves one target key", () => {
  const secret = "SUPABASE_SERVICE_ROLE_KEY=preserve-this-value";
  const original = [
    "SUPABASE_URL=https://hosted-project.supabase.co",
    secret,
    "SUPABASE_URL=http://127.0.0.1:56321",
    "APP_BASE_URL=https://us-stock-radar.com",
    "",
  ].join("\n");
  const rewritten = rewriteLocalEnv(
    original,
    buildLanDevelopmentValues("192.168.50.25"),
  );

  assert.equal(rewritten.match(/^SUPABASE_URL=/gm)?.length, 1);
  assert.match(rewritten, /SUPABASE_URL=http:\/\/192\.168\.50\.25:56321/);
  assert.match(rewritten, new RegExp(secret));
});

test("env rewrite rejects a final hosted duplicate even after a local value", () => {
  const original = [
    "SUPABASE_URL=http://127.0.0.1:56321",
    "SUPABASE_URL=https://hosted-project.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY=preserve-this-value",
    "",
  ].join("\n");

  assert.throws(
    () =>
      rewriteLocalEnv(
        original,
        buildLanDevelopmentValues("192.168.50.25"),
      ),
    /Refusing to overwrite a non-local SUPABASE_URL/,
  );
});

test("env rewrite refuses to replace a hosted Supabase URL", () => {
  const values = buildLanDevelopmentValues("10.0.0.8");
  assert.throws(
    () =>
      rewriteLocalEnv(
        "SUPABASE_URL=https://project.supabase.co\nSUPABASE_ANON_KEY=secret\n",
        values,
      ),
    /Refusing to overwrite a non-local SUPABASE_URL/,
  );
});

test("Supabase Auth rewrite uses exact LAN callbacks without wildcards", () => {
  const original = `[auth]\nsite_url = "http://127.0.0.1:3000"\nadditional_redirect_urls = [\n  "http://127.0.0.1:3110/auth/callback",\n  "http://localhost:4000/custom/callback",\n  "http://192.168.10.20:3110/auth/callback",\n  "http://localhost:5000/**",\n]\njwt_expiry = 3600\n\n[auth.email]\nenable_signup = true\n`;
  const rewritten = rewriteSupabaseAuthConfig(
    original,
    "http://192.168.50.25:3110",
  );

  assert.match(rewritten, /site_url = "http:\/\/192\.168\.50\.25:3110"/);
  assert.match(
    rewritten,
    /"http:\/\/192\.168\.50\.25:3110\/auth\/callback"/,
  );
  assert.match(
    rewritten,
    /"http:\/\/localhost:4000\/custom\/callback"/,
  );
  assert.match(
    rewritten,
    /"http:\/\/127\.0\.0\.1:3110\/auth\/callback"/,
  );
  assert.doesNotMatch(rewritten, /192\.168\.10\.20/);
  assert.doesNotMatch(rewritten, /\*/);
  assert.match(rewritten, /\[auth\.email\]/);
});
