import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import nextEnv from "@next/env";
// @ts-expect-error The project uses pg from JavaScript scripts without bundled declarations.
import { Client } from "pg";

import type { DilutionRegistryOsSourceBundle } from "../lib/dilution-registry/osPreview.ts";
import {
  fetchOfficialSecFilingDocument,
  normalizeSecDocumentText,
} from "../lib/dilution-registry/osPreviewSecFallback.ts";
import type { DilutionRegistryPayload } from "../lib/dilution-registry/preview.ts";
import {
  PostgresSecFilingXbrlArtifactRepository,
  type SecFilingXbrlRawArtifact,
} from "../lib/sec-structured-data/filingXbrlContext.ts";
import {
  PostgresIssuerCommonClassUniverseRepository,
  type IssuerCommonClassUniverseRepository,
  type IssuerCommonClassUniverseSnapshot,
} from "../lib/sec-structured-data/issuerCommonClassUniverse.ts";
import { resolveIssuerTotalCommonSharesAt } from "../lib/sec-structured-data/issuerTotalCommonSharesAggregator.ts";
import {
  createPostgresHumanVerifiedShareCountWriter,
  readExactFilingLedger,
} from "../lib/sec-structured-data/humanVerifiedShareCountObservation.ts";
import { createSecOsProductionCollector } from "../lib/sec-structured-data/osProductionCollector.ts";
import { SecRequestPolicy } from "../lib/sec-structured-data/secRequestPolicy.ts";
import {
  PostgresShareCountHistoryRepository,
  type ShareCountHistoryRepository,
} from "../lib/sec-structured-data/shareCountHistory.ts";
import type { StockSplitExecutionReadInput } from "../lib/sec-structured-data/stockSplitShareBasisNormalizer.ts";

nextEnv.loadEnvConfig(process.env.STOCK_RADAR_ENV_DIR ?? process.cwd(), true, { info() {}, error() {} });

const CIK = "0001840317";
const Q1_ACCESSION = "0001213900-26-057059";
const S3_ACCESSION = "0001213900-26-072701";
const S3_DOCUMENT = "ea0295954-s3_veea.htm";
const S3_EVIDENCE = "The aggregate market value\nof our outstanding common stock held by non-affiliates pursuant to General Instruction I.B.6 of Form S-3 was $20,529,470, which was calculated\nbased on 55,116,953 shares of common stock outstanding, as of June 24, 2026, of which 29,602,697 shares were held by non-affiliates, and\na price per share of $0.6935 which was the closing sale price of our common stock on the Nasdaq Capital Market on May 27, 2026, and which\nwas within 60 days of the filing of the registration statement of which this prospectus forms a part.";
const APPROVAL = {
  approverUserId: "6fcb1048-5f2d-4ef0-9f8b-c35a8db393bd",
  approvedAt: "2026-06-26T21:30:00.000Z",
};
const connectionString = process.env.SUPABASE_LOCAL_DB_URL;
if (!connectionString) throw new Error("SUPABASE_LOCAL_DB_URL is required; no default database is allowed");
const databaseUrl = new URL(connectionString);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(databaseUrl.hostname)) {
  throw new Error("Refusing non-local database");
}
if (databaseUrl.port === "56322") throw new Error("Refusing shared local database port 56322");
if (databaseUrl.port !== "60002") throw new Error(`Unexpected isolated database port ${databaseUrl.port}`);
const userAgent = process.env.SEC_USER_AGENT;
if (!userAgent) throw new Error("SEC_USER_AGENT is required for the official SEC source test");

const client = new Client({ connectionString });
await client.connect();
let transactionStarted = false;
let rolledBack = false;
try {
  const identity = (await client.query(
    `select current_database() as database, current_user as db_user,
            inet_server_addr()::text as server_addr, inet_server_port() as container_port`,
  )).rows[0];
  assert.notEqual(databaseUrl.port, "56322");

  const sql = createSerialSqlClient(client);
  const history = new PostgresShareCountHistoryRepository(sql);
  const universe = new PostgresIssuerCommonClassUniverseRepository(sql);
  const artifacts = new PostgresSecFilingXbrlArtifactRepository(sql);
  const initial = await counts();

  const collector = createSecOsProductionCollector({
    sqlClient: sql,
    userAgent,
    now: () => new Date("2026-08-30T13:00:00.000Z"),
  });
  const collection = await collector.collectIssuer({ cik: CIK, mode: "bootstrap" });
  assert.notEqual(collection.status, "FAILED");

  const q1Rows = (await client.query(
    `select shares_outstanding::text, as_of::text, accession_number, source_type,
            canonical_security_class_id, accepted_at::text
       from public.share_count_history
      where issuer_cik = $1 and accession_number = $2 and as_of = '2026-05-13'::date`,
    [CIK, Q1_ACCESSION],
  )).rows;
  assert.equal(q1Rows.length, 1);
  assert.equal(q1Rows[0].shares_outstanding, "50407567");
  assert.equal(q1Rows[0].canonical_security_class_id, `sc:v1:${CIK}:common_stock:single`);

  const q1Snapshots = (await client.query(
    `select id::text, snapshot_version, issuer_cik, universe_as_of::text,
            accepted_at::text, source_accession, source_form, source_filed_date::text,
            source_documents, status, reason, required_canonical_security_class_ids,
            class_evidence, aggregate_evidence, excluded_evidence,
            completeness_provenance, source_identity_hash, created_at::text
       from public.issuer_common_class_universe_snapshots
      where issuer_cik = $1 and source_accession = $2 and universe_as_of = '2026-05-13'::date
      order by snapshot_version desc`,
    [CIK, Q1_ACCESSION],
  )).rows;
  assert.ok(q1Snapshots.length >= 1);
  const q1Snapshot = mapSnapshot(q1Snapshots[0]);
  assert.equal(q1Snapshot.status, "COMPLETE_SINGLE");
  assert.equal(q1Snapshot.reason, "COMPLETE_SINGLE_COMMON_STOCK");

  const q1Resolver = await resolveIssuerTotalCommonSharesAt({
    universeRepository: universe,
    repository: history,
    cik: CIK,
    targetAt: "2026-05-16T00:00:00.000Z",
  }, { readExecutions: noRecordedStockSplitExecutions });
  assert.equal(q1Resolver.status, "RESOLVED");
  assert.equal(q1Resolver.totalCommonShares?.integerShares, "50407567");

  const baseline = await counts();
  await client.query("begin");
  transactionStarted = true;
  await client.query("set local statement_timeout = '10min'");

  const sourceReader = createSourceReader({ artifacts, sql, userAgent });
  const writer = createPostgresHumanVerifiedShareCountWriter({ sqlClient: sql, readSourceBundle: sourceReader });
  const beforeS3 = await s3HistoryCount();
  const inserted = await writer({
    payload: s3Payload(),
    approval: {
      approverUserId: "6fcb1048-5f2d-4ef0-9f8b-c35a8db393bd",
      approvedAt: "2026-06-26T21:30:00.000Z",
    },
    ingestedAt: "2026-06-26T21:31:00.000Z",
  });
  assert.equal(inserted.status, "INSERTED");
  assert.equal(await s3HistoryCount(), beforeS3 + 1);

  const storedS3 = (await client.query(
    `select shares_outstanding::text, as_of::text, accession_number, form,
            filing_document, filed_date::text, accepted_at::text, accepted_at_source,
            source_artifact_id::text, filing_ledger_raw_source_id::text,
            source_type, observation_type, source_evidence, source_provenance
       from public.share_count_history
      where issuer_cik = $1 and accession_number = $2
        and source_type = 'sec_filing_text_human_verified'`,
    [CIK, S3_ACCESSION],
  )).rows;
  assert.equal(storedS3.length, 1);
  assert.deepEqual([
    storedS3[0].shares_outstanding, storedS3[0].as_of, storedS3[0].form,
    storedS3[0].filing_document, storedS3[0].filed_date,
    new Date(storedS3[0].accepted_at).toISOString(), storedS3[0].accepted_at_source,
    storedS3[0].source_type, storedS3[0].observation_type,
  ], [
    "55116953", "2026-06-24", "S-3", S3_DOCUMENT, "2026-06-26",
    "2026-06-26T21:09:26.000Z", "sec_filing_ledger",
    "sec_filing_text_human_verified", "source_stated",
  ]);
  assert.notEqual(storedS3[0].source_artifact_id, storedS3[0].filing_ledger_raw_source_id);

  const exactArtifact = (await client.query(
    `select id::text, source_url, content_hash, raw_content_kind,
            payload ->> 'document_name' as document_name,
            payload ->> 'accession' as accession
       from public.sec_structured_raw_sources
      where id = $1::uuid and source_kind = 'filing_xbrl'`,
    [storedS3[0].source_artifact_id],
  )).rows;
  assert.equal(exactArtifact.length, 1);
  assert.equal(exactArtifact[0].document_name, S3_DOCUMENT);
  assert.equal(exactArtifact[0].accession, S3_ACCESSION);

  const s3Resolver = await resolveIssuerTotalCommonSharesAt({
    universeRepository: universe,
    repository: history,
    cik: CIK,
    targetAt: "2026-06-27T00:00:00.000Z",
  }, { readExecutions: noRecordedStockSplitExecutions });
  assert.equal(s3Resolver.status, "RESOLVED");
  assert.equal(s3Resolver.totalCommonShares?.integerShares, "55116953");

  const replayBefore = await s3HistoryCount();
  const replay = await writer({
    payload: s3Payload(),
    approval: {
      approverUserId: "6fcb1048-5f2d-4ef0-9f8b-c35a8db393bd",
      approvedAt: "2026-06-26T21:30:00.000Z",
    },
    ingestedAt: "2026-06-26T21:31:00.000Z",
  });
  assert.equal(replay.status, "REPLAY");
  assert.equal(await s3HistoryCount() - replayBefore, 0);

  const negativeResults: Record<string, { status: string; rowDelta: number }> = {};
  await negative("plusOne", s3Payload({ shares_outstanding: "55116954" }));
  await negativeWithEvidence(
    "futureExpected",
    "Following the offering, 55,116,953 shares of common stock are expected to be outstanding, as of June 24, 2026.",
  );
  await negativeWithEvidence(
    "proForma",
    "Pro forma shares of common stock outstanding will be 55,116,953, as of June 24, 2026.",
  );
  await negative("missingBaseline", s3Payload(), emptyUniverseRepository());
  await negative(
    "multiClassReview",
    s3Payload(),
    snapshotRepository(toMultiSnapshot(q1Snapshot)),
    historyWithoutLaterClassEvidence(history),
  );
  await negativeWithEvidence(
    "adsReview",
    "There were 55,116,953 American Depositary Shares outstanding, as of June 24, 2026.",
    undefined,
    { security_class_title: "American Depositary Shares" },
  );

  const after = await counts();
  const q1StillPresent = (await client.query(
    `select count(*)::integer as count from public.share_count_history
      where issuer_cik = $1 and accession_number = $2 and shares_outstanding = 50407567`,
    [CIK, Q1_ACCESSION],
  )).rows[0].count;
  assert.equal(q1StillPresent, 1);

  await client.query("rollback");
  rolledBack = true;
  const cleanup = await counts();
  assert.deepEqual(cleanup, baseline);
  console.log(JSON.stringify({
    ok: true,
    database: { ...identity, hostPort: Number(databaseUrl.port), sharedPort: 56322, differs: true },
    initial,
    collectionStatus: collection.status,
    collectionCounts: collection.counts,
    q1: {
      sharesOutstanding: q1Rows[0].shares_outstanding,
      asOf: "2026-05-13",
      accession: Q1_ACCESSION,
      classStatus: q1Snapshot.status,
      canonicalSecurityClassId: q1Snapshot.requiredCanonicalSecurityClassIds[0],
      resolverStatus: q1Resolver.status,
      issuerTotal: q1Resolver.totalCommonShares?.integerShares,
    },
    s3: {
      insertedRows: 1,
      sharesOutstanding: storedS3[0].shares_outstanding,
      asOf: storedS3[0].as_of,
      acceptedAt: new Date(storedS3[0].accepted_at).toISOString(),
      sourceType: storedS3[0].source_type,
      observationType: storedS3[0].observation_type,
      artifact: exactArtifact[0],
      resolverStatus: s3Resolver.status,
      issuerTotal: s3Resolver.totalCommonShares?.integerShares,
      replayDelta: 0,
    },
    negativeResults,
    futureSnapshotUse: storedS3[0].source_provenance.classUniverse.futureSnapshotUsed ? 1 : 0,
    q1RowsRemaining: q1StillPresent,
    transactionCounts: after,
    rollbackCleanup: cleanup,
  }, null, 2));

  async function negative(
    name: string,
    payload: DilutionRegistryPayload,
    universeRepository?: IssuerCommonClassUniverseRepository,
    historyRepository?: ShareCountHistoryRepository,
  ) {
    const before = await s3HistoryCount();
    const result = await createWriter(universeRepository, sourceReader, historyRepository)({
      payload,
      approval: APPROVAL,
      ingestedAt: "2026-06-26T21:31:00.000Z",
    });
    const delta = await s3HistoryCount() - before;
    assert.equal(result.status, "REJECTED", name);
    assert.equal(delta, 0, name);
    negativeResults[name] = { status: result.verifierStatus, rowDelta: delta };
  }

  async function negativeWithEvidence(
    name: string,
    evidence: string,
    universeRepository?: IssuerCommonClassUniverseRepository,
    override: Record<string, unknown> = {},
  ) {
    const baseReader = sourceReader;
    const reader: typeof sourceReader = async (accession, context) => {
      const bundle = await baseReader(accession, context);
      return {
        ...bundle,
        sourceMode: "stored",
        officialSecFallbackArtifact: undefined,
        documents: bundle.documents.map((document) => ({ ...document, text: evidence })),
      };
    };
    const before = await s3HistoryCount();
    const result = await createWriter(universeRepository, reader)({
      payload: s3Payload({ evidence, ...override }),
      approval: APPROVAL,
      ingestedAt: "2026-06-26T21:31:00.000Z",
    });
    const delta = await s3HistoryCount() - before;
    assert.equal(result.status, "REJECTED", name);
    assert.equal(delta, 0, name);
    negativeResults[name] = { status: result.verifierStatus, rowDelta: delta };
  }

  function createWriter(
    universeRepository: IssuerCommonClassUniverseRepository = universe,
    readSourceBundle: typeof sourceReader,
    historyRepository = history as ShareCountHistoryRepository,
  ) {
    return (writeInput: Parameters<typeof writer>[0]) =>
      import("../lib/sec-structured-data/humanVerifiedShareCountObservation.ts").then(
        ({ writeHumanVerifiedShareCountObservation }) => writeHumanVerifiedShareCountObservation(writeInput, {
          artifactRepository: artifacts,
          historyRepository,
          universeRepository,
          readLedger: (accession) => readExactFilingLedger(sql, accession),
          readSourceBundle,
        }),
      );
  }

  async function s3HistoryCount() {
    return (await client.query(
      `select count(*)::integer as count from public.share_count_history
        where issuer_cik = $1 and accession_number = $2
          and source_type = 'sec_filing_text_human_verified'`,
      [CIK, S3_ACCESSION],
    )).rows[0].count as number;
  }

  async function counts() {
    return (await client.query(
      `select
        (select count(*)::integer from public.share_count_history where issuer_cik = $1) as history,
        (select count(*)::integer from public.issuer_common_class_universe_snapshots where issuer_cik = $1) as snapshots,
        (select count(*)::integer from public.sec_structured_raw_sources where cik = $1) as raw_sources`,
      [CIK],
    )).rows[0];
  }
} finally {
  if (transactionStarted && !rolledBack) await client.query("rollback").catch(() => undefined);
  await client.end();
}

function s3Payload(override: Record<string, unknown> = {}): DilutionRegistryPayload {
  return {
    issuer: { issuer_cik: CIK, ticker: "VEEA" },
    instruments: [], snapshots: [], activities: [], totals: [],
    os_observations: [{
      observation_type: "source_stated", shares_outstanding: "55116953",
      as_of: "2026-06-24", security_class_kind: "common_stock",
      security_class_title: "common stock", source_accession: S3_ACCESSION,
      source_form: "S-3", source_ref: S3_DOCUMENT, evidence: S3_EVIDENCE,
      ...override,
    }],
  };
}

function createSourceReader(input: {
  artifacts: PostgresSecFilingXbrlArtifactRepository;
  sql: ReturnType<typeof createSerialSqlClient>;
  userAgent: string;
}) {
  const policy = new SecRequestPolicy(input.userAgent);
  return async (
    accessionNumber: string,
    context: { issuerCik: string; asOf: string; sourceForm: string; sourceRef: string },
  ): Promise<DilutionRegistryOsSourceBundle> => {
    const ledger = await readExactFilingLedger(input.sql, accessionNumber);
    if (!ledger) return unavailable("The exact SEC filing ledger is unavailable.");
    const base = {
      issuer_cik: ledger.issuerCik,
      accession_number: ledger.accessionNumber,
      form: ledger.form,
      primary_document: ledger.primaryDocument,
    };
    const stored = (await input.artifacts.readArtifacts(context.issuerCik, accessionNumber))
      .filter((artifact) => artifact.documentName === context.sourceRef);
    if (stored.length > 1) return unavailable("The exact stored SEC artifact is ambiguous.");
    if (stored.length === 1) {
      return {
        ok: true, sourceMode: "stored", classUniverseMode: null, ledger: base,
        documents: [artifactDocument(stored[0]!)], classUniverse: null,
      };
    }
    const official = await fetchOfficialSecFilingDocument({
      issuerCik: context.issuerCik,
      accessionNumber,
      sourceForm: context.sourceForm,
      sourceRef: context.sourceRef,
      requestPolicy: policy,
      now: () => new Date("2026-06-26T21:32:00.000Z"),
    });
    if (!official.ok) return unavailable(official.reason);
    return {
      ok: true, sourceMode: "official_sec_fallback", classUniverseMode: null,
      ledger: base, documents: [official.document],
      officialSecFallbackArtifact: official.artifact, classUniverse: null,
    };
  };
}

function artifactDocument(artifact: SecFilingXbrlRawArtifact) {
  return {
    source_ref: artifact.documentName,
    source_url: artifact.sourceUrl,
    document_name: artifact.documentName,
    label: artifact.documentName,
    text: normalizeSecDocumentText(artifact.rawContent),
  };
}

function unavailable(reason: string): DilutionRegistryOsSourceBundle {
  return { ok: false, errorReason: reason, sourceMode: null, classUniverseMode: null, ledger: null, documents: [], classUniverse: null };
}

function emptyUniverseRepository(): IssuerCommonClassUniverseRepository {
  return { async insertSnapshot() { return false; }, async readSnapshots() { return []; } };
}

function snapshotRepository(snapshot: IssuerCommonClassUniverseSnapshot): IssuerCommonClassUniverseRepository {
  return { async insertSnapshot() { return false; }, async readSnapshots() { return [structuredClone(snapshot)]; } };
}

function historyWithoutLaterClassEvidence(
  repository: ShareCountHistoryRepository,
): ShareCountHistoryRepository {
  return {
    insertObservation: (observation) => repository.insertObservation(observation),
    async readHistory() { return []; },
  };
}

function toMultiSnapshot(source: IssuerCommonClassUniverseSnapshot): IssuerCommonClassUniverseSnapshot {
  const classA = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassAMember`;
  const classB = `sc:v1:${CIK}:common_stock:us-gaap:CommonClassBMember`;
  const sourceFact = source.classEvidence[0]!.sourceFacts[0]!;
  return {
    ...structuredClone(source),
    snapshotVersion: "issuer-common-class-universe-snapshot-v2",
    status: "COMPLETE_MULTI",
    reason: "COMPLETE_MULTI_COMMON_STOCK",
    requiredCanonicalSecurityClassIds: [classA, classB],
    classEvidence: [
      { canonicalSecurityClassId: classA, sharesOutstanding: "25000000", sourceFacts: [{ ...sourceFact, sharesOutstanding: "25000000" }] },
      { canonicalSecurityClassId: classB, sharesOutstanding: "25407567", sourceFacts: [{ ...sourceFact, factKey: hash("multi-b"), contextRef: `${sourceFact.contextRef}-b`, sharesOutstanding: "25407567" }] },
    ],
    sourceIdentityHash: hash("isolated-multi-review"),
  };
}

function mapSnapshot(row: Record<string, unknown>): IssuerCommonClassUniverseSnapshot {
  return {
    id: String(row.id), snapshotVersion: String(row.snapshot_version) as IssuerCommonClassUniverseSnapshot["snapshotVersion"],
    issuerCik: String(row.issuer_cik), universeAsOf: String(row.universe_as_of),
    acceptedAt: new Date(String(row.accepted_at)).toISOString(), sourceAccession: String(row.source_accession),
    sourceForm: String(row.source_form), sourceFiledDate: String(row.source_filed_date),
    sourceDocuments: row.source_documents as string[], status: String(row.status) as IssuerCommonClassUniverseSnapshot["status"],
    reason: String(row.reason) as IssuerCommonClassUniverseSnapshot["reason"],
    requiredCanonicalSecurityClassIds: row.required_canonical_security_class_ids as string[],
    classEvidence: row.class_evidence as IssuerCommonClassUniverseSnapshot["classEvidence"],
    aggregateEvidence: row.aggregate_evidence as IssuerCommonClassUniverseSnapshot["aggregateEvidence"],
    excludedEvidence: row.excluded_evidence as IssuerCommonClassUniverseSnapshot["excludedEvidence"],
    completenessProvenance: row.completeness_provenance as Record<string, unknown>,
    sourceIdentityHash: String(row.source_identity_hash), createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

async function noRecordedStockSplitExecutions(input: StockSplitExecutionReadInput) {
  return {
    status: "available" as const,
    issuerCik: input.cik,
    canonicalSecurityClassId: input.canonicalSecurityClassId ?? null,
    from: input.from, to: input.to, targetAt: input.targetAt,
    basisChangeCoverage: input.actionKind === "forward_split" ? "forward_split_only" as const : "reverse_split_only" as const,
    executions: [], inactiveExecutions: [], conflicts: [],
  };
}

function createSerialSqlClient(sqlClient: {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}) {
  let queue: Promise<void> = Promise.resolve();
  return {
    query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]) {
      const execution = queue.then(() => sqlClient.query(text, values));
      queue = execution.then(() => undefined, () => undefined);
      return execution as Promise<{ rows: Row[]; rowCount: number | null }>;
    },
  };
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
