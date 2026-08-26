import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertHistoricalReplayCanonicalContractState,
  type HistoricalReplayCurrentCanonicalSelection,
} from "./historicalReplayCanonicalContractGate.ts";

const V1 = "corporate_action_reverse_split_analyzer_v1";
const V3 = "corporate_action_stock_split_day_basis_evidence_v3";
const V4 = "corporate_action_stock_split_day_basis_evidence_v4";

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

test("V1, V3, and valid V4 coexist while V4 remains the unique current contract", () => {
  const state = assertHistoricalReplayCanonicalContractState(available(V4), integrity({
    preserved_legacy_or_prior_fact_count: 2,
    preserved_legacy_or_prior_result_count: 2,
  }));
  assert.equal(state.current_analyzer_contract_version, V4);
  assert.equal(state.current_contract_fact_count, 1);
  assert.equal(state.current_contract_result_count, 1);
  assert.equal(state.preserved_legacy_or_prior_fact_count, 2);
  assert.equal(state.preserved_legacy_or_prior_result_count, 2);
});

test("V3 and valid V4 coexist while V4 remains the unique current contract", () => {
  const state = assertHistoricalReplayCanonicalContractState(available(V4), integrity({
    preserved_legacy_or_prior_fact_count: 1,
    preserved_legacy_or_prior_result_count: 1,
  }));
  assert.equal(state.current_analyzer_contract_version, V4);
  assert.equal(state.current_contract_fact_count, 1);
  assert.equal(state.current_contract_result_count, 1);
  assert.equal(state.preserved_legacy_or_prior_fact_count, 1);
  assert.equal(state.preserved_legacy_or_prior_result_count, 1);
});

test("failed or incomplete V4 never falls back silently to V3 or V1", () => {
  assert.throws(
    () => assertHistoricalReplayCanonicalContractState({
      status: "not_ready",
      reason: "current_contract_result_incomplete_or_failed",
    }, integrity()),
    /current_contract_result_incomplete_or_failed/,
  );
});

test("two V4 canonical facts in the production-selected current contract fail", () => {
  assert.throws(
    () => assertHistoricalReplayCanonicalContractState(available(V4), integrity({
      current_contract_fact_count: 2,
    })),
    /exactly one canonical fact.*found 2/,
  );
});

test("two V4 canonical results in the production-selected current contract fail", () => {
  assert.throws(
    () => assertHistoricalReplayCanonicalContractState(available(V4), integrity({
      current_contract_result_count: 2,
    })),
    /exactly one canonical result.*found 2/,
  );
});

test("multiple legacy or historical rows do not invalidate an unambiguous V4 current identity", () => {
  const state = assertHistoricalReplayCanonicalContractState(available(V4), integrity({
    preserved_legacy_or_prior_fact_count: 7,
    preserved_legacy_or_prior_result_count: 7,
  }));
  assert.equal(state.current_contract_fact_count, 1);
  assert.equal(state.current_contract_result_count, 1);
  assert.equal(state.preserved_legacy_or_prior_fact_count, 7);
});

test("a future contract follows the production reader selection without a harness version pin", () => {
  const futureContract = "corporate_action_stock_split_day_basis_evidence_v5";
  const state = assertHistoricalReplayCanonicalContractState(
    available(futureContract),
    integrity({ preserved_legacy_or_prior_fact_count: 8 }),
  );
  assert.equal(state.current_analyzer_contract_version, futureContract);
  assert.equal(state.current_contract_fact_count, 1);
});

test("missing result in the selected V4 contract fails closed", () => {
  assert.throws(
    () => assertHistoricalReplayCanonicalContractState(available(V4), integrity({
      current_contract_result_count: 0,
      selected_result_count: 0,
    })),
    /exactly one canonical result.*found 0/,
  );
});

test("pending current V4 never falls back silently to a completed legacy contract", () => {
  assert.throws(
    () => assertHistoricalReplayCanonicalContractState({
      status: "not_ready",
      reason: "current_contract_result_incomplete_or_failed",
    }, integrity({
      preserved_legacy_or_prior_fact_count: 2,
      preserved_legacy_or_prior_result_count: 2,
    })),
    /current_contract_result_incomplete_or_failed/,
  );
});

test("production reader missing current canonical result remains fail-closed", () => {
  assert.throws(
    () => assertHistoricalReplayCanonicalContractState({
      status: "not_ready",
      reason: "current_successful_result_missing",
    }, integrity()),
    /current_successful_result_missing/,
  );
});

test("COSM runner uses current-contract integrity instead of parent-lineage global counts", () => {
  const runner = readFileSync(
    new URL("./diagnose-corporate-action-effective-timing-local.cjs", import.meta.url),
    "utf8",
  );
  assert.match(runner, /assertHistoricalReplayCanonicalContractState/);
  assert.match(runner, /current_contract_fact_count/);
  assert.match(runner, /selected_source_execution_id/);
  assert.match(runner, /preserved_legacy_or_prior_fact_count/);
  assert.doesNotMatch(runner, /beforeReplay\.fact_count|afterReplay\.fact_count/);
  assert.doesNotMatch(runner, /function readPersistenceCounts/);
});

test("BINI runner uses current-contract integrity and keeps immediate replay provider-free", () => {
  const runner = readFileSync(
    new URL("./verify-stock-split-day-basis-evidence-v3-local.cjs", import.meta.url),
    "utf8",
  );
  assert.match(runner, /assertHistoricalReplayCanonicalContractState/);
  assert.match(runner, /current_contract_fact_count/);
  assert.match(runner, /selected_source_execution_id/);
  assert.match(runner, /preserved_legacy_or_prior_fact_count/);
  assert.match(runner, /execution\.providerCalls === 1/);
  assert.match(runner, /replay\.providerCalls !== 0/);
  assert.doesNotMatch(runner, /beforeReplay\.fact_count|afterReplay\.fact_count/);
  assert.doesNotMatch(runner, /Expected one canonical fact\/result/);
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
