import assert from "node:assert/strict";
import test from "node:test";
import { runCorporateActionCanonicalAnalyzerPreview } from "../ai/corporateActionCanonicalAnalyzerPreview.ts";
import { adaptSec8k6kCorporateActionSource } from "./corporateActionSourceAdapters.ts";
import type { CorporateActionCanonicalFacts } from "./corporateActionCanonicalFacts.ts";
import { readStockSplitExecutions } from "./reverseSplitExecution.ts";
import { readStockSplitHistory, type StockSplitHistoryReadResult } from "./reverseSplitHistory.ts";
import {
  buildPrevalidationStockSplitMaterializationDiagnostic,
  buildPersistedStockSplitMaterializationDiagnostic,
  readStockSplitMaterializationDiagnostic,
  stockSplitMaterializationError,
} from "./stockSplitMaterialization.ts";

const CIK = "0000000001";
const CLASS_ID = `sc:v1:${CIK}:common_stock:single`;
const ACCESSION = "0000000001-23-000001";
const ACCEPTED_AT = "2023-05-05T20:15:35Z";
const EVENT_ID = "10000000-0000-4000-8000-000000000001";
const EXECUTION_ID = "20000000-0000-4000-8000-000000000001";
const SOURCE = "Example Issuer will effect a 1-for-25 reverse stock split of its common stock. The common stock will begin trading on a split-adjusted basis when the market opens on May 4, 2023.";

const input = adaptSec8k6kCorporateActionSource({
  accession_number: ACCESSION,
  source_url: "https://www.sec.gov/Archives/edgar/data/1/000000000123000001/example_8k.htm",
  filed_at: ACCEPTED_AT,
  title: "Example Issuer files 8-K",
  cleaned_source_blocks: [{ block_id: "stock-split-source", text: SOURCE }],
  issuer_context: {
    availability: "available",
    issuer_cik: CIK,
    accession_number: ACCESSION,
    accepted_at: ACCEPTED_AT,
    provenance: "sec_filing_ledger",
  },
  security_class_candidates: [{
    canonical_security_class_id: CLASS_ID,
    security_type: "common_stock",
    security_class_basis: "SINGLE_COMMON_STOCK_CLASS",
    source_member_local_name: null,
    supporting_accessions: [ACCESSION],
  }],
});

test("invalid semantic timing fails closed without being mislabeled as an evidence-promotion failure", async () => {
  let calls = 0;
  const result = await runCorporateActionCanonicalAnalyzerPreview(input, {
    apiKey: "test-key",
    runPrompt: async () => {
      calls += 1;
      return providerRun(payload({
        availability: "available",
        kind: "exact_timestamp",
        timestamp: "2023-05-04T00:01:00-04:00",
        source_ref: "stock-split-source",
        evidence: SOURCE,
      }));
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.stage, "validation_error");
  if (result.stage !== "validation_error") return;
  assert.equal(result.materialization_diagnostic, null);
  assert.equal(result.retryError, undefined);
});

test("arbitrary LLM split fields cannot become a blocking prevalidation diagnostic", () => {
  const forgedRatio = payload({
    availability: "available",
    kind: "exact_timestamp",
    timestamp: "2023-05-04T00:01:00-04:00",
    source_ref: "stock-split-source",
    evidence: SOURCE,
  });
  forgedRatio.ratio = {
    availability: "available",
    old_shares: "20",
    new_shares: "1",
    source_ref: "stock-split-source",
    evidence: SOURCE,
  };
  assert.equal(buildPrevalidationStockSplitMaterializationDiagnostic(
    forgedRatio,
    input,
    "injected validation failure",
  ), null);
  const unrelatedCorporateAction = payload({
    availability: "unavailable",
    reason: "not_provided",
  });
  unrelatedCorporateAction.event_kind = "cash_dividend";
  assert.equal(buildPrevalidationStockSplitMaterializationDiagnostic(
    unrelatedCorporateAction,
    input,
    "unrelated Corporate Action validation failure",
  ), null);
});

test("source-correct market-open timing materializes one canonical fact and one active execution", async () => {
  let calls = 0;
  const result = await runCorporateActionCanonicalAnalyzerPreview(input, {
    apiKey: "test-key",
    runPrompt: async () => {
      calls += 1;
      return providerRun(payload({
        availability: "available",
        kind: "market_open",
        timestamp: null,
        source_ref: "stock-split-source",
        evidence: SOURCE,
      }));
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.stage, "complete");
  if (result.stage !== "complete" || !result.result.applicable) return;
  const facts = result.result.facts;
  assert.equal(facts.event_kind, "reverse_split");
  const exact = facts.ratio.exact_source_components;
  assert.equal(exact?.availability, "available");
  assert.equal(exact?.availability === "available" ? exact.old_share_units : null, "25");
  assert.equal(exact?.availability === "available" ? exact.new_share_units : null, "1");
  assert.equal(facts.calculation_activation?.state, "ON_EFFECTIVE_DATE");
  assert.equal(facts.effective_date.availability, "available");
  assert.equal(facts.effective_date.availability === "available" ? facts.effective_date.value : null, "2023-05-04");
  assert.equal(facts.effective_timing?.availability === "available"
    ? facts.effective_timing.kind : null, "market_open");
  assert.equal(facts.effective_timing?.availability === "available"
    ? facts.effective_timing.timestamp : undefined, null);

  const history = availableHistory(facts);
  const execution = await readStockSplitExecutions({
    actionKind: "reverse_split",
    cik: CIK,
    canonicalSecurityClassId: CLASS_ID,
    from: "2023-05-04",
    to: "2023-05-12",
    targetAt: "2023-05-12T23:59:59Z",
  }, {
    readHistory: async () => history,
    readUpdates: async () => ({
      status: "available", issuerCik: CIK, targetAt: "2023-05-12T23:59:59Z", updates: [],
    }),
  });
  assert.equal(execution.status, "available");
  assert.equal(execution.materializationStatus, "SPLIT_EXECUTIONS_AVAILABLE");
  assert.equal(execution.executions.length, 1);
  assert.equal(execution.executions[0]?.exactRatio.oldShareUnits, "25");
  assert.equal(execution.executions[0]?.exactRatio.newShareUnits, "1");
});

test("coverage distinguishes relevant failures, unrelated failures, no evidence, persistence failure, and healed replay", async () => {
  const successful = await runCorporateActionCanonicalAnalyzerPreview(input, {
    apiKey: "test-key",
    runPrompt: async () => providerRun(payload({
      availability: "available", kind: "market_open", timestamp: null,
      source_ref: "stock-split-source", evidence: SOURCE,
    })),
  });
  assert.equal(successful.stage, "complete");
  if (successful.stage !== "complete" || !successful.result.applicable) return;
  const facts = successful.result.facts;
  const persistenceFailure = buildPersistedStockSplitMaterializationDiagnostic(
    facts,
    "Corporate Action typed persistence failed: injected",
  );
  assert.ok(persistenceFailure);
  const persistedError = stockSplitMaterializationError(persistenceFailure!);
  assert.equal(readStockSplitMaterializationDiagnostic(persistedError.message)?.failureStage, "PERSISTENCE");

  const failed = await history([], [persistenceFailure!]);
  assert.equal(failed.status, "materialization_unavailable");
  assert.equal(failed.materializationStatus, "SPLIT_MATERIALIZATION_FAILED");

  const noEvidence = await history([], []);
  assert.equal(noEvidence.status, "available");
  assert.equal(noEvidence.materializationStatus, "NO_SPLIT_EVIDENCE");

  const unrelated = structuredClone(persistenceFailure!);
  unrelated.actionKind = "forward_split";
  const unrelatedResult = await history([], [unrelated]);
  assert.equal(unrelatedResult.status, "available");
  assert.equal(unrelatedResult.materializationStatus, "NO_SPLIT_EVIDENCE");

  const replay = await history([facts], [persistenceFailure!]);
  assert.equal(replay.status, "available");
  assert.equal(replay.items.length, 1);

  const legacyFacts = structuredClone(facts);
  delete legacyFacts.calculation_activation;
  const legacyFallback = await history([legacyFacts], [persistenceFailure!]);
  assert.equal(legacyFallback.status, "materialization_unavailable");
  assert.equal(legacyFallback.materializationStatus, "SPLIT_MATERIALIZATION_FAILED");
});

function payload(effectiveTiming: Record<string, unknown>) {
  return {
    applicable: true,
    event_kind: "reverse_split",
    action_stage: "effective",
    effective_date: {
      availability: "available", value: "2023-05-04",
      calculation_basis: "split_effective",
      source_ref: "stock-split-source", evidence: SOURCE,
    },
    ratio: {
      availability: "available", old_shares: "25", new_shares: "1",
      source_ref: "stock-split-source", evidence: SOURCE,
    },
    affected_security: {
      availability: "available",
      canonical_security_class_id: CLASS_ID,
      security_type: "common_stock",
      source_security_title: "common stock",
      source_ref: "stock-split-source",
      evidence: SOURCE,
    },
    effective_timing: effectiveTiming,
    execution_update: {
      decision: "NEW_EXECUTION",
      target_execution_id: null,
      source_ref: "stock-split-source",
      evidence: SOURCE,
    },
    source_ref: "stock-split-source",
    evidence: SOURCE,
    confidence: "high",
    as_of: { availability: "available", value: "2023-05-04" },
  };
}

function providerRun(value: unknown) {
  return {
    ok: true as const,
    responseOk: true,
    status: 200,
    statusText: "OK",
    model: "test-model",
    responseId: "test-response",
    outputText: JSON.stringify(value),
    parsed: value as Record<string, unknown>,
    usage: null,
    body: null,
  };
}

function availableHistory(facts: CorporateActionCanonicalFacts): StockSplitHistoryReadResult {
  return {
    status: "available",
    materializationStatus: "SPLIT_EXECUTIONS_AVAILABLE",
    issuerCik: CIK,
    canonicalSecurityClassId: CLASS_ID,
    from: "2023-05-04",
    to: "2023-05-12",
    basisChangeCoverage: "reverse_split_only",
    items: [{
      eventId: EVENT_ID,
      sourceExecutionId: EXECUTION_ID,
      issuerCik: CIK,
      canonicalSecurityClassId: CLASS_ID,
      effectiveDate: "2023-05-04",
      effectiveTiming: facts.effective_timing!,
      sameDayOrdering: "explicit_source_timing",
      facts,
      persistedAt: ACCEPTED_AT,
    }],
  };
}

async function history(
  facts: CorporateActionCanonicalFacts[],
  failures: NonNullable<ReturnType<typeof buildPersistedStockSplitMaterializationDiagnostic>>[],
) {
  return readStockSplitHistory({
    actionKind: "reverse_split",
    cik: CIK,
    canonicalSecurityClassId: CLASS_ID,
    from: "2023-05-04",
    to: "2023-05-12",
  }, {
    rpc: async () => ({
      ok: true,
      status: 200,
      data: {
        status: "available",
        action_kind: "reverse_split",
        issuer_cik: CIK,
        canonical_security_class_id: CLASS_ID,
        from: "2023-05-04",
        to: "2023-05-12",
        candidates: facts.map((item, index) => ({
          event_id: EVENT_ID,
          source_execution_id: EXECUTION_ID,
          issuer_cik: CIK,
          canonical_security_class_id: CLASS_ID,
          effective_date: "2023-05-04",
          persisted_at: `2026-08-23T00:00:0${index}Z`,
          facts: item,
        })),
      },
    }),
    readCurrent: async () => facts.length ? ({
      status: "available",
      eventId: EVENT_ID,
      rawItemId: "30000000-0000-4000-8000-000000000001",
      parentPrimaryAiRunId: "40000000-0000-4000-8000-000000000001",
      sourceExecutionId: EXECUTION_ID,
      monitorAnalyzerKey: "corporate_action",
      analyzerContractVersion: facts[0]!.calculation_activation
        ? "corporate_action_stock_split_day_basis_evidence_v4"
        : "corporate_action_reverse_split_analyzer_v1",
      factSchemaVersion: facts[0]!.version,
      facts: facts[0]!,
      persistedAt: "2026-08-23T00:00:00Z",
    }) : ({ status: "not_ready", reason: "fixture_empty" }),
    readMaterializationFailures: async () => failures,
  });
}
