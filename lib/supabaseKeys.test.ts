import assert from "node:assert/strict";
import test from "node:test";
import {
  classifySupabaseApiKey,
  resolveSupabasePublishableKey,
  resolveSupabaseSecretKey,
  supabaseApiKeyHeaders,
} from "./supabaseKeys.ts";

test("new Supabase keys take precedence over staged legacy fallbacks", () => {
  assert.deepEqual(
    resolveSupabasePublishableKey({
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_preferred",
      SUPABASE_ANON_KEY: legacyKey("anon"),
    }),
    {
      key: "sb_publishable_preferred",
      source: "SUPABASE_PUBLISHABLE_KEY",
      error: null,
    },
  );
  assert.deepEqual(
    resolveSupabaseSecretKey({
      SUPABASE_SECRET_KEY: "sb_secret_preferred",
      SUPABASE_SERVICE_ROLE_KEY: legacyKey("service_role"),
    }),
    {
      key: "sb_secret_preferred",
      source: "SUPABASE_SECRET_KEY",
      error: null,
    },
  );
});

test("legacy anon and service_role keys remain supported as explicit fallbacks", () => {
  const anon = legacyKey("anon");
  const serviceRole = legacyKey("service_role");
  assert.equal(classifySupabaseApiKey(anon), "legacy-publishable");
  assert.equal(classifySupabaseApiKey(serviceRole), "legacy-secret");
  assert.equal(resolveSupabasePublishableKey({ SUPABASE_ANON_KEY: anon }).key, anon);
  assert.equal(
    resolveSupabaseSecretKey({ SUPABASE_SERVICE_ROLE_KEY: serviceRole }).key,
    serviceRole,
  );
});

test("wrong-role values fail closed and do not silently fall back", () => {
  assert.deepEqual(
    resolveSupabaseSecretKey({
      SUPABASE_SECRET_KEY: "sb_publishable_wrong",
      SUPABASE_SERVICE_ROLE_KEY: legacyKey("service_role"),
    }),
    {
      key: "",
      source: "SUPABASE_SECRET_KEY",
      error: "wrong-role",
    },
  );
  assert.deepEqual(
    resolveSupabasePublishableKey({
      SUPABASE_PUBLISHABLE_KEY: "sb_secret_wrong",
      SUPABASE_ANON_KEY: legacyKey("anon"),
    }),
    {
      key: "",
      source: "SUPABASE_PUBLISHABLE_KEY",
      error: "wrong-role",
    },
  );
  assert.equal(
    resolveSupabasePublishableKey({
      SUPABASE_ANON_KEY: legacyKey("service_role"),
    }).error,
    "wrong-role",
  );
  assert.equal(
    resolveSupabaseSecretKey({
      SUPABASE_SERVICE_ROLE_KEY: legacyKey("anon"),
    }).error,
    "wrong-role",
  );
});

test("new API keys use apikey while user JWTs retain Authorization", () => {
  assert.deepEqual(
    supabaseApiKeyHeaders({
      apiKey: "sb_publishable_public",
      headers: { Accept: "application/json" },
    }),
    {
      Accept: "application/json",
      apikey: "sb_publishable_public",
    },
  );
  assert.deepEqual(
    supabaseApiKeyHeaders({
      apiKey: "sb_secret_server",
      headers: { Accept: "application/json" },
    }),
    {
      Accept: "application/json",
      apikey: "sb_secret_server",
    },
  );
  assert.deepEqual(
    supabaseApiKeyHeaders({
      accessToken: "signed-in-user-jwt",
      apiKey: "sb_publishable_public",
    }),
    {
      apikey: "sb_publishable_public",
      Authorization: "Bearer signed-in-user-jwt",
    },
  );
});

test("legacy keys retain bearer compatibility without changing user JWT priority", () => {
  const legacyService = legacyKey("service_role");
  assert.equal(
    supabaseApiKeyHeaders({ apiKey: legacyService }).Authorization,
    `Bearer ${legacyService}`,
  );
  assert.equal(
    supabaseApiKeyHeaders({
      apiKey: legacyKey("anon"),
      accessToken: "signed-in-user-jwt",
    }).Authorization,
    "Bearer signed-in-user-jwt",
  );
});

function legacyKey(role: "anon" | "service_role") {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ role })}.test-signature`;
}
