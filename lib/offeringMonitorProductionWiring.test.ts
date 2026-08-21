import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { OfferingMonitorJobIdentity } from "./offeringMonitorJobFoundation.ts";
import {
  validateOfferingMonitorCanonicalReadResult,
  type OfferingMonitorCanonicalReadResult,
  type OfferingMonitorPromotionResult,
} from "./offeringMonitorCanonicalPersistence.ts";
import {
  processOfferingMonitorProductionWiring,
  type OfferingMonitorProductionWiringDependencies,
} from "./offeringMonitorProductionWiring.ts";
import type { OfferingMonitorDiagnosticCandidate } from "./offeringMonitorSecondStage.ts";
import {
  buildMinimalOfferingMarketSnapshot,
  materializeMinimalOfferingMonitor,
  type MinimalOfferingMonitor,
} from "./minimalOfferingMonitor.ts";

const EVENT_ID = "69606800-ee16-4a75-9bbf-3b64bdc56d69";
const RAW_ID = "efea3384-9eef-4e6b-9e63-60dc1cd3090e";
const PRIMARY_ID = "5e56353f-e700-4c3f-89c1-0d7c6faf851a";
const EXECUTION_ID = "42745e3b-7ac8-55af-a362-dec6ee07b96f";

test("current validated candidate promotes, reads official canonical, and reaches the existing Matcher once", async () => {
  const harness = wiringHarness();
  const result = await processOfferingMonitorProductionWiring(identity(), completed(), harness.dependencies);

  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.promotionStatus, "saved");
  assert.equal(result.matcherStatus, "invoked");
  assert.equal(result.matcherInvoked, true);
  assert.equal(result.canonicalSourceExecutionId, EXECUTION_ID);
  assert.deepEqual(harness.calls(), { promote: 1, read: 1, matcher: 1, metadata: 1 });
  assert.equal(harness.metadata().diagnostic_candidate_only, false);
  assert.equal(harness.metadata().canonical_persistence_changed, true);
  assert.equal(harness.metadata().canonical_reader_status, "available");
  assert.equal(harness.metadata().offering_matcher_invoked, true);
});

test("same execution replay is an exact idempotent equivalent with no canonical or Matcher duplicate", async () => {
  const harness = wiringHarness();
  const first = await processOfferingMonitorProductionWiring(identity(), completed(), harness.dependencies);
  const second = await processOfferingMonitorProductionWiring(identity(), completed(), harness.dependencies);

  assert.equal(first.status, "completed");
  assert.equal(second.status, "completed");
  if (second.status !== "completed") return;
  assert.equal(second.promotionStatus, "idempotent");
  assert.equal(second.matcherStatus, "replayed");
  assert.equal(second.matcherInvoked, false);
  assert.deepEqual(harness.calls(), { promote: 1, read: 2, matcher: 1, metadata: 1 });
  assert.equal(harness.canonicalRows(), 1);
  assert.equal(harness.matcherResults(), 1);
});

test("existing RPC idempotency remains safe and reports no new canonical write", async () => {
  const harness = wiringHarness({
    promotion: { status: "idempotent", eventId: EVENT_ID, sourceExecutionId: EXECUTION_ID },
    canonical: availableCanonical(),
  });
  const result = await processOfferingMonitorProductionWiring(identity(), completed(), harness.dependencies);

  assert.equal(result.status, "completed");
  if (result.status !== "completed") return;
  assert.equal(result.promotionStatus, "idempotent");
  assert.equal(result.matcherStatus, "invoked");
  assert.equal(harness.metadata().canonical_persistence_changed, false);
  assert.equal(harness.metadata().diagnostic_candidate_only, false);
  assert.deepEqual(harness.calls(), { promote: 1, read: 1, matcher: 1, metadata: 1 });
});

test("stale parent blocks promotion, preserves current canonical, and never invokes Matcher", async () => {
  const currentCanonical = availableCanonical({ sourceExecutionId: "52745e3b-7ac8-55af-a362-dec6ee07b96f" });
  const harness = wiringHarness({ promotion: { status: "stale", reason: "parent_not_current" }, canonical: currentCanonical });
  const before = structuredClone(currentCanonical);

  const result = await processOfferingMonitorProductionWiring(identity(), completed(), harness.dependencies);

  assert.deepEqual(result, {
    status: "promotion_blocked",
    promotionStatus: "stale",
    reason: "parent_not_current",
    matcherInvoked: false,
  });
  assert.deepEqual(harness.currentCanonical(), before);
  assert.deepEqual(harness.calls(), { promote: 1, read: 0, matcher: 0, metadata: 1 });
});

test("invalid and not-applicable candidates never promote or invoke Matcher", async () => {
  const invalidHarness = wiringHarness();
  const invalid = completed();
  invalid.candidate.validation.status = "validation_failed";
  assert.deepEqual(
    await processOfferingMonitorProductionWiring(identity(), invalid, invalidHarness.dependencies),
    { status: "not_promoted", reason: "invalid_candidate", matcherInvoked: false },
  );
  assert.deepEqual(invalidHarness.calls(), { promote: 0, read: 0, matcher: 0, metadata: 0 });

  const notApplicableHarness = wiringHarness();
  assert.deepEqual(
    await processOfferingMonitorProductionWiring(identity(), completed(notApplicableCandidate()), notApplicableHarness.dependencies),
    { status: "not_promoted", reason: "candidate_not_applicable", matcherInvoked: false },
  );
  assert.deepEqual(notApplicableHarness.calls(), { promote: 0, read: 0, matcher: 0, metadata: 1 });
  assert.equal(notApplicableHarness.metadata().diagnostic_candidate_only, true);
  assert.equal(notApplicableHarness.metadata().canonical_persistence_changed, false);
});

test("official reader not-ready after safe promotion blocks Matcher and records the true persistence state", async () => {
  const harness = wiringHarness({ canonical: { status: "not_ready", reason: "parent_not_current" } });
  const result = await processOfferingMonitorProductionWiring(identity(), completed(), harness.dependencies);

  assert.deepEqual(result, {
    status: "reader_not_ready",
    promotionStatus: "saved",
    reason: "parent_not_current",
    matcherInvoked: false,
  });
  assert.deepEqual(harness.calls(), { promote: 1, read: 1, matcher: 0, metadata: 1 });
  assert.equal(harness.metadata().diagnostic_candidate_only, false);
  assert.equal(harness.metadata().canonical_persistence_changed, true);
  assert.equal(harness.metadata().offering_matcher_invoked, false);
});

test("production source uses only existing promotion, official reader, and existing Matcher in a second durable step", () => {
  const source = readFileSync(new URL("./offeringMonitorProductionWiring.ts", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../workflows/offering-monitor-normalization.ts", import.meta.url), "utf8");
  assert.match(source, /promoteOfferingMonitorCanonical/);
  assert.match(source, /readOfferingMonitorCanonical/);
  assert.match(source, /evaluateOfferingMonitorEvent/);
  assert.doesNotMatch(source, /event_offering_terms|offering_monitor_payload|parser_output|Gemini|alert queue|Telegram|Email|notification/i);
  assert.ok(workflow.indexOf("runOfferingMonitorSecondStageStep") < workflow.indexOf("runOfferingMonitorProductionWiringStep"));
  assert.match(workflow, /runOfferingMonitorProductionWiringStep\.maxRetries = 0/);
  assert.match(workflow, /secondStage\.status !== "completed"/);
});

function wiringHarness(options: {
  promotion?: OfferingMonitorPromotionResult;
  canonical?: OfferingMonitorCanonicalReadResult;
} = {}) {
  let promote = 0;
  let read = 0;
  let matcher = 0;
  let metadataWrites = 0;
  let canonicalRows = options.canonical?.status === "available" ? 1 : 0;
  let matcherResults = 0;
  let currentCanonical: OfferingMonitorCanonicalReadResult = options.canonical || { status: "not_ready", reason: "canonical_missing" };
  let metadata: Record<string, unknown> = { phase: "diagnostic_candidate_saved" };
  const dependencies: OfferingMonitorProductionWiringDependencies = {
    async promoteCanonical(): Promise<OfferingMonitorPromotionResult> {
      promote += 1;
      const promotion = options.promotion || { status: "saved" as const, eventId: EVENT_ID, sourceExecutionId: EXECUTION_ID };
      if (promotion.status === "saved") {
        currentCanonical = options.canonical || availableCanonical();
        canonicalRows = 1;
      }
      return promotion;
    },
    async readCanonical() {
      read += 1;
      return currentCanonical;
    },
    async evaluateMatcher({ eventId, canonical }) {
      matcher += 1;
      matcherResults += 1;
      assert.equal(canonical.sourceExecutionId, EXECUTION_ID);
      return { version: "offering_monitor_matcher_v1", eventId, evaluations: [] };
    },
    async readExecutionMetadata() {
      return { ...metadata };
    },
    async recordExecutionMetadata(_identity, patch) {
      metadataWrites += 1;
      metadata = { ...metadata, ...patch };
    },
  };
  return {
    dependencies,
    calls: () => ({ promote, read, matcher, metadata: metadataWrites }),
    metadata: () => metadata,
    canonicalRows: () => canonicalRows,
    matcherResults: () => matcherResults,
    currentCanonical: () => currentCanonical,
  };
}

function identity(): OfferingMonitorJobIdentity {
  return {
    schemaVersion: "offering_monitor_job_v2",
    purpose: "offering_monitor_normalization",
    jobId: EXECUTION_ID,
    logicalJobId: "32745e3b-7ac8-55af-a362-dec6ee07b96f",
    executionId: EXECUTION_ID,
    executionContractVersion: "second_stage_direct_v8",
    executionAttemptKey: "automatic",
    eventId: EVENT_ID,
    rawItemId: RAW_ID,
    sourceIdentity: "0001437749-26-021738",
    formType: "S-1",
    family: "s1",
    parentPrimaryAiRunId: PRIMARY_ID,
    parentPromptKey: "sec_s1_f1_analysis",
    parentPromptVersion: "v1",
    enqueuedAt: "2026-08-21T00:00:00.000Z",
  };
}

function completed(value = candidate()) {
  return { status: "completed" as const, candidate: value };
}

function candidate(): OfferingMonitorDiagnosticCandidate {
  const canonicalCandidate = applicableCanonicalCandidate();
  return {
    schema_version: "offering_monitor_second_stage_candidate_v2",
    job_id: EXECUTION_ID,
    parent_primary_ai_run_id: PRIMARY_ID,
    event_id: EVENT_ID,
    raw_item_id: RAW_ID,
    source_identity: "0001437749-26-021738",
    prompt: { key: "offering_monitor_normalization_job", version: "second_stage_direct_v8" },
    input_stats: { selectedSourceRefs: ["amount_ref", "immediate_ref", "additional_ref"] } as never,
    provider: {
      name: "gemini", model: "fixture", response_id: null, http_status: 200,
      response_ok: true, attempts: 1, latency_ms: 1, usage: null,
    },
    raw_output: "{}",
    direct_payload: {},
    validation: { status: "success", errors: [] },
    canonical_candidate: canonicalCandidate,
    materialized_candidate: materializeMinimalOfferingMonitor(canonicalCandidate, buildMinimalOfferingMarketSnapshot(null)),
  };
}

function notApplicableCandidate() {
  const value = candidate();
  const unavailable = {
    actual_primary_offering_amount: unavailableFact("currency", "market_cap"),
    offering_price: unavailableFact("currency_per_security", "market_price"),
    immediate_primary_share_exposure: unavailableFact("shares", "shares_outstanding"),
    additional_potential_primary_share_exposure: unavailableFact("shares", "shares_outstanding"),
    resale_share_exposure: unavailableFact("shares", "public_float"),
  };
  value.canonical_candidate = {
    version: "minimal_offering_monitor_v1",
    applicability: "not_applicable",
    financing_stage: "unknown",
    primary_or_resale: "not_applicable",
    security_nature: "non_equity",
    has_warrant: null,
    has_prefunded_warrant: null,
    has_convertible: null,
    facts: unavailable,
  };
  value.materialized_candidate = materializeMinimalOfferingMonitor(
    value.canonical_candidate,
    buildMinimalOfferingMarketSnapshot(null),
  );
  return value;
}

function availableCanonical(overrides: { sourceExecutionId?: string } = {}) {
  const value = candidate();
  return validateOfferingMonitorCanonicalReadResult({
    status: "available",
    event_id: EVENT_ID,
    raw_item_id: RAW_ID,
    parent_primary_ai_run_id: PRIMARY_ID,
    source_execution_id: overrides.sourceExecutionId || EXECUTION_ID,
    form_family: "s1",
    contract_version: "second_stage_direct_v8",
    schema_version: value.schema_version,
    canonical_payload: value.canonical_candidate,
    materialized_payload: value.materialized_candidate,
    total_potential_primary_share_exposure: 31_426_774,
    promoted_at: "2026-08-21T00:00:00.000Z",
  });
}

function applicableCanonicalCandidate(): MinimalOfferingMonitor {
  return {
    version: "minimal_offering_monitor_v1",
    applicability: "applicable",
    financing_stage: "registration_only",
    primary_or_resale: "primary",
    security_nature: "equity_linked",
    has_warrant: true,
    has_prefunded_warrant: true,
    has_convertible: false,
    facts: {
      actual_primary_offering_amount: availableFact(10_000_000, "currency", "USD", "unit_offering", "market_cap", "amount_ref"),
      offering_price: unavailableFact("currency_per_security", "market_price"),
      immediate_primary_share_exposure: availableFact(15_713_387, "shares", null, "common_shares", "shares_outstanding", "immediate_ref"),
      additional_potential_primary_share_exposure: availableFact(15_713_387, "shares", null, "common_warrants", "shares_outstanding", "additional_ref"),
      resale_share_exposure: unavailableFact("shares", "public_float"),
    },
  };
}

function availableFact(
  value: number,
  unit: "currency" | "shares",
  currency: string | null,
  securityBasis: string,
  comparisonBasis: "market_cap" | "shares_outstanding",
  sourceRef: string,
) {
  return {
    value, availability: "available" as const, value_quality: "estimated" as const,
    bound: "maximum" as const, unit, currency, security_basis: securityBasis,
    comparison_basis_type: comparisonBasis, comparable_to_event_market_basis: false, source_ref: sourceRef,
  };
}

function unavailableFact(
  unit: "currency" | "currency_per_security" | "shares",
  comparisonBasis: "market_cap" | "market_price" | "shares_outstanding" | "public_float",
) {
  return {
    value: null, availability: "unavailable" as const, value_quality: "unknown" as const,
    bound: "unknown" as const, unit, currency: null, security_basis: null,
    comparison_basis_type: comparisonBasis, comparable_to_event_market_basis: null, source_ref: null,
  };
}
