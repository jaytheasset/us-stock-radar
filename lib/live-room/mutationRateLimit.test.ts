import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { LiveRoomPolicyError } from "./policy.ts";
import {
  assertLiveRoomMutationRateLimitResult,
  buildLiveRoomRateLimitActorKey,
  LIVE_ROOM_MUTATION_RATE_LIMITS,
} from "./mutationRateLimitPolicy.ts";

const migration = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260802061240_live_room_mutation_rate_limits.sql",
      import.meta.url,
    ),
  ),
  "utf8",
);

test("fixed policy constants match the database contract", () => {
  assert.deepEqual(LIVE_ROOM_MUTATION_RATE_LIMITS, {
    follow: { limit: 60, windowSeconds: 600 },
    like: { limit: 120, windowSeconds: 300 },
    report: { limit: 10, windowSeconds: 3600 },
  });
  assert.match(migration, /when 'follow'[\s\S]*v_limit := 60;[\s\S]*v_window_seconds := 600;/i);
  assert.match(migration, /when 'like'[\s\S]*v_limit := 120;[\s\S]*v_window_seconds := 300;/i);
  assert.match(migration, /when 'report'[\s\S]*v_limit := 10;[\s\S]*v_window_seconds := 3600;/i);
});

test("migration provides an atomic service-role-only RLS bucket", () => {
  assert.match(migration, /primary key \(actor_key, action\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /force row level security/i);
  assert.match(migration, /on conflict \(actor_key, action\) do update/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /set search_path = pg_catalog, public/i);
  assert.match(migration, /revoke all on table[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant select, insert, update[\s\S]*to service_role/i);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function[\s\S]*to service_role/i);
});

test("actor keys are derived only from the resolved server actor", () => {
  assert.equal(
    buildLiveRoomRateLimitActorKey({
      kind: "member",
      userId: "00000000-0000-4000-8000-000000000001",
      email: null,
    }),
    "member:00000000-0000-4000-8000-000000000001",
  );
  assert.equal(
    buildLiveRoomRateLimitActorKey({
      kind: "guest",
      guestSessionId: "00000000-0000-4000-8000-000000000002",
    }),
    "guest:00000000-0000-4000-8000-000000000002",
  );
});

test("denial maps to the shared 429 and Retry-After policy contract", async () => {
  await assert.rejects(
    Promise.resolve().then(() => assertLiveRoomMutationRateLimitResult(
      {
        data: [{ allowed: false, retry_after_seconds: 91.2 }],
        ok: true,
        status: 200,
      },
      "report",
    )),
    (error: unknown) => {
      assert.ok(error instanceof LiveRoomPolicyError);
      assert.equal(error.code, "LIVE_ROOM_REPORT_RATE_LIMITED");
      assert.equal(error.status, 429);
      assert.equal(error.retryAfterSeconds, 92);
      return true;
    },
  );
});

test("database failures fail closed without leaking provider detail", async () => {
  await assert.rejects(
    Promise.resolve().then(() => assertLiveRoomMutationRateLimitResult(
      {
        data: null,
        error: "sensitive database detail",
        ok: false,
        status: 503,
      },
      "like",
    )),
    (error: unknown) => {
      assert.ok(error instanceof LiveRoomPolicyError);
      assert.equal(error.code, "LIVE_ROOM_RATE_LIMIT_UNAVAILABLE");
      assert.equal(error.status, 503);
      assert.doesNotMatch(error.message, /sensitive/i);
      return true;
    },
  );
});
