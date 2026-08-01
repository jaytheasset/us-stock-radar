import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../supabase/migrations/20260730145308_fmp_economic_calendar_ingest_rpc.sql",
  import.meta.url,
);

const SCHEMA_QUALIFIED_SPECIAL_SQL_FORM =
  /\b[a-z_][a-z0-9_$]*\.(?:coalesce|extract|greatest|least|nullif|overlay|position|substring|trim)\s*\(/i;

test("Economic Calendar RPC is atomic, additive, and service-role only", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /create or replace function public\.ingest_fmp_economic_calendar_observation/,
  );
  assert.match(
    sql,
    /language plpgsql[\s\S]*security invoker[\s\S]*set search_path = ''/,
  );
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /on conflict \(provider, source_event_key\)/);
  assert.match(sql, /on conflict \(event_id\)/);
  assert.match(
    sql,
    /on conflict \(event_id, metric_key, release_stage\)/,
  );
  assert.match(sql, /revoke all on function[\s\S]*from public/);
  assert.match(sql, /revoke all on function[\s\S]*from anon/);
  assert.match(sql, /revoke all on function[\s\S]*from authenticated/);
  assert.match(sql, /grant execute on function[\s\S]*to service_role/);
  assert.doesNotMatch(sql, /security definer/i);
  assert.doesNotMatch(sql, /create table|alter table/i);
});

test("backfill raw retention cannot create alerts or cron work", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /p_observation->>'mode' <> 'backfill'/);
  assert.match(sql, /p_observation->>'provider' <> 'fmp'/);
  assert.match(sql, /true,[\s\S]*'prelaunch_long_term',[\s\S]*null/);
  assert.doesNotMatch(
    sql,
    /calendar_alert_candidates|calendar_delivery_attempts|pg_cron|cron\.schedule/i,
  );
});

test("metric replacement removes missing metrics and updates retained metrics", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /delete from public\.calendar_event_metrics as existing[\s\S]*not exists[\s\S]*incoming\.metric_key = existing\.metric_key[\s\S]*incoming\.release_stage = existing\.release_stage/,
  );
  assert.match(
    sql,
    /on conflict \(event_id, metric_key, release_stage\)[\s\S]*do update set[\s\S]*actual = excluded\.actual[\s\S]*consensus = excluded\.consensus[\s\S]*previous = excluded\.previous[\s\S]*released = excluded\.released/,
  );
  assert.match(
    sql,
    /v_metrics_changed := v_old_metrics is distinct from v_new_metrics/,
  );
  assert.match(
    sql,
    /v_old_metrics[\s\S]*order by metric\.metric_key, metric\.release_stage/,
  );
  assert.match(
    sql,
    /v_new_metrics[\s\S]*order by metric\.metric_key, metric\.release_stage/,
  );
});

test("result changes create result-updated history only after state comparison", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /v_details_changed :=[\s\S]*v_metrics_changed :=[\s\S]*v_changed :=/,
  );
  assert.match(
    sql,
    /elsif v_event\.lifecycle_status <> 'released' and v_lifecycle = 'released' then[\s\S]*v_change_kind := 'released';[\s\S]*else[\s\S]*v_change_kind := 'result-updated';/,
  );
  assert.match(
    sql,
    /if v_changed then[\s\S]*insert into public\.calendar_event_history/,
  );
  assert.match(
    sql,
    /current_revision = current_revision \+ case when v_changed then 1 else 0 end/,
  );
  assert.match(
    sql,
    /'unchanged', not v_changed/,
  );
});

test("identity, timezone, taxonomy, and category metric scopes are validated", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /pg_catalog\.strpos\(v_canonical_identity, v_event_date::text\) > 0/,
  );
  assert.match(sql, /at time zone 'America\/New_York'/);
  assert.match(
    sql,
    /v_category = 'macro' and pg_catalog\.jsonb_array_length\(v_metrics\) = 0/,
  );
  assert.match(
    sql,
    /v_category = 'policy' and pg_catalog\.jsonb_array_length\(v_metrics\) <> 0/,
  );
  for (const eventType of [
    "cpi",
    "ppi",
    "pce",
    "employment-situation",
    "jolts",
    "gdp-advance",
    "retail-sales",
    "fomc-decision",
    "fomc-minutes",
    "treasury-refunding",
    "treasury-auction-10y",
    "treasury-auction-30y",
  ]) {
    assert.match(sql, new RegExp(`'${eventType}'`));
  }
  assert.doesNotMatch(sql, /fed-chair-testimony|sec-open-meeting/);
});

test("migration never schema-qualifies PostgreSQL special SQL syntax", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.doesNotMatch(sql, SCHEMA_QUALIFIED_SPECIAL_SQL_FORM);
  assert.match(
    sql,
    /fetched_at = greatest\([\s\S]*calendar_provider_payloads\.fetched_at/,
  );
  assert.match(
    sql,
    /last_seen_at = greatest\(last_seen_at, v_fetched_at\)/,
  );
});
