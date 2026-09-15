import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error The repository runtime dependency intentionally has no local declaration package.
import pg from "pg";
import { buildOwnershipParserFactRows } from "../lib/monitor/ownershipParserFacts.ts";

const { Pool } = pg;
const connectionString = process.env.OWNERSHIP_CONTEXT_ISOLATED_DB_URL;
const expectedPort = process.env.OWNERSHIP_CONTEXT_ISOLATED_DB_PORT;
if (!connectionString || !expectedPort) {
  throw new Error("OWNERSHIP_CONTEXT_ISOLATED_DB_URL and OWNERSHIP_CONTEXT_ISOLATED_DB_PORT are required");
}
const databaseUrl = new URL(connectionString);
assertIsolatedDatabase(databaseUrl, expectedPort);

const pool = new Pool({ connectionString, max: 8 });
const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, "../supabase/migrations/20260915014346_ownership_structured_context_v1.sql"), "utf8");
const fixture = JSON.parse(readFileSync(
  join(here, "../lib/sources/sec/forms/ownership/fixtures/form4-multi-owner-10b5-1-conversion.json"),
  "utf8",
)) as Record<string, unknown>;

const eventId = "a1111111-1111-4111-8111-111111111111";
const rawItemId = "a2222222-2222-4222-8222-222222222222";
const aiRunId = "a3333333-3333-4333-8333-333333333333";
const aiOutputId = "a4444444-4444-4444-8444-444444444444";

try {
  await pool.query(baselineSql());
  await pool.query(migration);
  const anonClient = await pool.connect();
  try {
    await anonClient.query("begin");
    await anonClient.query("set local role anon");
    await assert.rejects(
      anonClient.query("select public.read_event_ownership_context_snapshot($1)", [eventId]),
      (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "42501"),
    );
  } finally {
    try { await anonClient.query("rollback"); } catch {}
    anonClient.release();
  }

  const sourceText = String(fixture.filingText);
  const preservedSourceText = `\n${sourceText}\n `;
  const accession = String(fixture.accessionNumber);
  const ticker = xmlValue(sourceText, "issuerTradingSymbol");
  const issuerCik = xmlValue(sourceText, "issuerCik");
  const rawItem = {
    id: rawItemId,
    source_unique_id: accession,
    raw_payload: {
      form_type: fixture.formType,
      accession_number: accession,
      cik: issuerCik,
      ownership_issuer_cik: issuerCik,
      ticker,
      ownership_issuer_trading_symbol: ticker,
      ownership_source_text: preservedSourceText,
      ownership_source_url: `https://www.sec.gov/Archives/edgar/data/1000000/${accession.replace(/-/g, "")}/ownership.xml`,
      ownership_source_format: "ownership_xml",
      ownership_source_text_truncated: false,
    },
  };
  const built = buildOwnershipParserFactRows({ eventId, rawItem, symbol: ticker });
  assert.equal(built.form4Transactions.length, 3);
  await pool.query("insert into public.raw_items(id, source_unique_id, raw_payload) values ($1, $2, $3::jsonb)", [
    rawItemId, accession, JSON.stringify(rawItem.raw_payload),
  ]);
  await pool.query(`insert into public.events(
    id, raw_item_id, source_code, source_group, event_type, metadata
  ) values ($1, $2, 'sec_edgar', 'filings', 'insider_ownership', $3::jsonb)`, [
    eventId, rawItemId, JSON.stringify({ form_type: fixture.formType, accession_number: accession }),
  ]);
  await replaceRows(built.form4Transactions);

  const firstFingerprint = await currentFingerprint();
  assert.match(firstFingerprint, /^ownership-context-v1:[0-9a-f]{64}$/);
  const directBefore = await directRows();
  const context = validContext(firstFingerprint);
  const nullArguments = await pool.query(
    "select public.persist_event_ownership_context($1, null, null, null, null, null) as result",
    [eventId],
  );
  assert.equal(nullArguments.rows[0].result.reason, "invalid_arguments");
  const nullFact = [{ row_ref: "row:form4:0", assertions: [{
    fact: null, status: "supported", value: "sell", evidence_refs: ["evidence:form4:0:0"],
  }] }];
  assert.equal((await persistContext(firstFingerprint, nullFact)).reason, "assertion_shape_invalid");
  const nullValue = [{ row_ref: "row:form4:0", assertions: [{
    fact: "economic_direction", status: "supported", value: null, evidence_refs: ["evidence:form4:0:0"],
  }] }];
  assert.equal((await persistContext(firstFingerprint, nullValue)).reason, "assertion_value_invalid");
  const injectedDirectKey = [{ row_ref: "row:form4:0", assertions: [{
    fact: "economic_direction", status: "supported", value: "sell",
    evidence_refs: ["evidence:form4:0:0"], shares: 123,
  }] }];
  assert.equal((await persistContext(firstFingerprint, injectedDirectKey)).reason, "assertion_shape_invalid");
  assert.deepEqual(await persistContext(firstFingerprint, context), {
    status: "stored", updated_row_count: 1, source_fingerprint: firstFingerprint,
  });
  await assert.rejects(
    pool.query(`update public.event_form4_transactions
      set context_facts = context_facts || '{"raw_model":{"shares":999}}'::jsonb
      where event_id = $1 and transaction_index = 0`, [eventId]),
    (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: string }).code === "23514"),
  );
  assert.deepEqual(await directRows(), directBefore, "context-only RPC cannot modify direct columns");

  const replayRows = built.form4Transactions.map((row) => ({ ...row, updated_at: "2030-01-01T00:00:00.000Z" }));
  await replaceRows(replayRows);
  assert.equal(await currentFingerprint(), firstFingerprint, "timestamps are excluded from the source fingerprint");
  assert.equal((await storedContext())?.source_fingerprint, firstFingerprint, "same-input replay preserves context");

  const changedRows = structuredClone(built.form4Transactions);
  changedRows[0].shares = Number(changedRows[0].shares) + 1;
  await replaceRows(changedRows);
  const changedFingerprint = await currentFingerprint();
  assert.notEqual(changedFingerprint, firstFingerprint);
  assert.equal(await storedContext(), null, "changed direct input invalidates context");
  assert.equal((await persistContext(firstFingerprint, context)).status, "stale");

  await replaceRows(built.form4Transactions);
  const restoredFingerprint = await currentFingerprint();
  const restoredContext = validContext(restoredFingerprint);
  await pool.query(`insert into public.ai_runs(
    id, event_id, raw_item_id, prompt_key, prompt_version, model, status
  ) values ($1, $2, $3, 'ownership_structured_context', 'ownership_context_v1.0', 'isolated-fixture', 'completed')`, [
    aiRunId, eventId, rawItemId,
  ]);
  await pool.query(`insert into public.ai_outputs(id, ai_run_id, event_id, output_type, payload)
    values ($1, $2, $3, 'ownership_context_v1', '{}'::jsonb)`, [aiOutputId, aiRunId, eventId]);
  assert.equal((await persistContext(restoredFingerprint, restoredContext, aiRunId, aiOutputId)).status, "stored");
  assert.equal((await persistContext(
    restoredFingerprint, restoredContext,
    "a5555555-5555-4555-8555-555555555555", aiOutputId,
  )).reason, "ai_refs_lineage_invalid");

  await replaceRows(built.form4Transactions);
  const raceFingerprint = await currentFingerprint();
  await persistContext(raceFingerprint, validContext(raceFingerprint));
  const contextFirst = await raceWithAdvisoryLock({
    first: () => persistContext(raceFingerprint, validContext(raceFingerprint)),
    second: () => replaceRows(changedRows),
  });
  assert.equal(contextFirst.first.status, "replayed");
  assert.equal(await storedContext(), null, "replacement after a context write invalidates changed input context");

  await replaceRows(built.form4Transactions);
  const replacementFirstFingerprint = await currentFingerprint();
  const replacementFirst = await raceWithAdvisoryLock({
    first: () => replaceRows(changedRows),
    second: () => persistContext(replacementFirstFingerprint, validContext(replacementFirstFingerprint)),
  });
  assert.equal(replacementFirst.second.status, "stale", "context validated before replacement is rejected after changed replacement wins");
  assert.equal(await storedContext(), null);

  await replaceRows(built.form4Transactions);
  const rawRaceFingerprint = await currentFingerprint();
  const rawClient = await pool.connect();
  try {
    await rawClient.query("begin");
    await rawClient.query(`update public.raw_items
      set raw_payload = pg_catalog.jsonb_set(raw_payload, '{ownership_source_text}', pg_catalog.to_jsonb((raw_payload->>'ownership_source_text') || ' '))
      where id = $1`, [rawItemId]);
    const pendingWrite = persistContext(rawRaceFingerprint, validContext(rawRaceFingerprint));
    await delay(100);
    await rawClient.query("commit");
    assert.equal((await pendingWrite).status, "stale", "raw update is serialized before fingerprint acceptance");
  } finally {
    try { await rawClient.query("rollback"); } catch {}
    rawClient.release();
  }
  const unavailable = await pool.query(
    "select public.get_event_ownership_context_fingerprint($1) as result",
    [eventId],
  );
  assert.equal(unavailable.rows[0].result.status, "not_ready", "raw XML drift cannot mint a mixed old-row/new-raw fingerprint");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    isolatedDatabase: { host: databaseUrl.hostname, port: databaseUrl.port, database: databaseUrl.pathname.slice(1) },
    assertions: {
      migrationApplied: true,
      anonymousRpcExecutionRevoked: true,
      sqlNullAndJsonNullRejected: true,
      rawModelEnvelopeRejectedByConstraint: true,
      directColumnsUnchangedByContextWrite: true,
      sameInputReplayPreserved: true,
      changedInputInvalidated: true,
      staleFingerprintRejected: true,
      aiReferenceForgeryRejected: true,
      contextThenReplacementRaceSafe: true,
      replacementThenContextRaceSafe: true,
      rawUpdateRaceSafe: true,
    },
  }, null, 2)}\n`);
} finally {
  await pool.end();
}

async function replaceRows(rows: readonly Record<string, unknown>[]) {
  const result = await pool.query(
    "select public.replace_event_ownership_facts($1, $2::jsonb, '[]'::jsonb) as result",
    [eventId, JSON.stringify(rows)],
  );
  return result.rows[0].result as Record<string, unknown>;
}

async function persistContext(
  sourceFingerprint: string,
  contexts: readonly Record<string, unknown>[],
  runId: string | null = null,
  outputId: string | null = null,
) {
  const result = await pool.query(
    "select public.persist_event_ownership_context($1, 'form4', $2, $3::jsonb, $4, $5) as result",
    [eventId, sourceFingerprint, JSON.stringify(contexts), runId, outputId],
  );
  return result.rows[0].result as Record<string, any>;
}

async function currentFingerprint() {
  const result = await pool.query("select public.ownership_context_source_fingerprint($1) as fingerprint", [eventId]);
  return String(result.rows[0].fingerprint || "");
}

async function directRows() {
  const result = await pool.query(`select pg_catalog.jsonb_agg(
    pg_catalog.to_jsonb(row_value) - 'created_at' - 'updated_at' - 'context_facts'
    order by transaction_index
  ) as rows from public.event_form4_transactions as row_value where event_id = $1`, [eventId]);
  return result.rows[0].rows;
}

async function storedContext() {
  const result = await pool.query(`select context_facts from public.event_form4_transactions
    where event_id = $1 and transaction_index = 0`, [eventId]);
  return result.rows[0].context_facts as Record<string, any> | null;
}

function validContext(sourceFingerprint: string) {
  return [{
    row_ref: "row:form4:0",
    assertions: [{
      fact: "economic_direction",
      status: "supported",
      value: "sell",
      evidence_refs: ["evidence:form4:0:0"],
    }],
  }];
}

async function raceWithAdvisoryLock(input: {
  first(): Promise<Record<string, any>>;
  second(): Promise<Record<string, any>>;
}) {
  const blocker = await pool.connect();
  try {
    await blocker.query("begin");
    await blocker.query("select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ownership-context:' || $1::text, 0))", [eventId]);
    const first = input.first();
    await delay(100);
    const second = input.second();
    await delay(100);
    await blocker.query("commit");
    return { first: await first, second: await second };
  } finally {
    try { await blocker.query("rollback"); } catch {}
    blocker.release();
  }
}

function assertIsolatedDatabase(url: URL, expectedPort: string) {
  assert.ok(new Set(["127.0.0.1", "localhost", "::1", "[::1]"]).has(url.hostname), "database must be loopback-only");
  assert.equal(url.port, expectedPort);
  assert.ok(url.pathname.startsWith("/ownership_context_isolated_"), "database name must be dedicated to ownership context isolation");
  assert.notEqual(url.port, "5432");
  assert.notEqual(url.port, "56322", "shared-local database port is forbidden");
}

function xmlValue(sourceText: string, localName: string) {
  return sourceText.match(new RegExp(`<${localName}\\b[^>]*>\\s*([^<]*?)\\s*<\\/${localName}>`, "i"))?.[1]?.trim() ?? null;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baselineSql() {
  return String.raw`
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
do $block$ begin create role service_role nologin; exception when duplicate_object then null; end $block$;
do $block$ begin create role anon nologin; exception when duplicate_object then null; end $block$;
do $block$ begin create role authenticated nologin; exception when duplicate_object then null; end $block$;
create table public.raw_items (
  id uuid primary key, source_unique_id text not null, raw_payload jsonb not null
);
create table public.events (
  id uuid primary key, raw_item_id uuid references public.raw_items(id), source_code text,
  source_group text, event_type text, metadata jsonb not null default '{}'::jsonb
);
create table public.ai_runs (
  id uuid primary key, event_id uuid references public.events(id), raw_item_id uuid references public.raw_items(id),
  prompt_key text not null, prompt_version text not null, model text not null, status text not null
);
create table public.ai_outputs (
  id uuid primary key, ai_run_id uuid not null references public.ai_runs(id), event_id uuid references public.events(id),
  output_type text not null, payload jsonb not null
);
create table public.event_form4_transactions (
  event_id uuid not null references public.events(id) on delete cascade, transaction_index integer not null,
  symbol text, reporting_owner_names jsonb not null default '[]', reporting_owner_roles jsonb not null default '[]',
  officer_titles jsonb not null default '[]', is_officer boolean, is_director boolean, is_10_percent_owner boolean,
  officer_title text, is_10b5_1 boolean, transaction_kind text, security_title text, transaction_date date,
  deemed_execution_date date, transaction_code text, acquired_disposed_code text, economic_direction text,
  shares numeric, shares_quality text, price_per_share numeric, price_per_share_quality text,
  transaction_value numeric, transaction_value_quality text, post_transaction_shares numeric,
  shares_value_quality text, shares_availability text, price_per_share_value_quality text,
  price_per_share_availability text, transaction_value_value_quality text, transaction_value_availability text,
  post_transaction_shares_value_quality text, post_transaction_shares_availability text,
  direct_or_indirect_ownership text, nature_of_ownership text, fact_as_of date, confidence numeric,
  provenance jsonb not null, evidence jsonb not null default '[]', calculation_basis jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(event_id, transaction_index)
);
create table public.event_form144_proposed_sales (
  event_id uuid not null references public.events(id) on delete cascade, proposed_sale_index integer not null,
  symbol text, seller_name text, reporting_owner_names jsonb not null default '[]', security_title text, exchange text,
  securities_to_be_sold numeric, securities_to_be_sold_quality text, aggregate_market_value numeric,
  aggregate_market_value_quality text, approximate_sale_date date, shares_outstanding numeric,
  shares_outstanding_quality text, proposed_sale_percent numeric, proposed_sale_percent_quality text,
  securities_to_be_sold_value_quality text, securities_to_be_sold_availability text,
  aggregate_market_value_value_quality text, aggregate_market_value_availability text,
  shares_outstanding_value_quality text, shares_outstanding_availability text,
  proposed_sale_percent_value_quality text, proposed_sale_percent_availability text,
  fact_as_of date, confidence numeric, provenance jsonb not null, evidence jsonb not null default '[]',
  calculation_basis jsonb not null default '{}', created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), primary key(event_id, proposed_sale_index)
);
grant select, insert, update, delete on all tables in schema public to service_role;
`;
}
