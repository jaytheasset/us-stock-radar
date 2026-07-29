import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

import { calendarEventTypeManifest } from "../lib/calendar-v1/taxonomyManifest.ts";

const { Client } = pg;
const config = readFileSync("supabase/config.toml", "utf8");
const portMatch = config.match(/\[db\][\s\S]*?\bport\s*=\s*(\d+)/);
assert.ok(portMatch, "supabase/config.toml must declare the local DB port");

const expectedTables = [
  "calendar_alert_candidates",
  "calendar_delivery_attempts",
  "calendar_event_details",
  "calendar_event_history",
  "calendar_event_metrics",
  "calendar_event_sectors",
  "calendar_event_securities",
  "calendar_event_sources",
  "calendar_event_types",
  "calendar_events",
  "calendar_provider_payloads",
  "calendar_reminder_rules",
  "user_calendar_event_follows",
];

const expectedPolicyNames = [
  "calendar_reminder_rules_delete_own",
  "calendar_reminder_rules_insert_own",
  "calendar_reminder_rules_select_own",
  "calendar_reminder_rules_update_own",
  "user_calendar_event_follows_delete_own",
  "user_calendar_event_follows_insert_own",
  "user_calendar_event_follows_select_own",
  "user_calendar_event_follows_update_own",
];

const requiredConstraints = [
  "calendar_alert_candidates_kind_check",
  "calendar_alert_candidates_status_check",
  "calendar_delivery_attempts_channel_check",
  "calendar_delivery_attempts_idempotency_key_key",
  "calendar_delivery_attempts_status_check",
  "calendar_event_details_object_check",
  "calendar_event_history_change_kind_check",
  "calendar_event_history_observation_key",
  "calendar_event_history_revision_key",
  "calendar_event_metrics_release_stage_check",
  "calendar_event_sources_confidence_check",
  "calendar_event_types_category_check",
  "calendar_event_types_policy_subcategory_check",
  "calendar_events_canonical_identity_key_key",
  "calendar_events_impact_level_check",
  "calendar_events_impact_scope_check",
  "calendar_events_lifecycle_status_check",
  "calendar_events_market_session_check",
  "calendar_events_schedule_confidence_check",
  "calendar_events_time_status_check",
  "calendar_provider_payloads_prelaunch_purge_check",
  "calendar_provider_payloads_retention_mode_check",
  "calendar_reminder_rules_channel_check",
  "calendar_reminder_rules_identity_key",
  "user_calendar_event_follows_user_event_key",
];

const requiredIndexes = [
  "calendar_alert_candidates_pending_idx",
  "calendar_delivery_attempts_retry_idx",
  "calendar_event_history_event_observed_idx",
  "calendar_event_metrics_event_idx",
  "calendar_event_sectors_sector_idx",
  "calendar_event_securities_primary_uidx",
  "calendar_event_securities_ticker_idx",
  "calendar_event_sources_event_idx",
  "calendar_event_sources_provider_key_uidx",
  "calendar_events_category_date_idx",
  "calendar_events_instant_idx",
  "calendar_events_lifecycle_date_idx",
  "calendar_events_type_date_idx",
  "calendar_provider_payloads_provider_fetched_idx",
  "calendar_reminder_rules_enabled_idx",
  "user_calendar_event_follows_event_idx",
];

const serverOnlyTables = expectedTables.filter(
  (table) =>
    table !== "user_calendar_event_follows" &&
    table !== "calendar_reminder_rules",
);

const client = new Client({
  host: "127.0.0.1",
  port: Number(portMatch[1]),
  user: "postgres",
  password: "postgres",
  database: "postgres",
});

let passed = 0;

async function check(name, test) {
  await test();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

async function expectDatabaseError(name, expectedCode, query, values = []) {
  await client.query(`savepoint "${name}"`);
  try {
    await client.query(query, values);
    assert.fail(`${name} should fail with PostgreSQL error ${expectedCode}`);
  } catch (error) {
    assert.equal(error.code, expectedCode, `${name} returned ${error.code}`);
  } finally {
    await client.query(`rollback to savepoint "${name}"`);
    await client.query(`release savepoint "${name}"`);
  }
}

async function setRole(role, userId = null) {
  await client.query(`set local role ${role}`);
  if (userId) {
    await client.query(
      "select pg_catalog.set_config('request.jwt.claim.sub', $1, true)",
      [userId],
    );
  }
}

async function resetRole() {
  await client.query("reset role");
  await client.query(
    "select pg_catalog.set_config('request.jwt.claim.sub', '', true)",
  );
}

await client.connect();
await client.query("begin");

try {
  await check("all normalized Calendar tables exist", async () => {
    const result = await client.query(
      `select tablename
       from pg_catalog.pg_tables
       where schemaname = 'public'
         and tablename = any($1::text[])
       order by tablename`,
      [expectedTables],
    );
    assert.deepEqual(
      result.rows.map((row) => row.tablename),
      expectedTables,
    );
  });

  await check("all exposed Calendar tables have RLS enabled", async () => {
    const result = await client.query(
      `select c.relname
       from pg_catalog.pg_class as c
       join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = any($1::text[])
         and c.relrowsecurity
       order by c.relname`,
      [expectedTables],
    );
    assert.deepEqual(
      result.rows.map((row) => row.relname),
      expectedTables,
    );
  });

  await check("Calendar taxonomy matches the TypeScript manifest", async () => {
    const result = await client.query(
      `select
         event_type as "eventType",
         category,
         policy_subcategory as "policySubcategory",
         label,
         schema_version as "schemaVersion"
       from public.calendar_event_types
       order by event_type`,
    );
    const expected = [...calendarEventTypeManifest].sort((left, right) =>
      left.eventType.localeCompare(right.eventType),
    );
    assert.equal(result.rows.length, 22);
    assert.deepEqual(result.rows, expected);
  });

  await check("required closed constraints and identity keys exist", async () => {
    const result = await client.query(
      `select conname
       from pg_catalog.pg_constraint
       where connamespace = 'public'::regnamespace
         and conname = any($1::text[])
       order by conname`,
      [requiredConstraints],
    );
    assert.deepEqual(
      result.rows.map((row) => row.conname),
      [...requiredConstraints].sort(),
    );
  });

  await check("required access-path and partial indexes exist", async () => {
    const result = await client.query(
      `select indexname
       from pg_catalog.pg_indexes
       where schemaname = 'public'
         and indexname = any($1::text[])
       order by indexname`,
      [requiredIndexes],
    );
    assert.deepEqual(
      result.rows.map((row) => row.indexname),
      [...requiredIndexes].sort(),
    );
  });

  await check("foreign-key delete actions preserve durable history", async () => {
    const result = await client.query(
      `select conname, confdeltype
       from pg_catalog.pg_constraint
       where conname = any($1::text[])
       order by conname`,
      [[
        "calendar_delivery_attempts_candidate_id_fkey",
        "calendar_delivery_attempts_follow_id_fkey",
        "calendar_delivery_attempts_user_id_fkey",
        "calendar_event_sources_raw_payload_id_fkey",
        "calendar_reminder_rules_follow_id_fkey",
        "user_calendar_event_follows_event_id_fkey",
        "user_calendar_event_follows_user_id_fkey",
      ]],
    );
    assert.deepEqual(result.rows, [
      { conname: "calendar_delivery_attempts_candidate_id_fkey", confdeltype: "r" },
      { conname: "calendar_delivery_attempts_follow_id_fkey", confdeltype: "n" },
      { conname: "calendar_delivery_attempts_user_id_fkey", confdeltype: "n" },
      { conname: "calendar_event_sources_raw_payload_id_fkey", confdeltype: "n" },
      { conname: "calendar_reminder_rules_follow_id_fkey", confdeltype: "c" },
      { conname: "user_calendar_event_follows_event_id_fkey", confdeltype: "r" },
      { conname: "user_calendar_event_follows_user_id_fkey", confdeltype: "c" },
    ]);
  });

  await check("only follow and reminder ownership policies are installed", async () => {
    const result = await client.query(
      `select policyname
       from pg_catalog.pg_policies
       where schemaname = 'public'
         and tablename = any($1::text[])
       order by policyname`,
      [expectedTables],
    );
    assert.deepEqual(
      result.rows.map((row) => row.policyname),
      expectedPolicyNames,
    );
  });

  await check("service_role has explicit CRUD on every Calendar table", async () => {
    const result = await client.query(
      `select table_name,
         pg_catalog.has_table_privilege(
           'service_role',
           pg_catalog.format('public.%I', table_name),
           'SELECT,INSERT,UPDATE,DELETE'
         ) as allowed
       from pg_catalog.unnest($1::text[]) as table_name
       order by table_name`,
      [expectedTables],
    );
    assert.ok(result.rows.every((row) => row.allowed));
  });

  await check("browser roles have least-privilege table grants", async () => {
    const result = await client.query(
      `select
         table_name,
         pg_catalog.has_any_column_privilege(
           'anon',
           pg_catalog.format('public.%I', table_name),
           'SELECT,INSERT,UPDATE,REFERENCES'
         ) as anon_allowed,
         pg_catalog.has_table_privilege(
           'authenticated',
           pg_catalog.format('public.%I', table_name),
           'SELECT,INSERT,UPDATE,DELETE'
         ) as authenticated_crud
       from pg_catalog.unnest($1::text[]) as table_name
       order by table_name`,
      [expectedTables],
    );
    assert.ok(result.rows.every((row) => !row.anon_allowed));
    assert.deepEqual(
      result.rows
        .filter((row) => row.authenticated_crud)
        .map((row) => row.table_name),
      ["calendar_reminder_rules", "user_calendar_event_follows"],
    );
  });

  const userA = randomUUID();
  const userB = randomUUID();
  const eventId = randomUUID();
  const payloadId = randomUUID();
  const sourceId = randomUUID();
  const candidateId = randomUUID();

  await setRole("service_role");
  await client.query(
    `insert into public.user_profiles (id, email)
     values ($1, $2), ($3, $4)`,
    [userA, `calendar-a-${userA}@example.test`, userB, `calendar-b-${userB}@example.test`],
  );
  await client.query(
    `insert into public.calendar_provider_payloads (
       id, provider, request_window_start, request_window_end, payload,
       checksum, fetched_at, ingested_run_id
     )
     values ($1, 'fmp', date '2026-07-01', date '2026-07-31',
       '{"symbol":"TEST"}'::jsonb, 'raw-checksum', pg_catalog.now(), 'calendar-schema-test')`,
    [payloadId],
  );
  const retention = await client.query(
    `select retention_mode, purge_after, is_development_data
     from public.calendar_provider_payloads
     where id = $1`,
    [payloadId],
  );
  await client.query(
    `insert into public.calendar_events (
       id, canonical_identity_key, event_type, category, title, event_date,
       event_time, event_timezone, event_instant, time_status, market_session,
       lifecycle_status, schedule_confidence, impact_level, impact_scope
     )
     values (
       $1, 'test:cpi:2026-07-release', 'cpi', 'macro', 'CPI test release',
       date '2026-07-15', time '08:30', 'America/New_York',
       timestamptz '2026-07-15 12:30:00+00', 'exact', 'bmo',
       'scheduled', 'confirmed', 'high', 'market-wide'
     )`,
    [eventId],
  );
  await client.query(
    `insert into public.calendar_event_sources (
       id, event_id, provider, source_agency, source_name, source_event_key,
       fetched_at, checksum, confidence, raw_payload_id
     )
     values (
       $1, $2, 'fmp', 'BLS', 'CPI calendar', 'fmp:cpi:2026-07',
       pg_catalog.now(), 'source-checksum', 'medium', $3
     )`,
    [sourceId, eventId, payloadId],
  );
  await client.query(
    `insert into public.calendar_event_securities (event_id, ticker, role)
     values ($1, 'SPY', 'related')`,
    [eventId],
  );
  await client.query(
    `insert into public.calendar_event_sectors (event_id, sector, role)
     values ($1, 'Consumer Cyclical', 'affected')`,
    [eventId],
  );
  await client.query(
    `insert into public.calendar_event_metrics (
       event_id, metric_key, name, consensus, previous, unit, unit_raw,
       release_stage, released
     )
     values ($1, 'headline-mom', 'Headline CPI MoM', 0.2, 0.1, 'percent', '%',
       'monthly', false)`,
    [eventId],
  );
  await client.query(
    `insert into public.calendar_event_details (event_id, detail)
     values ($1, '{"referencePeriod":"June 2026"}'::jsonb)`,
    [eventId],
  );
  await client.query(
    `insert into public.calendar_event_history (
       event_id, revision, change_kind, after_schedule,
       observation_fingerprint, source_id
     )
     values (
       $1, 1, 'registered', '{"eventDate":"2026-07-15"}'::jsonb,
       'observation-1', $2
     )`,
    [eventId, sourceId],
  );
  await client.query(
    `insert into public.calendar_alert_candidates (
       id, event_id, event_revision, candidate_kind, candidate_key
     )
     values ($1, $2, 1, 'event-registered', 'candidate:event-registered:1')`,
    [candidateId, eventId],
  );
  await client.query(
    `update public.calendar_events
     set last_seen_at = pg_catalog.now(), updated_at = pg_catalog.now()
     where id = $1`,
    [eventId],
  );
  await resetRole();

  await check("service-only raw archive defaults to prelaunch long-term retention", async () => {
    assert.deepEqual(retention.rows, [
      {
        retention_mode: "prelaunch_long_term",
        purge_after: null,
        is_development_data: true,
      },
    ]);
  });

  await setRole("anon");
  await check("anon cannot read events, raw payloads, or outbox rows", async () => {
    for (const table of [
      "calendar_events",
      "calendar_provider_payloads",
      "calendar_alert_candidates",
    ]) {
      await expectDatabaseError(
        `anon_${table}`,
        "42501",
        `select * from public.${table} limit 1`,
      );
    }
  });
  await resetRole();

  await setRole("authenticated", userA);
  const followA = await client.query(
    `insert into public.user_calendar_event_follows (user_id, event_id)
     values ($1, $2)
     returning id`,
    [userA, eventId],
  );
  const followAId = followA.rows[0].id;
  const reminderA = await client.query(
    `insert into public.calendar_reminder_rules (follow_id, minutes_before, channel)
     values ($1, 60, 'web')
     returning id`,
    [followAId],
  );
  const reminderAId = reminderA.rows[0].id;
  await client.query(
    `update public.user_calendar_event_follows
     set enabled = false, updated_at = pg_catalog.now()
     where id = $1`,
    [followAId],
  );
  await client.query(
    `update public.calendar_reminder_rules
     set minutes_before = 90, updated_at = pg_catalog.now()
     where id = $1`,
    [reminderAId],
  );
  await resetRole();

  await setRole("authenticated", userB);
  const followB = await client.query(
    `insert into public.user_calendar_event_follows (user_id, event_id)
     values ($1, $2)
     returning id`,
    [userB, eventId],
  );
  await check("user B cannot select, update, or delete user A follow rows", async () => {
    const selected = await client.query(
      "select id from public.user_calendar_event_follows where id = $1",
      [followAId],
    );
    const updated = await client.query(
      "update public.user_calendar_event_follows set enabled = true where id = $1",
      [followAId],
    );
    const deleted = await client.query(
      "delete from public.user_calendar_event_follows where id = $1",
      [followAId],
    );
    assert.equal(selected.rowCount, 0);
    assert.equal(updated.rowCount, 0);
    assert.equal(deleted.rowCount, 0);
  });
  await check("reminder ownership blocks IDOR through another user's follow", async () => {
    const selected = await client.query(
      "select id from public.calendar_reminder_rules where id = $1",
      [reminderAId],
    );
    assert.equal(selected.rowCount, 0);
    await expectDatabaseError(
      "reminder_idor_insert",
      "42501",
      `insert into public.calendar_reminder_rules
       (follow_id, minutes_before, channel)
       values ($1, 120, 'web')`,
      [followAId],
    );
  });
  await resetRole();

  await setRole("authenticated", userA);
  await check("user A can read and delete owned reminder rows", async () => {
    const selected = await client.query(
      "select minutes_before from public.calendar_reminder_rules where id = $1",
      [reminderAId],
    );
    assert.deepEqual(selected.rows, [{ minutes_before: 90 }]);
    const deleted = await client.query(
      "delete from public.calendar_reminder_rules where id = $1",
      [reminderAId],
    );
    assert.equal(deleted.rowCount, 1);
  });
  await resetRole();

  await setRole("service_role");
  const deliveryId = randomUUID();
  await client.query(
    `insert into public.calendar_delivery_attempts (
       id, candidate_id, follow_id, user_id, channel, attempt_number,
       idempotency_key
     )
     values ($1, $2, $3, $4, 'web', 1, 'delivery:candidate:1:web')`,
    [deliveryId, candidateId, followAId, userA],
  );
  await resetRole();

  await setRole("authenticated", userA);
  const deletedFollow = await client.query(
    "delete from public.user_calendar_event_follows where id = $1",
    [followAId],
  );
  assert.equal(deletedFollow.rowCount, 1);
  await resetRole();

  await setRole("service_role");
  await check("deleting a follow preserves delivery history and clears its reference", async () => {
    const result = await client.query(
      "select follow_id from public.calendar_delivery_attempts where id = $1",
      [deliveryId],
    );
    assert.deepEqual(result.rows, [{ follow_id: null }]);
  });

  await check("canonical identity blocks reschedule duplicates", async () => {
    await expectDatabaseError(
      "duplicate_canonical_identity",
      "23505",
      `insert into public.calendar_events (
         canonical_identity_key, event_type, category, title, event_date,
         event_time, time_status, market_session, lifecycle_status,
         schedule_confidence, impact_level, impact_scope
       )
       values (
         'test:cpi:2026-07-release', 'cpi', 'macro', 'Rescheduled duplicate',
         date '2026-07-16', time '08:30', 'exact', 'bmo', 'scheduled',
         'confirmed', 'high', 'market-wide'
       )`,
    );
  });

  await check("provider and source event key block duplicate observations", async () => {
    await expectDatabaseError(
      "duplicate_provider_source_key",
      "23505",
      `insert into public.calendar_event_sources (
         event_id, provider, source_agency, source_name, source_event_key,
         fetched_at, checksum, confidence
       )
       values (
         $1, 'fmp', 'BLS', 'Duplicate CPI', 'fmp:cpi:2026-07',
         pg_catalog.now(), 'duplicate-checksum', 'medium'
       )`,
      [eventId],
    );
  });

  await check("history fingerprint makes observation processing idempotent", async () => {
    await expectDatabaseError(
      "duplicate_history_fingerprint",
      "23505",
      `insert into public.calendar_event_history (
         event_id, revision, change_kind, after_schedule, observation_fingerprint
       )
       values (
         $1, 2, 'schedule-changed', '{"eventDate":"2026-07-16"}'::jsonb,
         'observation-1'
       )`,
      [eventId],
    );
  });

  await check("event type and category cannot form a contradictory pair", async () => {
    await expectDatabaseError(
      "contradictory_event_category",
      "23503",
      `insert into public.calendar_events (
         canonical_identity_key, event_type, category, title, event_date,
         event_time, time_status, market_session, lifecycle_status,
         schedule_confidence, impact_level, impact_scope
       )
       values (
         'test:bad-category', 'cpi', 'company', 'Invalid category',
         date '2026-07-15', time '08:30', 'exact', 'bmo', 'scheduled',
         'confirmed', 'high', 'market-wide'
       )`,
    );
  });

  await check("the taxonomy seed is explicitly idempotent", async () => {
    const migration = readFileSync(
      "supabase/migrations/20260729193519_normalized_calendar_schema.sql",
      "utf8",
    );
    assert.match(migration, /on conflict \(event_type\) do update/i);
    assert.equal(
      new Set(calendarEventTypeManifest.map((entry) => entry.eventType)).size,
      22,
    );
  });

  await resetRole();
  await client.query("rollback");
  console.log(`1..${passed}`);
  console.log(`calendar schema verification passed (${passed} contracts)`);
} catch (error) {
  await client.query("rollback");
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}
