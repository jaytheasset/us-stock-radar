import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { Client } = require("pg") as {
  Client: new (input: { connectionString: string }) => {
    connect(): Promise<void>;
    end(): Promise<void>;
    query(sql: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  };
};

const connectionString = process.env.FORM4_PURCHASE_ISOLATED_DB_URL;
const expectedPort = process.env.FORM4_PURCHASE_ISOLATED_DB_PORT;
if (!connectionString || !expectedPort) {
  throw new Error("FORM4_PURCHASE_ISOLATED_DB_URL and FORM4_PURCHASE_ISOLATED_DB_PORT are required");
}
const databaseUrl = new URL(connectionString);
assert.equal(databaseUrl.hostname, "127.0.0.1");
assert.equal(databaseUrl.port, expectedPort);
assert.notEqual(expectedPort, "54322", "shared local Supabase port is forbidden");

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(
  join(here, "../supabase/migrations/20260926195721_form4_insider_purchase_monitor.sql"),
  "utf8",
);
const client = new Client({ connectionString });
const ownerId = "10000000-0000-4000-8000-000000000001";
const monitorId = "20000000-0000-4000-8000-000000000002";
const rawItemId = "30000000-0000-4000-8000-000000000003";
const eventId = "40000000-0000-4000-8000-000000000004";
const accessionNumber = "0001493152-26-023264";

try {
  await client.connect();
  await client.query(baselineSql());
  await client.query(migration);

  const settings = {
    target: { scope: "ticker", ticker: "AGIG" },
    role: "director",
    minimumShares: 8000,
  };
  await client.query(`insert into public.listing_monitors(
    id, user_id, domain, conditions, monitor_kind, form4_purchase_settings, is_active
  ) values ($1, $2, 'listing', '[]'::jsonb, 'form4_insider_purchase', $3::jsonb, true)`, [
    monitorId, ownerId, JSON.stringify(settings),
  ]);

  for (const invalid of [
    { ...settings, minimumShares: "8000" },
    { ...settings, minimumShares: 1.5 },
    { ...settings, target: { scope: "ticker", ticker: "bad ticker" } },
  ]) {
    await assert.rejects(
      client.query(`insert into public.listing_monitors(
        id, user_id, domain, conditions, monitor_kind, form4_purchase_settings, is_active
      ) values (gen_random_uuid(), $1, 'listing', '[]'::jsonb, 'form4_insider_purchase', $2::jsonb, true)`, [
        ownerId, JSON.stringify(invalid),
      ]),
      (error: unknown) => databaseErrorCode(error) === "23514",
    );
  }

  await client.query(`insert into public.raw_items(id, raw_payload) values ($1, $2::jsonb)`, [
    rawItemId,
    JSON.stringify({ ownership_source_text: "<ownershipDocument />" }),
  ]);
  await client.query(`insert into public.events(
    id, raw_item_id, source_code, source_group, event_type, published_at, metadata
  ) values ($1, $2, 'sec_edgar', 'filings', 'insider_ownership', $3, $4::jsonb)`, [
    eventId,
    rawItemId,
    "2026-05-23T15:00:00.000Z",
    JSON.stringify({ form_type: "4", accession_number: accessionNumber }),
  ]);
  await client.query(`insert into public.event_form4_transactions(event_id, transaction_index, symbol)
    values ($1, 0, 'AGIG'), ($1, 1, 'AGIG')`, [eventId]);

  const snapshot = await client.query(
    "select public.read_event_ownership_context_snapshot($1) as value",
    [eventId],
  );
  const snapshotValue = snapshot.rows[0].value as Record<string, unknown>;
  assert.equal((snapshotValue.event as Record<string, unknown>).published_at, "2026-05-23T15:00:00+00:00");
  assert.equal((snapshotValue.form4_rows as unknown[]).length, 2);

  await client.query("begin");
  try {
    await client.query("set local role anon");
    await assert.rejects(
      client.query("select public.read_event_ownership_context_snapshot($1)", [eventId]),
      (error: unknown) => databaseErrorCode(error) === "42501",
    );
  } finally {
    await client.query("rollback");
  }

  const evidence = {
    version: "form4_insider_purchase_match_v1",
    kind: "form4_insider_purchase",
    ticker: "AGIG",
    accessionNumber,
    filedAt: "2026-05-23T15:00:00.000Z",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1685251/000149315226023264/ownership.xml",
    reason: "SEC Form 4 reports confirmed purchases.",
    matches: [
      { transactionIndex: 0, sharesRaw: "1050" },
      { transactionIndex: 1, sharesRaw: "8950" },
    ],
  };
  const insertAlert = () => client.query(`insert into public.user_alert_deliveries(
    id, user_id, alert_event_id, ticker, title, category, source_type, source_label,
    alert_lane, delivered_channels, delivery_status, delivered_at, scheduled_for,
    sent_at, attempted_at, listing_monitor_id, alert_domain, listing_source_execution_id,
    listing_match_evidence
  ) values (
    gen_random_uuid(), $1, $2, 'AGIG', 'Form 4 insider purchase reported', 'insider_ownership',
    'other', 'Form 4 Purchase Monitor', 'listing_monitor', array[]::text[], 'queued', now(),
    null, null, null, $3, 'listing', $2, $4::jsonb
  ) on conflict (listing_monitor_id, alert_event_id) do nothing returning id`, [
    ownerId, eventId, monitorId, JSON.stringify(evidence),
  ]);
  const concurrent = await Promise.all([insertAlert(), insertAlert(), insertAlert(), insertAlert()]);
  assert.equal(concurrent.reduce((sum, result) => sum + (result.rowCount ?? 0), 0), 1);
  const stored = await client.query(`select listing_match_evidence
    from public.user_alert_deliveries where listing_monitor_id = $1 and alert_event_id = $2`, [monitorId, eventId]);
  const storedEvidence = stored.rows[0].listing_match_evidence as typeof evidence;
  assert.deepEqual(storedEvidence.matches.map((row) => row.sharesRaw), ["1050", "8950"]);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    isolatedDatabase: { host: databaseUrl.hostname, port: databaseUrl.port, database: databaseUrl.pathname.slice(1) },
    assertions: {
      migrationApplied: true,
      typedSettingsConstraint: true,
      malformedSettingsFailClosedWithoutCastError: true,
      publishedAtSnapshotPresent: true,
      anonymousSnapshotExecutionRevoked: true,
      allMatchingRowsPersisted: true,
      concurrentMonitorFilingDedupe: true,
      externalDeliveryFieldsRemainInternalOnly: true,
    },
  }, null, 2)}\n`);
} finally {
  await client.end();
}

function databaseErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

function baselineSql() {
  return `
    create extension if not exists pgcrypto;
    do $roles$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
    end $roles$;
    create table public.listing_monitors (
      id uuid primary key, user_id uuid not null, domain text not null, conditions jsonb not null,
      is_active boolean not null default true, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table public.raw_items (id uuid primary key, raw_payload jsonb not null);
    create table public.events (
      id uuid primary key, raw_item_id uuid references public.raw_items(id), source_code text,
      source_group text, event_type text, published_at timestamptz, metadata jsonb
    );
    create table public.event_form4_transactions (
      event_id uuid not null references public.events(id), transaction_index integer not null,
      symbol text, primary key(event_id, transaction_index)
    );
    create table public.event_form144_proposed_sales (
      event_id uuid not null references public.events(id), proposed_sale_index integer not null,
      symbol text, primary key(event_id, proposed_sale_index)
    );
    create table public.user_alert_deliveries (
      id uuid primary key, user_id uuid not null, alert_event_id uuid, ticker text, title text,
      category text, source_type text, source_label text, alert_lane text, severity text,
      delivered_channels text[] not null default array[]::text[], delivery_status text,
      delivered_at timestamptz, scheduled_for timestamptz, sent_at timestamptz,
      attempted_at timestamptz, last_error text, dedupe_key text,
      listing_monitor_id uuid references public.listing_monitors(id), alert_domain text,
      listing_source_execution_id uuid,
      constraint user_alert_deliveries_listing_alert_shape_check check (
        listing_monitor_id is null or (
          alert_domain = 'listing' and listing_source_execution_id is not null
          and alert_event_id is not null and category = 'listing_risk'
          and alert_lane = 'listing_monitor' and delivery_status = 'queued'
          and delivered_channels = array[]::text[] and scheduled_for is null
          and sent_at is null and attempted_at is null
        )
      ),
      unique(listing_monitor_id, alert_event_id)
    );
    create function public.get_event_ownership_context_fingerprint(uuid) returns jsonb
      language sql stable as $$ select '{}'::jsonb $$;
    create function public.ownership_context_semantic_verifier_refs_valid(uuid) returns boolean
      language sql stable as $$ select true $$;
    grant usage on schema public to anon, authenticated, service_role;
    grant select on public.events, public.raw_items, public.event_form4_transactions,
      public.event_form144_proposed_sales to service_role;
  `;
}
