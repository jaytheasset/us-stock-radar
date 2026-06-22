import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProxyFiling } from "./parser.ts";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

{
  const parsed = parseFixture("parser-phase2-annual-three-routine-proposals");
  assert.equal(parsed.facts.proposalCount, 3, "annual routine proxy should dedupe to three proposals");
  assert.deepStrictEqual(
    parsed.facts.proposals.map((proposal) => proposal.category),
    ["director_election", "auditor_ratification", "compensation"],
  );
  assert.deepStrictEqual(
    parsed.facts.proposals.map((proposal) => proposal.recommendation),
    ["FOR", "FOR", "FOR"],
  );
  assert.ok(parsed.raw.proposalExtraction.candidates.some((candidate) => candidate.voteMechanicsText?.includes("Plurality voting")));
}

{
  const parsed = parseFixture("parser-phase2-source-deduplication");
  assert.equal(parsed.facts.proposalCount, 3, "notice/body/proxy card repeats should not become nine proposals");
  assert.equal(parsed.raw.proposalExtraction.sourceCounts.notice, 3);
  assert.equal(parsed.raw.proposalExtraction.sourceCounts.body, 3);
  assert.equal(parsed.raw.proposalExtraction.sourceCounts.proxy_card, 3);
  assert.equal(parsed.raw.proposalExtraction.countMismatch, false);
}

{
  const parsed = parseFixture("parser-phase2-shareholder-proposal-board-against");
  const candidate = parsed.raw.proposalExtraction.candidates.find((item) => item.detailedCategory === "shareholder_proposal");
  assert.ok(candidate, "shareholder proposal candidate missing");
  assert.equal(candidate.sponsor, "shareholder");
  assert.equal(candidate.boardRecommendation, "AGAINST");
  assert.equal(candidate.shareholderRecommendation, "FOR");
  assert.equal(parsed.facts.proposals[0]?.recommendation, "AGAINST");
}

{
  const parsed = parseFixture("parser-phase2-proxy-card-options-neutral");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "proxy_card_only");
  assert.equal(parsed.raw.administrativeOnlyCandidate, true);
  assert.ok(parsed.facts.proposals.every((proposal) => proposal.recommendation === null));
  assert.ok(parsed.raw.documentInventory[0]?.highRiskSignals.every((signal) => signal !== "proposal"));
}

{
  const parsed = parseFixture("parser-phase2-defa14a-ballot-items-only");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "proxy_card_only");
  assert.equal(parsed.raw.administrativeOnlyCandidate, true);
}

{
  const parsed = parseFixture("parser-phase2-reverse-split-card");
  const candidate = parsed.raw.proposalExtraction.candidates.find((item) => item.detailedCategory === "reverse_stock_split");
  assert.ok(candidate, "reverse split proposal should be detected");
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
  assert.ok(parsed.raw.documentInventory[0]?.highRiskSignals.includes("reverse_split"));
}

{
  const parsed = parseFixture("parser-phase2-supplemental-update");
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "supplemental_proxy_material");
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
  assert.ok(parsed.raw.documentInventory[0]?.highRiskSignals.includes("supplement"));
  assert.ok(parsed.raw.documentInventory[0]?.highRiskSignals.includes("update"));
}

{
  const parsed = parseFixture("parser-phase2-merger-proposal");
  const candidate = parsed.raw.proposalExtraction.candidates.find((item) => item.detailedCategory === "merger_acquisition");
  assert.ok(candidate, "merger proposal should be detected");
  assert.equal(candidate.boardRecommendation, "FOR");
  assert.ok(parsed.raw.documentInventory[0]?.highRiskSignals.includes("fairness_opinion"));
  assert.ok(parsed.raw.documentInventory[0]?.highRiskSignals.includes("special_committee"));
  assert.ok(candidate.voteMechanicsText?.includes("Vote required"));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseFixture("parser-phase2-equity-incentive-plan");
  const candidate = parsed.raw.proposalExtraction.candidates.find((item) => item.detailedCategory === "equity_incentive_plan");
  assert.ok(candidate, "equity incentive plan proposal should be detected");
  assert.equal(parsed.facts.dilution.hasEquityPlanVote, true);
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseFixture("parser-phase2-proposal-count-mismatch");
  assert.equal(parsed.raw.proposalExtraction.sourceCounts.notice, 3);
  assert.equal(parsed.raw.proposalExtraction.sourceCounts.proxy_card, 4);
  assert.equal(parsed.raw.proposalExtraction.countMismatch, true);
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
  assert.ok(parsed.warnings.some((warning) => /proposal counts differ/i.test(warning)));
}

{
  const parsed = parseFixture("parser-phase2-board-no-recommendation");
  const candidate = parsed.raw.proposalExtraction.candidates.find((item) => item.boardRecommendation === "NO_RECOMMENDATION");
  assert.ok(candidate, "no-recommendation state should be preserved");
  assert.equal(parsed.facts.proposals[0]?.recommendation, null);
}

{
  const parsed = parseFixture("parser-phase2-toc-body-dedup");
  assert.equal(parsed.raw.proposalExtraction.sourceCounts.toc, 3);
  assert.equal(parsed.raw.proposalExtraction.sourceCounts.body, 3);
  assert.equal(parsed.facts.proposalCount, 3, "TOC and body proposal headings should not duplicate final count");
  assert.ok(parsed.facts.proposals.every((proposal) => !/\s\d{1,3}$/.test(proposal.title)), "page numbers should not remain in titles");
}

console.log("parser.phase2.test.ts: proxy parser phase 2 cases passed");

function parseFixture(name: string) {
  const fixture = JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", `${name}.json`), "utf8"));
  return parseProxyFiling(fixture.input);
}
