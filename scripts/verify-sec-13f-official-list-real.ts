import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { config as loadEnv } from "dotenv";
import { fetchSec13fOfficialList } from "../lib/sec-13f-official-list/fetch.ts";
import type { Sec13fOfficialListSnapshot } from "../lib/sec-13f-official-list/parser.ts";
import { persistSec13fOfficialList } from "../lib/sec-13f-official-list/repository.ts";

loadEnv({ path: ".env.local", quiet: true });
const userAgent = process.env.SEC_USER_AGENT;
const connectionString = process.env.SUPABASE_DB_URL;
if (!userAgent || !connectionString) throw new Error("SEC_USER_AGENT and SUPABASE_DB_URL are required");
const database = new URL(connectionString);
if (!["127.0.0.1", "localhost", "::1"].includes(database.hostname)) {
  throw new Error("Refusing non-local database for rollback-only SEC 13(f) test");
}

const sourceUrls = [
  ["2026Q1", "https://www.sec.gov/files/investment/13flist2026q1.txt"],
  ["2026Q2", "https://www.sec.gov/files/investment/13flist2026q2-txt.txt"],
] as const;
const snapshots: Sec13fOfficialListSnapshot[] = [];
for (const [expectedQuarter, sourceUrl] of sourceUrls) {
  snapshots.push(await fetchSec13fOfficialList({ sourceUrl, expectedQuarter, userAgent }));
}

const client = new Client({ connectionString });
await client.connect();
try {
  const before = await client.query<{ existing: string | null }>(
    "select to_regclass('public.sec_13f_official_list_snapshots')::text as existing",
  );
  await client.query("begin");
  try {
    if (!before.rows[0].existing) {
      const migration = await readFile(
        new URL("../supabase/migrations/20260930044614_sec_13f_official_list_snapshots.sql", import.meta.url),
        "utf8",
      );
      await client.query(migration);
    }
    const access = await client.query<{
      snapshots_rls: boolean; entries_rls: boolean; anon_read: boolean;
      authenticated_read: boolean; service_read: boolean; service_insert: boolean;
    }>(`select
          (select relrowsecurity from pg_class where oid = 'public.sec_13f_official_list_snapshots'::regclass) as snapshots_rls,
          (select relrowsecurity from pg_class where oid = 'public.sec_13f_official_list_entries'::regclass) as entries_rls,
          has_table_privilege('anon', 'public.sec_13f_official_list_snapshots', 'SELECT') as anon_read,
          has_table_privilege('authenticated', 'public.sec_13f_official_list_snapshots', 'SELECT') as authenticated_read,
          has_table_privilege('service_role', 'public.sec_13f_official_list_snapshots', 'SELECT') as service_read,
          has_table_privilege('service_role', 'public.sec_13f_official_list_snapshots', 'INSERT') as service_insert`);
    assert.deepEqual(access.rows[0], {
      snapshots_rls: true, entries_rls: true, anon_read: false, authenticated_read: false,
      service_read: true, service_insert: true,
    });
    const first = await persistSec13fOfficialList(client, snapshots[0], "external");
    const second = await persistSec13fOfficialList(client, snapshots[1], "external");
    const replay = await persistSec13fOfficialList(client, snapshots[0], "external");
    assert.notEqual(first.snapshotId, second.snapshotId);
    assert.equal(replay.inserted, false);
    assert.equal(replay.snapshotId, first.snapshotId);
    const rows = await client.query<{
      quarter: string; quarter_end: string; source_sha256: string; row_count: number;
      persisted_count: string; added: string; deleted: string;
    }>(`select s.quarter, s.quarter_end::text, s.source_sha256, s.row_count,
              count(e.*)::text as persisted_count,
              count(*) filter (where e.status = 'added')::text as added,
              count(*) filter (where e.status = 'deleted')::text as deleted
         from public.sec_13f_official_list_snapshots s
         join public.sec_13f_official_list_entries e on e.snapshot_id = s.id
        where (s.quarter = $1 and s.source_sha256 = $2)
           or (s.quarter = $3 and s.source_sha256 = $4)
        group by s.id order by s.quarter`, [
          snapshots[0].quarter, snapshots[0].sourceSha256,
          snapshots[1].quarter, snapshots[1].sourceSha256,
        ]);
    assert.deepEqual(rows.rows.map((row) => row.quarter), ["2026Q1", "2026Q2"]);
    const recurringCusip = await client.query<{ quarter: string }>(
      `select s.quarter from public.sec_13f_official_list_entries e
         join public.sec_13f_official_list_snapshots s on s.id = e.snapshot_id
        where e.cusip = '037833100' and e.snapshot_id in ($1, $2) order by s.quarter`,
      [first.snapshotId, second.snapshotId],
    );
    assert.deepEqual(recurringCusip.rows.map((row) => row.quarter), ["2026Q1", "2026Q2"]);
    for (let index = 0; index < snapshots.length; index += 1) {
      const snapshot = snapshots[index];
      const row = rows.rows[index];
      assert.equal(row.quarter_end, snapshot.quarterEnd);
      assert.equal(row.source_sha256, snapshot.sourceSha256);
      assert.equal(row.row_count, snapshot.entries.length);
      assert.equal(Number(row.persisted_count), snapshot.entries.length);
      assert.equal(Number(row.added), snapshot.entries.filter((entry) => entry.status === "added").length);
      assert.equal(Number(row.deleted), snapshot.entries.filter((entry) => entry.status === "deleted").length);
    }
    console.log(JSON.stringify({
      result: "PASS", mode: "transaction_rollback", schemaAlreadyApplied: Boolean(before.rows[0].existing),
      distinctSnapshots: rows.rows.length,
      quarters: rows.rows.map((row) => ({
        quarter: row.quarter, sourceSha256: row.source_sha256, rows: row.row_count,
        added: Number(row.added), deleted: Number(row.deleted),
      })), replayCreatedNewSnapshot: replay.inserted,
    }));
  } finally {
    await client.query("rollback");
  }
  const after = await client.query<{ existing: string | null }>(
    "select to_regclass('public.sec_13f_official_list_snapshots')::text as existing",
  );
  assert.equal(after.rows[0].existing, before.rows[0].existing, "rollback must preserve schema state");
} finally {
  await client.end();
}
