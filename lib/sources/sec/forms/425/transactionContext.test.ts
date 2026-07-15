import assert from "node:assert/strict";

import {
  buildSec425TransactionContextMatchPlan,
  normalizeSec425TransactionContextForm,
} from "./transactionContext.ts";

const current = {
  accession_number: "0000000000-26-042500",
  filed_at: "2026-07-10T12:00:00.000Z",
  cik: "0001065088",
  ticker: "GME",
  company_name: "GameStop Corp.",
  related_names: ["GameStop Corp.", "eBay Inc."],
};

const matching = {
  raw_item_id: "raw-matching",
  event_id: "event-matching",
  accession_number: "0000000000-26-040000",
  form_type: "8-K",
  filed_at: "2026-06-30T12:00:00.000Z",
  cik: "1065088",
  ticker: "GME",
  company_name: "GameStop Corp.",
  event_type: "strategic_transaction",
  event_title: "GameStop announces proposal involving eBay",
  quick_take: "GameStop proposed an acquisition of eBay.",
  summary: "The proposed transaction concerns eBay Inc.",
  transaction_fingerprint: { acquirer: "GameStop", target: "eBay" },
};

const unrelated = {
  ...matching,
  raw_item_id: "raw-unrelated",
  event_id: "event-unrelated",
  accession_number: "0000000000-25-020000",
  filed_at: "2025-08-01T12:00:00.000Z",
  event_title: "GameStop completes an unrelated asset sale",
  quick_take: "The company sold a warehouse to Example Buyer.",
  summary: "This transaction concerns Example Buyer only.",
  transaction_fingerprint: { acquirer: "Example Buyer", target: "Warehouse Assets" },
};

const noSavedAnalysis = {
  ...matching,
  raw_item_id: "raw-no-analysis",
  event_id: null,
  accession_number: "0000000000-26-030000",
};

const plan = buildSec425TransactionContextMatchPlan(current, [unrelated, noSavedAnalysis, matching]);
assert.equal(plan.status, "found");
assert.equal(plan.selected[0]?.raw_item_id, "raw-matching");
assert.ok(plan.selected[0]?.match_reasons.includes("transaction_party_match"));
assert.equal(plan.selected.some((candidate) => candidate.raw_item_id === "raw-unrelated"), false);
assert.equal(plan.selected.some((candidate) => candidate.raw_item_id === "raw-no-analysis"), false);

const noMatch = buildSec425TransactionContextMatchPlan(current, [unrelated]);
assert.equal(noMatch.status, "not_found");
assert.deepEqual(noMatch.selected, []);

assert.equal(normalizeSec425TransactionContextForm("Form S-4 / A"), "S-4/A");
assert.equal(normalizeSec425TransactionContextForm("Schedule 13E-3"), "SC 13E3");

console.log("sec 425 transaction context fixtures passed");
