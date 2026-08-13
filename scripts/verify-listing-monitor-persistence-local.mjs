import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  createListingMonitor,
  deleteListingMonitor,
  listActiveListingMonitorsForOwner,
  ListingMonitorPersistenceError,
  pauseListingMonitor,
  readListingMonitorForOwner,
  resumeListingMonitor,
  updateListingMonitor,
} from "../lib/monitor/listingMonitorPersistence.ts";

const { Client } = pg;
const atpcConditions = [
  { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
  { key: "listing.event_outcome", operator: "eq", value: "adverse" },
  { key: "listing.compliance_deadline", operator: "within_days", value: 30 },
];

const ownerA = randomUUID();
const ownerB = randomUUID();
const corruptMonitorId = randomUUID();
const client = new Client({ connectionString: localDatabaseUrl() });
let transactionOpen = false;

try {
  await client.connect();
  await client.query("begin");
  transactionOpen = true;
  await client.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at
     ) values
       ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $3, '', now(), now(), now()),
       ($2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $4, '', now(), now(), now())`,
    [ownerA, ownerB, `monitor-local-${ownerA}@example.test`, `monitor-local-${ownerB}@example.test`],
  );

  const repository = postgresRepository(client);
  const created = await createListingMonitor({ ownerId: ownerA, conditions: atpcConditions }, repository);
  assert.deepEqual(created.conditions, atpcConditions);
  assert.deepEqual(
    (await listActiveListingMonitorsForOwner(ownerA, repository)).monitors.map((monitor) => monitor.id),
    [created.id],
  );

  await pauseListingMonitor(ownerA, created.id, repository);
  assert.equal((await listActiveListingMonitorsForOwner(ownerA, repository)).monitors.length, 0);
  await resumeListingMonitor(ownerA, created.id, repository);
  assert.deepEqual(
    (await listActiveListingMonitorsForOwner(ownerA, repository)).monitors.map((monitor) => monitor.id),
    [created.id],
  );

  const countBeforeInvalid = await monitorCount(client, [ownerA, ownerB]);
  await assert.rejects(
    createListingMonitor({
      ownerId: ownerA,
      conditions: [{ key: "listing.unsupported", operator: "eq", value: "guess" }],
    }, repository),
    (error) => error instanceof ListingMonitorPersistenceError && error.code === "listing_monitor_invalid",
  );
  assert.equal(await monitorCount(client, [ownerA, ownerB]), countBeforeInvalid);

  await client.query(
    `insert into public.listing_monitors (id, user_id, conditions)
     values ($1, $2, $3::jsonb)`,
    [
      corruptMonitorId,
      ownerA,
      JSON.stringify([{ key: "listing.removed_key", operator: "eq", value: "stale" }]),
    ],
  );
  const failClosed = await listActiveListingMonitorsForOwner(ownerA, repository);
  assert.deepEqual(failClosed.monitors.map((monitor) => monitor.id), [created.id]);
  assert.deepEqual(failClosed.diagnostics, [{
    id: corruptMonitorId,
    reason: "stored_conditions_invalid",
    errors: ["conditions[0]:condition_key_unknown"],
  }]);

  const foreign = await createListingMonitor({ ownerId: ownerB, conditions: atpcConditions }, repository);
  assert.equal((await readListingMonitorForOwner(ownerA, foreign.id, repository)).status, "not_found");
  await assert.rejects(
    updateListingMonitor({ ownerId: ownerA, monitorId: foreign.id, isActive: false }, repository),
    (error) => error instanceof ListingMonitorPersistenceError && error.code === "listing_monitor_not_found",
  );
  assert.equal(await deleteListingMonitor(ownerA, foreign.id, repository), false);
  assert.equal((await readListingMonitorForOwner(ownerB, foreign.id, repository)).status, "available");

  assert.equal(await deleteListingMonitor(ownerA, created.id, repository), true);
  assert.equal((await readListingMonitorForOwner(ownerA, created.id, repository)).status, "not_found");
  assert.equal(await deleteListingMonitor(ownerB, foreign.id, repository), true);

  await client.query("rollback");
  transactionOpen = false;
  const residue = await client.query(
    `select
       (select count(*)::integer from public.listing_monitors where user_id = any($1::uuid[])) as monitor_count,
       (select count(*)::integer from auth.users where id = any($1::uuid[])) as user_count`,
    [[ownerA, ownerB]],
  );
  assert.deepEqual(residue.rows[0], { monitor_count: 0, user_count: 0 });

  console.log(JSON.stringify({
    status: "passed",
    canonicalRoundTrip: true,
    activePauseResume: true,
    invalidRejectedWithoutWrite: true,
    invalidStoredExcludedWithDiagnostic: true,
    ownershipIsolation: true,
    hardDelete: true,
    residue: residue.rows[0],
    geminiOrLlmCalls: 0,
  }));
} finally {
  if (transactionOpen) await client.query("rollback").catch(() => undefined);
  await client.end().catch(() => undefined);
}

function postgresRepository(databaseClient) {
  const fields = "id,user_id,domain,conditions,is_active,created_at,updated_at";
  return {
    async create(row) {
      const result = await databaseClient.query(
        `insert into public.listing_monitors (user_id, domain, conditions, is_active)
         values ($1, $2, $3::jsonb, $4)
         returning ${fields}`,
        [row.user_id, row.domain, JSON.stringify(row.conditions), row.is_active],
      );
      return { ok: true, data: normalizeRows(result.rows) };
    },
    async list(ownerId, activeOnly) {
      const result = await databaseClient.query(
        `select ${fields}
         from public.listing_monitors
         where user_id = $1 and domain = 'listing'${activeOnly ? " and is_active" : ""}
         order by created_at desc, id desc`,
        [ownerId],
      );
      return { ok: true, data: normalizeRows(result.rows) };
    },
    async read(ownerId, monitorId) {
      const result = await databaseClient.query(
        `select ${fields}
         from public.listing_monitors
         where user_id = $1 and id = $2 and domain = 'listing'
         limit 1`,
        [ownerId, monitorId],
      );
      return { ok: true, data: normalizeRows(result.rows) };
    },
    async update(ownerId, monitorId, patch) {
      const allowed = new Set(["conditions", "is_active", "updated_at"]);
      const values = [ownerId, monitorId];
      const setters = [];
      for (const [column, value] of Object.entries(patch)) {
        assert.ok(allowed.has(column));
        values.push(column === "conditions" ? JSON.stringify(value) : value);
        setters.push(`${column} = $${values.length}${column === "conditions" ? "::jsonb" : ""}`);
      }
      const result = await databaseClient.query(
        `update public.listing_monitors
         set ${setters.join(", ")}
         where user_id = $1 and id = $2 and domain = 'listing'
         returning ${fields}`,
        values,
      );
      return { ok: true, data: normalizeRows(result.rows) };
    },
    async delete(ownerId, monitorId) {
      const result = await databaseClient.query(
        `delete from public.listing_monitors
         where user_id = $1 and id = $2 and domain = 'listing'
         returning ${fields}`,
        [ownerId, monitorId],
      );
      return { ok: true, data: normalizeRows(result.rows) };
    },
  };
}

async function monitorCount(databaseClient, ownerIds) {
  const result = await databaseClient.query(
    "select count(*)::integer as count from public.listing_monitors where user_id = any($1::uuid[])",
    [ownerIds],
  );
  return result.rows[0].count;
}

function normalizeRows(rows) {
  return rows.map((row) => ({
    ...row,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  }));
}

function localDatabaseUrl() {
  if (process.env.LOCAL_SUPABASE_DB_URL) return process.env.LOCAL_SUPABASE_DB_URL;
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const port = config.match(/^\[db\][\s\S]*?^port\s*=\s*(\d+)/m)?.[1];
  if (!port) throw new Error("Local Supabase database port is unavailable");
  return `postgresql://postgres:postgres@127.0.0.1:${port}/postgres`;
}
