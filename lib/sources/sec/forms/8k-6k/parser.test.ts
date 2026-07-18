import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSec8k6kFiling } from "./parser";
import {
  deriveSec8k6kDeliveryLevel,
  isSec8k6kApprovedEventType,
  SEC_8K_6K_FILING_CUE_TYPES,
  SEC_8K_6K_FORM_SCOPE,
  SEC_8K_6K_PARSER_GROUP,
  SEC_8K_6K_PARSER_VERSION,
  type Sec8k6kParseInput,
  type Sec8k6kRoomExpectedOutput,
} from "./types";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "8k-6k");
const fixturesDir = join(roomDir, "fixtures");
const expectedDir = join(roomDir, "expected");

const allFixtureNames = readdirSync(fixturesDir)
  .filter((name: string) => name.endsWith(".json"))
  .sort();
const expectedNames = readdirSync(expectedDir)
  .filter((name: string) => name.endsWith(".expected.json"))
  .sort();
const fixtureNames = allFixtureNames.filter((name) => existsSync(join(expectedDir, name.replace(/\.json$/, ".expected.json"))));

assert.equal(expectedNames.length, 15);
assert.equal(fixtureNames.length, expectedNames.length);
for (const policyFixtureName of [
  "complex-financing-8k.json",
  "exchange-delisting-8k.json",
  "material-vote-results-8k.json",
  "merger-closing-delisting-8k.json",
  "six-k-exhibit-99-1.json",
  "voluntary-delisting-8k.json",
]) {
  assert.ok(allFixtureNames.includes(policyFixtureName), policyFixtureName);
}

const expectedCueByFixture: Record<string, string> = {
  "capital-return-8k.json": "capital_return_authorization",
  "dilution-risk-8k.json": "securities_offering_or_issuance",
  "dividends-6k.json": "dividend_declaration",
  "earnings-8k.json": "financial_results",
  "fda-clinical-6k.json": "fda_or_clinical_update",
  "financial-risk-8k.json": "financial_distress_or_default",
  "insider-ownership-8k.json": "insider_or_control_update",
  "leadership-governance-8k.json": "leadership_or_governance_change",
  "legal-risk-8k.json": "legal_or_regulatory_proceeding",
  "listing-risk-8k.json": "exchange_listing_notice",
  "product-update-6k.json": "product_or_commercial_update",
  "routine-amendment-8ka.json": "routine_administrative_amendment",
  "sales-performance-8k.json": "sales_or_operating_update",
  "shareholder-vote-8k.json": "shareholder_vote_or_approval",
  "strategic-transaction-8k.json": "strategic_transaction_terms",
};

for (const fixtureName of fixtureNames) {
  const fixture = readJson<Sec8k6kParseInput & { expected: { eventType: string; deliveryLevel: string } }>(
    join(fixturesDir, fixtureName),
  );
  const expected = readJson<Sec8k6kRoomExpectedOutput>(join(expectedDir, fixtureName.replace(/\.json$/, ".expected.json")));
  const parsed = parseSec8k6kFiling(fixture);

  assert.equal(parsed.parserVersion, SEC_8K_6K_PARSER_VERSION, fixtureName);
  assert.equal(parsed.parserGroup, SEC_8K_6K_PARSER_GROUP, fixtureName);
  assert.equal(parsed.formType, SEC_8K_6K_FORM_SCOPE, fixtureName);
  assert.equal(parsed.isSupported, true, fixtureName);
  assert.equal(parsed.accessionNumber, expected.parser_output.accessionNumber, fixtureName);
  assert.ok(isSec8k6kApprovedEventType(expected.analysis_output.event_type), fixtureName);
  assert.equal(expected.analysis_output.event_type, fixture.expected.eventType, fixtureName);
  assert.equal(deriveSec8k6kDeliveryLevel(expected.analysis_output.score), expected.fixture_expected.expected_delivery_level, fixtureName);
  assert.equal(expected.fixture_expected.expected_delivery_level, fixture.expected.deliveryLevel, fixtureName);
  assert.ok(parsed.summary, fixtureName);
  assert.ok(parsed.signals.length >= 1, fixtureName);
  assert.ok(parsed.facts.filingCues.some((cue) => cue.cueType === expectedCueByFixture[fixtureName]), fixtureName);
  assertParserHasNoRoutingDecision(parsed, fixtureName);
  for (const cue of parsed.facts.filingCues) {
    assert.ok(SEC_8K_6K_FILING_CUE_TYPES.includes(cue.cueType), fixtureName);
    assert.ok(cue.evidence, fixtureName);
  }
}

const dilution = parseSec8k6kFiling(readFixture("dilution-risk-8k.json"));
assert.ok(dilution.facts.marketContext.fields.includes("market_cap"));
assert.ok(dilution.facts.marketContext.fields.includes("public_float"));
assert.ok(dilution.facts.moneyAmounts.some((amount) => amount.value.amount === 25_000_000));
assert.ok(dilution.facts.shareCounts.some((count) => count.value === 12_500_000));

const amendment = parseSec8k6kFiling(readFixture("routine-amendment-8ka.json"));
assert.equal(amendment.facts.isAmendment, true);
assert.equal(amendment.facts.amendment.amendmentNumber, 1);
assert.equal(amendment.facts.amendment.parentAccessionNumber, "0015151515-26-000001");
assert.equal(amendment.facts.amendment.parentFiledDate, "May 1, 2026");
assert.equal(amendment.facts.amendment.isRoutineAdministrativeOnly, true);
assert.ok(amendment.facts.filingCues.some((cue) => cue.cueType === "routine_administrative_amendment"));
assertParserHasNoRoutingDecision(amendment, "routine-amendment-8ka.json");

const archiveLinkedAmendment = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000002",
  title: "Example issuer Form 8-K/A",
  publishedAt: "2026-06-08T16:00:00Z",
  bodyText: [
    "FORM 8-K/A",
    "Explanatory Note",
    "This Amendment amends the Current Report on Form 8-K filed on 2026-06-01.",
    "The original report is available at https://www.sec.gov/Archives/edgar/data/1234567/000123456726000001/original.htm.",
    "SEC File No. 001-99999.",
  ].join("\n"),
  rawPayload: { accession_number: "0000000000-26-000002", form_type: "8-K/A" },
});
assert.equal(archiveLinkedAmendment.facts.amendment.parentAccessionNumber, "0001234567-26-000001");
assert.equal(archiveLinkedAmendment.facts.amendment.parentFiledDate, "2026-06-01");

const explicitlyDatedCurrentReportAmendment = parseSec8k6kFiling({
  sourceUniqueId: "0001193125-26-134682",
  title: "Infleqtion, Inc. Form 8-K/A",
  publishedAt: "2026-04-01T16:00:00Z",
  bodyText: [
    "FORM 8-K/A",
    "Explanatory Note",
    "This Amendment No. 1 amends the Current Report on Form 8-K filed with the Securities and Exchange Commission on March 26, 2026.",
    "The disclosure concerns the dismissal and engagement of independent registered public accounting firms.",
  ].join("\n"),
  rawPayload: { accession_number: "0001193125-26-134682", form_type: "8-K/A", cik: "0002007825" },
});
assert.equal(explicitlyDatedCurrentReportAmendment.facts.referencedFilings.length, 1);
assert.equal(explicitlyDatedCurrentReportAmendment.facts.referencedFilings[0]?.formType, "8-K");
assert.equal(explicitlyDatedCurrentReportAmendment.facts.referencedFilings[0]?.filedDate, "2026-03-26");
assert.equal(explicitlyDatedCurrentReportAmendment.facts.referencedFilings[0]?.confidence, "high");
assert.match(explicitlyDatedCurrentReportAmendment.facts.referencedFilings[0]?.evidence || "", /March 26, 2026/);

const dividend = parseSec8k6kFiling(readFixture("dividends-6k.json"));
assert.deepEqual(
  dividend.calendarItems.map((item) => item.label),
  ["record_date", "payment_date"],
);

const fda = parseSec8k6kFiling(readFixture("fda-clinical-6k.json"));
assert.ok(fda.calendarItems.some((item) => item.label === "pdufa_date"));

const explicitProxyReference = parseSec8k6kFiling({
  sourceUniqueId: "0001829635-25-016947",
  title: "TransCode Therapeutics Form 8-K vote results",
  publishedAt: "2025-02-25T16:00:00Z",
  bodyText: [
    "FORM 8-K",
    "Item 5.07 Submission of Matters to a Vote of Security Holders.",
    "The Company voted upon the proposals set forth in the definitive proxy statement on Schedule 14A filed by the Company with the Securities and Exchange Commission on December 30, 2024.",
    "Stockholders approved the full issuance of shares upon exercise of the Series C Warrants and Series D Warrants.",
  ].join("\n"),
  rawPayload: { accession_number: "0001829635-25-016947", form_type: "8-K", cik: "0001829635" },
});
assert.deepEqual(explicitProxyReference.facts.referencedFilings, [
  {
    formType: "DEF 14A",
    filedDate: "2024-12-30",
    accessionNumber: null,
    itemNumber: "5.07",
    evidence:
      "The Company voted upon the proposals set forth in the definitive proxy statement on Schedule 14A filed by the Company with the Securities and Exchange Commission on December 30, 2024.",
    confidence: "high",
  },
]);

const introductoryNote = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000002",
  title: "8-K - Merger Closing",
  bodyText: [
    "FORM 8-K",
    "Introductory Note",
    "The purchaser offered $57.00 per share in cash.",
    "A total of 46,731,511 shares, representing 92.8% of outstanding shares, were tendered.",
    "The merger closed and the company became a wholly owned subsidiary of the parent.",
    "Item 2.01 Completion of Acquisition or Disposition of Assets.",
    "The information in the Introductory Note is incorporated by reference.",
    "Item 3.01 Notice of Delisting or Failure to Satisfy a Continued Listing Rule or Standard.",
    "The company requested suspension of trading after the completed merger.",
    "SIGNATURES",
  ].join("\n"),
  rawPayload: { accession_number: "0000000000-26-000002", form_type: "8-K" },
});
assert.equal(introductoryNote.facts.unnumberedSections?.length, 1);
assert.equal(introductoryNote.facts.unnumberedSections?.[0]?.heading, "Introductory Note");
assert.match(introductoryNote.facts.unnumberedSections?.[0]?.evidence || "", /\$57\.00 per share/);
assert.match(introductoryNote.facts.unnumberedSections?.[0]?.evidence || "", /92\.8%/);

const noisyPackage = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000001",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000026000001/test.txt",
  title: "8-K - Results",
  publishedAt: "2026-05-23",
  bodyText: [
    "Date of Report (Date of earliest event reported): May 23, 2026",
    "Item 2.02 Results of Operations and Financial Condition.",
    "The issuer furnished a press release with selected financial results including revenue of $10 million.",
    "EXHIBIT INDEX",
    "99.1 Press Release",
    "Forward-looking statements are made under the safe harbor provisions of the Private Securities Litigation Reform Act.",
    "About TestCo",
    "Investor Relations Contact: ir@example.com",
    "SIGNATURES",
    "By: /s/ Jane Doe",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000001",
    form_type: "8-K",
    index_items: ["2.02"],
    documents: [
      {
        type: "8-K",
        description: "Primary filing",
        isPrimary: true,
        includedInParserText: true,
        textCharCount: 1200,
        textTruncated: false,
      },
      {
        type: "EX-99.1",
        description: "Press Release",
        filename: "ex991.htm",
        importantForParsing: true,
        includedInParserText: true,
        includedTextCharCount: 900,
        selectionPriority: 130,
        selectionReason: "exhibit_99_material_text",
        textCharCount: 900,
        textExtractionStatus: "text_extracted",
      },
      {
        type: "EX-101.INS",
        description: "XBRL Instance Document",
        filename: "xbrl.xml",
        textCharCount: 5000,
        textExtractionStatus: "not_extracted_support_file",
      },
      {
        type: "GRAPHIC",
        description: "Logo image",
        filename: "logo.jpg",
        textCharCount: 0,
        textExtractionStatus: "not_extracted_binary_or_graphic",
      },
    ],
    attachment_texts: [
      {
        type: "EX-99.1",
        description: "Press Release",
        text: "TestCo reported revenue of $10 million and net income of $1 million.",
      },
    ],
  },
});
const noisyExtracted = noisyPackage.facts.extracted as Record<string, unknown>;
const noiseCandidates = noisyExtracted.noiseCandidates as Array<Record<string, unknown>>;
assert.ok(noiseCandidates.some((candidate) => candidate.kind === "exhibit_index"));
assert.ok(noiseCandidates.some((candidate) => candidate.kind === "signature_block"));
assert.ok(noiseCandidates.some((candidate) => candidate.kind === "forward_looking_safe_harbor"));
assert.ok(noiseCandidates.some((candidate) => candidate.kind === "machine_readable_support_documents"));
const noisyCoverage = noisyExtracted.documentCoverage as Record<string, unknown>;
assert.ok(noisyCoverage.roleProfile);
assert.ok(noisyCoverage.selectionAudit);

const earningsExhibit = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000101",
  title: "TestCo files 8-K",
  bodyText: [
    "Item 2.02 Results of Operations and Financial Condition",
    "On May 23, 2026, TestCo furnished a press release announcing financial results.",
    "Item 9.01 Financial Statements and Exhibits",
    "(d) Exhibits.",
    "Exhibit No. Description",
    "99.1 Earnings Release",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000101",
    form_type: "8-K",
    documents: [
      { type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 900, textExtractionStatus: "text_extracted" },
      { type: "EX-99.1", description: "Earnings Release", filename: "ex991.htm", importantForParsing: true, textCharCount: 1200, includedInParserText: true, includedTextCharCount: 1200, textExtractionStatus: "text_extracted" },
    ],
    attachment_texts: [
      { type: "EX-99.1", description: "Earnings Release", text: "TestCo reported revenue of $10 million and net income of $1 million." },
    ],
  },
});
assert.deepEqual(earningsExhibit.facts.items.map((item) => item.item), ["2.02", "9.01"]);
assert.ok(exhibitHints(earningsExhibit).some((hint) => hint.item === "2.02" && hint.exhibitNumber === "99.1"));
assert.ok(earningsExhibit.facts.filingCues.some((cue) => cue.cueType === "financial_results"));
assertParserHasNoRoutingDecision(earningsExhibit, "8-K Item 2.02 exhibit mapping");

const earningsExhibitGenericMetadata = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000101-generic",
  title: "MetadataLiteCo files 8-K",
  bodyText: [
    "Item 2.02 Results of Operations and Financial Condition",
    "MetadataLiteCo furnished the materials attached as Exhibit 99.1.",
    "Item 9.01 Financial Statements and Exhibits",
    "(d) Exhibits.",
    "99.1 Exhibit",
    "101 Inline XBRL Document Set",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000101-generic",
    form_type: "8-K",
    documents: [
      { type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 900, textExtractionStatus: "text_extracted" },
      { type: "EX-99.1", description: "Exhibit", filename: "q1fy27pr.htm", importantForParsing: true, textCharCount: 1200, includedInParserText: true, includedTextCharCount: 1200, textExtractionStatus: "text_extracted" },
    ],
    attachment_texts: [
      {
        type: "EX-99.1",
        description: "Exhibit",
        text: "Revenue increased to $10 million. Net income was $1 million. These financial results are for the quarter ended March 31, 2026.",
      },
    ],
  },
});
assert.ok(exhibitHints(earningsExhibitGenericMetadata).some((hint) => hint.item === "2.02" && hint.exhibitNumber === "99.1"));
assert.equal(referencedExhibits(earningsExhibitGenericMetadata).some((reference) => reference.exhibitNumber === "101"), false);
assert.equal(earningsExhibitGenericMetadata.warnings.includes("exhibit_reference_document_match_failed"), false);

const agreementExhibit = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000102",
  title: "AgreementCo files 8-K",
  bodyText: [
    "Item 1.01 Entry into a Material Definitive Agreement",
    "On May 23, 2026, AgreementCo entered into a loan agreement.",
    "The agreement is filed as Exhibit 10.",
    "Item 9.01 Financial Statements and Exhibits",
    "10.1 Loan Agreement, dated May 23, 2026",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000102",
    form_type: "8-K",
    documents: [
      { type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 850, textExtractionStatus: "text_extracted" },
      { type: "EX-10.1", description: "Loan Agreement", filename: "ex101.htm", importantForParsing: true, textCharCount: 2400, includedInParserText: true, includedTextCharCount: 2400, textExtractionStatus: "text_extracted" },
    ],
    attachment_texts: [
      { type: "EX-10.1", description: "Loan Agreement", text: "Loan Agreement by and among AgreementCo and the lenders." },
    ],
  },
});
assert.deepEqual(agreementExhibit.facts.items.map((item) => item.item), ["1.01", "9.01"]);
assert.ok(exhibitHints(agreementExhibit).some((hint) => hint.item === "1.01" && hint.exhibitNumber === "10.1"));
assert.equal(agreementExhibit.warnings.includes("exhibit_reference_document_match_failed"), false);

const exhibitIndexNoFalseItem = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000103",
  title: "IndexOnlyCo files 8-K",
  bodyText: [
    "Item 9.01 Financial Statements and Exhibits",
    "EXHIBIT INDEX",
    "Item 2.02 Results of Operations and Financial Condition - cross-reference only",
    "99.1 Press Release",
    "SIGNATURES",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000103",
    form_type: "8-K",
    documents: [
      { type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 500, textExtractionStatus: "text_extracted" },
      { type: "EX-99.1", description: "Press Release", filename: "ex991.htm", textCharCount: 700, includedInParserText: true, includedTextCharCount: 700, textExtractionStatus: "text_extracted" },
    ],
  },
});
assert.deepEqual(exhibitIndexNoFalseItem.facts.items.map((item) => item.item), ["9.01"]);
assert.equal(referencedExhibits(exhibitIndexNoFalseItem).some((reference) => reference.exhibitNumber === "9.01"), false);

const midBodyReference = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000104",
  title: "ReferenceCo files 8-K",
  bodyText: [
    "Item 8.01 Other Events",
    "The information under Item 2.02 is incorporated by reference in this Item 8.01.",
    "Item 2.02 is incorporated by reference and is not a new section heading here.",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000104",
    form_type: "8-K",
    documents: [
      { type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 600, textExtractionStatus: "text_extracted" },
    ],
  },
});
assert.deepEqual(midBodyReference.facts.items.map((item) => item.item), ["8.01"]);

const sixKPressRelease = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000201",
  title: "ForeignCo files 6-K",
  bodyText: "Report of Foreign Private Issuer. ForeignCo furnishes herewith as Exhibit 99.1 a press release.",
  rawPayload: {
    accession_number: "0000000000-26-000201",
    form_type: "6-K",
    documents: [
      { type: "6-K", description: "Primary filing", isPrimary: true, textCharCount: 260, textExtractionStatus: "text_extracted" },
      { type: "EX-99.1", description: "Press Release", filename: "ex991.htm", textCharCount: 1400, includedInParserText: true, includedTextCharCount: 1400, textExtractionStatus: "text_extracted" },
    ],
    attachment_texts: [
      { type: "EX-99.1", description: "Press Release", text: "ForeignCo announced a corporate update in a press release." },
    ],
  },
});
assert.deepEqual(sixKPressRelease.facts.items, []);
assert.equal(formProfile(sixKPressRelease).primaryIsWrapper, true);
assert.ok(sixKExhibits(sixKPressRelease).some((exhibit) => roleCandidates(exhibit).includes("press_release")));

const sixKFinancialResults = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000202",
  title: "ForeignResultsCo files 6-K",
  bodyText: "Report of Foreign Private Issuer. The attached Exhibit 99.1 is furnished herewith.",
  rawPayload: {
    accession_number: "0000000000-26-000202",
    form_type: "6-K",
    documents: [
      { type: "6-K", description: "Primary filing", isPrimary: true, textCharCount: 240, textExtractionStatus: "text_extracted" },
      { type: "EX-99.1", description: "Financial Results", filename: "ex991.htm", textCharCount: 1800, includedInParserText: true, includedTextCharCount: 1800, textExtractionStatus: "text_extracted" },
    ],
    attachment_texts: [
      { type: "EX-99.1", description: "Financial Results", text: "Three months ended March 31, 2026 revenue was $50 million and net income was $5 million. EPS was $0.10." },
    ],
  },
});
assert.ok(sixKExhibits(sixKFinancialResults).some((exhibit) => roleCandidates(exhibit).includes("financial_results")));
assert.ok(sixKFinancialResults.facts.filingCues.some((cue) => cue.cueType === "financial_results"));

const sixKMultipleExhibits = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000203",
  title: "ForeignMultiCo files 6-K",
  bodyText: "Report of Foreign Private Issuer. Materials are attached hereto as Exhibit 99.1 and Exhibit 99.2.",
  rawPayload: {
    accession_number: "0000000000-26-000203",
    form_type: "6-K",
    documents: [
      { type: "6-K", description: "Primary filing", isPrimary: true, textCharCount: 300, textExtractionStatus: "text_extracted" },
      { type: "EX-99.1", description: "Press Release", filename: "ex991.htm", textCharCount: 900, includedInParserText: true, includedTextCharCount: 900, textExtractionStatus: "text_extracted" },
      { type: "EX-99.2", description: "Investor Presentation", filename: "ex992.htm", textCharCount: 2000, includedInParserText: true, includedTextCharCount: 2000, textExtractionStatus: "text_extracted" },
    ],
    attachment_texts: [
      { type: "EX-99.1", description: "Press Release", text: "ForeignMultiCo issued a press release." },
      { type: "EX-99.2", description: "Investor Presentation", text: "Investor presentation slides with company overview." },
    ],
  },
});
assert.equal(sixKExhibits(sixKMultipleExhibits).length, 2);
assert.ok(sixKExhibits(sixKMultipleExhibits).some((exhibit) => roleCandidates(exhibit).includes("investor_presentation")));

const sixKExhibitLabelBeforeHeadline = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000203-headline",
  title: "ForeignOperationsCo files 6-K",
  bodyText: "Report of Foreign Private Issuer. Materials are attached hereto as Exhibit 99.2.",
  rawPayload: {
    accession_number: "0000000000-26-000203-headline",
    form_type: "6-K",
    documents: [
      { type: "6-K", description: "Primary filing", isPrimary: true, textCharCount: 240, textExtractionStatus: "text_extracted" },
      { type: "EX-99.2", description: "EXHIBIT 99.2", filename: "ex992.htm", textCharCount: 1800, includedInParserText: true, includedTextCharCount: 1800, textExtractionStatus: "text_extracted" },
    ],
    attachment_texts: [
      {
        type: "EX-99.2",
        description: "EXHIBIT 99.2",
        text: [
          "EXHIBIT 99.2",
          "Lithium Producer Reports 2024 Production Results and 2025 Guidance",
          "Production reached 25,400 tonnes and 2025 guidance is 30,000 to 35,000 tonnes.",
        ].join("\n"),
      },
    ],
  },
});
const labeledExhibit = sixKExhibits(sixKExhibitLabelBeforeHeadline).find((exhibit) => exhibit.exhibitNumber === "99.2");
assert.equal(labeledExhibit?.headline, "Lithium Producer Reports 2024 Production Results and 2025 Guidance");

const sixKMissingReferencedExhibit = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000204",
  title: "ForeignMissingCo files 6-K",
  bodyText: "Report of Foreign Private Issuer. The company furnished herewith as Exhibit 99.1 a press release.",
  rawPayload: {
    accession_number: "0000000000-26-000204",
    form_type: "6-K",
    documents: [
      { type: "6-K", description: "Primary filing", isPrimary: true, textCharCount: 280, textExtractionStatus: "text_extracted" },
    ],
  },
});
assert.ok(sixKMissingReferencedExhibit.warnings.includes("exhibit_reference_document_match_failed"));
assert.ok(sixKMissingReferencedExhibit.warnings.includes("six_k_wrapper_without_meaningful_exhibit"));

const sixKBinaryExhibit = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000205",
  title: "ForeignBinaryCo files 6-K",
  bodyText: "Report of Foreign Private Issuer. The investor presentation is furnished herewith as Exhibit 99.1.",
  rawPayload: {
    accession_number: "0000000000-26-000205",
    form_type: "6-K",
    documents: [
      { type: "6-K", description: "Primary filing", isPrimary: true, textCharCount: 260, textExtractionStatus: "text_extracted" },
      { type: "EX-99.1", description: "Investor Presentation PDF", filename: "ex991.pdf", textCharCount: 0, textExtractionStatus: "not_extracted_binary_or_graphic" },
    ],
  },
});
assert.ok(sixKBinaryExhibit.warnings.includes("six_k_meaningful_exhibit_non_text"));
assert.ok(sixKBinaryExhibit.warnings.includes("possible_material_binary_or_pdf_exhibit_without_text"));

const normalizedFormVariants = [
  parseSec8k6kFiling({
    sourceUniqueId: "0000000000-26-000301",
    title: "VariantCo files 8-K/A",
    bodyText: "Item 2.02. Results of Operations and Financial Condition\nVariantCo reported revenue of $1 million.",
    rawPayload: {
      accession_number: "0000000000-26-000301",
      form_type: " 8-k/a ",
      documents: [{ type: " 8-k/a ", description: "Primary filing", isPrimary: true, textCharCount: 500 }],
    },
  }),
  parseSec8k6kFiling({
    sourceUniqueId: "0000000000-26-000302",
    title: "VariantForeignCo files 6-K/A",
    bodyText: "Report of Foreign Private Issuer. VariantForeignCo announced financial results with revenue of $1 million.",
    rawPayload: {
      accession_number: "0000000000-26-000302",
      form_type: " 6-k/a ",
      documents: [{ type: " 6-k/a ", description: "Primary filing", isPrimary: true, textCharCount: 500 }],
    },
  }),
];
assert.equal(normalizedFormVariants[0].facts.secFormType, "8-K/A");
assert.equal(formProfile(normalizedFormVariants[0]).parserPath, "8k_item_sections");
assert.equal(normalizedFormVariants[1].facts.secFormType, "6-K/A");
assert.equal(formProfile(normalizedFormVariants[1]).parserPath, "6k_wrapper_exhibits");

const itemReferenceEdges = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000303",
  title: "ReferenceEdgesCo files 8-K",
  bodyText: [
    "Item 8.01 Other Events",
    "Pursuant to Item 2.02 of Form 8-K, the company provided this update.",
    "(Item 2.02)",
    "SIGNATURES",
    "Item 5.02 Departure of Directors or Certain Officers",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000303",
    form_type: "8-K",
    documents: [{ type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 700 }],
  },
});
assert.deepEqual(itemReferenceEdges.facts.items.map((item) => item.item), ["8.01"]);

const validItemHeadingVariants = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000304",
  title: "HeadingVariantCo files 8-K",
  bodyText: [
    "Item\u00a02.02.\u00a0Results of Operations and Financial Condition",
    "HeadingVariantCo reported revenue of $2 million.",
    "ITEM 5.02",
    "Departure of Directors or Certain Officers",
    "The company appointed a new chief financial officer.",
    "Item",
    "9.01 Financial Statements and Exhibits",
    "99.1 Press Release",
    "| ITEM 8.01 |",
    "| Other Events. |",
    "The company announced a business update.",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000304",
    form_type: "8-K",
    documents: [{ type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 900 }],
  },
});
assert.deepEqual(validItemHeadingVariants.facts.items.map((item) => item.item), ["2.02", "5.02", "9.01", "8.01"]);

const tableOfContentsItems = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000305",
  title: "TocCo files 8-K",
  bodyText: [
    "TABLE OF CONTENTS",
    "Item 2.02 Results of Operations and Financial Condition",
    "Item 9.01 Financial Statements and Exhibits",
    "",
    "Item 2.02 Results of Operations and Financial Condition",
    "TocCo reported revenue of $3 million.",
    "Item 9.01 Financial Statements and Exhibits",
    "99.1 Press Release",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000305",
    form_type: "8-K",
    documents: [{ type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 1000 }],
  },
});
assert.deepEqual(tableOfContentsItems.facts.items.map((item) => item.item), ["2.02", "9.01"]);

const exhibitNormalization = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000306",
  title: "NormalizeExhibitCo files 8-K",
  bodyText: [
    "Item 2.02 Results of Operations and Financial Condition",
    "The earnings release is attached as Exhibit 99.1.",
    "Item 9.01 Financial Statements and Exhibits",
    "Exhibit 99.1 Earnings Release",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000306",
    form_type: "8-K",
    documents: [
      { type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 900 },
      { type: "EX99.1", description: "Earnings Release", filename: "ex991.htm", textCharCount: 1000, includedInParserText: true, includedTextCharCount: 1000, textExtractionStatus: "text_extracted" },
      { type: "EX-10.1", description: "Agreement", filename: "ex10-1.htm", textCharCount: 1000 },
      { type: "EX-2.1", description: "Transaction Agreement", filename: "ex_2_1.htm", textCharCount: 1000 },
      { type: "EX-16", description: "Accountant Letter", filename: "ex16.htm", textCharCount: 1000 },
      { type: "HTML", description: "Filename-only exhibit", filename: "ex99-1.htm", textCharCount: 1000 },
      { type: "HTML", description: "Filename-only underscore exhibit", filename: "ex_99_1.htm", textCharCount: 1000 },
    ],
  },
});
assert.ok(documentExhibits(exhibitNormalization).some((document) => document.exhibitNumber === "99.1" && document.filename === "ex991.htm"));
assert.ok(documentExhibits(exhibitNormalization).some((document) => document.exhibitNumber === "99.1" && document.filename === "ex99-1.htm"));
assert.ok(documentExhibits(exhibitNormalization).some((document) => document.exhibitNumber === "99.1" && document.filename === "ex_99_1.htm"));
assert.ok(documentExhibits(exhibitNormalization).some((document) => document.exhibitNumber === "10.1" && document.filename === "ex10-1.htm"));
assert.ok(documentExhibits(exhibitNormalization).some((document) => document.exhibitNumber === "2.1" && document.filename === "ex_2_1.htm"));
assert.ok(documentExhibits(exhibitNormalization).some((document) => document.exhibitNumber === "16" && document.filename === "ex16.htm"));
assert.ok(referencedExhibits(exhibitNormalization).some((reference) => reference.exhibitNumber === "99.1" && reference.matchedDocument));

const sixKPrimaryOnlyMeaningful = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000307",
  title: "ForeignPrimaryCo files 6-K",
  bodyText: [
    "Report of Foreign Private Issuer",
    "ForeignPrimaryCo announced financial results for the quarter.",
    "Revenue was $20 million and net income was $2 million.",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000307",
    form_type: "6-K",
    documents: [{ type: "6-K", description: "Primary filing", isPrimary: true, textCharCount: 700, textExtractionStatus: "text_extracted" }],
  },
});
assert.equal(formProfile(sixKPrimaryOnlyMeaningful).primaryHasMeaningfulContent, true);
assert.equal(formProfile(sixKPrimaryOnlyMeaningful).primaryIsWrapper, false);
assert.equal(sixKPrimaryOnlyMeaningful.warnings.includes("six_k_wrapper_without_meaningful_exhibit"), false);

const tableFactsPackage = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000308",
  title: "TableCo files 8-K",
  bodyText: [
    "Item 2.02 Results of Operations and Financial Condition",
    "Metric | Three Months Ended March 31 2026 | Three Months Ended March 31 2025",
    "Revenue | $10 million | $8 million",
    "Net income | $1 million | $500 thousand",
    "EXHIBIT INDEX",
    "Exhibit No. | Description",
    "99.1 | Press Release",
    "SIGNATURES",
    "Name | Title",
    "/s/ Jane Doe | Chief Executive Officer",
    "Investor Relations | ir@example.com",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000308",
    form_type: "8-K",
    documents: [{ type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 1200 }],
  },
});
const tableFacts = extractedRecord(tableFactsPackage, "tableFacts");
const tableLikeBlocks = tableFacts.tableLikeBlocks as Array<Record<string, unknown>>;
assert.ok(tableLikeBlocks.some((block) => block.kind === "financial_table"));
assert.equal(tableLikeBlocks.some((block) => String(block.evidence).includes("Exhibit No.")), false);
assert.equal(tableLikeBlocks.some((block) => String(block.evidence).includes("Investor Relations")), false);

const separatedTableFactsPackage = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000308-separated",
  title: "SeparatedTableCo files 8-K",
  bodyText: [
    "Item 2.02 Results of Operations and Financial Condition",
    "Metric | Q1 FY27 | Q4 FY26 | Q1 FY26",
    "",
    "Revenue | $81,615 | $44,062 | $26,044",
    "",
    "Operating income | $53,536 | $28,465 | $16,909",
    "",
    "Net income | $58,321 | $22,091 | $14,881",
  ].join("\n"),
  rawPayload: {
    accession_number: "0000000000-26-000308-separated",
    form_type: "8-K",
    documents: [{ type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 1200 }],
  },
});
const separatedTableFacts = extractedRecord(separatedTableFactsPackage, "tableFacts");
const separatedTableLikeBlocks = separatedTableFacts.tableLikeBlocks as Array<Record<string, unknown>>;
assert.ok(separatedTableLikeBlocks.some((block) => block.kind === "financial_table"));
assert.ok(separatedTableLikeBlocks.some((block) => Number(block.rowCount) >= 4));

const duplicateBodyAnalysis = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000309",
  title: "DuplicateCo files 8-K",
  bodyText: "Item 2.02 Results of Operations and Financial Condition\nDuplicateCo reported revenue of $4 million.",
  analysisText: "Item 2.02 Results of Operations and Financial Condition\nDuplicateCo reported revenue of $4 million.",
  rawPayload: {
    accession_number: "0000000000-26-000309",
    form_type: "8-K",
    documents: [{ type: "8-K", description: "Primary filing", isPrimary: true, textCharCount: 500 }],
  },
});
assert.deepEqual(duplicateBodyAnalysis.facts.items.map((item) => item.item), ["2.02"]);
assert.ok(duplicateBodyAnalysis.facts.textStats.combinedChars < duplicateBodyAnalysis.facts.textStats.bodyChars + duplicateBodyAnalysis.facts.textStats.analysisChars);

const exchangeDelisting = parseSec8k6kFiling(readFixture("exchange-delisting-8k.json"));
assert.deepEqual(exchangeDelisting.facts.items.map((item) => item.item), ["3.01", "9.01"]);
assert.ok(exchangeDelisting.facts.filingCues.some((cue) => cue.cueType === "exchange_listing_notice"));
assert.ok(
  exchangeDelisting.facts.dates.some(
    (date) => String(date.label || "").includes("Trading suspension") || String(date.evidence || "").includes("suspended"),
  ),
);
assertParserHasNoRoutingDecision(exchangeDelisting, "exchange-delisting-8k.json");

const voluntaryDelisting = parseSec8k6kFiling(readFixture("voluntary-delisting-8k.json"));
assert.deepEqual(voluntaryDelisting.facts.items.map((item) => item.item), ["8.01", "9.01"]);
assert.ok(voluntaryDelisting.facts.filingCues.some((cue) => cue.cueType === "exchange_listing_notice"));
assert.ok(voluntaryDelisting.facts.filingCues.some((cue) => cue.evidence.toLowerCase().includes("voluntary delisting")));
assertParserHasNoRoutingDecision(voluntaryDelisting, "voluntary-delisting-8k.json");

const mergerClosingDelisting = parseSec8k6kFiling(readFixture("merger-closing-delisting-8k.json"));
assert.deepEqual(mergerClosingDelisting.facts.items.map((item) => item.item), ["2.01", "3.01", "5.01", "9.01"]);
assert.ok(mergerClosingDelisting.facts.filingCues.some((cue) => cue.cueType === "strategic_transaction_terms"));
assert.ok(mergerClosingDelisting.facts.filingCues.some((cue) => cue.cueType === "exchange_listing_notice"));
assertParserHasNoRoutingDecision(mergerClosingDelisting, "merger-closing-delisting-8k.json");

const materialVoteResults = parseSec8k6kFiling(readFixture("material-vote-results-8k.json"));
assert.deepEqual(materialVoteResults.facts.items.map((item) => item.item), ["5.07"]);
assert.ok(materialVoteResults.facts.filingCues.some((cue) => cue.cueType === "shareholder_vote_or_approval"));
assert.ok(materialVoteResults.facts.shareCounts.some((count) => count.value === 32_000_000));
assertParserHasNoRoutingDecision(materialVoteResults, "material-vote-results-8k.json");

const complexFinancing = parseSec8k6kFiling(readFixture("complex-financing-8k.json"));
assert.deepEqual(complexFinancing.facts.items.map((item) => item.item), ["1.01", "2.03", "3.02", "9.01"]);
assert.ok(complexFinancing.facts.filingCues.some((cue) => cue.cueType === "securities_offering_or_issuance"));
assert.ok(complexFinancing.facts.moneyAmounts.some((amount) => amount.value.amount === 12_000_000));
assert.ok(complexFinancing.facts.shareCounts.some((count) => count.value === 8_000_000));
assertParserHasNoRoutingDecision(complexFinancing, "complex-financing-8k.json");

const coverTableTicker = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000ticker",
  title: "Morphic Holding files 8-K",
  bodyText: [
    "FORM 8-K",
    "Title of each class | Trading\nSymbol(s) | Name of each exchange on which registered",
    "Common Stock, $0.0001 par value per share | | MORF | | The Nasdaq Stock Market LLC",
    "Item 2.01 Completion of Acquisition or Disposition of Assets.",
    "The merger was completed for $57 per share in cash.",
  ].join("\n"),
  rawPayload: { accession_number: "0000000000-26-000ticker", form_type: "8-K" },
});
assert.equal(coverTableTicker.facts.ticker, "MORF");

const longItemText = Array.from(
  { length: 52 },
  (_, index) => `Background paragraph ${index + 1}. The company describes the amended certificate and related capital terms in original filing language.`,
).join("\n\n");
const longItemParsed = parseSec8k6kFiling({
  sourceUniqueId: "0000000000-26-000310",
  title: "Long Item 5.03 filing",
  bodyText: [
    "FORM 8-K",
    "Item 5.03 Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year.",
    longItemText,
    "The Series B conversion price equals 85% of the lowest ten-day VWAP, subject to a 75% triggering-event adjustment.",
    "SIGNATURES",
  ].join("\n"),
  rawPayload: { accession_number: "0000000000-26-000310", form_type: "8-K" },
});
const longItem503 = longItemParsed.facts.items.find((item) => item.item === "5.03");
assert.ok(longItem503);
assert.match(longItem503.evidence, /85% of the lowest ten-day VWAP/);
assert.ok(longItem503.evidence.length > 6_000);

console.log("sec 8k-6k parser fixtures passed");

function readFixture(name: string): Sec8k6kParseInput {
  return readJson<Sec8k6kParseInput>(join(fixturesDir, name));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function formProfile(parsed: ReturnType<typeof parseSec8k6kFiling>) {
  return (parsed.facts.extracted as Record<string, unknown>).formProfile as Record<string, unknown>;
}

function exhibitFacts(parsed: ReturnType<typeof parseSec8k6kFiling>) {
  return (parsed.facts.extracted as Record<string, unknown>).exhibitFacts as Record<string, unknown>;
}

function exhibitHints(parsed: ReturnType<typeof parseSec8k6kFiling>) {
  return exhibitFacts(parsed).itemExhibitHints as Array<Record<string, unknown>>;
}

function documentExhibits(parsed: ReturnType<typeof parseSec8k6kFiling>) {
  return exhibitFacts(parsed).documentExhibits as Array<Record<string, unknown>>;
}

function referencedExhibits(parsed: ReturnType<typeof parseSec8k6kFiling>) {
  return exhibitFacts(parsed).referencedExhibits as Array<Record<string, unknown>>;
}

function sixKExhibits(parsed: ReturnType<typeof parseSec8k6kFiling>) {
  const sixK = exhibitFacts(parsed).sixK as Record<string, unknown>;
  return sixK.exhibits as Array<Record<string, unknown>>;
}

function extractedRecord(parsed: ReturnType<typeof parseSec8k6kFiling>, key: string) {
  return (parsed.facts.extracted as Record<string, unknown>)[key] as Record<string, unknown>;
}

function roleCandidates(exhibit: Record<string, unknown>) {
  return exhibit.roleCandidates as string[];
}

function assertParserHasNoRoutingDecision(parsed: ReturnType<typeof parseSec8k6kFiling>, label: string) {
  const facts = parsed.facts as unknown as Record<string, unknown>;
  assert.equal("primaryEventCandidate" in facts, false, label);
  assert.equal("eventCandidates" in facts, false, label);
  assert.equal("deterministicDecision" in facts, false, label);

  const serializedFacts = JSON.stringify(parsed.facts);
  assert.equal(serializedFacts.includes("scoreHint"), false, label);
  assert.equal(serializedFacts.includes("displayType"), false, label);
  assert.equal(serializedFacts.includes("deliveryLevel"), false, label);

  for (const signal of parsed.signals as unknown as Array<Record<string, unknown>>) {
    assert.equal("eventType" in signal, false, label);
    assert.equal("scoreHint" in signal, false, label);
    assert.equal("displayType" in signal, false, label);
  }
}
