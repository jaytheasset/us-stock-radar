import assert from "node:assert/strict";
import { parseProxyFiling, type ProxyParserOutput } from "./parser.ts";

const SEC_HEADERS = {
  "User-Agent": "US-Stock-Radar proxy parser validation engineering@example.com",
  "Accept-Encoding": "gzip, deflate",
};

const TARGETS = [
  {
    caseName: "qncx-pre14a-2026",
    cik: "1662774",
    formType: "PRE 14A",
    accessionNumber: "0001193125-26-161838",
    primaryDocument: "qncx-20260417.htm",
    companyName: "Quince Therapeutics, Inc.",
    expected: {
      proxyType: "annual",
      meetingDate: "JUNE 11, 2026",
      recordDate: "April 23, 2026",
      maxProposalCount: 8,
      eventTypesInclude: ["listing_risk"],
      eventTypesExclude: ["leadership_governance"],
    },
  },
  {
    caseName: "xpof-defa14a-2024",
    cik: "1802156",
    formType: "DEFA14A",
    accessionNumber: "0001140361-24-026741",
    primaryDocument: "ny20029031x1_defa14a.htm",
    companyName: "Xponential Fitness, Inc.",
    expected: {
      proxyType: "annual",
      hasSupplement: true,
      withdrawnNomineeContains: "Geisler",
      maxProposalCount: 3,
      eventTypesInclude: ["leadership_governance"],
      eventTypesExclude: ["shareholder_vote"],
    },
  },
  {
    caseName: "trian-disney-defc14a-2024",
    cik: "1345471",
    formType: "DEFC14A",
    accessionNumber: "0000902664-24-000897",
    primaryDocument: "p24-0536defc14a.htm",
    companyName: "TRIAN FUND MANAGEMENT, L.P.",
    expected: {
      proxyType: "contested",
      hasContested: true,
      solicitationSource: "third_party",
      maxProposalCount: 12,
      eventTypesInclude: ["leadership_governance"],
    },
  },
  {
    caseName: "opal-defa14a-2026",
    cik: "1842279",
    formType: "DEFA14A",
    accessionNumber: "0001213900-26-047133",
    primaryDocument: "ea0287310-defa14a_opal.htm",
    companyName: "OPAL Fuels Inc.",
    expected: {
      proxyType: "notice_only",
      hasNoticeOnly: true,
      meetingDate: "JUNE 17, 2026",
      maxProposalCount: 2,
      eventTypesInclude: ["shareholder_vote"],
    },
  },
  {
    caseName: "opal-def14a-2026",
    cik: "1842279",
    formType: "DEF 14A",
    accessionNumber: "0001628280-26-026900",
    primaryDocument: "wdq-20260423.htm",
    companyName: "OPAL Fuels Inc.",
    expected: {
      proxyType: "annual",
      notNoticeOnly: true,
      meetingDate: "June 17, 2026",
      recordDate: "April 22, 2026",
      maxProposalCount: 8,
      eventTypesExclude: ["dilution_risk", "strategic_transaction", "leadership_governance"],
    },
  },
  {
    caseName: "innovid-prem14a-2024",
    cik: "1835378",
    formType: "PREM14A",
    accessionNumber: "0001140361-24-050156",
    primaryDocument: "ny20040318x1_prem14a.htm",
    companyName: "Innovid Corp.",
    expected: {
      proxyType: "special",
      hasTransaction: true,
      consideration: "$3.15 per share",
      premiumToLastClose: "94%",
      maxProposalCount: 8,
      eventTypesInclude: ["strategic_transaction"],
      eventTypesExclude: ["listing_risk", "insider_ownership", "leadership_governance"],
    },
  },
] as const;

for (const target of TARGETS) {
  const url = secArchiveUrl(target.cik, target.accessionNumber, target.primaryDocument);
  const html = await fetchSecText(url);
  const filingText = htmlToText(html);
  const parsed = parseProxyFiling({
    formType: target.formType,
    accessionNumber: target.accessionNumber,
    companyName: target.companyName,
    primaryTicker: { ticker: null, exchange: null },
    filingText,
  });

  assertSemanticExpectations(target.caseName, parsed, target.expected);
  assertSourceSupport(target.caseName, parsed, filingText);
  assertRawPayloadSupport(target.caseName, parsed, filingText);
}

console.log(`parser.real-sec.test.ts: ${TARGETS.length} live SEC source cases passed`);

function secArchiveUrl(cik: string, accessionNumber: string, primaryDocument: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNumber.replace(/-/g, "")}/${primaryDocument}`;
}

async function fetchSecText(url: string): Promise<string> {
  const response = await fetch(url, { headers: SEC_HEADERS });
  const text = await response.text();
  assert.equal(response.ok, true, `SEC fetch failed for ${url}: ${response.status} ${response.statusText}`);
  return text;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/tr>|<\/li>|<\/h\d>|<\/td>|<\/th>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&#8220;|&ldquo;/gi, "\"")
    .replace(/&#8221;|&rdquo;/gi, "\"")
    .replace(/&#8211;|&ndash;/gi, "-")
    .replace(/&#8212;|&mdash;/gi, "-")
    .replace(/&#8226;|&bull;/gi, "[bullet]")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function assertSemanticExpectations(
  caseName: string,
  parsed: ProxyParserOutput,
  expected: (typeof TARGETS)[number]["expected"],
): void {
  const eventTypes = parsed.signals.map((signal) => signal.eventType);

  assert.equal(parsed.facts.proxyType, expected.proxyType, `${caseName}: proxyType mismatch`);
  if ("notNoticeOnly" in expected && expected.notNoticeOnly) {
    assert.notEqual(parsed.facts.proxyType, "notice_only", `${caseName}: full proxy misread as notice_only`);
    assert.equal(parsed.facts.noticeOnly, undefined, `${caseName}: noticeOnly facts should not be present`);
  }
  if ("meetingDate" in expected) {
    assert.equal(normalize(parsed.facts.meetingDate), normalize(expected.meetingDate), `${caseName}: meetingDate mismatch`);
  }
  if ("recordDate" in expected) {
    assert.equal(normalize(parsed.facts.recordDate), normalize(expected.recordDate), `${caseName}: recordDate mismatch`);
  }
  if ("maxProposalCount" in expected) {
    assert.ok(
      parsed.facts.proposalCount <= expected.maxProposalCount,
      `${caseName}: proposal over-extraction (${parsed.facts.proposalCount})`,
    );
  }
  if ("hasSupplement" in expected && expected.hasSupplement) {
    assert.ok(parsed.facts.supplement, `${caseName}: supplement facts missing`);
  }
  if ("withdrawnNomineeContains" in expected) {
    assert.ok(
      parsed.facts.supplement?.withdrawnNominees.some((name) => name.includes(expected.withdrawnNomineeContains)),
      `${caseName}: withdrawn nominee missing`,
    );
  }
  if ("hasContested" in expected && expected.hasContested) {
    assert.ok(parsed.facts.contested, `${caseName}: contested facts missing`);
  }
  if ("solicitationSource" in expected) {
    assert.equal(parsed.facts.contested?.solicitationSource, expected.solicitationSource, `${caseName}: solicitation source mismatch`);
  }
  if ("hasNoticeOnly" in expected && expected.hasNoticeOnly) {
    assert.ok(parsed.facts.noticeOnly, `${caseName}: notice-only facts missing`);
  }
  if ("hasTransaction" in expected && expected.hasTransaction) {
    assert.equal(parsed.facts.transaction.hasTransactionVote, true, `${caseName}: transaction vote missing`);
  }
  if ("consideration" in expected) {
    assert.equal(parsed.facts.transaction.consideration, expected.consideration, `${caseName}: consideration mismatch`);
  }
  if ("premiumToLastClose" in expected) {
    assert.equal(parsed.facts.transaction.premiumToLastClose, expected.premiumToLastClose, `${caseName}: premium mismatch`);
  }
  for (const eventType of expected.eventTypesInclude ?? []) {
    assert.ok(eventTypes.includes(eventType), `${caseName}: missing event type ${eventType}`);
  }
  for (const eventType of expected.eventTypesExclude ?? []) {
    assert.ok(!eventTypes.includes(eventType), `${caseName}: unexpected event type ${eventType}`);
  }
}

function assertSourceSupport(caseName: string, parsed: ProxyParserOutput, filingText: string): void {
  const sourceValues = [
    parsed.facts.meetingDate,
    parsed.facts.recordDate,
    ...parsed.facts.proposals.map((proposal) => proposal.sourceText),
    parsed.facts.ownership.sourceText,
    parsed.facts.transaction.consideration,
    parsed.facts.transaction.voteRequired,
    parsed.facts.transaction.agreementDate,
    parsed.facts.transaction.premiumToLastClose,
    parsed.facts.supplement?.sourceText,
    parsed.facts.contested?.sourceText,
    parsed.facts.noticeOnly?.sourceText,
    parsed.facts.reverseSplit?.sourceText,
    ...parsed.signals.map((signal) => signal.evidence).filter((evidence) => !isSyntheticEvidence(evidence)),
  ].filter((value): value is string => Boolean(value));

  for (const value of sourceValues) {
    assert.ok(sourceContains(filingText, value), `${caseName}: parsed value missing from SEC source: ${value}`);
  }
}

function assertRawPayloadSupport(caseName: string, parsed: ProxyParserOutput, filingText: string): void {
  assert.ok(parsed.raw.primaryTextChars > 500, `${caseName}: raw primary text is unexpectedly short`);
  assert.ok(parsed.raw.combinedTextChars >= parsed.raw.primaryTextChars, `${caseName}: combined raw text shrank`);
  assert.ok(Array.isArray(parsed.raw.attachmentInventory), `${caseName}: attachment inventory missing`);
  assert.ok(Array.isArray(parsed.raw.importantBlocks), `${caseName}: important source blocks missing`);
  assert.ok(Array.isArray(parsed.raw.noiseBlocks), `${caseName}: noise blocks missing`);

  for (const proposal of parsed.facts.proposals) {
    assert.ok(
      parsed.raw.importantBlocks.some((block) => block.kind === "proposal" && block.label.includes(proposal.id)),
      `${caseName}: proposal ${proposal.id} missing from importantBlocks`,
    );
  }

  for (const block of parsed.raw.importantBlocks) {
    assert.ok(block.text.length > 0, `${caseName}: empty important block`);
    if (block.kind !== "preliminary_placeholder") {
      assert.ok(sourceContains(filingText, block.text), `${caseName}: important block should be source-backed: ${block.text}`);
    }
  }
}

function isSyntheticEvidence(value: string): boolean {
  return /^(Annual proxy contains only|Contested proxy solicitation facts|Notice of internet availability|Reverse stock split proposal references)/.test(value);
}

function sourceContains(text: string, value: string): boolean {
  return normalize(text).includes(normalize(value));
}

function normalize(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#8217;|&rsquo;/gi, "'")
    .replace(/&#8220;|&ldquo;/gi, "\"")
    .replace(/&#8221;|&rdquo;/gi, "\"")
    .replace(/&#8211;|&ndash;/gi, "-")
    .replace(/&#8212;|&mdash;/gi, "-")
    .replace(/&#8201;|&#8194;|&#8203;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
