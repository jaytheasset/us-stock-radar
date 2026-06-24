import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSecForm25Filing } from "./parser";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "form25");
const fixturesDir = join(roomDir, "fixtures");
const expectedDir = join(roomDir, "expected");

const cases = [
  "common-share-delisting",
  "merger-completion-removal",
  "matured-debt-removal",
  "voluntary-withdrawal-continued-listing",
  "ambiguous-units-requires-llm",
  "missing-reason-requires-llm",
  "rule-a2-warrant-retired-from-xml",
  "rule-a3-merger-not-listing-failure",
  "rule-a3-warrant-substitution-needs-analysis",
];

for (const name of cases) {
  const parsed = parseSecForm25Filing(readFixture(`${name}.json`));
  const expected = readExpected(`${name}.expected.json`);
  const expectedFacts = expected.parser_output.facts;

  assert.equal(parsed.parserVersion, expected.parser_output.parserVersion, name);
  assert.equal(parsed.parserGroup, "form25", name);
  assert.equal(parsed.formType, "Form 25 / 25-NSE", name);
  assert.equal(parsed.accessionNumber, expected.parser_output.accessionNumber, name);
  assert.equal(parsed.isSupported, true, name);
  assert.equal(parsed.facts.source_form_type, expectedFacts.source_form_type, name);
  assert.equal(parsed.facts.removed_security?.value, expectedFacts.removed_security, name);
  assert.equal(parsed.facts.security_category.value, expectedFacts.security_category, name);
  assert.equal(parsed.facts.removal_reason_category.value, expectedFacts.removal_reason_category, name);
  assert.equal(parsed.facts.common_equity_affected.value, expectedFacts.common_equity_affected, name);
  assert.equal(parsed.facts.filing_meaning.case, expectedFacts.deterministic_case, name);
  assert.equal(parsed.facts.routing.analysis_required, expectedFacts.analysis_required, name);
  assert.deepEqual(parsed.facts.routing.analysis_reasons, expectedFacts.analysis_reasons, name);
  assert.ok(parsed.facts.extracted_field_count > 0, name);
  assert.ok(parsed.raw.sourceInventory.documents.length > 0, name);
  assert.ok(parsed.raw.sourceInventory.source_text_char_count > 0, name);
  assert.ok(Array.isArray(parsed.raw.sourceInventory.truncation_notes), name);
  assert.ok(Array.isArray(parsed.raw.selectedEvidenceSnippets), name);
  assert.equal(Object.hasOwn(parsed.facts, "score"), false, "parser must not score");
  assert.equal(Object.hasOwn(parsed.facts, "delivery_level"), false, "parser must not decide delivery level");
}

const commonShare = parseSecForm25Filing(readFixture("common-share-delisting.json"));
assert.ok(commonShare.raw.sourceInventory.table_counts.total >= 1);
assert.ok(commonShare.raw.selectedTableSnippets.length >= 1);
assert.equal(commonShare.facts.routing.router_required, false);
assert.equal(commonShare.facts.routing.event_type, "listing_risk");
assert.equal(commonShare.facts.routing.display_type, "sec_form25_listing_removal");
assert.equal(commonShare.facts.routing.display_version, "sec_form25_listing_removal_v1");

const merger = parseSecForm25Filing(readFixture("merger-completion-removal.json"));
assert.equal(merger.facts.filing_meaning.deterministic, true);
assert.equal(merger.facts.routing.analysis_required, false);
assert.equal(merger.facts.routing.router_required, false);
assert.equal(merger.facts.routing.event_type, "strategic_transaction");
assert.equal(merger.facts.primary_ticker?.value, "HES");
assert.equal(merger.facts.successor_or_acquirer?.value, "Hess Corporation / Chevron Corporation");

const ruleA2Warrant = parseSecForm25Filing(readFixture("rule-a2-warrant-retired-from-xml.json"));
assert.equal(ruleA2Warrant.facts.removal_reason_category.value, "matured_redeemed_retired");
assert.equal(ruleA2Warrant.facts.filing_meaning.case, "matured_redeemed_retired_non_common");
assert.equal(ruleA2Warrant.facts.routing.analysis_required, true);
assert.equal(ruleA2Warrant.facts.routing.router_required, false);
assert.equal(ruleA2Warrant.facts.routing.event_type, "other");
assert.ok(ruleA2Warrant.facts.routing.analysis_reasons.includes("archive_required_ticker_missing"));

const ruleA3Merger = parseSecForm25Filing(readFixture("rule-a3-merger-not-listing-failure.json"));
assert.equal(ruleA3Merger.facts.removal_reason_category.value, "merger_completion");
assert.equal(ruleA3Merger.facts.routing.suggested_event_types.includes("strategic_transaction"), true);
assert.equal(ruleA3Merger.facts.routing.analysis_required, false);
assert.equal(ruleA3Merger.facts.routing.router_required, false);
assert.equal(ruleA3Merger.facts.routing.event_type, "strategic_transaction");
assert.equal(ruleA3Merger.warnings.includes("listing_standards_failure"), false);

const ruleA3Warrant = parseSecForm25Filing(readFixture("rule-a3-warrant-substitution-needs-analysis.json"));
assert.equal(ruleA3Warrant.facts.removal_reason_category.value, "unknown");
assert.equal(ruleA3Warrant.facts.routing.analysis_required, true);
assert.equal(ruleA3Warrant.warnings.includes("listing_standards_failure"), false);

const missingReason = parseSecForm25Filing(readFixture("missing-reason-requires-llm.json"));
assert.ok(missingReason.warnings.includes("missing_or_unclear_reason"));
assert.ok(missingReason.warnings.includes("common_equity_delisting_possible"));
assert.equal(missingReason.facts.routing.router_required, true);
assert.equal(missingReason.facts.routing.event_type, null);

const ambiguousUnits = parseSecForm25Filing(readFixture("ambiguous-units-requires-llm.json"));
assert.equal(ambiguousUnits.facts.routing.router_required, true);
assert.equal(ambiguousUnits.facts.routing.event_type, null);

console.log("sec form25 parser fixtures passed");

function readFixture(name: string) {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
}

function readExpected(name: string) {
  return JSON.parse(readFileSync(join(expectedDir, name), "utf8")) as {
    parser_output: {
      parserVersion: string;
      parserGroup: string;
      formType: string;
      accessionNumber: string | null;
      isSupported: boolean;
      summary: string | null;
      facts: {
        source_form_type: string;
        removed_security: string;
        security_category: string;
        removal_reason_category: string;
        common_equity_affected: boolean | null;
        deterministic_case: string | null;
        analysis_required: boolean;
        analysis_reasons: string[];
      };
    };
  };
}
