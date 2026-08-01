import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = process.cwd();
const read = (path: string) => readFile(`${root}/${path}`, "utf8");

test("local Calendar seed is enabled and only exposed through a local reset command", async () => {
  const config = await read("supabase/config.toml");
  const packageJson = await read("package.json");
  const docs = await read("docs/CALENDAR_LOCAL_SEED.md");

  assert.match(
    config,
    /\[db\.seed\][\s\S]*enabled\s*=\s*true[\s\S]*sql_paths\s*=\s*\["\.\/seed\.sql"\]/,
  );
  assert.match(
    packageJson,
    /"calendar:reset-seed:local":\s*"supabase db reset --local --sql-paths \.\/seed\.sql"/,
  );
  assert.match(docs, /Never add `--linked` or a remote `--db-url`/);
  assert.match(docs, /FMP key/);
});

test("local Calendar seed covers every closed event type in normalized and legacy tables", async () => {
  const seed = await read("supabase/seed.sql");
  const model = await read("lib/calendar-v1/model.ts");

  const companyTypes = ["earnings", "dividend", "split", "ipo"];
  const macroTypes = [
    "cpi",
    "ppi",
    "pce",
    "employment-situation",
    "jolts",
    "gdp-advance",
    "retail-sales",
  ];
  const policyTypes = [
    "fomc-decision",
    "fomc-minutes",
    "fed-chair-testimony",
    "treasury-borrowing-estimate",
    "treasury-refunding",
    "treasury-auction-10y",
    "treasury-auction-30y",
    "sec-open-meeting",
    "sec-rule-milestone",
    "trade-policy-action",
    "fda-advisory-committee",
  ];

  for (const eventType of [...companyTypes, ...macroTypes, ...policyTypes]) {
    assert.match(model, new RegExp(`"${eventType}"`));
    assert.match(seed, new RegExp(`'${eventType}'`));
  }

  assert.match(seed, /insert into public\.calendar_events/);
  assert.match(seed, /insert into public\.calendar_event_sources/);
  assert.match(seed, /insert into public\.calendar_event_securities/);
  assert.match(seed, /insert into public\.calendar_event_sectors/);
  assert.match(seed, /insert into public\.calendar_event_metrics/);
  assert.match(seed, /insert into public\.calendar_event_details/);
  assert.match(seed, /insert into public\.event_calendar_items/);
  assert.match(seed, /event\.canonical_identity_key like 'local-seed:%'/);
  assert.match(seed, /on conflict \(canonical_identity_key\) do update/);
});

test("local Calendar fixtures cannot fabricate raw payloads, follows, history, or alerts", async () => {
  const seed = await read("supabase/seed.sql");

  assert.doesNotMatch(seed, /insert into public\.calendar_provider_payloads/i);
  assert.doesNotMatch(seed, /insert into public\.calendar_event_history/i);
  assert.doesNotMatch(seed, /insert into public\.calendar_alert_candidates/i);
  assert.doesNotMatch(seed, /insert into public\.user_calendar_event_follows/i);
  assert.doesNotMatch(seed, /insert into public\.calendar_delivery_attempts/i);
  assert.match(seed, /Deterministic local QA fixture/);
  assert.match(seed, /source_url,[\s\S]*null,/);
});

test("seed fixtures include past and upcoming lifecycle, ET, TNA, and detail data", async () => {
  const seed = await read("supabase/seed.sql");

  assert.match(seed, /date '2026-07-27'/);
  assert.match(seed, /date '2026-07-31'/);
  assert.match(seed, /date '2026-08-02'/);
  assert.match(seed, /'released', 'confirmed'/);
  assert.match(seed, /'scheduled', 'tentative'/);
  assert.match(seed, /'America\/New_York'/);
  assert.match(seed, /'time-not-announced', 'tna'/);
  assert.match(seed, /'all-day', 'tna'/);
  assert.match(seed, /'actualEps'/);
  assert.match(seed, /\bconsensus\b/);
  assert.match(seed, /'pressConferenceTime'/);
});
