import assert from "node:assert/strict";
import test from "node:test";
import {
  assertHistoricalReplayCanonicalContractState,
  type HistoricalReplayCurrentCanonicalSelection,
} from "./historicalReplayCanonicalContractGate.ts";

const V1 = "corporate_action_reverse_split_analyzer_v1";
const V3 = "corporate_action_stock_split_day_basis_evidence_v3";

test("V1-only current selection remains valid when production fallback allows it", () => {
  const state = assertHistoricalReplayCanonicalContractState(available(V1), integrity());
  assert.equal(state.current_analyzer_contract_version, V1);
  assert.equal(state.current_contract_fact_count, 1);
  assert.equal(state.current_contract_result_count, 1);
});

test("V1 and valid V3 may coexist while V3 remains the unique current contract", () => {
  const state = assertHistoricalReplayCanonicalContractState(available(V3), integrity({
    preserved_legacy_or_prior_fact_count: 1,
    preserved_legacy_or_prior_result_count: 1,
  }));
  assert.equal(state.current_analyzer_contract_version, V3);
  assert.equal(state.preserved_legacy_or_prior_fact_count, 1);
  assert.equal(state.preserved_legacy_or_prior_result_count, 1);
});

test("failed or incomplete V3 never falls back silently to V1", () => {
  assert.throws(
    () => assertHistoricalReplayCanonicalContractState({
      status: "not_ready",
      reason: "current_contract_result_incomplete_or_failed",
    }, integrity()),
    /current_contract_result_incomplete_or_failed/,
  );
});

test("two canonical facts in the production-selected current contract fail", () => {
  assert.throws(
    () => assertHistoricalReplayCanonicalContractState(available(V3), integrity({
      current_contract_fact_count: 2,
    })),
    /exactly one canonical fact.*found 2/,
  );
});

test("two canonical results in the production-selected current contract fail", () => {
  assert.throws(
    () => assertHistoricalReplayCanonicalContractState(available(V3), integrity({
      current_contract_result_count: 2,
    })),
    /exactly one canonical result.*found 2/,
  );
});

test("multiple legacy or historical rows do not invalidate an unambiguous current contract", () => {
  const state = assertHistoricalReplayCanonicalContractState(available(V3), integrity({
    preserved_legacy_or_prior_fact_count: 7,
    preserved_legacy_or_prior_result_count: 7,
  }));
  assert.equal(state.current_contract_fact_count, 1);
  assert.equal(state.current_contract_result_count, 1);
  assert.equal(state.preserved_legacy_or_prior_fact_count, 7);
});

test("a future contract follows the production reader selection without a harness version pin", () => {
  const futureContract = "corporate_action_stock_split_day_basis_evidence_v4";
  const state = assertHistoricalReplayCanonicalContractState(
    available(futureContract),
    integrity({ preserved_legacy_or_prior_fact_count: 8 }),
  );
  assert.equal(state.current_analyzer_contract_version, futureContract);
  assert.equal(state.current_contract_fact_count, 1);
});

test("missing current canonical result remains fail-closed", () => {
  assert.throws(
    () => assertHistoricalReplayCanonicalContractState({
      status: "not_ready",
      reason: "current_successful_result_missing",
    }, integrity()),
    /current_successful_result_missing/,
  );
});

function available(analyzerContractVersion: string): HistoricalReplayCurrentCanonicalSelection {
  return {
    status: "available",
    eventId: "11111111-1111-4111-8111-111111111111",
    parentPrimaryAiRunId: "22222222-2222-4222-8222-222222222222",
    sourceExecutionId: "33333333-3333-4333-8333-333333333333",
    analyzerContractVersion,
    persistedAt: "2026-08-26T12:39:56.588Z",
  };
}

function integrity(overrides: Record<string, unknown> = {}) {
  return {
    current_contract_fact_count: 1,
    current_contract_result_count: 1,
    selected_fact_count: 1,
    selected_result_count: 1,
    preserved_legacy_or_prior_fact_count: 0,
    preserved_legacy_or_prior_result_count: 0,
    selected_fact_persisted_at: "2026-08-26T12:39:56.588Z",
    ...overrides,
  };
}
