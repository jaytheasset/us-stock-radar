import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import {
  resolveSupabasePublishableKey,
  resolveSupabaseSecretKey,
  supabaseServiceHeaders,
} from "./supabase-service-headers.mjs";

const require = createRequire(import.meta.url);
const { resolveSupabaseSecretKey: resolveCommonJsSecretKey } = require(
  "./supabase-key-env.cjs",
);

test("script key resolution prefers new keys and preserves fallback", () => {
  assert.equal(
    resolveSupabaseSecretKey({
      SUPABASE_SECRET_KEY: "sb_secret_new",
      SUPABASE_SERVICE_ROLE_KEY: "legacy-service-placeholder",
    }),
    "sb_secret_new",
  );
  assert.equal(
    resolveSupabasePublishableKey({ SUPABASE_ANON_KEY: "legacy-anon-placeholder" }),
    "legacy-anon-placeholder",
  );
});

test("script helpers reject wrong-role keys before making requests", () => {
  assert.throws(
    () => resolveSupabaseSecretKey({ SUPABASE_SECRET_KEY: "sb_publishable_wrong" }),
    /refusing privileged access/,
  );
  assert.throws(
    () =>
      resolveSupabasePublishableKey({
        SUPABASE_PUBLISHABLE_KEY: "sb_secret_wrong",
      }),
    /refusing public exposure/,
  );
});

test("script request headers omit bearer for new keys", () => {
  assert.deepEqual(supabaseServiceHeaders("sb_secret_new", { Accept: "application/json" }), {
    Accept: "application/json",
    apikey: "sb_secret_new",
  });
  assert.equal(
    supabaseServiceHeaders("legacy-service-placeholder").Authorization,
    "Bearer legacy-service-placeholder",
  );
});

test("CommonJS verification scripts share the same privileged role guard", () => {
  assert.equal(
    resolveCommonJsSecretKey({ SUPABASE_SECRET_KEY: "sb_secret_new" }),
    "sb_secret_new",
  );
  assert.throws(
    () => resolveCommonJsSecretKey({ SUPABASE_SECRET_KEY: "sb_publishable_wrong" }),
    /refusing privileged access/,
  );
});
