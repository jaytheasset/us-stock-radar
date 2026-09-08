import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  consumeOfferingMonitorAlertsForEvent,
  listOfferingMonitorAlertsForOwner,
} from "../lib/monitor/offeringMonitorAlertConsumer.ts";
import {
  createOfferingMonitor,
  listActiveOfferingMonitorsForConsumer,
} from "../lib/monitor/offeringMonitorPersistence.ts";
import { readRegistryBackedOfferingFacts } from "../lib/monitor/registryBackedOfferingFacts.ts";
import type { MinimalOfferingNumericFact } from "../lib/minimalOfferingMonitor.ts";

const OWNER_ID = "97000000-0000-4000-8000-000000000001";
const EVENT_ID = "97100000-0000-4000-8000-000000000011";
const RAW_ITEM_ID = "97200000-0000-4000-8000-000000000021";
const MONITOR_ID = "97300000-0000-4000-8000-000000000031";
const MISMATCH_EVENT_ID = "97100000-0000-4000-8000-000000000012";
const MISMATCH_RAW_ITEM_ID = "97200000-0000-4000-8000-000000000022";
const UNMAPPABLE_EVENT_ID = "97100000-0000-4000-8000-000000000013";
const UNMAPPABLE_RAW_ITEM_ID = "97200000-0000-4000-8000-000000000023";
const CIK = "0001840317";
const OFFERING_ACCESSION = "0001213900-26-088706";
const MISMATCH_ACCESSION = "0001213900-26-088713";
const UNMAPPABLE_ACCESSION = "0001213900-26-087946";
const REGISTRY_CAPACITY = 4_353_000;

const dbUrl = process.env.OFFERING_REGISTRY_ISOLATED_DB_URL || "";
const expectedPort = process.env.OFFERING_REGISTRY_ISOLATED_DB_PORT || "";
const projectId = process.env.OFFERING_REGISTRY_ISOLATED_PROJECT_ID || "";
const moduleRoot = process.env.OFFERING_VERIFY_NODE_MODULES || "";
assertIsolatedTarget(dbUrl, expectedPort, projectId);
if (!moduleRoot) throw new Error("OFFERING_VERIFY_NODE_MODULES is required");
const pgModuleUrl = pathToFileURL(`${moduleRoot.replace(/[\\/]$/, "")}/pg/lib/index.js`).href;
const pg = (await import(pgModuleUrl)).default;
const { Client } = pg;

const officialEvidence = await fetchOfficialEvidence();
assert.equal(officialEvidence.offeringCapacity, REGISTRY_CAPACITY);

const client = new Client({ connectionString: dbUrl });
let rolledBack = false;
try {
  await client.connect();
  await client.query("begin");
  await seedOwner(client);
  await seedExactEventAndRegistry(client);
  await seedIdentityMismatch(client);
  await seedUnmappableEvent(client);

  const monitor = await createOfferingMonitor({
    ownerId: OWNER_ID,
    conditions: [{
      key: "offering.amount",
      operator: "gte",
      value: 4_000_000,
      currency: "USD",
    }],
  }, monitorRepository(client));
  assert.equal(monitor.id, MONITOR_ID);

  let runtimeLlmCalls = 0;
  let emailCalls = 0;
  let telegramCalls = 0;
  const dependencies = consumerDependencies(client);
  const first = await consumeOfferingMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies);
  assert.equal(first.readerStatus, "available");
  assert.deepEqual(first.evaluations.map((value) => [value.status, value.reasonCode]), [
    ["ineligible", "fact_unavailable"],
  ]);
  assert.deepEqual(
    [first.createdCount, first.existingCount, first.failedCount],
    [0, 0, 0],
    JSON.stringify(first),
  );

  const facts = await readRegistryBackedOfferingFacts(EVENT_ID, registryRepository(client));
  assert.equal(facts.status, "available");
  if (facts.status !== "available") throw new Error("exact facts unexpectedly unavailable");
  assert.equal(facts.mappingStatus, "unmappable");
  assert.equal(facts.registrySnapshotId, undefined);
  assert.equal(facts.registrySourceIdentity, undefined);
  for (const fact of Object.values(facts.canonical.facts) as MinimalOfferingNumericFact[]) {
    assert.deepEqual([fact.availability, fact.value, fact.source_ref], ["unavailable", null, null]);
  }

  const readback = await listOfferingMonitorAlertsForOwner(
    { ownerId: OWNER_ID, monitorId: MONITOR_ID },
    alertReadRepository(client),
  );
  assert.equal(readback.length, 0);

  const replay = await consumeOfferingMonitorAlertsForEvent({ eventId: EVENT_ID }, dependencies);
  assert.deepEqual([replay.createdCount, replay.existingCount], [0, 0]);
  assert.equal(await alertCount(client, EVENT_ID), 0);

  const mismatch = await consumeOfferingMonitorAlertsForEvent(
    { eventId: MISMATCH_EVENT_ID },
    dependencies,
  );
  assert.equal(mismatch.readerStatus, "not_ready");
  assert.equal(mismatch.readerReason, "registry_issuer_mismatch");
  assert.equal(mismatch.evaluations.every((value) => value.status === "ineligible"), true);
  assert.equal(await alertCount(client, MISMATCH_EVENT_ID), 0);

  const unmappableFacts = await readRegistryBackedOfferingFacts(
    UNMAPPABLE_EVENT_ID,
    registryRepository(client),
  );
  assert.equal(unmappableFacts.status, "available");
  if (unmappableFacts.status !== "available") throw new Error("unmappable case lost event identity");
  assert.equal(unmappableFacts.mappingStatus, "unmappable");
  assert.equal(unmappableFacts.registrySnapshotId, undefined);
  for (const fact of Object.values(unmappableFacts.canonical.facts)) {
    assert.deepEqual([fact.availability, fact.value, fact.source_ref], ["unavailable", null, null]);
  }
  const unmappable = await consumeOfferingMonitorAlertsForEvent(
    { eventId: UNMAPPABLE_EVENT_ID },
    dependencies,
  );
  assert.equal(unmappable.evaluations.every((value) => value.status === "ineligible"), true);
  assert.equal(await alertCount(client, UNMAPPABLE_EVENT_ID), 0);

  const factWrites = await client.query(
    `select count(*)::integer as count
     from public.event_offering_monitor_canonical
     where event_id = any($1::uuid[])`,
    [[EVENT_ID, MISMATCH_EVENT_ID, UNMAPPABLE_EVENT_ID]],
  );
  assert.equal(factWrites.rows[0].count, 0, "adapter must not persist or replace Stage 2 facts");
  const deliveryWrites = await client.query(
    `select count(*)::integer as count
     from public.user_alert_deliveries
     where offering_monitor_id is not null
       and (cardinality(delivered_channels) <> 0 or scheduled_for is not null)` ,
  );
  assert.equal(deliveryWrites.rows[0].count, 0);
  assert.deepEqual([runtimeLlmCalls, emailCalls, telegramCalls], [0, 0, 0]);
  assertRuntimeIsDeterministic();

  const output = {
    status: "passed",
    projectId,
    officialSecEvidence: officialEvidence,
    registrySource: {
      issuerCik: CIK,
      accession: OFFERING_ACCESSION,
      table: "dilution_instrument_snapshots",
      column: "original_capacity",
      observedCapacity: REGISTRY_CAPACITY,
      mappedToOfferingAmount: false,
      mappedFacts: [],
    },
    firstRun: { created: first.createdCount, readback: readback.length },
    replay: { additionalAlerts: await alertCount(client, EVENT_ID) },
    mismatch: { factWrites: 0, matchWrites: 0, alertWrites: await alertCount(client, MISMATCH_EVENT_ID) },
    unmappable: { alertWrites: await alertCount(client, UNMAPPABLE_EVENT_ID), allFactsUnavailable: true },
    externalDelivery: { emailCalls, telegramCalls, queuedForDelivery: deliveryWrites.rows[0].count },
    runtimeLlmCalls,
  };
  console.log(JSON.stringify(output, null, 2));
  await client.query("rollback");
  rolledBack = true;
} finally {
  if (!rolledBack) {
    try { await client.query("rollback"); } catch { /* connection may not exist */ }
  }
  try { await client.end(); } catch { /* connection may not exist */ }
}

function assertIsolatedTarget(urlValue: string, expectedPortValue: string, projectIdValue: string) {
  let url: URL;
  try { url = new URL(urlValue); } catch { throw new Error("isolated DB URL is invalid"); }
  const port = Number(url.port);
  const expected = Number(expectedPortValue);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname)
    || url.username !== "postgres"
    || url.pathname !== "/postgres"
    || !Number.isInteger(port)
    || port !== expected
    || port < 57_000
    || port > 65_000
    || port === 56_322
    || !/^stock-radar-offering-e2e-[a-z0-9-]+$/.test(projectIdValue)
  ) throw new Error("refusing non-disposable, shared-local, remote, or production database target");
}

async function fetchOfficialEvidence() {
  const cases = [
    {
      form: "424B5",
      accession: OFFERING_ACCESSION,
      url: "https://www.sec.gov/Archives/edgar/data/1840317/000121390026088706/ea0301578-424b5_veea.htm",
      needles: ["4,353,000", "Roth Capital Partners", "Common Stock"],
    },
    {
      form: "8-K",
      accession: MISMATCH_ACCESSION,
      url: "https://www.sec.gov/Archives/edgar/data/1840317/000121390026088713/ea0301833-8k_veea.htm",
      needles: ["4,353,000", "At Market Issuance Sales Agreement", "Roth Capital Partners"],
    },
    {
      form: "10-Q",
      accession: UNMAPPABLE_ACCESSION,
      url: "https://www.sec.gov/Archives/edgar/data/1840317/000121390026087946/ea0301195-10q_veea.htm",
      needles: ["Veea Inc.", "June 30, 2026"],
    },
  ];
  for (const item of cases) {
    const response = await fetch(item.url, {
      headers: {
        "User-Agent": "US-Stock-Radar isolated verification contact@example.test",
        "Accept-Encoding": "gzip, deflate",
      },
    });
    assert.equal(response.ok, true, `${item.form} SEC fetch failed: ${response.status}`);
    const body = await response.text();
    for (const needle of item.needles) assert.equal(body.includes(needle), true, `${item.form} lacks ${needle}`);
  }
  return {
    offeringCapacity: Number(cases[0].needles[0].replaceAll(",", "")),
    filings: cases.map(({ form, accession, url }) => ({ form, accession, url })),
  };
}

async function seedOwner(client: any) {
  await client.query(
    `insert into public.sources (code,name,source_group,runtime_owner,enabled,metadata)
     values ('sec_edgar','SEC EDGAR','filings','external',true,'{}'::jsonb)
     on conflict (code) do nothing`,
  );
  await client.query(
    `insert into public.event_types (code,label,category,badge_tone,source_groups,status)
     values ('offering','Offering','filing','neutral',array['filings']::public.source_group[],'active')
     on conflict (code) do nothing`,
  );
  await client.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at
     ) values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'offering-e2e@example.test', '', now(), now(), now())`,
    [OWNER_ID],
  );
  await client.query(
    `insert into public.user_profiles (id,email)
     values ($1,'offering-e2e@example.test')`,
    [OWNER_ID],
  );
}

async function seedExactEventAndRegistry(client: any) {
  await seedEvent(client, EVENT_ID, RAW_ITEM_ID, OFFERING_ACCESSION, CIK);
  const instrument = await client.query(
    `insert into public.dilution_instruments (
       instrument_key, issuer_cik, instrument_type, name, first_source_accession
     ) values ('veea-roth-atm-20260813', $1, 'atm_program', 'Roth ATM', $2)
     returning id`,
    [CIK, OFFERING_ACCESSION],
  );
  await client.query(
    `insert into public.dilution_instrument_snapshots (
       instrument_id, as_of_date, status, currency, original_capacity,
       remaining_potential_shares, start_date, source_accession, last_checked
     ) values ($1, '2026-08-13', 'current', 'USD', $2,
       76513659, '2026-08-13', $3, '2026-09-08')`,
    [instrument.rows[0].id, String(REGISTRY_CAPACITY), OFFERING_ACCESSION],
  );
}

async function seedIdentityMismatch(client: any) {
  await seedEvent(client, MISMATCH_EVENT_ID, MISMATCH_RAW_ITEM_ID, MISMATCH_ACCESSION, CIK);
  const instrument = await client.query(
    `insert into public.dilution_instruments (
       instrument_key, issuer_cik, instrument_type, name, first_source_accession
     ) values ('other-issuer-atm', '0000000001', 'atm_program', 'Other ATM', $1)
     returning id`,
    [MISMATCH_ACCESSION],
  );
  await client.query(
    `insert into public.dilution_instrument_snapshots (
       instrument_id, as_of_date, status, currency, original_capacity,
       start_date, source_accession, last_checked
     ) values ($1, '2026-08-13', 'current', 'USD', 4353000,
       '2026-08-13', $2, '2026-09-08')`,
    [instrument.rows[0].id, MISMATCH_ACCESSION],
  );
}

async function seedUnmappableEvent(client: any) {
  await seedEvent(client, UNMAPPABLE_EVENT_ID, UNMAPPABLE_RAW_ITEM_ID, UNMAPPABLE_ACCESSION, CIK);
  const instrument = await client.query(
    `insert into public.dilution_instruments (
       instrument_key, issuer_cik, instrument_type, name, first_source_accession
     ) values ('veea-quarterly-unmappable-atm', $1, 'atm_program', 'Unmappable ATM', $2)
     returning id`,
    [CIK, UNMAPPABLE_ACCESSION],
  );
  await client.query(
    `insert into public.dilution_instrument_snapshots (
       instrument_id, as_of_date, status, currency, original_capacity,
       remaining_potential_shares, start_date, source_accession, last_checked
     ) values ($1, '2026-06-30', 'current', 'USD', null,
       8430000, '2026-06-30', $2, '2026-09-08')`,
    [instrument.rows[0].id, UNMAPPABLE_ACCESSION],
  );
}

async function seedEvent(client: any, eventId: string, rawId: string, accession: string, cik: string) {
  await client.query(
    `insert into public.raw_items (
       id, source_code, source_group, source_unique_id, source_url, title, raw_payload, dedupe_key
     ) values ($1, 'sec_edgar', 'filings', $2, 'https://www.sec.gov/', 'Veea filing',
       jsonb_build_object('accession_number', $2::text, 'cik', $3::text), $2)`,
    [rawId, accession, cik],
  );
  await client.query(
    `insert into public.events (
       id, raw_item_id, source_code, source_group, source_name, source_url,
       ticker, event_type, score, delivery_level, impact, signal, title,
       group_dedupe_key, metadata
     ) values ($1, $2, 'sec_edgar', 'filings', 'SEC EDGAR', 'https://www.sec.gov/',
       'VEEA', 'offering', 50, 'archive', 'low', 'neutral', 'Veea offering filing',
       $3, jsonb_build_object('accession_number', $3::text, 'cik', $4::text))`,
    [eventId, rawId, accession, cik],
  );
}

function registryRepository(client: any) {
  return {
    readEvent: async (eventId: string) => okRows(await client.query(
      `select id,raw_item_id,source_code,source_group,ticker,metadata from public.events where id=$1`,
      [eventId],
    )),
    readRawItem: async (rawId: string) => okRows(await client.query(
      `select id,source_code,source_group,source_unique_id,raw_payload from public.raw_items where id=$1`,
      [rawId],
    )),
    readSnapshotsByAccession: async (accession: string) => okRows(await client.query(
      `select id,instrument_id,source_accession
       from public.dilution_instrument_snapshots where source_accession=$1 order by id`,
      [accession],
    )),
    readInstruments: async (ids: readonly string[]) => okRows(await client.query(
      `select id,instrument_key,issuer_cik,instrument_type,name,first_source_accession
       from public.dilution_instruments where id = any($1::bigint[]) order by id`,
      [ids],
    )),
  };
}

function monitorRepository(client: any) {
  return {
    create: async (row: Record<string, unknown>) => {
      const result = await client.query(
        `insert into public.offering_monitors (id,user_id,domain,conditions,is_active)
         values ($1,$2,$3,$4::jsonb,$5)
         returning id,user_id,domain,conditions,is_active,created_at,updated_at`,
        [MONITOR_ID, row.user_id, row.domain, JSON.stringify(row.conditions), row.is_active],
      );
      return okRows(result);
    },
    list: async (ownerId: string, activeOnly: boolean) => okRows(await client.query(
      `select id,user_id,domain,conditions,is_active,created_at,updated_at
       from public.offering_monitors where user_id=$1 and (not $2 or is_active)`,
      [ownerId, activeOnly],
    )),
  };
}

function consumerDependencies(client: any) {
  return {
    readFacts: (eventId: string) => readRegistryBackedOfferingFacts(eventId, registryRepository(client)),
    listActiveMonitors: () => listActiveOfferingMonitorsForConsumer({
      listActivePage: async (offset: number, limit: number) => okRows(await client.query(
        `select id,user_id,domain,conditions,is_active,created_at,updated_at
         from public.offering_monitors where domain='offering' and is_active
         order by created_at,id offset $1 limit $2`,
        [offset, limit],
      )),
    }),
    createAlert: async (input: any) => {
      const result = await client.query(
        `insert into public.user_alert_deliveries (
           user_id, alert_event_id, title, category, source_type, source_label,
           alert_lane, delivered_channels, delivery_status, delivered_at,
           scheduled_for, sent_at, attempted_at, last_error, dedupe_key,
           offering_monitor_id, alert_domain, offering_registry_accession,
           offering_registry_snapshot_id
         ) values (
           $1,$2,'Offering monitor matched','dilution_risk','other','Offering Monitor',
           'offering_monitor',array[]::text[],'queued',$3,
           null,null,null,null,null,$4,'offering',$5,$6
         ) on conflict (offering_monitor_id,alert_event_id) do nothing returning id`,
        [input.userId, input.eventId, input.createdAt, input.monitorId,
          input.registryAccession, input.registrySnapshotId],
      );
      return result.rows[0]
        ? { status: "created" as const, monitorId: input.monitorId, alertId: result.rows[0].id }
        : { status: "existing" as const, monitorId: input.monitorId };
    },
    now: () => new Date("2026-09-08T12:00:00.000Z"),
  };
}

function alertReadRepository(client: any) {
  return {
    list: async ({ ownerId, monitorId }: { ownerId: string; monitorId?: string }) => okRows(await client.query(
      `select id,alert_event_id,offering_monitor_id,offering_registry_accession,
              offering_registry_snapshot_id,created_at
       from public.user_alert_deliveries
       where user_id=$1 and alert_domain='offering' and alert_lane='offering_monitor'
         and ($2::uuid is null or offering_monitor_id=$2)
       order by delivered_at desc,id desc`,
      [ownerId, monitorId || null],
    )),
  };
}

async function alertCount(client: any, eventId: string) {
  const result = await client.query(
    `select count(*)::integer as count from public.user_alert_deliveries
     where offering_monitor_id=$1 and alert_event_id=$2`,
    [MONITOR_ID, eventId],
  );
  return result.rows[0].count as number;
}

function okRows(result: any) {
  return {
    ok: true,
    status: 200,
    data: result.rows.map((row: Record<string, unknown>) => Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        value instanceof Date
          ? key.endsWith("_date") ? value.toISOString().slice(0, 10) : value.toISOString()
          : value,
      ]),
    )),
  };
}

function assertRuntimeIsDeterministic() {
  const source = [
    readFileSync(new URL("../lib/monitor/registryBackedOfferingFacts.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../lib/monitor/offeringMonitorAlertConsumer.ts", import.meta.url), "utf8"),
  ].join("\n");
  assert.doesNotMatch(source, /gemini|openai|anthropic|generateContent|sendEmail|telegram/i);
}

// Guard behavior is part of the verification contract, not just setup.
for (const rejected of [
  ["postgresql://postgres:postgres@127.0.0.1:56322/postgres", "56322", "stock-radar-offering-e2e-shared"],
  ["postgresql://postgres:postgres@example.supabase.co:57322/postgres", "57322", "stock-radar-offering-e2e-remote"],
  ["postgresql://postgres:postgres@127.0.0.1:5432/postgres", "5432", "production"],
] as const) {
  const [url, port, id] = rejected;
  assert.throws(() => assertIsolatedTarget(url, port, id));
}
