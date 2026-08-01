import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();
const migrationPath =
  "supabase/migrations/20260731153421_calendar_event_analysis_links.sql";
const read = (path: string) => readFile(`${root}/${path}`, "utf8");

test("analysis-link schema is relational, indexed, RLS-enabled, and service-only", async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /create table public\.calendar_event_analysis_links/);
  assert.match(sql, /calendar_event_id uuid not null[\s\S]*references public\.calendar_events/);
  assert.match(sql, /analysis_event_id uuid not null[\s\S]*references public\.events/);
  assert.match(sql, /unique \(calendar_event_id, analysis_event_id\)/);
  assert.match(sql, /calendar_event_analysis_links_analysis_idx/);
  assert.match(sql, /unique index calendar_event_analysis_links_primary_uidx[\s\S]*where is_primary and link_status = 'linked'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.calendar_event_analysis_links[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /create policy/);
});

test("matcher RPC is invoker-only, atomic, idempotent, and preserves manual or amendment links", async () => {
  const sql = await read(migrationPath);
  assert.match(sql, /create function public\.upsert_calendar_event_analysis_matches/);
  assert.match(sql, /security invoker/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(sql, /on conflict \(calendar_event_id, analysis_event_id\) do update/);
  assert.match(sql, /existing\.match_method <> 'manual'/);
  assert.doesNotMatch(sql, /delete from public\.calendar_event_analysis_links/);
  assert.match(sql, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /pg_catalog\.(?:coalesce|greatest|least|position)\s*\(/i);
});

test("Calendar API exposes only canonical analysis presentation fields", async () => {
  const normalized = await read("lib/calendar-v1/normalized.ts");
  const model = await read("lib/calendar-v1/model.ts");
  const route = await read("app/api/sources/calendar-analysis-links/match/route.ts");
  assert.match(normalized, /calendar_event_analysis_links/);
  assert.match(normalized, /`\/filings\/\$\{analysis\.primaryAnalysisEventId\}`/);
  assert.match(model, /relatedAnalysisCount\?: number/);
  assert.match(model, /analysisPending\?: boolean/);
  assert.doesNotMatch(normalized, /match_score|match_method|reason|evidence/);
  assert.match(route, /sourceIngestAuthResponse/);
  assert.match(route, /body\.persist !== true/);
});
