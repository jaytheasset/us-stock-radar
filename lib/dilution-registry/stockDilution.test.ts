import assert from "node:assert/strict";
import test from "node:test";
import { buildStockDilutionSnapshot } from "./stockDilution.ts";

test("builds dilution UI data from stored totals, latest snapshots, and activity only", () => {
  const instruments = [
    instrument("1", "atm", "Roth ATM", "atm_program"),
    instrument("2", "warrant-current", "NLabs Warrant — Jun 2026", "warrant"),
    instrument("3", "equity-line", "White Lion Equity Line", "equity_line"),
    instrument("4", "note-a", "Crowdkeep Note — Apr 17 2025", "convertible_note"),
    instrument("5", "note-b", "Crowdkeep Note — May 13 2025", "convertible_note"),
    instrument("6", "warrant-one", "White Lion Warrant — First Closing", "warrant"),
    instrument("7", "warrant-two", "White Lion Warrant — Second Closing", "warrant"),
    instrument("8", "warrant-three", "White Lion Warrant — Third Closing", "warrant"),
    instrument("9", "old-note", "September 2024 Notes", "convertible_note"),
  ];
  const result = buildStockDilutionSnapshot({
    activityRows: [
      activity("1", "1", "program_start", "2026-08-13"),
      { ...activity("2", "", "share_issuance", "2026-08-10"), shares_issued: "1958479", details: "Shares issued to White Lion." },
      activity("3", "6", "cancellation", "2026-08-10", { units_cancelled: "990099" }),
      activity("4", "7", "cancellation", "2026-08-10", { units_cancelled: "734214" }),
      activity("5", "8", "cancellation", "2026-08-10", { units_cancelled: "888509" }),
      activity("6", "9", "conversion", "2026-06-08", { shares_issued: "1891388" }),
    ],
    fetchedAt: "2026-08-29T00:00:00.000Z",
    instrumentRows: instruments,
    outstanding: { asOf: "2026-08-10", shares: "62214156" },
    snapshotRows: [
      snapshot("1", "1", "current", "2026-08-13", { original_capacity: "4353000", start_date: "2026-08-13" }),
      snapshot("2", "2", "current", "2026-06-30", { remaining_units: "13331969", exercise_price: "0.31" }),
      snapshot("3", "3", "current", "2026-06-30", { remaining_capacity: "24095569", shares_issued: "643000" }),
      snapshot("4", "4", "current", "2026-06-30", { original_amount: "500000" }),
      snapshot("5", "5", "current", "2026-06-30", { original_amount: "500000" }),
      snapshot("6", "6", "closed", "2026-08-10"),
      snapshot("7", "7", "closed", "2026-08-10"),
      snapshot("8", "8", "closed", "2026-08-10"),
      snapshot("9", "9", "closed", "2026-06-30", { shares_issued: "1891388" }),
    ],
    symbol: "TEST",
    totalRows: [
      { id: "1", instrument_type: "warrant", name: "All Warrants", total_shares: "76513659", other_shares: "8641299", as_of_date: "2026-08-11" },
      { id: "2", instrument_type: "convertible_note", name: "All Convertible Notes", total_shares: "8430000", as_of_date: "2026-08-11" },
      { id: "3", instrument_type: "convertible_note", name: "Crowdkeep Notes", total_amount: "1000000", as_of_date: "2026-06-30" },
    ],
  });

  assert.equal(result.metrics.sharesOutstanding, 62_214_156);
  assert.equal(result.metrics.totalWarrantShares, 76_513_659);
  assert.equal(result.metrics.otherWarrantShares, 8_641_299);
  assert.equal(result.metrics.convertibleNotePotentialShares, 8_430_000);
  assert.equal(result.metrics.equityLineRemaining, 24_095_569);
  assert.equal(result.metrics.atmAmount, 4_353_000);
  assert.equal(result.metrics.floatShares, null);
  assert.equal(result.metrics.freeFloat, null);
  assert.equal(result.current.filter((row) => row.name.startsWith("Crowdkeep Note")).length, 2);
  assert.equal(result.closed.length, 4);
  assert.ok(result.activity.some((row) => row.title === "White Lion Warrants cancelled"));
  assert.ok(result.activity.some((row) => row.sharesIssued === 1_958_479));
  assert.equal(result.activity.filter((row) => row.title.includes("Warrant") && row.title.includes("cancelled")).length, 1);
});

test("projects one unsuperseded split adjustment over the current snapshot without changing history or dollar fields", () => {
  const result = buildStockDilutionSnapshot({
    adjustmentRows: [{
      id: "1",
      projection_id: `dca:v1:${"a".repeat(64)}`,
      instrument_id: "1",
      base_snapshot_id: "2",
      status: "APPLIED",
      review_reason: null,
      effective_date: "2024-01-16",
      execution_ids: [`rse:v1:${"b".repeat(64)}`],
      supersedes_projection_id: null,
      adjusted_fields: { remaining_units: "7500", exercise_price: "12.1" },
    }],
    activityRows: [],
    fetchedAt: "2024-01-17T00:00:00Z",
    instrumentRows: [instrument("1", "warrant", "Placement Agent Warrant", "warrant")],
    outstanding: null,
    snapshotRows: [
      snapshot("1", "1", "old", "2023-11-30", {
        remaining_units: "300000",
        exercise_price: "0.3025",
        remaining_amount: "90750",
      }),
      snapshot("2", "1", "current", "2023-12-04", {
        remaining_units: "300000",
        exercise_price: "0.3025",
        remaining_amount: "90750",
      }),
    ],
    symbol: "RNAZ",
    totalRows: [],
  });

  assert.equal(result.current[0]?.remainingUnits, 7_500);
  assert.equal(result.current[0]?.exercisePrice, 12.1);
  assert.equal(result.current[0]?.remainingAmount, 90_750);
  assert.equal(result.current[0]?.corporateActionAdjustment?.status, "APPLIED");
  assert.equal(result.current[0]?.corporateActionAdjustment?.effectiveDate, "2024-01-16");
});

test("a deterministic Review replacement supersedes an older applied projection and fails closed", () => {
  const appliedId = `dca:v1:${"c".repeat(64)}`;
  const reviewId = `dca:v1:${"d".repeat(64)}`;
  const result = buildStockDilutionSnapshot({
    adjustmentRows: [
      {
        projection_id: appliedId,
        instrument_id: "1",
        base_snapshot_id: "1",
        status: "APPLIED",
        effective_date: "2024-01-16",
        execution_ids: [`rse:v1:${"e".repeat(64)}`],
        supersedes_projection_id: null,
        adjusted_fields: { remaining_units: "7500" },
      },
      {
        projection_id: reviewId,
        instrument_id: "1",
        base_snapshot_id: "1",
        status: "REVIEW",
        review_reason: "EXECUTION_CONFLICT",
        effective_date: null,
        execution_ids: [],
        supersedes_projection_id: appliedId,
        adjusted_fields: {},
      },
    ],
    activityRows: [],
    fetchedAt: "2024-01-17T00:00:00Z",
    instrumentRows: [instrument("1", "warrant", "Placement Agent Warrant", "warrant")],
    outstanding: null,
    snapshotRows: [snapshot("1", "1", "current", "2023-12-04", { remaining_units: "300000" })],
    symbol: "RNAZ",
    totalRows: [],
  });

  assert.equal(result.current[0]?.remainingUnits, 300_000);
  assert.equal(result.current[0]?.corporateActionAdjustment?.status, "REVIEW");
  assert.equal(result.current[0]?.corporateActionAdjustment?.projectionId, reviewId);
  assert.equal(result.current[0]?.corporateActionAdjustment?.reviewReason, "EXECUTION_CONFLICT");
});

function instrument(id: string, instrument_key: string, name: string, instrument_type: string) {
  return { id, instrument_key, instrument_type, name };
}

function snapshot(
  id: string,
  instrument_id: string,
  status: string,
  as_of_date: string,
  fields: Record<string, unknown> = {},
) {
  return { id, instrument_id, status, as_of_date, last_checked: "2026-08-28", ...fields };
}

function activity(
  id: string,
  instrument_id: string,
  activity_type: string,
  activity_date: string,
  fields: Record<string, unknown> = {},
) {
  return { id, instrument_id, activity_type, activity_date, ...fields };
}
