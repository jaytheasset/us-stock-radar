import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProxyFiling } from "./parser.ts";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const phase4Cases = JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", "parser-phase4-cases.json"), "utf8"));

{
  const parsed = parseCase("defa14a-simple-proxy-card-only");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "proxy_card_only");
  assert.equal(parsed.raw.supplementalAnalysis.isSupplementalOrAmended, false);
  assert.equal(parsed.raw.supplementalAnalysis.materialType, "proxy_card_or_reminder");
  assert.equal(parsed.raw.administrativeOnlyCandidate, true);
}

{
  const parsed = parseCase("defa14a-vote-reminder-only");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "vote_reminder_only");
  assert.equal(parsed.raw.administrativeOnlyCandidate, true);
}

{
  const parsed = parseCase("defa14a-supplemental-proxy-statement");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "supplemental_proxy_material");
  assert.equal(parsed.raw.supplementalAnalysis.materialType, "supplemental_proxy_statement");
  assert.ok(parsed.raw.supplementalAnalysis.parentReferences.length >= 1);
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("supplement-parent-reference-unavailable");
  assert.ok(parsed.raw.supplementalAnalysis.parentReferences.length >= 1);
  assert.ok(parsed.raw.supplementalAnalysis.warnings.some((warning) => /parent proxy text was unavailable/i.test(warning)));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("supplement-meeting-date-location-change");
  assertSignal(parsed, "meeting_date_change");
  assertSignal(parsed, "meeting_location_change");
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("supplement-adding-proposal");
  assertSignal(parsed, "proposal_added");
  assert.ok(parsed.raw.proposalExtraction.candidates.some((candidate) => candidate.id === "4"));
  assert.equal(parsed.raw.proposalExtraction.countMismatch, true);
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("supplement-board-recommendation-change");
  assertSignal(parsed, "board_recommendation_changed");
  assert.ok(parsed.warnings.some((warning) => /board recommendation/i.test(warning)));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("supplement-shareholder-proposal-withdrawn");
  assertSignal(parsed, "shareholder_proposal_update");
  const candidate = parsed.raw.proposalExtraction.candidates.find((item) => item.detailedCategory === "shareholder_proposal");
  assert.equal(candidate?.sponsor, "shareholder");
  assert.equal(candidate?.boardRecommendation, "AGAINST");
  assert.equal(candidate?.shareholderRecommendation, "FOR");
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("merger-supplement-litigation-settlement");
  assert.equal(parsed.raw.supplementalAnalysis.materialType, "transaction_update");
  assertSignal(parsed, "litigation_update");
  assertSignal(parsed, "settlement_update");
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("merger-supplement-fairness-special-committee");
  assert.equal(parsed.raw.supplementalAnalysis.materialType, "transaction_update");
  assertSignal(parsed, "fairness_opinion_update");
  assertSignal(parsed, "special_committee_update");
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("equity-plan-supplement-share-reserve");
  assertSignal(parsed, "equity_plan_update");
  assert.ok(parsed.raw.keyTableExtraction.tables.some((table) => table.tableType === "new_plan_benefits"));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("reverse-split-supplement-ratio");
  assertSignal(parsed, "reverse_split_ratio_update");
  assert.ok(parsed.raw.proposalExtraction.candidates.some((candidate) => candidate.detailedCategory === "reverse_stock_split"));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("authorized-shares-supplement");
  assertSignal(parsed, "authorized_share_update");
  assert.ok(parsed.raw.proposalExtraction.candidates.some((candidate) => candidate.detailedCategory === "authorized_share_increase"));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("revised-proxy-form");
  assert.equal(parsed.raw.supplementalAnalysis.materialType, "revised_proxy_statement");
  assert.ok(parsed.raw.proposalExtraction.dedupedCount >= 2);
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("amendment-no-specific-change");
  assert.equal(parsed.raw.supplementalAnalysis.materialType, "amended_proxy_statement");
  assert.ok(parsed.raw.supplementalAnalysis.warnings.some((warning) => /specific changed term/i.test(warning)));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("parent-and-supplement-local-change");
  const reconciliation = parsed.raw.supplementalAnalysis.reconciliation;
  assert.equal(reconciliation.available, true);
  assert.ok(reconciliation.changedProposalIds.includes("3"));
  assert.ok(reconciliation.meetingMetadataConflicts.some((conflict) => /May 1, 2026 -> May 15, 2026/i.test(conflict)));
  assert.ok(reconciliation.recommendationConflicts.some((conflict) => /FOR -> AGAINST/i.test(conflict)));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("parent-and-supplement-no-meaningful-change");
  const reconciliation = parsed.raw.supplementalAnalysis.reconciliation;
  assert.equal(reconciliation.available, true);
  assert.equal(reconciliation.noSubstantiveChangeStatement, true);
  assert.equal(reconciliation.nearDuplicate, true);
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const phase2Fixture = JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", "parser-phase2-shareholder-proposal-board-against.json"), "utf8"));
  const phase2Parsed = parseProxyFiling(phase2Fixture.input);
  const shareholderCandidate = phase2Parsed.raw.proposalExtraction.candidates.find((item) => item.detailedCategory === "shareholder_proposal");
  assert.equal(shareholderCandidate?.sponsor, "shareholder");
  assert.equal(shareholderCandidate?.boardRecommendation, "AGAINST");

  const phase3Cases = JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", "parser-phase3-cases.json"), "utf8"));
  const phase3Parsed = parseProxyFiling(phase3Cases["summary-compensation-table"].input);
  assert.ok(phase3Parsed.raw.keyTableExtraction.tables.some((table) => table.tableType === "summary_compensation_table"));
}

console.log("parser.phase4.test.ts: proxy parser phase 4 cases passed");

function parseCase(name: string) {
  return parseProxyFiling(phase4Cases[name].input);
}

function assertSignal(parsed: ReturnType<typeof parseProxyFiling>, category: string) {
  assert.ok(
    parsed.raw.supplementalAnalysis.changeSignals.some((signal) => signal.category === category),
    `expected supplemental change signal ${category}`,
  );
}
