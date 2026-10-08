import assert from "node:assert/strict";
import test from "node:test";
import {
  SecOfflineLocalTargetError,
  validateSecOfflineLocalEndpoints,
  withSecOfflineLocalCredentials,
} from "./localTarget.ts";
import { getServerEnv } from "../env.ts";

const valid = {
  expectedApiUrl: "http://127.0.0.1:56321",
  expectedDbUrl: "postgresql://127.0.0.1:56322/postgres",
  configuredApiUrl: "http://127.0.0.1:56321/rest/v1",
  statusApiUrl: "http://localhost:56321",
  statusDbUrl: "postgresql://postgres:different-local-secret@localhost:56322/postgres",
};

function expectCode(overrides: Partial<typeof valid>, code: string) {
  assert.throws(
    () => validateSecOfflineLocalEndpoints({ ...valid, ...overrides }),
    (error: unknown) => error instanceof SecOfflineLocalTargetError && error.code === code,
  );
}

test("accepts one explicit loopback API/DB pair regardless of local DB credentials", () => {
  assert.deepEqual(validateSecOfflineLocalEndpoints(valid), {
    apiUrl: "http://127.0.0.1:56321",
    dbHost: "loopback",
    dbPort: "56322",
    database: "postgres",
  });
});

test("rejects remote API or database targets", () => {
  expectCode({ expectedApiUrl: "https://example.com" }, "non_loopback_api_target_rejected");
  expectCode(
    { expectedDbUrl: "postgresql://postgres:x@example.com:5432/postgres" },
    "non_loopback_db_target_rejected",
  );
});

test("rejects configured API drift", () => {
  expectCode(
    { configuredApiUrl: "http://127.0.0.1:9999" },
    "configured_api_target_mismatch",
  );
});

test("unconfigured candidate accepts verified local endpoints, explicit remote configuration still fails", () => {
  assert.equal(validateSecOfflineLocalEndpoints({ ...valid, configuredApiUrl: "" }).apiUrl, valid.expectedApiUrl);
  expectCode({ configuredApiUrl: "https://example.com" }, "configured_api_target_mismatch");
});

test("local service credentials reach production env reader and restore prior values on success and failure", async () => {
  for (const original of [{}, { SUPABASE_URL: "old-url", SUPABASE_SECRET_KEY: "old-secret", SUPABASE_SERVICE_ROLE_KEY: "old-role" }]) {
    for (const reject of [false, true]) {
      const environment: Record<string, string | undefined> = { ...original };
      const before = { ...environment };
      const run = withSecOfflineLocalCredentials({ apiUrl: valid.expectedApiUrl, secretKey: "sb_secret_synthetic" }, async () => {
        const env = getServerEnv(environment);
        assert.equal(env.supabaseUrl, valid.expectedApiUrl);
        assert.equal(env.supabaseSecretKey, "sb_secret_synthetic");
        assert.equal(environment.SUPABASE_SERVICE_ROLE_KEY, undefined);
        if (reject) throw new Error("synthetic failure");
        return "done";
      }, environment);
      if (reject) await assert.rejects(run, /synthetic failure/);
      else assert.equal(await run, "done");
      assert.deepEqual(environment, before);
    }
  }
});

test("legacy local service-role fallback works; missing or wrong-role credentials fail before action", async () => {
  const legacy = `e30.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.synthetic`;
  const environment = {};
  await withSecOfflineLocalCredentials({ apiUrl: valid.expectedApiUrl, serviceRoleKey: legacy }, async () => {
    assert.equal(getServerEnv(environment).supabaseSecretKey, legacy);
  }, environment);
  assert.deepEqual(environment, {});
  for (const secretKey of [undefined, "sb_publishable_synthetic", "unknown-credential"]) {
    let calls = 0;
    await assert.rejects(withSecOfflineLocalCredentials({ apiUrl: valid.expectedApiUrl, secretKey }, async () => { calls++; }, environment),
      (error: unknown) => error instanceof SecOfflineLocalTargetError && error.code === "local_service_credential_invalid");
    assert.equal(calls, 0);
    assert.deepEqual(environment, {});
  }
});

test("rejects Supabase status API drift", () => {
  expectCode(
    { statusApiUrl: "http://127.0.0.1:9999" },
    "local_stack_api_target_mismatch",
  );
});

test("rejects Supabase status DB port or database drift", () => {
  expectCode(
    { statusDbUrl: "postgresql://postgres:x@127.0.0.1:9999/postgres" },
    "local_stack_db_target_mismatch",
  );
  expectCode(
    { statusDbUrl: "postgresql://postgres:x@127.0.0.1:56322/other" },
    "local_stack_db_target_mismatch",
  );
});

test("rejects malformed target URLs without exposing their contents", () => {
  expectCode({ expectedApiUrl: "not a URL" }, "api_url_invalid");
  expectCode({ expectedDbUrl: "not a URL" }, "db_url_invalid");
  expectCode({ statusDbUrl: "not a URL" }, "local_stack_db_url_invalid");
});
