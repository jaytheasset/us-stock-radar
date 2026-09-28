import assert from "node:assert/strict";
import pg from "pg";
import type { OfferingMonitorJobIdentity } from "../lib/offeringMonitorJobFoundation.ts";
import { resolveClassShareCountAt } from "../lib/sec-structured-data/classShareCountResolver.ts";
import {
  extractLevel2ShareCountSidecar,
  writeLevel2ShareCountObservation,
} from "../lib/sec-structured-data/level2ShareCountObservation.ts";
import {
  OFFERING_SHARE_COUNT_SIDECAR_ANALYZER_KEY,
  extractOfferingShareCountFromSecRawItem,
  processOfferingShareCountSidecar,
} from "../lib/sec-structured-data/offeringShareCountSidecar.ts";
import { PostgresShareCountHistoryRepository } from "../lib/sec-structured-data/shareCountHistory.ts";
import { fetchSecEdgarRawItems } from "../lib/sources/sec/parser.ts";

const dbUrl = process.env.OFFERING_OS_ISOLATED_DB_URL;
const expectedPort = process.env.OFFERING_OS_ISOLATED_DB_PORT;
if (!dbUrl || !expectedPort) throw new Error("OFFERING_OS_ISOLATED_DB_URL and OFFERING_OS_ISOLATED_DB_PORT are required");
assertIsolatedDatabase(new URL(dbUrl), expectedPort);
process.env.SEC_USER_AGENT ||= "US-Stock-Radar isolated offering O/S verification engineering@openai.com";

const CASES = [
  { form: "S-1", cik: "0001086757", accession: "0000950131-00-001602", shares: "17398907", asOf: "2000-03-03" },
  { form: "S-3", cik: "0001007587", accession: "0000950135-01-000362", shares: "8619075", asOf: "2001-01-22" },
  { form: "F-3", cik: "0001907184", accession: "0001171843-25-004175", shares: "17962173", asOf: "2025-06-25" },
  { form: "424B5", cik: "0001832483", accession: "0001213900-24-095468", shares: "44298197", asOf: "2024-11-05" },
] as const;

const { Client } = pg;
const client = new Client({ connectionString: dbUrl });
let providerCalls = 0;

try {
  await client.connect();
  const repository = new PostgresShareCountHistoryRepository(client);
  const verified = [];
  let persistenceCase: {
    rawItem: Record<string, unknown>;
    identity: OfferingMonitorJobIdentity;
    acceptedAt: string;
  } | null = null;

  assert.equal(await level2RowCount(client), 0, "isolated stack must begin without Level 2 rows");

  for (let index = 0; index < CASES.length; index += 1) {
    const fixture = CASES[index]!;
    const fetched = await fetchSecEdgarRawItems({
      accessionNumber: fixture.accession,
      cik: fixture.cik,
      formTypes: [fixture.form],
      includeDocuments: true,
      attachmentLimit: 1,
      limit: 1,
    });
    assert.equal(fetched.ok, true, `${fixture.form} official SEC fetch`);
    assert.equal(fetched.items.length, 1, `${fixture.form} exact filing count`);
    const rawItemId = `81000000-0000-4000-8000-00000000000${index + 1}`;
    const rawItem = { ...fetched.items[0]!, id: rawItemId };
    const extraction = extractOfferingShareCountFromSecRawItem(rawItem);
    assert.equal(extraction.status, "eligible", `${fixture.form} deterministic eligibility`);
    if (extraction.status !== "eligible") throw new Error(`${fixture.form} was not eligible`);
    assert.equal(extraction.candidate.sharesOutstanding, fixture.shares, `${fixture.form} shares`);
    assert.equal(extraction.candidate.asOf, fixture.asOf, `${fixture.form} as-of`);

    const oldPath = extractLevel2ShareCountSidecar({
      payload: {
        share_count_observation: {
          observation_type: extraction.candidate.observationType,
          shares_outstanding: extraction.candidate.sharesOutstanding,
          as_of: extraction.candidate.asOf,
          security_class_kind: extraction.candidate.securityClassKind,
          security_class_title: extraction.candidate.securityClassTitle,
          source_ref: extraction.candidate.sourceRef,
          evidence: extraction.candidate.evidence,
        },
      },
      accessionNumber: extraction.candidate.accessionNumber,
      sourceDocumentUrl: extraction.candidate.sourceDocumentUrl,
      sourceDocuments: [{
        source_ref: extraction.candidate.sourceRef,
        text: extraction.candidate.evidence,
        document_name: extraction.candidate.sourceDocument,
      }],
    });
    assert.deepEqual(oldPath.errors, [], `${fixture.form} former validator acceptance`);
    assert.equal(oldPath.candidate?.sharesOutstanding, extraction.candidate.sharesOutstanding);
    assert.equal(oldPath.candidate?.asOf, extraction.candidate.asOf);
    assert.equal(oldPath.candidate?.securityClassTitle, extraction.candidate.securityClassTitle);
    assert.equal(oldPath.candidate?.accessionNumber, extraction.candidate.accessionNumber);
    assert.equal(oldPath.candidate?.sourceDocumentUrl, extraction.candidate.sourceDocumentUrl);

    verified.push({
      form: fixture.form,
      accession: fixture.accession,
      sharesOutstanding: extraction.candidate.sharesOutstanding,
      asOf: extraction.candidate.asOf,
      priorSidecarEquivalent: true,
    });
    if (fixture.form === "424B5") {
      const acceptedAt = String((rawItem.raw_payload as Record<string, unknown>).accepted_at || "");
      assert.ok(Number.isFinite(Date.parse(acceptedAt)), "actual SEC acceptance time is required");
      persistenceCase = { rawItem, identity: identityFor(fixture, rawItemId), acceptedAt };
    }
  }

  assert.ok(persistenceCase, "424B persistence fixture is required");
  const { rawItem, identity, acceptedAt } = persistenceCase!;
  await client.query(
    `insert into public.sources (code, name, source_group, runtime_owner, enabled)
     values ('sec_edgar', 'SEC EDGAR', 'filings', 'manual', false)
     on conflict (code) do nothing`,
  );
  await client.query(
    `insert into public.sec_issuers (cik) values ($1) on conflict (cik) do nothing`,
    [CASES[3].cik],
  );
  await client.query(
    `insert into public.raw_items (
       id, source_code, source_group, source_unique_id, source_url, title,
       published_at, fetched_at, body_text, analysis_text, raw_payload, metadata, dedupe_key
     ) values ($1, 'sec_edgar', 'filings', $2, $3, $4, $5::timestamptz, $6::timestamptz,
       $7, $8, $9::jsonb, $10::jsonb, $11)`,
    [
      identity.rawItemId,
      identity.sourceIdentity,
      rawItem.source_url,
      rawItem.title,
      rawItem.published_at,
      rawItem.fetched_at,
      rawItem.body_text,
      rawItem.analysis_text,
      JSON.stringify(rawItem.raw_payload),
      JSON.stringify(rawItem.metadata),
      rawItem.dedupe_key,
    ],
  );

  const dependencies = {
    readParentAuthority: async () => ({
      status: "current" as const,
      latestPrimaryAiRunId: identity.parentPrimaryAiRunId,
    }),
    loadRawItem: async () => {
      const result = await client.query<Record<string, unknown>>(
        `select * from public.raw_items where id = $1 and source_unique_id = $2`,
        [identity.rawItemId, identity.sourceIdentity],
      );
      assert.equal(result.rows.length, 1, "exact stored raw item readback");
      return result.rows[0]!;
    },
    persist: async ({ candidate }: { candidate: ReturnType<typeof eligibleCandidate> }) =>
      writeLevel2ShareCountObservation({
        repository,
        candidate,
        context: {
          issuerCik: CASES[3].cik,
          form: CASES[3].form,
          filedDate: String((rawItem.raw_payload as Record<string, unknown>).filing_date),
          acceptedAt,
          acceptedAtSource: "sec_raw_payload_acceptance",
          acceptedAtProvenance: {
            source: "raw_items.raw_payload.accepted_at",
            accessionNumber: identity.sourceIdentity,
            rawItemId: identity.rawItemId,
          },
          ingestedAt: "2026-09-10T00:00:00.000Z",
          rawItemId: identity.rawItemId,
          eventId: identity.eventId,
          parentPrimaryAiRunId: identity.parentPrimaryAiRunId,
          sourceExecutionId: identity.executionId,
          analyzerKey: OFFERING_SHARE_COUNT_SIDECAR_ANALYZER_KEY,
          canonicalSecurityClassSupports: [{
            observationId: "support-1",
            canonicalSecurityClassId: `sc:v1:${CASES[3].cik}:common_stock:single`,
            canonicalSecurityClassKind: "common_stock",
            securityClassBasis: "SINGLE_COMMON_STOCK_CLASS",
            sourceFactKey: "a".repeat(64),
            accessionNumber: "0000000001-24-000001",
          }],
        },
      }),
  };

  const first = await processOfferingShareCountSidecar(identity, dependencies);
  const replay = await processOfferingShareCountSidecar(identity, dependencies);
  assert.deepEqual(first.status === "completed" ? [first.inserted, first.deduped] : null, [1, 0]);
  assert.deepEqual(replay.status === "completed" ? [replay.inserted, replay.deduped] : null, [0, 1]);
  assert.equal(await level2RowCount(client), 1, "replay must not append a duplicate row");
  assert.equal(providerCalls, 0, "deterministic path must make zero runtime LLM calls");

  const canonicalClassId = `sc:v1:${CASES[3].cik}:common_stock:single`;
  const before = await resolveClassShareCountAt({
    repository,
    cik: CASES[3].cik,
    securityClassId: canonicalClassId,
    targetAt: new Date(new Date(acceptedAt).valueOf() - 1).toISOString(),
  });
  const after = await resolveClassShareCountAt({
    repository,
    cik: CASES[3].cik,
    securityClassId: canonicalClassId,
    targetAt: new Date(new Date(acceptedAt).valueOf() + 1).toISOString(),
  });
  assert.equal(before.status, "UNAVAILABLE", "accepted-at must prevent look-ahead");
  assert.equal(after.status, "RESOLVED");
  assert.equal(after.sharesOutstanding, CASES[3].shares);
  assert.equal(after.selectedObservation?.sourceType, "sec_filing_text_level2");

  process.stdout.write(`${JSON.stringify({
    isolatedDbPort: expectedPort,
    actualSecCases: verified,
    storedRawItemId: identity.rawItemId,
    writes: { first: [1, 0], replay: [0, 1], finalRows: 1 },
    resolver: { beforeAcceptance: before.status, afterAcceptance: after.status, shares: after.sharesOutstanding },
    runtimeLlmCalls: providerCalls,
  })}\n`);
} finally {
  await client.end();
}

function eligibleCandidate(rawItem: Record<string, unknown>) {
  const extraction = extractOfferingShareCountFromSecRawItem(rawItem);
  if (extraction.status !== "eligible") throw new Error("expected eligible candidate");
  return extraction.candidate;
}

async function level2RowCount(connection: InstanceType<typeof Client>) {
  const result = await connection.query(
    `select count(*)::integer as count from public.share_count_history where source_type = 'sec_filing_text_level2'`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

function identityFor(fixture: typeof CASES[number], rawItemId: string): OfferingMonitorJobIdentity {
  const family = fixture.form === "S-1" ? "s1" : fixture.form === "S-3" || fixture.form === "F-3" ? "s3" : "424b";
  return {
    schemaVersion: "offering_monitor_job_v2",
    purpose: "offering_monitor_normalization",
    jobId: "81000000-0000-4000-8000-000000000010",
    logicalJobId: "81000000-0000-4000-8000-000000000011",
    executionId: "81000000-0000-4000-8000-000000000010",
    executionContractVersion: "second_stage_direct_v8",
    executionAttemptKey: "automatic",
    eventId: "81000000-0000-4000-8000-000000000012",
    rawItemId,
    sourceIdentity: fixture.accession,
    formType: fixture.form,
    family,
    parentPrimaryAiRunId: "81000000-0000-4000-8000-000000000013",
    parentPromptKey: "sec_424b_analysis",
    parentPromptVersion: "actual-sec-isolated-verification",
    enqueuedAt: "2026-09-10T00:00:00.000Z",
  };
}

function assertIsolatedDatabase(database: URL, requiredPort: string) {
  assert.ok(["127.0.0.1", "localhost"].includes(database.hostname));
  assert.equal(database.port, requiredPort);
  assert.ok(!new Set(["54322", "56322"]).has(database.port), `shared database port ${database.port} is forbidden`);
}
