import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260730120202_fmp_calendar_ingest_rpc.sql",
  import.meta.url,
);

const SCHEMA_QUALIFIED_SPECIAL_SQL_FORM =
  /\b[a-z_][a-z0-9_$]*\.(?:coalesce|extract|greatest|least|nullif|overlay|position|substring|trim)\s*\(/i;

function declaredRowTargets(sql: string) {
  return Array.from(
    sql.matchAll(
      /^\s*([a-z_][a-z0-9_$]*)\s+(?:[a-z_][a-z0-9_$.]*%rowtype|record)\s*;/gim,
    ),
    (match) => match[1],
  );
}

function selectIntoTargets(sql: string) {
  return Array.from(
    sql.matchAll(/\bselect\b[\s\S]*?\binto\s+([\s\S]*?)\s+\bfrom\b/gi),
    (match) => match[1].trim(),
  );
}

test("FMP Calendar migration is additive, atomic, and service-role only", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create or replace function public\.ingest_fmp_calendar_observation/);
  assert.match(sql, /language plpgsql[\s\S]*security invoker[\s\S]*set search_path = ''/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /on conflict \([\s\S]*provider,[\s\S]*checksum,[\s\S]*request_window_start/);
  assert.match(sql, /on conflict \(provider, source_event_key\)/);
  assert.match(sql, /on conflict \(event_id, ticker\)/);
  assert.match(sql, /on conflict \(event_id\)/);
  assert.match(sql, /revoke all on function[\s\S]*from public/);
  assert.match(sql, /revoke all on function[\s\S]*from anon/);
  assert.match(sql, /revoke all on function[\s\S]*from authenticated/);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /security definer/i);
  assert.doesNotMatch(sql, /event_calendar_items/);
});

test("migration avoids schema-qualifying PostgreSQL special SQL syntax", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.doesNotMatch(sql, SCHEMA_QUALIFIED_SPECIAL_SQL_FORM);
  assert.match(
    sql,
    /pg_catalog\.strpos\(v_canonical_identity, v_event_date::text\) > 0/,
  );
});

test("row and record variables are never mixed into multi-target loads", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const rowTargets = declaredRowTargets(sql);
  const intoTargets = selectIntoTargets(sql);

  assert.deepEqual(rowTargets, ["v_event"]);
  for (const rowTarget of rowTargets) {
    for (const intoTarget of intoTargets) {
      if (new RegExp(`\\b${rowTarget}\\b`, "i").test(intoTarget)) {
        assert.doesNotMatch(
          intoTarget,
          /,/,
          `${rowTarget} must be the only SELECT INTO target`,
        );
      }
    }
  }

  assert.match(
    sql,
    /select event_row\.\*[\s\S]*into v_event[\s\S]*for update of event_row;/,
  );
  assert.match(
    sql,
    /select details\.detail[\s\S]*into v_old_detail[\s\S]*where details\.event_id = v_event\.id;/,
  );
});

test("raw retention and backfill contracts cannot create alerts", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /is_development_data,[\s\S]*retention_mode,[\s\S]*purge_after/);
  assert.match(sql, /true,[\s\S]*'prelaunch_long_term',[\s\S]*null/);
  assert.match(sql, /p_observation->>'mode' <> 'backfill'/);
  assert.match(sql, /p_observation->>'provider' <> 'fmp'/);
  assert.match(sql, /p_observation->>'category' <> 'company'/);
  assert.doesNotMatch(
    sql,
    /calendar_alert_candidates|calendar_delivery_attempts|pg_cron|cron\.schedule/i,
  );
});

test("revision/history changes only for normalized schedule or result changes", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /history\.observation_fingerprint = v_history_fingerprint/,
  );
  assert.match(sql, /current_revision = current_revision \+ case when v_changed then 1 else 0 end/);
  assert.match(sql, /if v_schedule_changed then[\s\S]*'schedule-changed'/);
  assert.match(sql, /v_event\.lifecycle_status <> 'released'[\s\S]*'released'/);
  assert.match(sql, /'result-updated'/);
  assert.match(sql, /if v_changed then[\s\S]*insert into public\.calendar_event_history/);
  assert.match(sql, /last_seen_at = greatest/);
  assert.match(sql, /checksum = excluded\.checksum/);
  assert.match(sql, /fetched_at = excluded\.fetched_at/);
  assert.ok(
    sql.indexOf("v_changed :=") <
      sql.indexOf("history.observation_fingerprint = v_history_fingerprint"),
    "current normalized state must be compared before a historical fingerprint is reused",
  );
  assert.match(sql, /v_fingerprint \|\| ':revision:' \|\|/);
});

test("existing Calendar foreign keys have supporting indexes and ticker identity is already indexed", async () => {
  const baseline = await readFile(
    new URL(
      "../../supabase/migrations/20260728113243_canonical_baseline.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const normalized = await readFile(
    new URL(
      "../../supabase/migrations/20260729193519_normalized_calendar_schema.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(baseline, /ADD CONSTRAINT "tickers_pkey" PRIMARY KEY \("symbol"\)/);
  for (const index of [
    "calendar_event_sources_event_idx",
    "calendar_event_sources_raw_payload_idx",
    "calendar_event_securities_ticker_idx",
    "calendar_event_history_event_observed_idx",
    "calendar_event_history_source_idx",
  ]) {
    assert.match(normalized, new RegExp(index));
  }
});
