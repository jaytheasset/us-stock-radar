import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseProxyFiling, type ProxyDocumentClass } from "./parser.ts";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

const CLASSIFICATION_CASES: Array<{
  fixture: string;
  expectedClass: ProxyDocumentClass;
  administrativeOnly: boolean;
  aggregateAdministrativeOnly?: boolean;
  highRiskIncludes?: string[];
}> = [
  {
    fixture: "parser-phase1-defa14a-proxy-card-only",
    expectedClass: "proxy_card_only",
    administrativeOnly: true,
    aggregateAdministrativeOnly: true,
  },
  {
    fixture: "parser-phase1-defa14a-vote-reminder-only",
    expectedClass: "vote_reminder_only",
    administrativeOnly: true,
    aggregateAdministrativeOnly: true,
  },
  {
    fixture: "parser-phase1-defa14a-supplemental-proxy",
    expectedClass: "supplemental_proxy_material",
    administrativeOnly: false,
    highRiskIncludes: ["supplement", "amend", "update"],
  },
  {
    fixture: "parser-phase1-merger-proxy-language",
    expectedClass: "merger_proxy",
    administrativeOnly: false,
    highRiskIncludes: ["merger", "acquisition", "transaction", "fairness_opinion", "special_committee"],
  },
  {
    fixture: "parser-phase1-contested-proxy-language",
    expectedClass: "contested_solicitation",
    administrativeOnly: false,
    highRiskIncludes: ["dissident", "contest", "opposition", "universal_proxy"],
  },
  {
    fixture: "parser-phase1-shareholder-proposal-language",
    expectedClass: "shareholder_solicitation",
    administrativeOnly: false,
    highRiskIncludes: ["shareholder_proposal"],
  },
  {
    fixture: "parser-phase1-proxy-card-voting-options-high-risk",
    expectedClass: "proxy_card_only",
    administrativeOnly: false,
    highRiskIncludes: ["reverse_split"],
  },
];

for (const testCase of CLASSIFICATION_CASES) {
  const fixture = readFixture(testCase.fixture);
  const parsed = parseProxyFiling(fixture.input);
  const targetDocument = parsed.raw.documentInventory.find((document) => document.proxyClass === testCase.expectedClass);

  assert.ok(targetDocument, `${testCase.fixture}: expected document class ${testCase.expectedClass}`);
  assert.equal(
    targetDocument.administrativeOnlyCandidate,
    testCase.administrativeOnly,
    `${testCase.fixture}: administrative-only candidate mismatch`,
  );

  for (const signal of testCase.highRiskIncludes ?? []) {
    assert.ok(
      targetDocument.highRiskSignals.includes(signal),
      `${testCase.fixture}: missing high-risk signal ${signal}`,
    );
  }

  if (testCase.aggregateAdministrativeOnly !== undefined) {
    assert.equal(
      parsed.raw.administrativeOnlyCandidate,
      testCase.aggregateAdministrativeOnly,
      `${testCase.fixture}: filing-level administrative candidate mismatch`,
    );
  }
}

{
  const fixture = readFixture("parser-phase1-defa14a-proxy-card-only");
  const parsed = parseProxyFiling(fixture.input);
  assert.equal(parsed.raw.documentInventory.length, 2, "SEC DOCUMENT blocks should be preserved");
  assert.deepStrictEqual(
    parsed.raw.documentInventory.map((document) => ({
      sequence: document.sequence,
      type: document.type,
      filename: document.filename,
      isPrimary: document.isPrimary,
      isTextLike: document.isTextLike,
    })),
    [
      {
        sequence: "1",
        type: "DEFA14A",
        filename: "proxy-card.htm",
        isPrimary: true,
        isTextLike: true,
      },
      {
        sequence: "2",
        type: "GRAPHIC",
        filename: "logo.jpg",
        isPrimary: false,
        isTextLike: false,
      },
    ],
    "document inventory metadata should remain source-backed",
  );
}

{
  const fixture = readFixture("parser-phase1-proxy-card-voting-options-high-risk");
  const parsed = parseProxyFiling(fixture.input);
  assert.ok(parsed.facts.proposals.length > 0, "proxy card proposal heading should be detected");
  assert.ok(
    parsed.facts.proposals.every((proposal) => proposal.recommendation === null),
    "FOR / AGAINST / ABSTAIN rows alone must not become board recommendations",
  );
  assert.equal(parsed.raw.administrativeOnlyCandidate, false, "high-risk proxy card must not be filing-level administrative");
}

{
  const fixture = readFixture("parser-phase1-proposal-heading-detection");
  const parsed = parseProxyFiling(fixture.input);
  const titles = parsed.facts.proposals.map((proposal) => proposal.title);

  assert.ok(parsed.raw.documentInventory[0]?.proposalHeadingCount >= 9, "common proposal heading styles should be counted");
  assert.ok(titles.some((title) => /Election of Directors/i.test(title)), "Election of Directors heading missing");
  assert.ok(titles.some((title) => /Independent Registered Public Accounting Firm/i.test(title)), "auditor ratification heading missing");
  assert.ok(titles.some((title) => /Executive Compensation|Say-on-Pay/i.test(title)), "say-on-pay heading missing");
  assert.ok(titles.some((title) => /Equity Incentive Plan/i.test(title)), "equity plan heading missing");
  assert.ok(titles.some((title) => /Certificate of Incorporation/i.test(title)), "certificate amendment heading missing");
  assert.ok(titles.some((title) => /Reverse Stock Split/i.test(title)), "reverse split heading missing");
  assert.ok(titles.some((title) => /Increase in Authorized Shares/i.test(title)), "authorized share increase heading missing");
  assert.ok(titles.some((title) => /Merger Agreement/i.test(title)), "merger agreement heading missing");
  assert.ok(titles.some((title) => /Stockholder Proposal/i.test(title)), "stockholder proposal heading missing");
}

console.log("parser.phase1.test.ts: proxy parser phase 1 cases passed");

function readFixture(name: string) {
  return JSON.parse(fs.readFileSync(path.join(currentDir, "fixtures", `${name}.json`), "utf8"));
}
