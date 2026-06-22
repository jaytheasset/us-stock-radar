import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProxyFiling } from "./parser.ts";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const phase3Cases = JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", "parser-phase3-cases.json"), "utf8"));

{
  const parsed = parseCase("section-basic-annual-proxy");
  const kinds = parsed.raw.sectionSegmentation.sections.map((section) => section.kind);
  assert.ok(kinds.includes("notice_of_meeting"));
  assert.ok(kinds.includes("voting_information"));
  assert.equal(kinds.filter((kind) => kind === "proposal_section").length, 3);
  assert.ok(kinds.includes("board_governance"));
  assert.ok(kinds.includes("executive_compensation"));
  assert.ok(kinds.includes("audit_fees"));
  assert.ok(kinds.includes("beneficial_ownership"));
  assert.ok(kinds.includes("other_matters"));
  assert.ok(kinds.includes("proxy_card"));
  assert.equal(parsed.raw.proposalExtraction.dedupedCount, 3);
}

{
  const parsed = parseCase("toc-body-dedupe");
  assert.equal(parsed.raw.sectionSegmentation.tocHints.length, 2);
  assert.equal(parsed.raw.sectionSegmentation.sections.filter((section) => section.kind === "proposal_section").length, 2);
  assert.equal(parsed.facts.proposalCount, 2);
}

assertTable("director-nominee-table", "director_nominee_table", { proposalId: "1" });
assertTable("board-skills-matrix", "board_skills_matrix");
assertTable("committee-membership-table", "committee_membership_table");
assertTable("audit-fee-table", "audit_fee_table", { proposalId: "2" });

{
  const parsed = parseCase("summary-compensation-table");
  const table = assertTable("summary-compensation-table", "summary_compensation_table");
  assert.ok(table.warnings.some((warning) => /rowspan|colspan/i.test(warning)));
}

assertTable("pay-versus-performance-table", "pay_versus_performance");
assertTable("beneficial-ownership-table", "beneficial_ownership");
assertTable("equity-compensation-plan-table", "equity_compensation_plan_information");
assertTable("new-plan-benefits-table", "new_plan_benefits", { proposalId: "4" });

{
  const parsed = parseCase("layout-table-exclusion");
  assert.equal(parsed.raw.keyTableExtraction.tables.length, 0);
  assert.ok(parsed.raw.keyTableExtraction.ignoredLayoutTableCount >= 1);
}

{
  const parsed = parseCase("proxy-card-voting-table");
  assert.equal(parsed.raw.keyTableExtraction.tables.length, 0);
  assert.equal(parsed.raw.documentInventory[0]?.proxyClass, "proxy_card_only");
  assert.equal(parsed.raw.administrativeOnlyCandidate, true);
  assert.ok(parsed.facts.proposals.every((proposal) => proposal.recommendation === null));
}

{
  const parsed = parseCase("rowspan-colspan-table");
  const table = assertTable("rowspan-colspan-table", "summary_compensation_table");
  assert.ok(table.warnings.some((warning) => /rowspan|colspan/i.test(warning)));
}

{
  const table = assertTable("footnote-heavy-table", "beneficial_ownership");
  assert.ok(table.headers.some((header) => header === "Name"));
  assert.ok(table.headers.some((header) => header === "Shares"));
}

{
  const parsed = parseCase("image-heavy-document");
  assert.equal(parsed.raw.textCoverage.hasImageHeavyDocument, true);
  assert.ok(parsed.warnings.some((warning) => /image-heavy|low-text/i.test(warning)));
  assert.equal(parsed.raw.administrativeOnlyCandidate, false);
}

{
  const parsed = parseCase("damaged-critical-table");
  const table = assertTable("damaged-critical-table", "summary_compensation_table");
  assert.ok(table.warnings.some((warning) => /damaged|thin/i.test(warning)));
  assert.ok(parsed.warnings.some((warning) => /damaged|thin/i.test(warning)));
}

{
  const fixture = JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", "parser-phase2-shareholder-proposal-board-against.json"), "utf8"));
  const parsed = parseProxyFiling(fixture.input);
  const candidate = parsed.raw.proposalExtraction.candidates.find((item) => item.detailedCategory === "shareholder_proposal");
  assert.equal(candidate?.sponsor, "shareholder");
  assert.equal(candidate?.boardRecommendation, "AGAINST");
  assert.equal(candidate?.shareholderRecommendation, "FOR");
}

console.log("parser.phase3.test.ts: proxy parser phase 3 cases passed");

function parseCase(name: string) {
  return parseProxyFiling(phase3Cases[name].input);
}

function assertTable(name: string, tableType: string, options: { proposalId?: string } = {}) {
  const parsed = parseCase(name);
  const table = parsed.raw.keyTableExtraction.tables.find((item) => item.tableType === tableType);
  assert.ok(table, `${name}: expected ${tableType}`);
  assert.equal(table.isLayoutTable, false);
  assert.ok(table.rowCount >= 1, `${name}: row count missing`);
  assert.ok(table.columnCount >= 1, `${name}: column count missing`);
  if (options.proposalId) {
    assert.equal(table.proposalId, options.proposalId, `${name}: proposal link mismatch`);
  }
  return table;
}
