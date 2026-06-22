import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseS4F4Filing } from "./parser.ts";
import type { RequiredOutputJson, S4F4Fixture } from "./types.ts";

const roomDir = dirname(fileURLToPath(import.meta.url));

runParserFixtureTests();
runFullSubmissionNoiseTest();
runFullSubmissionDocumentSplitTest();
runExpandedSourceBlockSelectionTest();
runPrecisionCleanupTests();
runFullBodyAmendmentWithoutChangeExplanationTest();
runIndexOnlySourceTest();
runGraphicOnlySourceTest();

function runParserFixtureTests(): void {
  for (const id of fixtureIds()) {
    const fixture = readJson<S4F4Fixture>(join(roomDir, "fixtures", `${id}.json`));
    const expected = readJson<RequiredOutputJson>(join(roomDir, "expected", `${id}.expected.json`));
    const parsed = parseS4F4Filing(fixture);

    assert.equal(parsed.parserVersion, "s4-f4-v1", id);
    assert.equal(parsed.parserGroup, "s4-f4", id);
    assert.equal(parsed.formType, "S-4 / F-4 / S-4/A / F-4/A", id);
    assert.equal(parsed.accessionNumber, expected.parser_output.accessionNumber, id);
    assert.equal(parsed.isSupported, true, id);
    assert.equal(parsed.facts.secFormType, fixture.formType, id);
    assert.deepEqual(parsed.facts.primaryTicker, fixture.primaryTicker, id);
    assert.equal(parsed.facts.isAmendment, fixture.formType.endsWith("/A"), id);

    const expectedFacts = expected.parser_output.facts;
    assert.equal(parsed.summary?.includes("raw extraction packet"), true, id);
    assert.equal(parsed.facts.transaction.type, "unknown", id);
    assert.equal(parsed.facts.amendment.materialChange, false, id);
    assert.equal(parsed.facts.amendment.routineAdministrative, false, id);
    assert.equal(parsed.facts.rawExtraction.normalizedTextChars, fixture.filingText.replace(/\s+/g, " ").trim().length, id);
    assert.equal(parsed.facts.rawExtraction.sourceAvailability, "primary_document", id);
    assert.equal(parsed.facts.rawExtraction.missingRequiredItems.length, 0, id);
    assert.ok(parsed.cleaned_source_blocks.length > 0, id);
    assert.ok(blockTypes(parsed).has("filing_metadata"), id);
    assert.ok(blockTypes(parsed).has("document_inventory"), id);
    assert.ok(blockTypes(parsed).has("primary_source_section"), id);
    assert.equal(requiredStatus(parsed, "primary_document_text"), "present", id);
    assert.equal(requiredStatus(parsed, "cover_metadata"), "present", id);
    assert.equal(requiredStatus(parsed, "registrant_or_party_metadata"), "present", id);
    assert.equal(requiredStatus(parsed, "primary_filing_marker"), "present", id);
    assert.equal(requiredStatus(parsed, "exhibit_inventory"), "present", id);
    assert.equal(requiredStatus(parsed, "primary_body_not_sec_index"), "present", id);

    if (fixture.formType.endsWith("/A")) {
      assert.notEqual(requiredStatus(parsed, "amendment_marker"), "missing", id);
    } else {
      assert.equal(requiredStatus(parsed, "amendment_marker"), "not_applicable", id);
    }

    if (expectedFacts.structure?.isExhibitsOnly) {
      assert.equal(parsed.facts.structure.isExhibitsOnly, true, id);
      assert.equal(optionalStatus(parsed, "exhibits_only_omission_language"), "present", id);
    }

    if (id === "notes-exchange-s4") {
      assert.equal(optionalStatus(parsed, "debt_security_terms"), "present", id);
    }

    if (expected.fixture_expected.market_context_needed) {
      assert.equal(parsed.facts.dilution.marketContextProvided, true, id);
    }

    if (id === "complex-f4a-amendment") {
      assert.ok(parsed.warnings.some((warning) => warning.includes("Multiple registrants")), id);
    }
  }
}

function requiredStatus(parsed: ReturnType<typeof parseS4F4Filing>, item: string): string {
  const match = parsed.facts.rawExtraction.requiredItems.find((candidate) => candidate.item === item);
  assert.ok(match, `missing required raw check ${item}`);
  return match.status;
}

function optionalStatus(parsed: ReturnType<typeof parseS4F4Filing>, item: string): string {
  const match = parsed.facts.rawExtraction.optionalItems.find((candidate) => candidate.item === item);
  assert.ok(match, `missing optional raw check ${item}`);
  return match.status;
}

function blockTypes(parsed: ReturnType<typeof parseS4F4Filing>): Set<string> {
  return new Set(parsed.cleaned_source_blocks.map((block) => block.block_type));
}

function runFullSubmissionNoiseTest(): void {
  const encodedPayload = "A".repeat(240);
  const fixture: S4F4Fixture = {
    id: "full-submission-noise",
    description: "Synthetic complete submission noise packet",
    formType: "S-4/A",
    accessionNumber: "0000000000-26-000001",
    filingDate: "2026-05-23",
    companyName: "Noise Test Registrant",
    primaryTicker: { ticker: null, exchange: null },
    participants: [{ name: "Noise Test Registrant", role: "registrant" }],
    filingText: [
      "<SEC-DOCUMENT>0000000000-26-000001.txt : 20260523",
      "<SEC-HEADER>ACCESSION NUMBER: 0000000000-26-000001</SEC-HEADER>",
      "<DOCUMENT>",
      "<TYPE>S-4/A",
      "<SEQUENCE>1",
      "<FILENAME>noise-s4a.htm",
      "<DESCRIPTION>S-4/A",
      "<TEXT>",
      "<html>",
      "<body>",
      "<script>var noisy = true;</script>",
      ...Array.from({ length: 1_101 }, (_, index) => `<div class=\"c${index}\" style=\"x:${index}\">registration statement prospectus merger special meeting Amendment No. 1</div>`),
      ...Array.from({ length: 55 }, () => "<!-- converted table layout -->"),
      encodedPayload,
      "</body>",
      "</html>",
      "</TEXT>",
      "</DOCUMENT>",
      "<DOCUMENT>",
      "<TYPE>GRAPHIC",
      "<SEQUENCE>2",
      "<FILENAME>image.jpg",
      "<DESCRIPTION>Graphic",
      "<TEXT>",
      encodedPayload,
      "</TEXT>",
      "</DOCUMENT>",
      "</SEC-DOCUMENT>",
    ].join("\n"),
    attachments: [{ type: "GRAPHIC", description: "Graphic", filedHerewith: true }],
    market_context: null,
    parentFilingContext: null,
  };
  const parsed = parseS4F4Filing(fixture);
  const noiseItems = new Set(parsed.facts.rawExtraction.noiseCandidates.map((item) => item.item));

  assert.equal(parsed.facts.rawExtraction.sourceAvailability, "full_submission");
  for (const item of [
    "complete_submission_wrapper",
    "sec_header_block",
    "multi_document_submission",
    "submission_document_metadata_tags",
    "graphic_attachments",
    "html_markup",
    "inline_css_class_attributes",
    "html_comments",
    "script_style_markup",
    "encoded_binary_payloads",
  ]) {
    assert.ok(noiseItems.has(item), `full-submission-noise missing ${item}`);
  }

  assert.equal(parsed.facts.rawExtraction.missingRequiredItems.length, 0);
  assert.equal(parsed.facts.transaction.type, "unknown");
  assert.equal(parsed.facts.amendment.materialChange, false);
}

function runFullSubmissionDocumentSplitTest(): void {
  const fixture: S4F4Fixture = {
    id: "full-submission-document-split",
    description: "Full SEC submission with primary S-4 body and material exhibit text",
    formType: "S-4",
    accessionNumber: "0000000000-26-000002",
    filingDate: "2026-05-23",
    companyName: "Split Test Registrant",
    primaryTicker: { ticker: "SPLT", exchange: "NASDAQ" },
    participants: [{ name: "Split Test Registrant", ticker: "SPLT", exchange: "NASDAQ", role: "registrant" }],
    filingText: [
      "<SEC-DOCUMENT>0000000000-26-000002.txt : 20260523",
      "<SEC-HEADER>ACCESSION NUMBER: 0000000000-26-000002</SEC-HEADER>",
      "<DOCUMENT>",
      "<TYPE>S-4",
      "<SEQUENCE>1",
      "<FILENAME>split-s4.htm",
      "<DESCRIPTION>Registration Statement",
      "<TEXT>",
      "<html><body><h1>Registration Statement on Form S-4</h1>",
      "<p>This proxy statement/prospectus describes a proposed merger and special meeting for Split Test Registrant.</p>",
      "</body></html>",
      "</TEXT>",
      "</DOCUMENT>",
      "<DOCUMENT>",
      "<TYPE>EX-2.1",
      "<SEQUENCE>2",
      "<FILENAME>merger-agreement.htm",
      "<DESCRIPTION>Agreement and Plan of Merger",
      "<TEXT>",
      "<html><body><p>Agreement and Plan of Merger. The business combination agreement includes closing conditions and amendment mechanics.</p></body></html>",
      "</TEXT>",
      "</DOCUMENT>",
      "</SEC-DOCUMENT>",
    ].join("\n"),
    attachments: [],
    market_context: null,
    parentFilingContext: null,
  };
  const parsed = parseS4F4Filing(fixture);
  const raw = parsed.raw as {
    sourceAvailability?: string;
    sourceDocuments?: Array<{ role: string; type: string }>;
    selectedExhibitSnippets?: unknown[];
  };

  assert.equal(parsed.facts.rawExtraction.sourceAvailability, "full_submission");
  assert.equal(requiredStatus(parsed, "primary_document_text"), "present");
  assert.equal(parsed.facts.exhibits.count, 1);
  assert.ok(raw.sourceDocuments?.some((document) => document.role === "primary" && document.type === "S-4"));
  assert.ok(raw.sourceDocuments?.some((document) => document.role === "exhibit" && document.type === "EX-2.1"));
  assert.equal(raw.selectedExhibitSnippets?.length, 1);
  assert.ok(blockTypes(parsed).has("selected_exhibit_snippet"));
}

function runExpandedSourceBlockSelectionTest(): void {
  const fixture: S4F4Fixture = {
    id: "expanded-source-block-selection",
    description: "S-4 source block selection for SPAC, vote, PIPE, termination, exhibit, and fee-table noise",
    formType: "S-4",
    accessionNumber: "0000000000-26-000006",
    filingDate: "2026-05-23",
    companyName: "SPAC Source Block Corp.",
    primaryTicker: { ticker: "SSBC", exchange: "NASDAQ" },
    participants: [
      { name: "SPAC Source Block Corp.", ticker: "SSBC", exchange: "NASDAQ", role: "registrant" },
      { name: "Target Robotics Inc.", role: "target" },
    ],
    filingText: [
      "<SEC-DOCUMENT>0000000000-26-000006.txt : 20260523",
      "<DOCUMENT>",
      "<TYPE>S-4",
      "<SEQUENCE>1",
      "<FILENAME>spac-s4.htm",
      "<DESCRIPTION>Registration Statement",
      "<TEXT>",
      "<html><body>",
      "<h1>Proxy Statement/Prospectus for the Business Combination</h1>",
      "<p>Questions and Answers About the Business Combination explain the special meeting, record date, and required vote.</p>",
      "<p>Public stockholders may elect to redeem their shares. The business combination is conditioned upon the company having at least $75 million in the trust account after redemptions.</p>",
      "<p>The board recommends that stockholders vote FOR the merger proposal and the Nasdaq proposal.</p>",
      "<p>The merger agreement includes an outside date of September 30, 2026, a termination fee of $12.5 million, and a no-shop covenant.</p>",
      "<p>The PIPE financing and backstop agreement provide $125 million of committed financing. The sponsor support agreement includes founder share forfeiture and a lock-up agreement.</p>",
      "<p>Unaudited pro forma condensed combined financial information shows 35,000,000 shares, 62% ownership, and $275,000,000 of cash after closing.</p>",
      "</body></html>",
      "</TEXT>",
      "</DOCUMENT>",
      "<DOCUMENT>",
      "<TYPE>EX-10.1",
      "<SEQUENCE>2",
      "<FILENAME>subscription-agreement.htm",
      "<DESCRIPTION>PIPE Subscription Agreement",
      "<TEXT>",
      "<html><body><p>Subscription Agreement. Investors agreed to purchase $125 million of common stock in the PIPE financing at $10.00 per share as a closing condition.</p></body></html>",
      "</TEXT>",
      "</DOCUMENT>",
      "<DOCUMENT>",
      "<TYPE>EX-99.1",
      "<SEQUENCE>3",
      "<FILENAME>investor-presentation.htm",
      "<DESCRIPTION>Investor Presentation",
      "<TEXT>",
      "<html><body><p>Investor Presentation. The combined company is expected to be listed on Nasdaq under the symbol RBOT after closing.</p></body></html>",
      "</TEXT>",
      "</DOCUMENT>",
      "<DOCUMENT>",
      "<TYPE>EX-FILING FEES",
      "<SEQUENCE>4",
      "<FILENAME>fee-table.htm",
      "<DESCRIPTION>Filing Fee Table",
      "<TEXT>",
      "<html><body><table><tr><td>Maximum Aggregate Offering Price</td><td>$400,000,000</td></tr><tr><td>Amount of Registration Fee</td><td>$59,040</td></tr></table></body></html>",
      "</TEXT>",
      "</DOCUMENT>",
      "</SEC-DOCUMENT>",
    ].join("\n"),
    attachments: [
      { type: "EX-2.1", description: "Agreement and Plan of Merger", filedHerewith: true },
      { type: "EX-10.1", description: "PIPE Subscription Agreement", filedHerewith: true },
      { type: "EX-FILING FEES", description: "Filing Fee Table", filedHerewith: true },
    ],
    market_context: null,
    parentFilingContext: null,
  };
  const parsed = parseS4F4Filing(fixture);
  const blocks = parsed.cleaned_source_blocks;

  assert.ok(blocks.some((block) => block.title === "SPAC/de-SPAC status terms" && block.text.includes("Public stockholders may elect to redeem")));
  assert.ok(blocks.some((block) => block.title === "Termination and no-shop terms" && block.text.includes("termination fee of $12.5 million")));
  assert.ok(blocks.some((block) => block.title === "Support, lock-up, PIPE, or backstop terms" && block.text.includes("PIPE financing")));
  assert.ok(blocks.some((block) => block.block_type === "selected_exhibit_snippet" && block.text.includes("$125 million of common stock")));
  assert.ok(blocks.some((block) => block.block_type === "ambiguous_source_block" && block.text.includes("EX-2.1 Agreement and Plan of Merger")));
  assert.ok(blocks.some((block) => block.block_type === "source_noise_summary" && block.text.includes("filing_fee_table")));
  assert.ok(parsed.facts.rawExtraction.noiseCandidates.some((candidate) => candidate.item === "filing_fee_table"));
  assert.equal(optionalStatus(parsed, "filing_fee_table"), "noise");
  assert.equal(optionalStatus(parsed, "support_lockup_pipe_terms"), "present");
  assert.equal(optionalStatus(parsed, "termination_terms"), "present");
  assert.equal(optionalStatus(parsed, "spac_de_spac_terms"), "present");
  assert.equal(
    blocks.some((block) => block.block_type === "table_source_block" && block.text.includes("Maximum Aggregate Offering Price")),
    false,
  );
}

function runPrecisionCleanupTests(): void {
  const tocOnly = parseS4F4Filing(baseFixture({
    id: "toc-only-no-source-block",
    filingText: [
      "Registration Statement on Form S-4",
      "TABLE OF CONTENTS",
      "QUESTIONS AND ANSWERS 4",
      "SUMMARY 9",
      "CLOSING CONDITIONS 50",
      "RISK FACTORS 72",
    ].join("\n"),
  }));
  assert.equal(hasBlockTitle(tocOnly, "Summary or Q&A"), false);
  assert.equal(hasBlockTitle(tocOnly, "Closing conditions"), false);

  const bodyWithTocBoundary = parseS4F4Filing(baseFixture({
    id: "body-with-toc-boundary",
    filingText: [
      "Registration Statement on Form S-4",
      "TABLE OF CONTENTS",
      "SUMMARY 9",
      "CLOSING CONDITIONS 50",
      "The closing of the business combination is conditioned upon approval by stockholders and receipt of required regulatory approvals.",
    ].join("\n"),
  }));
  const closingBlock = bodyWithTocBoundary.cleaned_source_blocks.find((block) => block.title === "Closing conditions");
  assert.ok(closingBlock);
  assert.equal(closingBlock.text.includes("TABLE OF CONTENTS"), false);
  assert.ok(closingBlock.text.includes("The closing of the business combination is conditioned"));

  const tocTableRows = parseS4F4Filing(baseFixture({
    id: "toc-table-rows-not-table-source",
    filingText: [
      "Registration Statement on Form S-4",
      "TABLE OF CONTENTS",
      "UNAUDITED PRO FORMA CONDENSED COMBINED FINANCIAL INFORMATION 105",
      "COMPARATIVE PER SHARE DATA 117",
      "RISK FACTORS 128",
    ].join("\n"),
  }));
  assert.equal(
    tocTableRows.cleaned_source_blocks.some((block) => block.block_type === "table_source_block"),
    false,
  );

  const romanTocRows = parseS4F4Filing(baseFixture({
    id: "roman-toc-rows-not-summary-source",
    filingText: [
      "Registration Statement on Form S-4",
      "TABLE OF CONTENTS",
      "Page",
      "CERTAIN DEFINITIONS ii",
      "QUESTIONS AND ANSWERS ABOUT THE TRANSACTION iv",
      "SUMMARY OF THE TRANSACTION 1",
      "RISK FACTORS 4",
      "THE TRANSACTION 39",
    ].join("\n"),
  }));
  assert.equal(hasBlockTitle(romanTocRows, "Summary or Q&A"), false);

  const genericAcquisitionShelf = parseS4F4Filing(baseFixture({
    id: "generic-acquisition-shelf-not-merger-blocks",
    filingText: [
      "Registration Statement on Form S-4.",
      "This prospectus relates to securities that may be issued from time to time in connection with acquisitions.",
      "We may acquire businesses, assets or securities pursuant to an applicable agreement or plan of merger or other acquisition agreement.",
      "Stockholder approval may be required under Nasdaq rules at a special meeting.",
      "The board of directors may recommend approval of corporate governance matters under our charter and bylaws.",
      "A prospectus supplement will describe any specific transaction.",
    ].join(" "),
  }));
  assert.equal(hasBlockTitle(genericAcquisitionShelf, "Transaction terms"), false);
  assert.equal(hasBlockTitle(genericAcquisitionShelf, "Vote or meeting terms"), false);
  assert.equal(hasBlockTitle(genericAcquisitionShelf, "Board recommendation"), false);

  const s4ForeignLaw = parseS4F4Filing(baseFixture({
    id: "s4-generic-foreign-law",
    formType: "S-4/A",
    filingText:
      "This Amendment No. 1 to Form S-4 describes the merger agreement. The purchaser has no liability under comparable provisions of state, local or foreign Law. The merger agreement includes customary closing conditions.",
  }));
  assert.equal(hasBlockTitle(s4ForeignLaw, "F-4 foreign issuer or ADS terms"), false);
  assert.equal(optionalStatus(s4ForeignLaw, "f4_cross_border_terms"), "not_applicable");

  const f4AdsScheme = parseS4F4Filing(baseFixture({
    id: "f4-ads-scheme",
    formType: "F-4/A",
    filingText:
      "This Amendment No. 1 to Form F-4 describes the scheme of arrangement. Each ADS represents two ordinary shares. The scheme of arrangement must be approved by the Court before closing.",
  }));
  assert.ok(hasBlockTitle(f4AdsScheme, "F-4 foreign issuer or ADS terms"));
  assert.equal(optionalStatus(f4AdsScheme, "f4_cross_border_terms"), "present");

  const fractionalRedemption = parseS4F4Filing(baseFixture({
    id: "fractional-redemption-not-spac",
    filingText:
      "This registration statement describes the merger. No fractional shares will be issued. Holders who receive cash in lieu of a fractional share will be treated as receiving cash in redemption of the fractional share from the exchange agent.",
  }));
  assert.equal(hasBlockTitle(fractionalRedemption, "SPAC/de-SPAC status terms"), false);
  assert.equal(optionalStatus(fractionalRedemption, "spac_de_spac_terms"), "missing");

  const publicTrustRedemption = parseS4F4Filing(baseFixture({
    id: "public-trust-redemption",
    filingText:
      "This proxy statement/prospectus describes a SPAC business combination. Public stockholders may elect to redeem their public shares for cash held in the trust account. The sponsor support agreement remains in effect.",
  }));
  assert.ok(hasBlockTitle(publicTrustRedemption, "SPAC/de-SPAC status terms"));
  assert.equal(optionalStatus(publicTrustRedemption, "spac_de_spac_terms"), "present");

  const exhibitPriority = parseS4F4Filing(baseFixture({
    id: "substantive-exhibits-before-consents",
    filingText: [
      "<SEC-DOCUMENT>0000000000-26-000008.txt : 20260523",
      "<DOCUMENT>",
      "<TYPE>S-4",
      "<SEQUENCE>1",
      "<FILENAME>priority-s4.htm",
      "<DESCRIPTION>Registration Statement",
      "<TEXT>",
      "<html><body><p>This proxy statement/prospectus describes a merger and business combination proposal.</p></body></html>",
      "</TEXT>",
      "</DOCUMENT>",
      "<DOCUMENT>",
      "<TYPE>EX-2.1",
      "<SEQUENCE>2",
      "<FILENAME>merger-agreement.htm",
      "<DESCRIPTION>Agreement and Plan of Merger",
      "<TEXT>",
      "<html><body><p>Agreement and Plan of Merger. The merger agreement includes an exchange ratio, outside date, and closing conditions.</p></body></html>",
      "</TEXT>",
      "</DOCUMENT>",
      "<DOCUMENT>",
      "<TYPE>EX-10.1",
      "<SEQUENCE>3",
      "<FILENAME>support-agreement.htm",
      "<DESCRIPTION>Voting and Support Agreement",
      "<TEXT>",
      "<html><body><p>Voting Agreement. The support agreement requires holders to vote in favor of the merger proposal and restricts transfers before the closing of the transaction.</p></body></html>",
      "</TEXT>",
      "</DOCUMENT>",
      "<DOCUMENT>",
      "<TYPE>EX-23.1",
      "<SEQUENCE>4",
      "<FILENAME>auditor-consent.htm",
      "<DESCRIPTION>Consent of Independent Registered Public Accounting Firm",
      "<TEXT>",
      "<html><body><p>We consent to the incorporation by reference of our report in this registration statement.</p></body></html>",
      "</TEXT>",
      "</DOCUMENT>",
      "</SEC-DOCUMENT>",
    ].join("\n"),
  }));
  const selectedExhibitBlocks = exhibitPriority.cleaned_source_blocks.filter((block) => block.block_type === "selected_exhibit_snippet");
  assert.equal(selectedExhibitBlocks.some((block) => block.text.includes("We consent to the incorporation")), false);
  assert.equal(selectedExhibitBlocks.some((block) => block.title.includes("EX-23")), false);
  assert.ok(selectedExhibitBlocks.some((block) => block.text.includes("Agreement and Plan of Merger")));
  assert.ok(selectedExhibitBlocks.some((block) => block.text.includes("Voting Agreement")));
}

function runFullBodyAmendmentWithoutChangeExplanationTest(): void {
  const repeatedBody = Array.from(
    { length: 120 },
    () =>
      "This proxy statement/prospectus describes the proposed merger, merger consideration, special meeting, vote required, closing conditions, risk factors, regulatory approvals, fairness opinion, and pro forma financial information.",
  ).join(" ");
  const fixture: S4F4Fixture = {
    id: "full-body-amendment-change-not-identified",
    description: "S-4/A with a full body refiled but no explanatory note identifying amendment changes",
    formType: "S-4/A",
    accessionNumber: "0000000000-26-000005",
    filingDate: "2026-05-23",
    companyName: "Full Body Amendment Registrant",
    primaryTicker: { ticker: "FBAR", exchange: "NASDAQ" },
    participants: [{ name: "Full Body Amendment Registrant", ticker: "FBAR", exchange: "NASDAQ", role: "registrant" }],
    filingText: [
      "AMENDMENT NO. 1 TO FORM S-4 REGISTRATION STATEMENT.",
      repeatedBody,
      "Schedules to the merger agreement have been omitted pursuant to Item 601(a)(5) of Regulation S-K.",
    ].join(" "),
    attachments: [],
    market_context: null,
    parentFilingContext: null,
  };
  const parsed = parseS4F4Filing(fixture);

  assert.equal(parsed.facts.structure.isExhibitsOnly, false);
  assert.ok(blockTypes(parsed).has("amendment_change_not_identified"));
  assert.ok(
    parsed.cleaned_source_blocks.some(
      (block) =>
        block.block_type === "amendment_change_not_identified" &&
        block.text.includes("Do not infer no material change"),
    ),
  );
}

function baseFixture(overrides: Partial<S4F4Fixture>): S4F4Fixture {
  return {
    id: "precision-base",
    description: "Synthetic S-4/F-4 precision cleanup fixture",
    formType: "S-4",
    accessionNumber: "0000000000-26-000007",
    filingDate: "2026-05-23",
    companyName: "Precision Cleanup Registrant",
    primaryTicker: { ticker: "PCLR", exchange: "NASDAQ" },
    participants: [{ name: "Precision Cleanup Registrant", ticker: "PCLR", exchange: "NASDAQ", role: "registrant" }],
    filingText: "Registration Statement on Form S-4",
    attachments: [],
    market_context: null,
    parentFilingContext: null,
    ...overrides,
  };
}

function hasBlockTitle(parsed: ReturnType<typeof parseS4F4Filing>, title: string): boolean {
  return parsed.cleaned_source_blocks.some((block) => block.title === title);
}

function runIndexOnlySourceTest(): void {
  const fixture: S4F4Fixture = {
    id: "index-only-source",
    description: "SEC accession index without primary filing body",
    formType: "S-4/A",
    accessionNumber: "0000000000-26-000003",
    filingDate: "2026-05-23",
    companyName: "Index Only Registrant",
    primaryTicker: { ticker: null, exchange: null },
    participants: [{ name: "Index Only Registrant", role: "registrant" }],
    filingText:
      "SEC EDGAR Filing Documents. Document Format Files. Seq Description Document Type Size 1 index-s4a.htm S-4/A 42 KB 2 agreement.htm EX-2.1 35 KB.",
    attachments: [{ type: "EX-2.1", description: "Agreement and Plan of Merger", filedHerewith: true }],
    market_context: null,
    parentFilingContext: null,
  };
  const parsed = parseS4F4Filing(fixture);

  assert.equal(parsed.facts.rawExtraction.sourceAvailability, "index_or_inventory_only");
  assert.equal(requiredStatus(parsed, "primary_document_text"), "missing");
  assert.equal(requiredStatus(parsed, "primary_body_not_sec_index"), "missing");
  assert.ok(parsed.facts.rawExtraction.missingRequiredItems.includes("primary_document_text"));
  assert.ok(parsed.warnings.some((warning) => warning.includes("do not send this packet to router or analysis LLM")));
}

function runGraphicOnlySourceTest(): void {
  const encodedPayload = "A".repeat(260);
  const fixture: S4F4Fixture = {
    id: "graphic-only-source",
    description: "Complete submission with no primary text document",
    formType: "S-4/A",
    accessionNumber: "0000000000-26-000004",
    filingDate: "2026-05-23",
    companyName: "Graphic Only Registrant",
    primaryTicker: { ticker: null, exchange: null },
    participants: [{ name: "Graphic Only Registrant", role: "registrant" }],
    filingText: [
      "<SEC-DOCUMENT>0000000000-26-000004.txt : 20260523",
      "<DOCUMENT>",
      "<TYPE>GRAPHIC",
      "<SEQUENCE>1",
      "<FILENAME>image.jpg",
      "<DESCRIPTION>Graphic",
      "<TEXT>",
      encodedPayload,
      "</TEXT>",
      "</DOCUMENT>",
      "</SEC-DOCUMENT>",
    ].join("\n"),
    attachments: [{ type: "GRAPHIC", description: "Graphic", filedHerewith: true }],
    market_context: null,
    parentFilingContext: null,
  };
  const parsed = parseS4F4Filing(fixture);

  assert.equal(parsed.facts.rawExtraction.sourceAvailability, "graphic_or_binary_only");
  assert.equal(requiredStatus(parsed, "primary_document_text"), "missing");
  assert.ok(parsed.facts.rawExtraction.missingRequiredItems.includes("primary_document_text"));
  assert.ok(parsed.facts.rawExtraction.noiseCandidates.some((candidate) => candidate.item === "graphic_attachments"));
  assert.ok(parsed.warnings.some((warning) => warning.includes("do not send this packet to router or analysis LLM")));
}

function fixtureIds(): string[] {
  return readdirSync(join(roomDir, "fixtures"))
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => fileName.replace(/\.json$/, ""))
    .sort();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
