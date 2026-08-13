import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  consumeListingMonitorAlertsForEvent,
} from "../lib/monitor/listingMonitorAlertConsumer.ts";
import { listActiveListingMonitorsForConsumer } from "../lib/monitor/listingMonitorPersistence.ts";
import {
  readCurrentListingRiskFacts,
} from "../lib/monitor/listingRiskPersistence.ts";

const { Client } = pg;
const ATPC_EVENT_ID = "29f5fe0d-8171-458c-bfb0-baacb6495e13";
const CUPR_EVENT_ID = "920c6119-c33d-410c-9dff-18d1933b7bca";
const OWNER_A = "96000000-0000-4000-8000-000000000001";
const OWNER_B = "96000000-0000-4000-8000-000000000002";
const MONITOR_A = "96100000-0000-4000-8000-000000000011";
const MONITOR_B = "96100000-0000-4000-8000-000000000012";
const PAUSED = "96100000-0000-4000-8000-000000000013";
const INVALID = "96100000-0000-4000-8000-000000000014";
const INELIGIBLE = "96100000-0000-4000-8000-000000000015";
const FOREIGN = "96100000-0000-4000-8000-000000000016";
const CONCURRENT = "96100000-0000-4000-8000-000000000017";
const CUPR_MATCH = "96100000-0000-4000-8000-000000000018";
const REST_DEDUPE = "96100000-0000-4000-8000-000000000019";
const REANALYSIS_DEDUPE = "96100000-0000-4000-8000-000000000020";
const OTHER_ATPC_SOURCE_EXECUTION_ID = "696bc839-6355-57e8-a758-98954c23acb6";
const TEST_USERS = [OWNER_A, OWNER_B];

const admin = new Client({ connectionString: localDatabaseUrl() });
await admin.connect();

try {
  await cleanup(admin);
  await createUsers(admin);
  await createBaseMonitors(admin);

  const firstHarness = consumerDependencies(admin);
  const first = await consumeListingMonitorAlertsForEvent({ eventId: ATPC_EVENT_ID }, firstHarness.dependencies);
  assert.equal(firstHarness.readCount(), 1, "ATPC official reader is called once");
  assert.equal(first.readerStatus, "available");
  assert.equal(first.createdCount, 2, "owner A and foreign owner matching monitors create Alerts");
  assert.equal(first.failedCount, 0);
  assert.deepEqual(statusFor(first, MONITOR_A), ["match", "all_conditions_match"]);
  assert.deepEqual(statusFor(first, MONITOR_B), ["no_match", "condition_not_met"]);
  assert.deepEqual(statusFor(first, INELIGIBLE), ["ineligible", "fact_unavailable"]);
  assert.equal(first.diagnostics.some((item) => item.id === INVALID), true);
  assert.equal(first.evaluations.some((item) => item.monitorId === PAUSED), false);
  assert.equal(await alertCount(admin, MONITOR_A, ATPC_EVENT_ID), 1);

  const dueListingRows = await admin.query(
    `select count(*)::integer as count
     from public.user_alert_deliveries
     where listing_monitor_id is not null
       and delivery_status = 'queued'
       and scheduled_for <= now()`,
  );
  assert.equal(dueListingRows.rows[0].count, 0, "existing delivery claim predicate excludes Listing Alerts");

  await insertMonitor(admin, REST_DEDUPE, OWNER_A, matchAtpc(), true);
  const localSupabase = readLocalSupabaseCredentials();
  const restOutcomes = await Promise.all([
      createListingMonitorAlertViaLocalPostgrest(localSupabase, {
        eventId: ATPC_EVENT_ID,
        sourceExecutionId: OTHER_ATPC_SOURCE_EXECUTION_ID,
        monitorId: REST_DEDUPE,
        userId: OWNER_A,
        createdAt: "2026-08-14T00:00:00.000Z",
      }),
      createListingMonitorAlertViaLocalPostgrest(localSupabase, {
        eventId: ATPC_EVENT_ID,
        sourceExecutionId: first.sourceExecutionId,
        monitorId: REST_DEDUPE,
        userId: OWNER_A,
        createdAt: "2026-08-14T00:00:00.000Z",
      }),
  ]);
  assert.deepEqual(restOutcomes.map((item) => item.status).sort(), ["created", "existing"]);
  assert.equal(await alertCount(admin, REST_DEDUPE, ATPC_EVENT_ID), 1);
  const restProvenance = await alertSourceExecution(admin, REST_DEDUPE, ATPC_EVENT_ID);
  assert.equal(
    [first.sourceExecutionId, OTHER_ATPC_SOURCE_EXECUTION_ID].includes(restProvenance),
    true,
    "the winning PostgREST insert retains its source execution as provenance",
  );
  assert.equal(await alertCount(admin, MONITOR_B, ATPC_EVENT_ID), 0);
  assert.equal(await alertCount(admin, PAUSED, ATPC_EVENT_ID), 0);
  assert.equal(await alertCount(admin, INVALID, ATPC_EVENT_ID), 0);
  assert.equal(await alertCount(admin, INELIGIBLE, ATPC_EVENT_ID), 0);
  assert.equal(await alertCount(admin, FOREIGN, ATPC_EVENT_ID), 1);

  const replay = await consumeListingMonitorAlertsForEvent({ eventId: ATPC_EVENT_ID }, firstHarness.dependencies);
  assert.equal(firstHarness.readCount(), 2, "replay performs exactly one new official read");
  assert.equal(replay.createdCount, 0);
  assert.equal(replay.existingCount, 3);
  assert.equal(await alertCount(admin, MONITOR_A, ATPC_EVENT_ID), 1);

  await verifyOwnershipIsolation();

  await insertMonitor(admin, CONCURRENT, OWNER_A, matchAtpc(), true);
  const clientA = new Client({ connectionString: localDatabaseUrl() });
  const clientB = new Client({ connectionString: localDatabaseUrl() });
  await Promise.all([clientA.connect(), clientB.connect()]);
  try {
    const harnessA = consumerDependencies(clientA);
    const harnessB = consumerDependencies(clientB);
    const concurrent = await Promise.all([
      consumeListingMonitorAlertsForEvent({ eventId: ATPC_EVENT_ID }, harnessA.dependencies),
      consumeListingMonitorAlertsForEvent({ eventId: ATPC_EVENT_ID }, harnessB.dependencies),
    ]);
    assert.equal(harnessA.readCount(), 1);
    assert.equal(harnessB.readCount(), 1);
    assert.equal(await alertCount(admin, CONCURRENT, ATPC_EVENT_ID), 1);
    const concurrentOutcomes = concurrent.flatMap((result) => result.writes)
      .filter((write) => write.monitorId === CONCURRENT)
      .map((write) => write.status)
      .sort();
    assert.deepEqual(concurrentOutcomes, ["created", "existing"]);

    await insertMonitor(admin, REANALYSIS_DEDUPE, OWNER_A, matchAtpc(), true);
    const reanalysisOutcomes = await Promise.all([
      insertListingAlertAtomic(clientA, {
        eventId: ATPC_EVENT_ID,
        sourceExecutionId: first.sourceExecutionId,
        monitorId: REANALYSIS_DEDUPE,
        userId: OWNER_A,
        createdAt: "2026-08-14T00:00:00.000Z",
      }),
      insertListingAlertAtomic(clientB, {
        eventId: ATPC_EVENT_ID,
        sourceExecutionId: OTHER_ATPC_SOURCE_EXECUTION_ID,
        monitorId: REANALYSIS_DEDUPE,
        userId: OWNER_A,
        createdAt: "2026-08-14T00:00:00.000Z",
      }),
    ]);
    assert.deepEqual(reanalysisOutcomes.map((item) => item.status).sort(), ["created", "existing"]);
    assert.equal(await alertCount(admin, REANALYSIS_DEDUPE, ATPC_EVENT_ID), 1);
    const reanalysisProvenance = await alertSourceExecution(
      admin,
      REANALYSIS_DEDUPE,
      ATPC_EVENT_ID,
    );
    assert.equal(
      [first.sourceExecutionId, OTHER_ATPC_SOURCE_EXECUTION_ID].includes(reanalysisProvenance),
      true,
      "one independently committed source execution remains as provenance",
    );
  } finally {
    await Promise.all([clientA.end(), clientB.end()]);
  }

  await insertMonitor(admin, CUPR_MATCH, OWNER_A, [
    { key: "listing.event_kind", operator: "eq", value: "compliance_recovery" },
    { key: "listing.event_outcome", operator: "eq", value: "recovered" },
  ], true);
  const cuprHarness = consumerDependencies(admin);
  const cupr = await consumeListingMonitorAlertsForEvent({ eventId: CUPR_EVENT_ID }, cuprHarness.dependencies);
  assert.equal(cuprHarness.readCount(), 1);
  assert.deepEqual(statusFor(cupr, CUPR_MATCH), ["match", "all_conditions_match"]);
  assert.equal(await alertCount(admin, CUPR_MATCH, CUPR_EVENT_ID), 1);

  const atpcSourceExecutionId = first.sourceExecutionId;
  assert.ok(atpcSourceExecutionId);
  const identity = await admin.query(
    `select alert_event_id, listing_source_execution_id, alert_domain, user_id,
            delivered_channels, scheduled_for
     from public.user_alert_deliveries
     where listing_monitor_id = $1`,
    [MONITOR_A],
  );
  assert.deepEqual(identity.rows[0], {
    alert_event_id: ATPC_EVENT_ID,
    listing_source_execution_id: atpcSourceExecutionId,
    alert_domain: "listing",
    user_id: OWNER_A,
    delivered_channels: [],
    scheduled_for: null,
  });

  console.log(JSON.stringify({
    status: "passed",
    atpc: {
      monitorAFirst: "created",
      monitorAReplay: "existing",
      total: await alertCount(admin, MONITOR_A, ATPC_EVENT_ID),
      monitorBNoMatch: await alertCount(admin, MONITOR_B, ATPC_EVENT_ID),
      paused: await alertCount(admin, PAUSED, ATPC_EVENT_ID),
      invalid: await alertCount(admin, INVALID, ATPC_EVENT_ID),
      ineligible: await alertCount(admin, INELIGIBLE, ATPC_EVENT_ID),
    },
    foreignOwnerIsolation: true,
    concurrentIndependentSessions: true,
    concurrentTotal: await alertCount(admin, CONCURRENT, ATPC_EVENT_ID),
    differentExecutionConcurrentTotal: await alertCount(admin, REANALYSIS_DEDUPE, ATPC_EVENT_ID),
    postgrestIgnoreDuplicatesAcrossExecutions: "created+existing",
    cuprComplianceRecovery: "match",
    geminiOrLlmCalls: 0,
  }));
} finally {
  await cleanup(admin).catch(() => undefined);
  const residue = await admin.query(
    `select
       (select count(*)::integer from public.listing_monitors where user_id = any($1::uuid[])) as monitor_count,
       (select count(*)::integer from public.user_alert_deliveries where user_id = any($1::uuid[])) as alert_count,
       (select count(*)::integer from public.user_profiles where id = any($1::uuid[])) as profile_count,
       (select count(*)::integer from auth.users where id = any($1::uuid[])) as user_count`,
    [TEST_USERS],
  );
  assert.deepEqual(residue.rows[0], {
    monitor_count: 0,
    alert_count: 0,
    profile_count: 0,
    user_count: 0,
  });
  console.log(JSON.stringify({ cleanup: residue.rows[0] }));
  await admin.end();
}

function consumerDependencies(client) {
  let reads = 0;
  return {
    readCount: () => reads,
    dependencies: {
      readFacts: async (eventId) => {
        reads += 1;
        return readCurrentListingRiskFacts(eventId, {
          rpc: async (functionName, payload) => {
            assert.equal(functionName, "read_current_event_listing_risk_facts");
            const result = await client.query(
              "select public.read_current_event_listing_risk_facts($1::uuid, $2::text) as value",
              [payload.p_event_id, payload.p_analyzer_contract_version],
            );
            return { ok: true, status: 200, data: result.rows[0].value };
          },
        });
      },
      listActiveMonitors: () => listActiveListingMonitorsForConsumer({
        listActivePage: async (offset, limit) => {
          const result = await client.query(
            `select id,user_id,domain,conditions,is_active,created_at,updated_at
             from public.listing_monitors
             where domain = 'listing' and is_active
             order by created_at asc, id asc
             offset $1 limit $2`,
            [offset, limit],
          );
          return { ok: true, status: 200, data: normalizeRows(result.rows) };
        },
      }),
      createAlert: (input) => insertListingAlertAtomic(client, input),
      now: () => new Date("2026-08-14T00:00:00.000Z"),
    },
  };
}

async function createUsers(client) {
  await client.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at
     ) values
       ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $3, '', now(), now(), now()),
       ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $4, '', now(), now(), now())`,
    [OWNER_A, OWNER_B, "listing-alert-local-a@example.test", "listing-alert-local-b@example.test"],
  );
  await client.query(
    `insert into public.user_profiles (id, email) values ($1, $3), ($2, $4)
     on conflict (id) do nothing`,
    [OWNER_A, OWNER_B, "listing-alert-local-a@example.test", "listing-alert-local-b@example.test"],
  );
}

async function createBaseMonitors(client) {
  await insertMonitor(client, MONITOR_A, OWNER_A, matchAtpc(), true);
  await insertMonitor(client, MONITOR_B, OWNER_A, [
    { key: "listing.event_kind", operator: "eq", value: "compliance_recovery" },
  ], true);
  await insertMonitor(client, PAUSED, OWNER_A, matchAtpc(), false);
  await insertMonitor(client, INVALID, OWNER_A, [
    { key: "listing.removed_key", operator: "eq", value: "stale" },
  ], true);
  await insertMonitor(client, INELIGIBLE, OWNER_A, [
    { key: "listing.appeal_deadline", operator: "eq", value: "2026-08-20" },
  ], true);
  await insertMonitor(client, FOREIGN, OWNER_B, matchAtpc(), true);
}

function matchAtpc() {
  return [
    { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
    { key: "listing.event_outcome", operator: "eq", value: "adverse" },
  ];
}

async function insertMonitor(client, id, userId, conditions, isActive) {
  await client.query(
    `insert into public.listing_monitors (id, user_id, conditions, is_active)
     values ($1, $2, $3::jsonb, $4)`,
    [id, userId, JSON.stringify(conditions), isActive],
  );
}

async function alertCount(client, monitorId, eventId) {
  const result = await client.query(
    `select count(*)::integer as count
     from public.user_alert_deliveries
     where listing_monitor_id = $1 and alert_event_id = $2`,
    [monitorId, eventId],
  );
  return result.rows[0].count;
}

async function alertSourceExecution(client, monitorId, eventId) {
  const result = await client.query(
    `select listing_source_execution_id
     from public.user_alert_deliveries
     where listing_monitor_id = $1 and alert_event_id = $2`,
    [monitorId, eventId],
  );
  return result.rows[0]?.listing_source_execution_id;
}

async function insertListingAlertAtomic(client, input) {
  const result = await client.query(
    `insert into public.user_alert_deliveries (
       user_id, alert_event_id, title, category, source_type, source_label,
       alert_lane, delivered_channels, delivery_status, delivered_at,
       scheduled_for, sent_at, attempted_at, last_error, dedupe_key,
       listing_monitor_id, alert_domain, listing_source_execution_id
     ) values (
       $1, $2, 'Listing monitor matched', 'listing_risk', 'other', 'Listing Monitor',
       'listing_monitor', array[]::text[], 'queued', $3,
       null, null, null, null, null, $4, 'listing', $5
     )
     on conflict (listing_monitor_id, alert_event_id)
     do nothing
     returning id`,
    [input.userId, input.eventId, input.createdAt, input.monitorId, input.sourceExecutionId],
  );
  return result.rows[0]
    ? { status: "created", monitorId: input.monitorId, alertId: result.rows[0].id }
    : { status: "existing", monitorId: input.monitorId };
}

async function verifyOwnershipIsolation() {
  const client = new Client({ connectionString: localDatabaseUrl() });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('request.jwt.claim.sub', $1, true)", [OWNER_A]);
    await client.query("set local role authenticated");
    const result = await client.query(
      `select
         count(*) filter (where user_id = $1)::integer as own_count,
         count(*) filter (where user_id = $2)::integer as foreign_count
       from public.user_alert_deliveries
       where listing_monitor_id is not null`,
      [OWNER_A, OWNER_B],
    );
    assert.equal(result.rows[0].own_count, 2);
    assert.equal(result.rows[0].foreign_count, 0);
    await client.query("rollback");
  } finally {
    await client.end();
  }
}

function statusFor(result, monitorId) {
  const evaluation = result.evaluations.find((item) => item.monitorId === monitorId);
  return [evaluation?.status, evaluation?.reasonCode];
}

function normalizeRows(rows) {
  return rows.map((row) => ({
    ...row,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }));
}

async function cleanup(client) {
  await client.query("delete from public.user_alert_deliveries where user_id = any($1::uuid[])", [TEST_USERS]);
  await client.query("delete from public.listing_monitors where user_id = any($1::uuid[])", [TEST_USERS]);
  await client.query("delete from public.user_profiles where id = any($1::uuid[])", [TEST_USERS]);
  await client.query("delete from auth.users where id = any($1::uuid[])", [TEST_USERS]);
}

function localDatabaseUrl() {
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const port = config.match(/^\[db\][\s\S]*?^port\s*=\s*(\d+)/m)?.[1];
  if (!port) throw new Error("Local Supabase database port is unavailable");
  return `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
}

function readLocalSupabaseCredentials() {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npx";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", "npx supabase status -o env"]
    : ["supabase", "status", "-o", "env"];
  const output = execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const values = Object.fromEntries(output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    return match ? [[match[1], match[2].replace(/"$/, "")]] : [];
  }));
  const apiUrl = values.API_URL || "";
  const serviceRoleKey = values.SERVICE_ROLE_KEY || "";
  const parsed = new URL(apiUrl);
  assert.ok(parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost");
  assert.ok(serviceRoleKey);
  return { apiUrl, serviceRoleKey };
}

async function createListingMonitorAlertViaLocalPostgrest(credentials, input) {
  const url = new URL(`${credentials.apiUrl.replace(/\/$/, "")}/rest/v1/user_alert_deliveries`);
  url.searchParams.set(
    "on_conflict",
    "listing_monitor_id,alert_event_id",
  );
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: credentials.serviceRoleKey,
      Authorization: `Bearer ${credentials.serviceRoleKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify({
      user_id: input.userId,
      alert_event_id: input.eventId,
      ticker: null,
      title: "Listing monitor matched",
      category: "listing_risk",
      source_type: "other",
      source_label: "Listing Monitor",
      alert_lane: "listing_monitor",
      severity: null,
      delivered_channels: [],
      delivery_status: "queued",
      delivered_at: input.createdAt,
      scheduled_for: null,
      sent_at: null,
      attempted_at: null,
      last_error: null,
      dedupe_key: null,
      listing_monitor_id: input.monitorId,
      alert_domain: "listing",
      listing_source_execution_id: input.sourceExecutionId,
    }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, JSON.stringify(body));
  assert.ok(Array.isArray(body));
  return body.length === 1
    ? { status: "created", monitorId: input.monitorId, alertId: body[0].id }
    : { status: "existing", monitorId: input.monitorId };
}
