import assert from "node:assert/strict";
import { Client } from "pg";
import { runCorporateActionCanonicalAnalyzerPreview } from "../lib/ai/corporateActionCanonicalAnalyzerPreview.ts";
import { buildGenericMonitorChildIdentities } from "../lib/monitor/genericMonitorChildExecution.ts";
import { buildCorporateActionAnalyzerInput } from "../lib/monitor/genericMonitorChildRuntime.ts";
import { readStockSplitExecutions } from "../lib/monitor/reverseSplitExecution.ts";
import type { StockSplitHistoryReadResult } from "../lib/monitor/reverseSplitHistory.ts";
import { validateCorporateActionApplicabilityContextResponse } from "../lib/monitor/corporateActionApplicabilityContext.ts";
import { reconcileShareCountAnchors } from "../lib/sec-structured-data/shareCountAnchorReconciliation.ts";
import { PostgresShareCountHistoryRepository } from "../lib/sec-structured-data/shareCountHistory.ts";
import type { StockSplitExecutionReadInput } from "../lib/sec-structured-data/stockSplitShareBasisNormalizer.ts";

const ACCESSION = "0001104659-23-056549";
const CIK = "0001499961";
const CLASS_ID = `sc:v1:${CIK}:common_stock:single`;
const START_AS_OF = "2023-02-09";
const END_AS_OF = "2023-05-12";
const EXPECTED_START_SHARES = "1747209236";
const EXPECTED_END_SHARES = "172510340";
const connectionString = process.env.SUPABASE_LOCAL_DB_URL
  || "postgresql://postgres:postgres@127.0.0.1:56322/postgres";
const databaseUrl = new URL(connectionString);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(databaseUrl.hostname)) {
  throw new Error("Refusing non-local database");
}

const client = new Client({ connectionString });

void main();

async function main() {
  await client.connect();
  try {
  const source = await readSourceLineage();
  const contextResult = await client.query(
    "select public.read_corporate_action_applicability_context($1::uuid, $2::uuid) as payload",
    [source.event_id, source.raw_item_id],
  );
  const applicabilityContext = validateCorporateActionApplicabilityContextResponse(
    contextResult.rows[0]?.payload,
  );
  assert.equal(applicabilityContext.issuerContext.availability, "available");
  assert.equal(applicabilityContext.securityClassCandidates.length, 1);
  assert.equal(applicabilityContext.securityClassCandidates[0]?.canonical_security_class_id, CLASS_ID);

  const [identity] = buildGenericMonitorChildIdentities({
    primary: {
      eventId: source.event_id,
      rawItemId: source.raw_item_id,
      sourceFamily: "sec_8k_6k",
      sourceGroup: source.source_group,
      sourceCode: source.source_code,
      sourceIdentity: source.source_unique_id,
      parentPrimaryAiRunId: source.parent_primary_ai_run_id,
      parentPromptKey: source.parent_prompt_key,
      parentPromptVersion: source.parent_prompt_version,
    },
    monitorRouting: { monitor_routes: [{ monitor_analyzer_key: "corporate_action" }] },
    now: "2026-08-23T00:00:00.000Z",
  });
  assert.ok(identity);
  const input = buildCorporateActionAnalyzerInput(
    identity,
    source.raw_item,
    source.primary_analysis,
    applicabilityContext,
  );
  const sourceEvidence = findSourceEvidence(input.source_documents);
  let providerCalls = 0;
  const preview = await runCorporateActionCanonicalAnalyzerPreview(input, {
    apiKey: "deterministic-local-verification",
    runPrompt: async () => {
      providerCalls += 1;
      const payload = {
        applicable: true,
        event_kind: "reverse_split",
        action_stage: "effective",
        effective_date: {
          availability: "available",
          value: "2023-05-04",
          calculation_basis: "split_adjusted_trading",
          source_ref: sourceEvidence.sourceRef,
          evidence: sourceEvidence.text,
        },
        ratio: {
          availability: "available",
          old_shares: "25",
          new_shares: "1",
          source_ref: sourceEvidence.sourceRef,
          evidence: sourceEvidence.text,
        },
        affected_security: {
          availability: "available",
          canonical_security_class_id: CLASS_ID,
          security_type: "common_stock",
          source_security_title: "common stock",
          source_ref: sourceEvidence.sourceRef,
          evidence: sourceEvidence.text,
        },
        effective_timing: {
          availability: "available",
          kind: "market_open",
          timestamp: null,
          source_ref: sourceEvidence.sourceRef,
          evidence: sourceEvidence.text,
        },
        execution_update: {
          decision: "NEW_EXECUTION",
          target_execution_id: null,
          source_ref: sourceEvidence.sourceRef,
          evidence: sourceEvidence.text,
        },
        source_ref: sourceEvidence.sourceRef,
        evidence: sourceEvidence.text,
        confidence: "high",
        as_of: { availability: "available", value: "2023-05-04" },
      };
      return {
        ok: true as const,
        responseOk: true,
        status: 200,
        statusText: "OK",
        model: "deterministic-local-verification",
        responseId: "bini-cached-source",
        outputText: JSON.stringify(payload),
        parsed: payload,
        usage: null,
        body: null,
      };
    },
  });
  assert.equal(providerCalls, 1);
  assert.equal(preview.stage, "complete");
  assert.equal(preview.repair, null);
  if (preview.stage !== "complete" || !preview.result.applicable) {
    throw new Error("BINI cached Corporate Action result did not materialize");
  }
  const facts = preview.result.facts;
  assert.equal(facts.event_kind, "reverse_split");
  assert.equal(facts.ratio.exact_source_components?.availability, "available");
  assert.equal(facts.ratio.exact_source_components?.availability === "available"
    ? facts.ratio.exact_source_components.old_share_units : null, "25");
  assert.equal(facts.ratio.exact_source_components?.availability === "available"
    ? facts.ratio.exact_source_components.new_share_units : null, "1");
  assert.equal(facts.ratio.exact_source_components?.availability === "available"
    ? facts.ratio.exact_source_components.evidence_identity?.exact_source : null, true);
  assert.equal(facts.effective_date.availability, "available");
  assert.equal(facts.effective_date.availability === "available" ? facts.effective_date.value : null,
    "2023-05-04");
  assert.equal(facts.effective_date.availability === "available"
    ? facts.effective_date.calculation_basis : null, "split_adjusted_trading");
  assert.equal(facts.effective_timing?.availability, "available");
  assert.equal(facts.effective_timing?.availability === "available" ? facts.effective_timing.kind : null,
    "market_open");
  assert.equal(facts.effective_timing?.availability === "available"
    ? facts.effective_timing.timestamp : undefined, null);

  const history: StockSplitHistoryReadResult = {
    status: "available",
    materializationStatus: "SPLIT_EXECUTIONS_AVAILABLE",
    issuerCik: CIK,
    canonicalSecurityClassId: CLASS_ID,
    from: "2023-05-04",
    to: END_AS_OF,
    basisChangeCoverage: "reverse_split_only",
    items: [{
      eventId: source.event_id,
      sourceExecutionId: identity.executionId,
      issuerCik: CIK,
      canonicalSecurityClassId: CLASS_ID,
      effectiveDate: "2023-05-04",
      effectiveTiming: facts.effective_timing!,
      sameDayOrdering: "explicit_source_timing",
      facts,
      persistedAt: "2023-05-05T20:15:36.000Z",
    }],
  };
  const executionRead = await readStockSplitExecutions({
    actionKind: "reverse_split",
    cik: CIK,
    canonicalSecurityClassId: CLASS_ID,
    from: "2023-05-04",
    to: END_AS_OF,
    targetAt: `${END_AS_OF}T23:59:59.999Z`,
  }, {
    readHistory: async () => history,
    readUpdates: async () => ({
      status: "available",
      issuerCik: CIK,
      targetAt: `${END_AS_OF}T23:59:59.999Z`,
      updates: [],
    }),
  });
  assert.equal(executionRead.status, "available");
  assert.equal(executionRead.executions.length, 1, JSON.stringify(executionRead));

  const historyRepository = new PostgresShareCountHistoryRepository(createSerialSqlClient(client));
  let splitReaderCalls = 0;
  const reconciliation = await reconcileShareCountAnchors({
    repository: historyRepository,
    cik: CIK,
    securityClassId: CLASS_ID,
    startAnchor: { asOf: START_AS_OF },
    endAnchor: { asOf: END_AS_OF },
    executionKnownAt: "2026-08-23T00:00:01.000Z",
  }, {
    readExecutions: async (request: StockSplitExecutionReadInput) => {
      splitReaderCalls += 1;
      if (request.actionKind === "reverse_split") {
        return {
          ...executionRead,
          from: request.from,
          to: request.to,
          targetAt: request.targetAt,
        };
      }
      return {
        status: "available",
        materializationStatus: "NO_SPLIT_EVIDENCE",
        actionKind: "forward_split",
        issuerCik: CIK,
        canonicalSecurityClassId: CLASS_ID,
        from: request.from,
        to: request.to,
        targetAt: request.targetAt,
        basisChangeCoverage: "forward_split_only",
        executions: [],
        inactiveExecutions: [],
        conflicts: [],
      };
    },
  });
  assert.equal(reconciliation.status, "RECONCILED", JSON.stringify(reconciliation));
  if (reconciliation.status !== "RECONCILED") throw new Error("BINI anchors did not reconcile");
  assert.equal(reconciliation.startAnchor.sharesOutstanding, EXPECTED_START_SHARES);
  assert.equal(reconciliation.endAnchor.sharesOutstanding, EXPECTED_END_SHARES);
  assert.deepEqual(reconciliation.normalizedStartShares, {
    numerator: EXPECTED_START_SHARES,
    denominator: "25",
  });
  assert.equal(reconciliation.appliedStockSplitExecutions.length, 1);
  const rawPct = percentage(BigInt(EXPECTED_END_SHARES) - BigInt(EXPECTED_START_SHARES),
    BigInt(EXPECTED_START_SHARES));
  const adjustedPct = rationalPercentage(reconciliation.netChangePct);
  assert.ok(rawPct < -90 && rawPct > -91);
  assert.ok(adjustedPct > 146 && adjustedPct < 147);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    source: {
      accession: ACCESSION,
      raw_item_id: source.raw_item_id,
      event_id: source.event_id,
      parent_primary_ai_run_id: source.parent_primary_ai_run_id,
      source_ref: sourceEvidence.sourceRef,
      evidence: sourceEvidence.text,
    },
    calls: { provider: providerCalls, verifier: 0, repair: 0, split_reader: splitReaderCalls },
    canonical: {
      event_kind: facts.event_kind,
      old_share_units: "25",
      new_share_units: "1",
      effective_date: "2023-05-04",
      timing_kind: "market_open",
      timestamp: null,
      fact_count: 1,
      active_execution_count: executionRead.executions.length,
    },
    anchors: {
      start: { as_of: START_AS_OF, shares: EXPECTED_START_SHARES },
      end: { as_of: END_AS_OF, shares: EXPECTED_END_SHARES },
      normalized_start_exact: reconciliation.normalizedStartShares,
      net_change_exact: reconciliation.netChangeShares,
      net_change_pct_exact: reconciliation.netChangePct,
      raw_net_change_pct: rawPct,
      adjusted_net_change_pct: adjustedPct,
    },
    database_writes: 0,
  }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

async function readSourceLineage() {
  const result = await client.query(
    `select e.id::text as event_id,
            r.id::text as raw_item_id,
            r.source_code,
            r.source_group,
            r.source_unique_id,
            to_jsonb(r.*) as raw_item,
            a.id::text as parent_primary_ai_run_id,
            a.prompt_key as parent_prompt_key,
            a.prompt_version as parent_prompt_version,
            o.payload->'analysis' as primary_analysis
       from public.raw_items r
       join public.events e on e.raw_item_id = r.id
       join public.ai_runs a on a.event_id = e.id and a.raw_item_id = r.id
       join public.ai_outputs o on o.ai_run_id = a.id
      where r.source_code = 'sec_edgar'
        and r.source_unique_id = $1
        and a.status = 'completed'
        and o.payload->'analysis'->'monitor_routes'
              @> '[{"monitor_analyzer_key":"corporate_action"}]'::jsonb
      order by a.started_at desc, a.id desc
      limit 1`,
    [ACCESSION],
  );
  assert.equal(result.rows.length, 1, "expected one cached BINI Primary lineage");
  return result.rows[0] as {
    event_id: string;
    raw_item_id: string;
    source_code: string;
    source_group: "filings";
    source_unique_id: string;
    raw_item: Record<string, unknown>;
    parent_primary_ai_run_id: string;
    parent_prompt_key: string;
    parent_prompt_version: string;
    primary_analysis: Record<string, unknown>;
  };
}

function findSourceEvidence(documents: Array<{ source_ref: string; text: string }>) {
  const phrase = "begin trading on a split-adjusted basis when the market opens on May 4, 2023";
  for (const document of documents) {
    const index = document.text.toLowerCase().indexOf(phrase.toLowerCase());
    if (index < 0) continue;
    const ratioIndex = document.text.toLowerCase().lastIndexOf("1-for-25", index);
    assert.ok(ratioIndex >= 0 && index - ratioIndex < 700);
    const start = ratioIndex;
    const nextPeriod = document.text.indexOf(".", index + phrase.length);
    const end = nextPeriod < 0 ? Math.min(document.text.length, start + 800) : nextPeriod + 1;
    const text = document.text.slice(start, end).trim();
    assert.ok(text.length > phrase.length && text.length <= 800);
    assert.match(text, /1-for-25 reverse stock split/i);
    assert.match(text, /common stock/i);
    return { sourceRef: document.source_ref, text };
  }
  throw new Error("Cached BINI split timing evidence is unavailable");
}

function percentage(numerator: bigint, denominator: bigint) {
  return Number(numerator * BigInt(100_000_000) / denominator) / 1_000_000;
}

function rationalPercentage(value: { numerator: string; denominator: string }) {
  return Number(BigInt(value.numerator) * BigInt(1_000_000) / BigInt(value.denominator)) / 1_000_000;
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
