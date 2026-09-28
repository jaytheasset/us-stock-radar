import assert from "node:assert/strict";
import pg from "pg";
import { resolveClassShareCountAt } from "../lib/sec-structured-data/classShareCountResolver.ts";
import { PostgresShareCountHistoryRepository } from "../lib/sec-structured-data/shareCountHistory.ts";
import { createSecOsProductionCollector } from "../lib/sec-structured-data/osProductionCollector.ts";
import { evaluateFinal424B4NewListingOs } from "../lib/sec-structured-data/prospectusOsBaseline.ts";
import { runSecRawIngest } from "../lib/secIngest.ts";
import {
  extractProspectusOsRawItemIds,
  runSecProspectusOsTriggerBridge,
} from "../lib/secProspectusOsTriggerBridge.ts";
import { fetchSecEdgarRawItems } from "../lib/sources/sec/parser.ts";
import { resolveSupabaseSecretKey } from "../lib/supabaseKeys.ts";

const dbUrl = process.env.NEW_LISTING_OS_ISOLATED_DB_URL;
const expectedPort = process.env.NEW_LISTING_OS_ISOLATED_DB_PORT;
const apiUrl = process.env.SUPABASE_URL;
if (!dbUrl || !expectedPort || !apiUrl || !resolveSupabaseSecretKey().key) {
  throw new Error("isolated database and Supabase API variables are required");
}
assertIsolatedTargets(new URL(dbUrl), expectedPort, new URL(apiUrl));
process.env.SUPABASE_DB_URL = dbUrl;
process.env.SEC_USER_AGENT ||= "US-Stock-Radar isolated new-listing O/S verification engineering@openai.com";

const CURX = {
  cik: "0002025942",
  accession: "0001493152-25-012350",
  form: "424B4",
  shares: "24000000",
  asOf: "2025-03-31",
};
const REVIEW_CASES = [
  { ticker: "XCH", cik: "0001979887", accession: "0001104659-24-098594" },
  { ticker: "HXHX", cik: "0001936817", accession: "0001213900-25-032325" },
] as const;
const { Client } = pg;
const client = new Client({ connectionString: dbUrl });

try {
  await client.connect();
  await assertCleanFeatureState(client);

  const ingested = await runSecRawIngest({
    accessionNumber: CURX.accession,
    cik: CURX.cik,
    formTypes: [CURX.form],
    force: true,
    includeDocuments: true,
    attachmentLimit: 1,
  });
  assert.equal(ingested.ok, true, JSON.stringify(ingested));
  const rawItemIds = extractProspectusOsRawItemIds(ingested.items ?? []);
  assert.equal(rawItemIds.length, 1, "real raw ingest must emit one stored 424B4 raw item");

  const first = await runSecProspectusOsTriggerBridge({ rawItemIds });
  assert.equal(first.status, "completed", JSON.stringify(first));
  assert.equal(first.results[0]?.decision.status, "AUTO_ACCEPT");
  if (first.results[0]?.decision.status !== "AUTO_ACCEPT") throw new Error("CURX was not accepted");
  assert.equal(first.results[0].decision.sharesOutstanding, CURX.shares);
  assert.equal(first.results[0].decision.asOf, CURX.asOf);
  assert.equal(first.results[0].persistence, "INSERTED");
  assert.equal(first.results[0].historyInserted, 1);
  assert.equal(first.results[0].snapshotInserted, 1);

  const stored = await featureCounts(client);
  assert.equal(stored.prospectusHistory, 1);
  assert.equal(stored.prospectusSnapshots, 1);
  assert.equal(stored.prospectusHistoryShares, CURX.shares);
  assert.equal(stored.prospectusSnapshotShares, CURX.shares);
  await assert.rejects(
    client.query(
      `update public.issuer_common_class_universe_snapshots
          set source_form = 'S-1'
        where issuer_cik = $1 and snapshot_version = 'issuer-common-class-universe-prospectus-text-v1'`,
      [CURX.cik],
    ),
    /issuer_common_class_universe_prospectus_text_check/,
  );
  await assert.rejects(
    client.query(
      `update public.share_count_history
          set source_provenance = jsonb_set(source_provenance, '{verifier,status}', '"Review"')
        where issuer_cik = $1 and source_type = 'sec_prospectus_text_authoritative_os'`,
      [CURX.cik],
    ),
    /share_count_history_prospectus_text_authoritative_check/,
  );

  const repository = new PostgresShareCountHistoryRepository(client);
  const classId = `sc:v1:${CURX.cik}:common_stock:single`;
  const beforeAcceptance = await resolveClassShareCountAt({
    repository,
    cik: CURX.cik,
    securityClassId: classId,
    targetAt: "2025-08-24T23:59:59.999Z",
  });
  assert.equal(beforeAcceptance.status, "UNAVAILABLE", "accepted-at must prevent look-ahead");
  const afterAcceptance = await resolveClassShareCountAt({
    repository,
    cik: CURX.cik,
    securityClassId: classId,
    targetAt: "2025-08-26T23:59:59.999Z",
  });
  assert.equal(afterAcceptance.status, "RESOLVED");
  assert.equal(afterAcceptance.sharesOutstanding, CURX.shares);
  assert.equal(afterAcceptance.asOf, CURX.asOf);

  const replay = await runSecProspectusOsTriggerBridge({ rawItemIds });
  assert.equal(replay.results[0]?.persistence, "DUPLICATE");
  assert.equal(replay.results[0]?.historyInserted, 0);
  assert.equal(replay.results[0]?.snapshotInserted, 0);

  const reviewResults = [];
  for (const fixture of REVIEW_CASES) {
    const fetched = await fetchSecEdgarRawItems({
      accessionNumber: fixture.accession,
      cik: fixture.cik,
      formTypes: ["424B4"],
      includeDocuments: true,
      attachmentLimit: 1,
      limit: 1,
    });
    assert.equal(fetched.ok, true, `${fixture.ticker} official fetch`);
    assert.equal(fetched.items.length, 1, `${fixture.ticker} exact filing count`);
    const raw = fetched.items[0]!;
    const decision = evaluateFinal424B4NewListingOs({
      id: "11111111-1111-4111-8111-111111111111",
      sourceUrl: raw.source_url,
      bodyText: raw.body_text ?? "",
      rawPayload: raw.raw_payload,
    });
    assert.equal(decision.status, "REVIEW", `${fixture.ticker} must be review-only`);
    reviewResults.push({ ticker: fixture.ticker, decision: decision.status, reason: decision.reason });
  }
  assert.deepEqual(await featureCounts(client), stored, "review and replay paths must write zero rows");

  const collector = createSecOsProductionCollector({
    sqlClient: client,
    userAgent: process.env.SEC_USER_AGENT,
  });
  const periodic = await collector.collectIssuer({ cik: CURX.cik, mode: "incremental" });
  assert.notEqual(periodic.status, "BASELINE_REQUIRED", "prospectus seed must be an incremental discovery boundary");
  assert.equal(periodic.incrementalBoundary?.status, "AVAILABLE");
  let incrementalBoundarySummary: string | undefined = periodic.incrementalBoundary?.status;
  if (periodic.incrementalBoundary?.status === "AVAILABLE") {
    assert.equal(periodic.incrementalBoundary.boundaryKind, "new_listing_prospectus");
    incrementalBoundarySummary = periodic.incrementalBoundary.boundaryKind;
  }
  const periodicRows = await client.query(
    `select count(*)::integer as count
       from public.share_count_history
      where issuer_cik = $1 and source_type = 'sec_authoritative_os'`,
    [CURX.cik],
  );
  const periodicCount = Number(periodicRows.rows[0]?.count ?? 0);
  assert.ok(periodicCount > 0, "first later periodic filing must create an authoritative row");

  const transitioned = await resolveClassShareCountAt({
    repository,
    cik: CURX.cik,
    securityClassId: classId,
    targetAt: "2026-09-01T23:59:59.999Z",
  });
  assert.equal(transitioned.status, "RESOLVED");
  assert.equal(transitioned.selectedObservation?.sourceType, "sec_authoritative_os");
  assert.ok(transitioned.asOf! > CURX.asOf);

  const prospectusBeforeGuard = await featureCounts(client);
  await client.query(
    `delete from public.issuer_common_class_universe_snapshots
      where issuer_cik = $1 and snapshot_version = 'issuer-common-class-universe-prospectus-text-v1'`,
    [CURX.cik],
  );
  await client.query(
    `delete from public.share_count_history
      where issuer_cik = $1 and source_type = 'sec_prospectus_text_authoritative_os'`,
    [CURX.cik],
  );
  const guarded = await runSecProspectusOsTriggerBridge({ rawItemIds });
  assert.equal(guarded.results[0]?.persistence, "PERIODIC_BASELINE_EXISTS");
  assert.equal(guarded.results[0]?.historyInserted, 0);
  assert.equal(guarded.results[0]?.snapshotInserted, 0);
  const afterGuard = await featureCounts(client);
  assert.equal(afterGuard.prospectusHistory, 0);
  assert.equal(afterGuard.prospectusSnapshots, 0);

  process.stdout.write(`${JSON.stringify({
    isolatedDbPort: expectedPort,
    rawIngest: { accession: CURX.accession, rawItemId: rawItemIds[0] },
    accepted: { sharesOutstanding: CURX.shares, asOf: CURX.asOf, writes: [1, 1] },
    replayWrites: [0, 0],
    reviews: reviewResults,
    resolverBeforeAcceptance: beforeAcceptance.status,
    resolverAfterAcceptance: afterAcceptance.status,
    incrementalBoundary: incrementalBoundarySummary,
    periodicRows: periodicCount,
    transitioned: { asOf: transitioned.asOf, sourceType: transitioned.selectedObservation?.sourceType },
    periodicGuardWrites: [guarded.results[0]?.historyInserted, guarded.results[0]?.snapshotInserted],
    prospectusRowsBeforeGuardCleanup: [prospectusBeforeGuard.prospectusHistory, prospectusBeforeGuard.prospectusSnapshots],
  })}\n`);
} finally {
  await client.end();
}

async function assertCleanFeatureState(connection: InstanceType<typeof Client>) {
  const counts = await featureCounts(connection);
  assert.equal(counts.prospectusHistory, 0);
  assert.equal(counts.prospectusSnapshots, 0);
}

async function featureCounts(connection: InstanceType<typeof Client>) {
  const result = await connection.query(`
    select
      (select count(*)::integer from public.share_count_history
        where issuer_cik = '${CURX.cik}' and source_type = 'sec_prospectus_text_authoritative_os') as prospectus_history,
      (select count(*)::integer from public.issuer_common_class_universe_snapshots
        where issuer_cik = '${CURX.cik}' and snapshot_version = 'issuer-common-class-universe-prospectus-text-v1') as prospectus_snapshots,
      (select max(shares_outstanding::text) from public.share_count_history
        where issuer_cik = '${CURX.cik}' and source_type = 'sec_prospectus_text_authoritative_os') as prospectus_history_shares,
      (select max(class_evidence -> 0 ->> 'sharesOutstanding') from public.issuer_common_class_universe_snapshots
        where issuer_cik = '${CURX.cik}' and snapshot_version = 'issuer-common-class-universe-prospectus-text-v1') as prospectus_snapshot_shares
  `);
  const row = result.rows[0]!;
  return {
    prospectusHistory: Number(row.prospectus_history),
    prospectusSnapshots: Number(row.prospectus_snapshots),
    prospectusHistoryShares: row.prospectus_history_shares as string | null,
    prospectusSnapshotShares: row.prospectus_snapshot_shares as string | null,
  };
}

function assertIsolatedTargets(database: URL, requiredPort: string, api: URL) {
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
  assert.ok(["127.0.0.1", "localhost"].includes(api.hostname));
  assert.equal(database.port, requiredPort);
  assert.equal(api.port, String(Number(requiredPort) - 1));
  assert.ok(!new Set(["54322", "56322"]).has(database.port), `shared database port ${database.port} is forbidden`);
}
