import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateSection16MonitorConditions,
  evaluateSection16MonitorFiling,
} from "./section16MonitorMatcher.ts";
import type { Section16MonitorFactReadResult, Section16MonitorFactRow } from "./monitor/section16MonitorFacts.ts";
import type { CanonicalSection16MonitorCondition } from "./monitor/section16MonitorPersistence.ts";

const ACCESSION = "0000036146-26-000004";

test("Section 16 Matcher distinguishes exact zero, missing, and footnote-only fields", () => {
  const zero = evaluateSection16MonitorConditions(
    facts([
      holdingRow(0, { amountOwned: field("exact", "0") }),
      holdingRow(1, { amountOwned: field("missing", null) }),
      holdingRow(2, { amountOwned: field("footnote_only", null, ["F1"]) }),
    ]),
    [condition("ownership.section16.holding.amount_owned", "eq", "0")],
    "holding",
  );
  assert.equal(zero.status, "match");
  assert.equal(zero.evidence?.matchedFilingRowCount, 1);
  assert.equal(zero.evidence?.countMeaning, "filing_rows_not_unique_trades");

  const missing = evaluateSection16MonitorConditions(
    facts([holdingRow(0, {
      securityTitle: field("exact", "Warrant"),
      amountOwned: field("missing", null),
    })]),
    [
      condition("ownership.section16.holding.security_title", "eq", "Warrant"),
      condition("ownership.section16.holding.amount_owned", "eq", "0"),
    ],
    "holding",
  );
  assert.equal(missing.status, "ineligible");
  assert.equal(missing.reasonCode, "source_field_missing");

  const footnoteOnly = evaluateSection16MonitorConditions(
    facts([holdingRow(0, { amountOwned: field("footnote_only", null, ["F1"]) })]),
    [condition("ownership.section16.holding.amount_owned", "eq", "0")],
    "holding",
  );
  assert.equal(footnoteOnly.status, "ineligible");
  assert.equal(footnoteOnly.reasonCode, "source_field_footnote_only");
});

test("Section 16 Matcher applies all transaction conditions to one filing row", () => {
  const current = facts([
    transactionRow(0, {
      transactionCode: field("exact", "P"),
      shares: field("exact", "10"),
      directOrIndirectOwnership: field("exact", "D"),
    }),
    transactionRow(1, {
      transactionCode: field("exact", "P"),
      shares: field("exact", "30"),
      directOrIndirectOwnership: field("exact", "I"),
    }),
  ]);
  const conditions = [
    condition("ownership.section16.transaction.transaction_code", "eq", "P"),
    condition("ownership.section16.transaction.shares", "eq", "30"),
    condition("ownership.section16.transaction.direct_or_indirect", "eq", "D"),
  ];
  const result = evaluateSection16MonitorConditions(current, conditions, "transaction");
  assert.equal(result.status, "no_match");
  assert.equal(result.reasonCode, "row_conjunction_not_met");
  assert.deepEqual(result.conditions.map((item) => item.status), ["match", "match", "match"]);
});

test("Section 16 Matcher keeps holding and transaction condition sets separate", () => {
  const result = evaluateSection16MonitorConditions(facts([]), [
    condition("ownership.section16.holding.security_title", "eq", "Common Stock"),
    condition("ownership.section16.transaction.security_title", "eq", "Common Stock"),
  ]);
  assert.equal(result.status, "ineligible");
  assert.equal(result.reasonCode, "row_families_mixed");
});

test("manual filing Matcher reads once and exposes no Alert or side-channel dependency", async () => {
  let reads = 0;
  const current = facts([transactionRow(0, { transactionCode: field("exact", "S") })]);
  const result = await evaluateSection16MonitorFiling({
    accessionNumber: ACCESSION,
    conditionSet: {
      rowFamily: "transaction",
      conditions: [condition("ownership.section16.transaction.transaction_code", "eq", "S")],
    },
  }, {
    readFacts: async (accession) => {
      reads += 1;
      assert.equal(accession, ACCESSION);
      return current;
    },
  });
  assert.equal(reads, 1);
  assert.equal(result.status, "match");
  assert.equal(result.evidence?.excludedConfirmedDuplicateRowCount, 1);
});

function facts(rows: Section16MonitorFactRow[]): Section16MonitorFactReadResult {
  return {
    status: "available",
    version: "section16_monitor_fact_reader_v1",
    scope: "one_exact_saved_filing_with_complete_stored_history_duplicate_review",
    accessionNumber: ACCESSION,
    issuerCik: "0000036146",
    formType: "5",
    sourceSha256: "a".repeat(64),
    reportingOwnerCiks: ["0001036241"],
    rows,
    includedTransactionRowCount: rows.filter((row) => row.rowFamily === "transaction").length,
    excludedConfirmedDuplicateRowCount: 1,
    holdingRowCount: rows.filter((row) => row.rowFamily === "holding").length,
    matchedCountMeaning: "filing_rows_not_unique_trades",
  };
}

function holdingRow(rowOrdinal: number, fields: Record<string, ReturnType<typeof field>>): Section16MonitorFactRow {
  return {
    accessionNumber: ACCESSION,
    formType: "5",
    rowFamily: "holding",
    rowOrdinal,
    aggregationStatus: "preserved_filing_snapshot",
    fields: { rowKind: "non_derivative", ...fields },
  };
}

function transactionRow(rowOrdinal: number, fields: Record<string, ReturnType<typeof field>>): Section16MonitorFactRow {
  return {
    accessionNumber: ACCESSION,
    formType: "5",
    rowFamily: "transaction",
    rowOrdinal,
    aggregationStatus: "included",
    fields: { rowKind: "non_derivative", ...fields },
  };
}

function field(status: "exact" | "missing" | "footnote_only", rawValue: string | null, footnoteIds: string[] = []) {
  return { xmlPath: "/fixture", status, value: rawValue, rawValue, footnoteIds };
}

function condition(key: string, operator: "eq", value: string): CanonicalSection16MonitorCondition {
  return { key, operator, value };
}
