import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProxyFiling } from "./parser.ts";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const phase5Cases = JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", "parser-phase5-cases.json"), "utf8"));

{
  const parsed = parseCase("pure-proxy-card-routine-items");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "proxy_card_only");
  assert.equal(parsed.raw.administrativeOnlyCandidate, true);
  assert.equal(parsed.raw.supplementalAnalysis.isSupplementalOrAmended, false);
}

{
  const parsed = parseCase("proxy-card-reverse-split");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "proxy_card_only");
  assert.ok(parsed.raw.proposalExtraction.candidates.some((candidate) => candidate.detailedCategory === "reverse_stock_split"));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("proxy-card-equity-plan");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "proxy_card_only");
  assert.ok(parsed.raw.proposalExtraction.candidates.some((candidate) => candidate.detailedCategory === "equity_incentive_plan"));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("pure-vote-reminder");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "vote_reminder_only");
  assert.equal(parsed.raw.administrativeOnlyCandidate, true);
  assert.equal(parsed.raw.supplementalAnalysis.isSupplementalOrAmended, false);
}

{
  const parsed = parseCase("vote-reminder-with-supplement-update");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "supplemental_proxy_material");
  assertSignal(parsed, "proposal_added");
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("pure-notice-internet-availability");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "notice_only");
  assert.equal(parsed.raw.administrativeOnlyCandidate, true);
}

{
  const parsed = parseCase("notice-with-added-proposal");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "supplemental_proxy_material");
  assertSignal(parsed, "proposal_added");
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("toc-does-not-duplicate-body");
  assert.equal(parsed.raw.proposalExtraction.sourceCounts.toc, 2);
  assert.equal(parsed.raw.proposalExtraction.sourceCounts.body, 2);
  assert.equal(parsed.facts.proposalCount, 2);
}

{
  const parsed = parseCase("multiline-proposal-title");
  const candidate = parsed.raw.proposalExtraction.candidates.find((item) => item.id === "2");
  assert.ok(candidate, "multiline proposal candidate missing");
  assert.equal(candidate.title, "Approval of the 2026 Equity Incentive Plan");
  assert.equal(candidate.detailedCategory, "equity_incentive_plan");
  assert.equal(candidate.boardRecommendation, "FOR");
}

{
  const parsed = parseCase("board-for-all-proposals");
  assert.deepEqual(parsed.facts.proposals.map((proposal) => proposal.recommendation), ["FOR", "FOR"]);
}

{
  const parsed = parseCase("shareholder-recommendation-not-board");
  const candidate = parsed.raw.proposalExtraction.candidates.find((item) => item.detailedCategory === "shareholder_proposal");
  assert.equal(candidate?.shareholderRecommendation, "FOR");
  assert.equal(candidate?.boardRecommendation, null);
  assert.equal(parsed.facts.proposals[0]?.recommendation, null);
}

{
  const parsed = parseCase("board-against-shareholder-proposal");
  const candidate = parsed.raw.proposalExtraction.candidates.find((item) => item.detailedCategory === "shareholder_proposal");
  assert.equal(candidate?.shareholderRecommendation, "FOR");
  assert.equal(candidate?.boardRecommendation, "AGAINST");
  assert.equal(parsed.facts.proposals[0]?.recommendation, "AGAINST");
}

{
  const parsed = parseCase("supplement-parent-unavailable");
  assert.ok(parsed.raw.supplementalAnalysis.parentReferences.length >= 1);
  assert.ok(parsed.raw.supplementalAnalysis.warnings.some((warning) => /parent proxy text was unavailable/i.test(warning)));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("unclear-amendment-purpose");
  assert.equal(parsed.raw.supplementalAnalysis.materialType, "amended_proxy_statement");
  assert.ok(parsed.raw.supplementalAnalysis.warnings.some((warning) => /specific changed term/i.test(warning)));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("damaged-critical-table");
  const table = parsed.raw.keyTableExtraction.tables.find((item) => item.tableType === "summary_compensation_table");
  assert.ok(table, "damaged summary compensation table should be detected");
  assert.ok(table.warnings.some((warning) => /damaged|thin/i.test(warning)));
  assert.ok(parsed.warnings.some((warning) => /damaged|thin/i.test(warning)));
}

{
  const parsed = parseCase("image-heavy-substantive");
  assert.equal(parsed.raw.textCoverage.hasImageHeavyDocument, true);
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
  assert.ok(parsed.raw.proposalExtraction.candidates.some((candidate) => candidate.detailedCategory === "merger_acquisition"));
}

{
  const parsed = parseCase("empty-or-malformed-document");
  assert.equal(parsed.isSupported, true);
  assert.equal(parsed.facts.proposalCount, 0);
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
  assert.ok(parsed.warnings.some((warning) => /No proxy proposals/i.test(warning)));
}

{
  const parsed = parseCase("spac-ipo-listing");
  assert.equal(parsed.isSupported, true);
  assert.ok(parsed.raw.proposalExtraction.candidates.length >= 1);
}

{
  const parsed = parseCase("spac-business-combination-not-ipo");
  assert.equal(parsed.isSupported, true);
  assert.ok(parsed.signals.every((signal) => signal.eventType !== "ipo_listing"));
}

{
  const phase1Fixture = JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", "parser-phase1-defa14a-proxy-card-only.json"), "utf8"));
  assert.equal(parseProxyFiling(phase1Fixture.input).raw.administrativeOnlyCandidate, true);

  const phase2Fixture = JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", "parser-phase2-source-deduplication.json"), "utf8"));
  assert.equal(parseProxyFiling(phase2Fixture.input).facts.proposalCount, 3);

  const phase3Cases = JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", "parser-phase3-cases.json"), "utf8"));
  assert.ok(parseProxyFiling(phase3Cases["audit-fee-table"].input).raw.keyTableExtraction.tables.some((table) => table.tableType === "audit_fee_table"));

  const phase4Cases = JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", "parser-phase4-cases.json"), "utf8"));
  assert.equal(parseProxyFiling(phase4Cases["parent-and-supplement-local-change"].input).raw.supplementalAnalysis.reconciliation.available, true);
}

console.log("parser.phase5.test.ts: proxy parser phase 5 cases passed");

function parseCase(name: string) {
  return parseProxyFiling(phase5Cases[name].input);
}

function assertSignal(parsed: ReturnType<typeof parseProxyFiling>, category: string) {
  assert.ok(
    parsed.raw.supplementalAnalysis.changeSignals.some((signal) => signal.category === category),
    `expected supplemental change signal ${category}`,
  );
}
