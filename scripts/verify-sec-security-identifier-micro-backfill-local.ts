/** Bounded, real SEC micro-backfill. Never runs analysis, 13F holdings, or alerts. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { Client } from "pg";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export%20%7B%7D;" };
    return nextResolve(specifier, context);
  },
});

type Target = Readonly<{
  label: string;
  cusip: string;
  accessions: readonly Readonly<{ accession: string; archiveCik: string }>[];
  cover?: Readonly<{ accession: string; archiveCik: string }>;
}>;

// Every CUSIP below is in the stored 2026 Q2 SEC Official List. Accessions
// are deliberately fixed so reruns assess the same source set.
const targets: readonly Target[] = [
  { label: "AGL", cusip: "00857U206", accessions: [{ accession: "0001167557-26-000123", archiveCik: "1167557" }], cover: { accession: "0001628280-26-053355", archiveCik: "1831097" } },
  { label: "ATO", cusip: "049560105", accessions: [{ accession: "0000902219-26-000262", archiveCik: "731802" }], cover: { accession: "0000731802-26-000102", archiveCik: "731802" } },
  { label: "EVH", cusip: "30050B101", accessions: [{ accession: "0000895421-26-000280", archiveCik: "895421" }], cover: { accession: "0001628908-26-000086", archiveCik: "1628908" } },
  { label: "PTON", cusip: "70614W100", accessions: [
    { accession: "0000912282-26-001063", archiveCik: "1456670" },
    { accession: "0000102909-26-002038", archiveCik: "102909" },
  ] },
  { label: "IMKTA", cusip: "457030104", accessions: [
    { accession: "0000052388-26-000276", archiveCik: "50493" },
    { accession: "0002100119-26-001396", archiveCik: "50493" },
  ] },
  { label: "GS ETF", cusip: "38149W382", accessions: [{ accession: "0001085146-26-000765", archiveCik: "1479026" }] },
  { label: "Founder", cusip: "G3662E121", accessions: [{ accession: "0002088488-26-000030", archiveCik: "1989930" }] },
  { label: "Amerant", cusip: "023576101", accessions: [{ accession: "0002100119-26-001325", archiveCik: "1734342" }] },
  { label: "Telos", cusip: "87969B101", accessions: [{ accession: "0002012383-26-003106", archiveCik: "320121" }] },
  { label: "Miami Intl", cusip: "59356Q108", accessions: [{ accession: "0001897612-26-000622", archiveCik: "1438472" }] },
  { label: "AAPL", cusip: "037833100", accessions: [{ accession: "0000932471-25-000778", archiveCik: "102909" }] },
];

const expectedSnapshotSha = "42e524a7d6901bdba97d517441452453b3630466f614a6fe9d9b282b200e0849";
const dbUrl = process.env.SUPABASE_DB_URL;
assert.ok(dbUrl && process.env.SEC_USER_AGENT && process.env.SUPABASE_SERVICE_ROLE_KEY, "Local DB, SEC user agent, and local service key are required");
const dbTarget = new URL(dbUrl);
assert.equal(dbTarget.hostname, "127.0.0.1");
assert.equal(dbTarget.port, "56322");
assert.equal(dbTarget.pathname, "/postgres");
const apiTarget = new URL(process.env.SUPABASE_URL ?? "");
assert.equal(apiTarget.port, "56321", "Expected the existing local Supabase API");
// .env.local may contain an obsolete LAN host; use the same local API via loopback
// for this process only. No environment or repository file is changed.
process.env.SUPABASE_URL = "http://127.0.0.1:56321";
delete process.env.FMP_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.OPENAI_API_KEY;
process.env.ALERT_DELIVERY_SEND_EMAIL = "false";
process.env.ALERT_DELIVERY_SEND_TELEGRAM = "false";

const [parser, sc13Canonical, sc13Persistence, coverPersistence, rawStore, mapping, sources, supabase] = await Promise.all([
  import("../lib/sources/sec/parser.ts"),
  import("../lib/sec-sc13-xml/canonical.ts"),
  import("../lib/sec-sc13-xml/persistence.ts"),
  import("../lib/sec-cover-observations/persistence.ts"),
  import("../lib/secStores/rawStore.ts"),
  import("../lib/sec-security-identifiers/mapping.ts"),
  import("../lib/sec-security-identifiers/sources.ts"),
  import("../lib/supabase.ts"),
]);

const db = new Client({ connectionString: dbUrl });
await db.connect();
const runId = randomUUID();
const artifactPath = path.join(homedir(), ".codex", "visualizations", "2026", "09", "30", "sec-cusip-micro-backfill", `${runId}.json`);
const audit: Record<string, unknown> = {
  version: "sec-cusip-micro-backfill-v1",
  runId,
  startedAt: new Date().toISOString(),
  dbTarget: { host: dbTarget.hostname, port: dbTarget.port, database: dbTarget.pathname },
  officialList: { quarter: "2026Q2", sourceSha256: expectedSnapshotSha },
  targetCusips: targets.map(({ label, cusip }) => ({ label, cusip })),
  accessions: [], covers: [], mappings: [],
};
let runStarted = false;
try {
  const snapshot = await db.query<{ id: number; source_sha256: string }>(
    "select id,source_sha256 from public.sec_13f_official_list_snapshots where quarter='2026Q2' order by id desc limit 1",
  );
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].source_sha256, expectedSnapshotSha);
  const listed = await db.query<{ cusip: string }>(
    `select distinct cusip from public.sec_13f_official_list_entries
      where snapshot_id=$1 and cusip=any($2::text[]) and status<>'deleted'
        and security_description not in ('CALL','PUT')`,
    [snapshot.rows[0].id, targets.map((target) => target.cusip)],
  );
  assert.equal(listed.rows.length, targets.length, "Every target must be an active non-option Official List entry");
  const apiSnapshot = await supabase.supabaseSelect("sec_13f_official_list_snapshots", {
    select: "id,source_sha256", id: `eq.${snapshot.rows[0].id}`, limit: "1",
  });
  assert.equal(apiSnapshot.ok, true);
  assert.equal((apiSnapshot.data as Array<{ source_sha256: string }>)[0]?.source_sha256, expectedSnapshotSha);

  const source = await db.query("select enabled from public.sources where code='sec_edgar'");
  assert.equal(source.rows[0]?.enabled, true, "Existing SEC source must be enabled");
  const startedAt = new Date().toISOString();
  await rawStore.createSecSourceRun({
    force: false, includeDocuments: true, requestedFormTypes: ["SCHEDULE 13D", "SCHEDULE 13G"],
    requestedLimit: targets.reduce((sum, target) => sum + target.accessions.length, 0) + targets.filter((target) => target.cover).length,
    runId, startedAt,
    metadata: { purpose: "bounded_sec_cusip_micro_backfill_validation", model_calls: 0, monitor_calls: 0 },
  });
  runStarted = true;

  const accessionAudit: Record<string, unknown>[] = [];
  for (const target of targets) {
    for (const source of target.accessions) {
      const itemAudit: Record<string, unknown> = { label: target.label, cusip: target.cusip, accession: source.accession };
      accessionAudit.push(itemAudit);
      try {
        const existing = await rawStore.findExistingSecRawItem({ source_code: "sec_edgar", source_unique_id: source.accession } as never);
        const fetched = await parser.fetchSecEdgarRawItems({ accessionNumber: source.accession, cik: source.archiveCik, includeDocuments: true });
        assert.equal(fetched.ok, true, fetched.error);
        assert.equal(fetched.items.length, 1);
        const raw = fetched.items[0];
        itemAudit.sourceUrl = raw.raw_payload.sc13_source_url;
        itemAudit.sourceSha256 = sha256(String(raw.raw_payload.sc13_source_text ?? ""));
        itemAudit.form = raw.raw_payload.form_type;
        const preflight = sc13Canonical.buildSc13CanonicalPayload(existing?.id as string || randomUUID(), raw);
        assert.ok(preflight);
        assert.ok((preflight.filing.cusips_raw as string[]).includes(target.cusip), "SC13 XML does not support the selected CUSIP");
        const saved = existing ?? await rawStore.saveSecRawItem(raw, runId);
        const result = await sc13Persistence.persistSc13CanonicalXmlForRawItem({ rawItemId: String(saved.id), rawItem: raw });
        assert.equal(result.status, "available");
        const read = await sc13Persistence.readSc13FilingByAccession(source.accession);
        assert.equal(read.status, "available", "Canonical SC13 reader did not return validated XML");
        itemAudit.rawItemId = saved.id;
        itemAudit.writeStatus = result.writeStatus;
        itemAudit.readback = read.status;
        itemAudit.issuerCik = read.filing.issuer_cik;
        itemAudit.securityTitle = read.filing.security_class_raw;
        itemAudit.cusips = read.filing.cusips_raw;
        const replay = await sc13Persistence.persistSc13CanonicalXmlForRawItem({ rawItemId: String(saved.id), rawItem: raw });
        assert.equal(replay.status, "available");
        assert.equal(replay.writeStatus, "replayed");
        itemAudit.replay = replay.writeStatus;
      } catch (error) {
        itemAudit.error = error instanceof Error ? error.message : String(error);
        itemAudit.errorCode = (error as { code?: string })?.code ?? null;
        itemAudit.issues = (error as { issues?: unknown })?.issues ?? null;
      }
    }
  }
  audit.accessions = accessionAudit;

  const coverAudit: Record<string, unknown>[] = [];
  for (const target of targets.filter((row) => row.cover)) {
    const source = target.cover!;
    const itemAudit: Record<string, unknown> = { label: target.label, accession: source.accession };
    coverAudit.push(itemAudit);
    try {
      const existing = await rawStore.findExistingSecRawItem({ source_code: "sec_edgar", source_unique_id: source.accession } as never);
      const fetched = await parser.fetchSecEdgarRawItems({ accessionNumber: source.accession, cik: source.archiveCik, includeDocuments: true });
      assert.equal(fetched.ok, true, fetched.error);
      assert.equal(fetched.items.length, 1);
      const raw = fetched.items[0];
      const saved = existing ?? await rawStore.saveSecRawItem(raw, runId);
      const result = await coverPersistence.persistSecCoverObservationsForRawItem({ rawItemId: String(saved.id), rawItem: raw });
      assert.equal(result.status, "available");
      const read = await coverPersistence.readSecCoverObservations({ accessionNumber: source.accession });
      assert.equal(read.status, "available", "Official cover reader did not return validated observations");
      itemAudit.sourceUrl = raw.raw_payload.primary_document_url;
      itemAudit.sourceSha256 = result.sourceSha256;
      itemAudit.rawItemId = saved.id;
      itemAudit.writeStatus = result.writeStatus;
      itemAudit.readback = read.status;
      itemAudit.extractionStatus = result.extractionStatus;
      itemAudit.observations = sources.secClassTickerObservationsFromCover(read)
        .filter((row) => row.kind === "class_ticker")
        .map((row) => ({ securityTitle: row.securityTitle, ticker: row.ticker, locator: row.evidence.locator }));
      const replay = await coverPersistence.persistSecCoverObservationsForRawItem({ rawItemId: String(saved.id), rawItem: raw });
      assert.equal(replay.status, "available");
      assert.equal(replay.writeStatus, "replayed");
      itemAudit.replay = replay.writeStatus;
    } catch (error) {
      itemAudit.error = error instanceof Error ? error.message : String(error);
      itemAudit.errorCode = (error as { code?: string })?.code ?? null;
    }
  }
  audit.covers = coverAudit;

  const catalogUrl = "https://www.sec.gov/files/company_tickers.json";
  const catalogResponse = await fetch(catalogUrl, { headers: { "User-Agent": process.env.SEC_USER_AGENT!, Accept: "application/json" }, cache: "no-store" });
  assert.equal(catalogResponse.ok, true, `SEC current ticker catalog HTTP ${catalogResponse.status}`);
  const catalogBody = await catalogResponse.text();
  const catalogFetchedAt = new Date().toISOString();
  const catalogRows = Object.values(JSON.parse(catalogBody)) as Array<{ cik_str: number; ticker: string }>;
  audit.currentCatalog = { sourceUrl: catalogUrl, sourceSha256: sha256(catalogBody), fetchedAt: catalogFetchedAt, rowCount: catalogRows.length };

  // Read every canonical pilot source back, then bridge only official reader results.
  const storedSc13 = await db.query<{ accession_number: string }>("select accession_number from public.sec_sc13_filings order by accession_number");
  const storedCover = await db.query<{ accession_number: string }>("select distinct accession_number from public.sec_cover_observation_results order by accession_number");
  const observations: Array<ReturnType<typeof sources.secCusipClassObservationsFromSc13>[number]> = [];
  for (const row of storedSc13.rows) {
    const read = await sc13Persistence.readSc13FilingByAccession(row.accession_number);
    assert.equal(read.status, "available");
    observations.push(...sources.secCusipClassObservationsFromSc13(read));
  }
  for (const row of storedCover.rows) {
    const read = await coverPersistence.readSecCoverObservations({ accessionNumber: row.accession_number });
    assert.equal(read.status, "available");
    observations.push(...sources.secClassTickerObservationsFromCover(read));
  }
  observations.push(...sources.secCurrentTickerObservations(catalogRows, catalogFetchedAt));
  const mappings = targets.map((target) => {
    const result = mapping.resolveSecSecurityIdentifier({ cusip: target.cusip, asOf: catalogFetchedAt, observations });
    return { label: target.label, cusip: target.cusip, ...result };
  });
  audit.mappings = mappings;
  audit.counts = {
    trusted: mappings.filter((row) => row.status === "trusted").length,
    unmapped: mappings.filter((row) => row.status === "unmapped").length,
    conflict: mappings.filter((row) => row.status === "conflict").length,
  };
  audit.rawCounts = (await db.query(
    "select source_unique_id,count(*)::int n from public.raw_items where source_unique_id=any($1::text[]) group by source_unique_id order by source_unique_id",
    [accessionAudit.filter((row) => row.readback === "available").map((row) => row.accession)],
  )).rows;
  assert.ok((audit.rawCounts as Array<{ n: number }>).every((row) => row.n === 1), "Duplicate raw accession detected");
  audit.completedAt = new Date().toISOString();
  await rawStore.finishSecSourceRun(runId, "completed", startedAt, { targets: targets.length, ...audit.counts as Record<string, number> }, undefined, { purpose: "bounded_sec_cusip_micro_backfill_validation" });
  runStarted = false;
} catch (error) {
  audit.fatalError = error instanceof Error ? error.message : String(error);
  audit.completedAt = new Date().toISOString();
  if (runStarted) {
    await rawStore.finishSecSourceRun(runId, "failed", String(audit.startedAt), {}, String(audit.fatalError), { purpose: "bounded_sec_cusip_micro_backfill_validation" });
  }
} finally {
  await db.end();
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(audit, null, 2)}\n`);
  console.log(JSON.stringify({ artifactPath, runId, counts: audit.counts, fatalError: audit.fatalError, accessions: audit.accessions, covers: audit.covers, mappings: (audit.mappings as Array<Record<string, unknown>>).map((row) => ({ label: row.label, cusip: row.cusip, status: row.status, reason: row.reason, ticker: row.ticker })) }));
}
if (audit.fatalError) process.exitCode = 1;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
