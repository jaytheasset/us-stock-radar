// Approved loopback DB only. Read-only snapshots; complete profile/preferences rows
// are compared in memory, never printed or persisted. No Auth/session credentials read.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";

const sha = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function main() {
  const [directory, approvedBaseline] = process.argv.slice(2);
  assert.ok(directory && approvedBaseline);
  const tables = Object.keys(JSON.parse(fs.readFileSync(approvedBaseline, "utf8")).fingerprints).sort();
  assert.equal(tables.length, 30);
  assert.ok(tables.every(t => /^[a-z0-9_]+$/.test(t)));
  const local = JSON.parse(execFileSync(process.execPath,
    ["node_modules/supabase/dist/supabase.js", "status", "-o", "json"],
    { encoding: "utf8", stdio: "pipe", windowsHide: true }));
  const url = new URL(local.DB_URL);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "56322");
  assert.equal(url.pathname, "/postgres"); assert.equal(local.API_URL, "http://127.0.0.1:56321");
  const db = new pg.Client({ connectionString: local.DB_URL, connectionTimeoutMillis: 5000, statement_timeout: 60000 });
  const marker = path.join(directory, "compare.request");
  assert.ok(!fs.existsSync(marker), "Use a new receipt directory for every run");
  fs.mkdirSync(directory, { recursive: true });
  const save = (name, value) => fs.writeFileSync(path.join(directory, name), JSON.stringify(value, null, 2) + "\n");
  try {
    await db.connect();
    const identity = (await db.query("select system_identifier::text from pg_control_system()")).rows[0].system_identifier;
    assert.equal(identity, "7678429483712069671");
    // Existing real review actor; selecting it grants no authentication or permission.
    const actor = (await db.query("select distinct actor_user_id from public.kiwoom_ticker_evidence_reviews where case_id=$1", ["e9f560f6-4079-4be3-9fa9-377e5cd0c828"])).rows;
    assert.equal(actor.length, 1);
    const actorId = actor[0].actor_user_id;
    async function snapshot() {
      await db.query("begin isolation level repeatable read read only");
      try {
        const result = { capturedAt: new Date().toISOString(), identity, fingerprints: {}, fullRows: {} };
        for (const t of tables) {
          result.fingerprints[t] = (await db.query(`select count(*)::text count, md5(coalesce(string_agg(h,',' order by h),'')) hash from (select md5(to_jsonb(t)::text) h from public."${t}" t) s`)).rows[0];
        }
        for (const [t, key] of [["user_profiles", "id"], ["alert_preferences", "user_id"]]) {
          result.fullRows[t] = (await db.query(`select to_jsonb(t) row from public."${t}" t order by "${key}"`)).rows.map(r => r.row);
          assert.ok(result.fullRows[t].some(r => r[key] === actorId));
        }
        result.ledger = (await db.query("select version from supabase_migrations.schema_migrations order by version")).rows;
        result.ledgerFingerprint = (await db.query("select count(*)::int count,md5(coalesce(string_agg(h,',' order by h),'')) hash from (select md5(to_jsonb(t)::text) h from supabase_migrations.schema_migrations t) s")).rows[0];
        result.kiwoom = {};
        for (const t of ["kiwoom_ticker_evidence_reviews", "kiwoom_sec_human_judgments", "kiwoom_sec_human_comparisons"]) {
          result.kiwoom[t] = (await db.query(`select count(*)::int count,md5(coalesce(string_agg(h,',' order by h),'')) hash from (select md5(to_jsonb(t)::text) h from public."${t}" t) s`)).rows[0];
        }
        result.audit = (await db.query("select count(*)::int count,md5(coalesce(string_agg(h,',' order by h),'')) hash from (select md5(to_jsonb(t)::text) h from public.admin_audit_logs t) s")).rows[0];
        await db.query("commit"); return result;
      } catch (e) { await db.query("rollback"); throw e; }
    }
    function receipt(snapshot) {
      const { fullRows, ...publicFields } = snapshot;
      return { ...publicFields, actorIdSha256: sha(actorId), wholeRows: Object.fromEntries(
        Object.entries(fullRows).map(([t, rows]) => {
          const row = rows.find(r => (r.user_id ?? r.id) === actorId);
          return [t, { count: rows.length, allRowsSha256: sha(rows), actorWholeRowSha256: sha(row), actorColumns: Object.keys(row).sort() }];
        })) };
    }
    const before = await snapshot(); save("readonly-before.json", receipt(before));
    console.log("BASELINE_READY: 30 protected tables plus complete profile/preferences rows retained in memory. Perform read-only browser checks, then create compare.request in the receipt directory.");
    const deadline = Date.now() + 15 * 60 * 1000;
    while (!fs.existsSync(marker) && Date.now() < deadline) await delay(500);
    assert.ok(fs.existsSync(marker), "Timed out waiting for comparison request");
    const after = await snapshot(); save("readonly-after.json", receipt(after));
    const equal = (a, b) => { try { assert.deepEqual(a, b); return true; } catch { return false; } };
    const changedTables = tables.filter(t => !equal(before.fingerprints[t], after.fingerprints[t]));
    const wholeRows = Object.fromEntries(Object.keys(before.fullRows).map(t => [t, equal(before.fullRows[t], after.fullRows[t])]));
    const report = { capturedAt: new Date().toISOString(), changedTables, protectedTableCount: tables.length,
      wholeRows, actorCoveredInBothTables: true,
      ledgerUnchanged: equal(before.ledger, after.ledger) && equal(before.ledgerFingerprint, after.ledgerFingerprint),
      kiwoomUnchanged: equal(before.kiwoom, after.kiwoom), auditUnchanged: equal(before.audit, after.audit) };
    report.pass = changedTables.length === 0 && Object.values(wholeRows).every(Boolean) && report.ledgerUnchanged && report.kiwoomUnchanged && report.auditUnchanged;
    save("readonly-comparison.json", report); console.log(JSON.stringify(report));
    assert.ok(report.pass);
  } finally { await db.end(); }
}
// CLI/SQL exceptions can contain sensitive buffers or rows; never print raw errors.
main().catch(() => { console.error("Read-only verification failed; sensitive diagnostics suppressed."); process.exitCode = 1; });
