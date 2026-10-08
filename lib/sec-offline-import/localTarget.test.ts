import assert from "node:assert/strict";
import test from "node:test";
import {
  SecOfflineLocalTargetError,
  validateSecOfflineLocalEndpoints,
} from "./localTarget.ts";

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
