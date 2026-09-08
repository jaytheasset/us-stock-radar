import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMonitorConditions, type MonitorFactReaders } from "./listingMonitorMatcher.ts";
import type { CurrentOwnershipReadResult } from "./monitor/ownershipMonitorPersistence.ts";

const eventId = "22222222-2222-4222-8222-222222222222";
const baseLineage = {
  eventId,
  rawItemId: "33333333-3333-4333-8333-333333333333",
  sourceExecutionId: eventId,
  accessionNumber: "0001493152-26-023264",
  parserVersion: "ownership-parser-v1",
  persistedAt: "2026-05-13T00:00:00.000Z",
} as const;

test("Form 4 raw transaction conditions execute on one reported XML row without LLM semantics", () => {
  const result = evaluate(form4Current(), [
    { key: "ownership.form4.transaction_kind", operator: "eq", value: "non_derivative" },
    { key: "ownership.form4.transaction_code", operator: "eq", value: "P" },
    { key: "ownership.form4.acquisition_disposition", operator: "eq", value: "A" },
    { key: "ownership.form4.security_class", operator: "eq", value: "Common Stock" },
    { key: "ownership.form4.transaction_date", operator: "eq", value: "2026-05-12" },
    { key: "ownership.form4.shares", operator: "gte", value: 8_000 },
    { key: "ownership.form4.price_per_share", operator: "lte", value: 1.2 },
    { key: "ownership.form4.post_transaction_shares", operator: "gt", value: 100_000 },
    { key: "ownership.form4.reporting_owner_role", operator: "eq", value: "director" },
    { key: "ownership.form4.is_director", operator: "eq", value: true },
  ]);
  assert.equal(result.status, "match");
  assert.equal(result.reasonCode, "all_conditions_match");

  assert.equal(evaluate(form4Current(), [
    { key: "ownership.form4.direction", operator: "eq", value: "buy" },
  ]).reasonCode, "condition_key_unknown");
  assert.equal(evaluate(form4Current(), [
    { key: "ownership.form4.transaction_value", operator: "gte", value: 1 },
  ]).reasonCode, "condition_key_unknown");
});

test("Form 4 AND conditions cannot combine matches from different transaction rows", () => {
  const result = evaluate(form4Current(), [
    { key: "ownership.form4.shares", operator: "eq", value: 1_050 },
    { key: "ownership.form4.post_transaction_shares", operator: "eq", value: 105_875 },
  ]);
  assert.equal(result.status, "no_match");
  assert.equal(result.reasonCode, "ownership_row_conjunction_not_met");
});

test("Form 144 proposed-sale fields match only proposed notices and never Form 4 transactions", () => {
  const result = evaluate(form144Current(), [
    { key: "ownership.form144.security_class", operator: "eq", value: "Common Stock" },
    { key: "ownership.form144.proposed_sale_shares", operator: "gte", value: 20_000_000 },
    { key: "ownership.form144.proposed_sale_value", operator: "gt", value: 2_000_000_000 },
    { key: "ownership.form144.proposed_sale_date", operator: "eq", value: "2026-05-22" },
    { key: "ownership.form144.exchange", operator: "eq", value: "NASD" },
  ]);
  assert.equal(result.status, "match");

  const wrongFamily = evaluate(form144Current(), [
    { key: "ownership.form4.transaction_code", operator: "eq", value: "S" },
  ]);
  assert.equal(wrongFamily.status, "ineligible");
  assert.equal(wrongFamily.reasonCode, "ownership_form_mismatch");
});

test("unavailable XML values and unattributed multiple reporters fail closed", () => {
  const unavailable = structuredClone(form4Current());
  if (unavailable.status === "available") {
    (unavailable.rows as unknown as Record<string, unknown>[]).forEach((row) => {
      row.price_per_share = null;
      row.price_per_share_value_quality = "unknown";
      row.price_per_share_availability = "unavailable";
    });
  }
  assert.equal(evaluate(unavailable, [
    { key: "ownership.form4.price_per_share", operator: "gte", value: 1 },
  ]).reasonCode, "fact_unavailable");

  const multiReporter = structuredClone(form4Current());
  if (multiReporter.status === "available") {
    (multiReporter.rows as unknown as Record<string, unknown>[]).forEach((row) => {
      row.is_director = null;
      row.provenance = {
        ...(row.provenance as Record<string, unknown>),
        reporting_owner_scope: "filing_level_unattributed_owner_set",
      };
    });
  }
  const mixedScope = evaluate(multiReporter, [
    { key: "ownership.form4.reporting_owner_role", operator: "eq", value: "director" },
    { key: "ownership.form4.shares", operator: "gte", value: 1_000 },
  ]);
  assert.equal(mixedScope.status, "ineligible");
  assert.equal(mixedScope.reasonCode, "ownership_reporter_attribution_unavailable");
  assert.equal(evaluate(multiReporter, [
    { key: "ownership.form4.reporting_owner_role", operator: "eq", value: "director" },
  ]).status, "match", "filing-level role alone does not invent row attribution");
  assert.equal(evaluate(multiReporter, [
    { key: "ownership.form4.reporting_owner_role", operator: "eq", value: "director" },
    { key: "ownership.form4.reporting_owner_role", operator: "eq", value: "officer" },
  ]).reasonCode, "ownership_reporter_attribution_unavailable");
});

test("invalid Ownership operators and values use the common fail-closed condition contract", () => {
  assert.equal(evaluate(form4Current(), [
    { key: "ownership.form4.shares", operator: "contains", value: 1_000 },
  ]).reasonCode, "condition_operator_unknown");
  assert.equal(evaluate(form4Current(), [
    { key: "ownership.form4.shares", operator: "gte", value: -0.5 },
  ]).reasonCode, "condition_value_invalid");

  const noMatchWins = evaluate(form4Current(), [
    { key: "ownership.form4.shares", operator: "eq", value: 99_999 },
    { key: "ownership.form4.price_per_share", operator: "contains", value: 1 },
  ]);
  assert.equal(noMatchWins.status, "no_match");
  assert.equal(noMatchWins.reasonCode, "condition_not_met");
});

function evaluate(
  ownership: CurrentOwnershipReadResult,
  conditions: readonly Readonly<{ key: string; operator: string; value: unknown }>[],
) {
  const readers: MonitorFactReaders = {
    listing: { status: "not_ready", reason: "reader_not_requested" },
    corporateAction: { status: "not_ready", reason: "reader_not_requested" },
    ownership,
  };
  return evaluateMonitorConditions(readers, conditions, {
    evaluationDate: "2026-05-13",
    evaluatedAt: "2026-05-13T12:00:00.000Z",
  });
}

function form4Current(): CurrentOwnershipReadResult {
  return {
    status: "available",
    form: "form4",
    ...baseLineage,
    rows: [
      form4Row(0, 1_050, 1.195, 96_925),
      form4Row(1, 8_950, 1.1999, 105_875),
    ],
  };
}

function form4Row(index: number, shares: number, price: number, postTransactionShares: number) {
  return {
    event_id: eventId,
    transaction_index: index,
    symbol: "XXII",
    reporting_owner_roles: ["director"],
    is_director: true,
    transaction_kind: "non_derivative",
    security_title: "Common Stock",
    transaction_date: "2026-05-12",
    transaction_code: "P",
    acquired_disposed_code: "A",
    shares,
    shares_value_quality: "exact",
    shares_availability: "available",
    price_per_share: price,
    price_per_share_value_quality: "exact",
    price_per_share_availability: "available",
    post_transaction_shares: postTransactionShares,
    post_transaction_shares_value_quality: "exact",
    post_transaction_shares_availability: "available",
    provenance: { reporting_owner_scope: "single_filing_owner" },
  } as Record<string, unknown> & { event_id: string; transaction_index: number };
}

function form144Current(): CurrentOwnershipReadResult {
  return {
    status: "available",
    form: "form144",
    ...baseLineage,
    accessionNumber: "0001958244-26-000308",
    rows: [{
      event_id: eventId,
      proposed_sale_index: 0,
      symbol: "WMT",
      security_title: "Common Stock",
      exchange: "NASD",
      securities_to_be_sold: 20_000_000,
      securities_to_be_sold_value_quality: "exact",
      securities_to_be_sold_availability: "available",
      aggregate_market_value: 2_405_400_000,
      aggregate_market_value_value_quality: "exact",
      aggregate_market_value_availability: "available",
      approximate_sale_date: "2026-05-22",
    }],
  };
}
