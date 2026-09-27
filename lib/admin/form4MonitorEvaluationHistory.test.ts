import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260927010939_form4_monitor_evaluation_history.sql");
const consumer = read("lib/monitor/listingMonitorAlertConsumer.ts");
const page = read("app/admin/alerts/form4-monitor-evaluations/page.tsx");

test("evaluation history is append-only, service-only, and indexed by actual lookup keys", () => {
  assert.match(migration, /create table if not exists public\.listing_monitor_evaluation_records/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all[\s\S]*public, anon, authenticated, service_role/i);
  assert.match(migration, /grant select, insert[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant[\s\S]*(?:update|delete)/i);
  assert.match(migration, /\(event_id, evaluated_at desc\)/i);
  assert.match(migration, /\(monitor_id, evaluated_at desc\)/i);
});

test("actual consumer persists match and notification outcomes separately", () => {
  assert.match(consumer, /evaluation_not_match/);
  assert.match(consumer, /matching_lineage_unavailable/);
  assert.match(consumer, /duplicate_alert_existing/);
  assert.match(consumer, /alert_write_failed/);
  assert.match(consumer, /recordForm4Evaluation/);
});

test("admin history is system.read guarded and explicitly avoids inference", () => {
  assert.match(page, /requireAdminPermission\("system\.read"\)/);
  assert.match(page, /does not infer missing facts or call an LLM/);
  assert.match(page, /Not evaluated \/ no persisted record/);
  assert.match(page, /Reviewed owners and source\/footnote evidence/);
  assert.match(page, /Notification \/ dedupe/);
});
