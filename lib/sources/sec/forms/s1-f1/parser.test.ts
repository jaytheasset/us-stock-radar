import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildDeterministicS1F1Result, parseS1F1Filing } from "./parser.ts";
import { buildS1F1LlmSourceInput } from "./sourceInput.ts";
import { APPROVED_SEC_EVENT_TYPES, type S1F1ParserInput } from "./types.ts";

const ROOM_URL = new URL("./", import.meta.url);
const FIXTURE_NAMES = [
  "edgar-cava-s1-ipo",
  "edgar-reddit-s1a-pricing",
  "edgar-arm-f1a-ads-ipo",
  "edgar-spirit-posam-deregistration",
  "edgar-liberty-f1mef-rule462b",
  "edgar-medline-s1mef-rule462b",
] as const;

interface FixtureFile {
  name: string;
  source: {
    sec_url: string;
    accession: string;
    text_basis: string;
  };
  input: S1F1ParserInput;
  expected: {
    event_type: string;
    delivery_level: string;
    deterministic: boolean;
    facts: Record<string, unknown>;
  };
}

function loadFixture(name: string): FixtureFile {
  return JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, ROOM_URL), "utf8")) as FixtureFile;
}

function documentBlock(type: string, sequence: number, filename: string, description: string, text: string): string {
  return `<DOCUMENT>
<TYPE>${type}
<SEQUENCE>${sequence}
<FILENAME>${filename}
<DESCRIPTION>${description}
<TEXT>${text}</TEXT>
</DOCUMENT>`;
}

describe("S-1/F-1 parser fixtures", () => {
  for (const name of FIXTURE_NAMES) {
    it(`extracts expected facts and approved signals for ${name}`, () => {
      const fixture = loadFixture(name);
      const parserOutput = parseS1F1Filing(fixture.input);

      assert.match(fixture.source.sec_url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
      assert.equal(fixture.source.accession, fixture.input.accessionNumber);
      assert.equal(fixture.source.text_basis, "edgar_original_excerpt");
      assert.equal(parserOutput.parserVersion, "s1-f1-parser-v1");
      assert.equal(parserOutput.parserGroup, "s1-f1");
      assert.equal(parserOutput.formType, "S-1 / F-1, S-1/A / F-1/A");
      assert.equal(parserOutput.accessionNumber, fixture.input.accessionNumber ?? null);
      assert.equal(parserOutput.isSupported, true);
      assert.equal(parserOutput.signals[0].event_type, fixture.expected.event_type);

      for (const signal of parserOutput.signals) {
        assert.ok(
          APPROVED_SEC_EVENT_TYPES.includes(signal.event_type),
          `unexpected event type ${signal.event_type}`,
        );
      }

      const expectedFacts = fixture.expected.facts;
      assert.equal(parserOutput.facts.company_name, expectedFacts.company_name);
      assert.equal(parserOutput.facts.ticker, expectedFacts.ticker);
      assert.equal(parserOutput.facts.exchange, expectedFacts.exchange);
      assert.equal(parserOutput.facts.registration_kind, expectedFacts.registration_kind);

      if ("shares_offered" in expectedFacts) {
        assert.equal(parserOutput.facts.offering.shares_offered, expectedFacts.shares_offered);
      }
      if ("selling_shareholder_shares" in expectedFacts) {
        assert.equal(parserOutput.facts.offering.selling_shareholder_shares, expectedFacts.selling_shareholder_shares);
      }
      if ("price_low" in expectedFacts) {
        assert.equal(parserOutput.facts.offering.price_low, expectedFacts.price_low);
      }
      if ("price_high" in expectedFacts) {
        assert.equal(parserOutput.facts.offering.price_high, expectedFacts.price_high);
      }
      if ("gross_proceeds" in expectedFacts) {
        assert.equal(parserOutput.facts.offering.gross_proceeds, expectedFacts.gross_proceeds);
      }
      if ("amendment_number" in expectedFacts) {
        assert.equal(parserOutput.facts.amendment.amendment_number, expectedFacts.amendment_number);
      }
      if ("routine_or_administrative" in expectedFacts) {
        assert.equal(parserOutput.facts.amendment.routine_or_administrative, expectedFacts.routine_or_administrative);
      }
      if ("going_concern" in expectedFacts) {
        assert.equal(parserOutput.facts.risks.going_concern, expectedFacts.going_concern);
      }
      if ("fda_or_clinical" in expectedFacts) {
        assert.equal(parserOutput.facts.risks.fda_or_clinical, expectedFacts.fda_or_clinical);
      }
      if ("offering_to_market_cap_pct" in expectedFacts) {
        assert.equal(parserOutput.facts.market_context_summary.offering_to_market_cap_pct, expectedFacts.offering_to_market_cap_pct);
      }
      if ("shares_to_float_pct" in expectedFacts) {
        assert.equal(parserOutput.facts.market_context_summary.shares_to_float_pct, expectedFacts.shares_to_float_pct);
      }
      if ("filing_variant" in expectedFacts) {
        assert.equal(parserOutput.facts.filing.filing_variant, expectedFacts.filing_variant);
      }
      if ("reported_form_type" in expectedFacts) {
        assert.equal(parserOutput.facts.filing.reported_form_type, expectedFacts.reported_form_type);
      }
      if ("parent_context_needed" in expectedFacts) {
        assert.equal(parserOutput.facts.filing.parent_context_needed, expectedFacts.parent_context_needed);
      }
      if ("post_effective_purpose" in expectedFacts) {
        assert.equal(parserOutput.facts.filing.post_effective_purpose, expectedFacts.post_effective_purpose);
      }
      if ("deregister_unsold_securities" in expectedFacts) {
        assert.equal(parserOutput.facts.filing.deregister_unsold_securities, expectedFacts.deregister_unsold_securities);
      }
      if ("no_additional_securities_registered" in expectedFacts) {
        assert.equal(
          parserOutput.facts.filing.no_additional_securities_registered,
          expectedFacts.no_additional_securities_registered,
        );
      }
      if ("prior_registration_number" in expectedFacts) {
        assert.equal(parserOutput.facts.filing.rule_462b.prior_registration_number, expectedFacts.prior_registration_number);
      }
      if ("added_securities_amount" in expectedFacts) {
        assert.equal(parserOutput.facts.filing.rule_462b.added_securities_amount, expectedFacts.added_securities_amount);
      }
      if ("automatic_effective" in expectedFacts) {
        assert.equal(parserOutput.facts.filing.rule_462b.automatic_effective, expectedFacts.automatic_effective);
      }
      if ("within_20_percent_limit" in expectedFacts) {
        assert.equal(parserOutput.facts.filing.rule_462b.within_20_percent_limit, expectedFacts.within_20_percent_limit);
      }
      if ("ads_offering" in expectedFacts) {
        assert.equal(parserOutput.facts.foreign_issuer.ads_offering, expectedFacts.ads_offering);
      }
      if ("vie_structure" in expectedFacts) {
        assert.equal(parserOutput.facts.foreign_issuer.vie_structure, expectedFacts.vie_structure);
      }
      if ("hfcaa_or_pcaob_risk" in expectedFacts) {
        assert.equal(parserOutput.facts.foreign_issuer.hfcaa_or_pcaob_risk, expectedFacts.hfcaa_or_pcaob_risk);
      }
    });
  }

  it("does not finish S-1/F-1 fixtures deterministically in the parser", () => {
    for (const name of FIXTURE_NAMES) {
      const fixture = loadFixture(name);
      const parserOutput = parseS1F1Filing(fixture.input);
      const deterministicResult = buildDeterministicS1F1Result(parserOutput);

      assert.equal(parserOutput.raw.deterministic, undefined, `${name} should go to LLM routing`);
      assert.equal(deterministicResult, null, `${name} should not build a parser-only result`);
    }
  });

  it("does not use live market context for EDGAR source fixtures", () => {
    for (const name of FIXTURE_NAMES) {
      const parserOutput = parseS1F1Filing(loadFixture(name).input);
      assert.equal(parserOutput.raw.marketContext, undefined);
      assert.equal(parserOutput.facts.market_context_summary.provided, false);
    }
  });
});

describe("S-1/F-1 parser structural foundation", () => {
  it("recognizes S-1/A amendment form structure without changing exported shape", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1/A",
      accessionNumber: "0000000000-26-000001",
      filingText: [
        "Amendment No. 2 to Form S-1",
        "Prospectus Summary",
        "We are offering common stock.",
        "Risk Factors",
        "Investing in our common stock involves a high degree of risk.",
      ].join("\n"),
    });

    assert.equal(parserOutput.isSupported, true);
    assert.equal(parserOutput.facts.filing.reported_form_type, "S-1/A");
    assert.equal(parserOutput.facts.filing.filing_variant, "pre_effective_amendment");
    assert.equal(parserOutput.facts.amendment.is_amendment, true);
    assert.equal(parserOutput.facts.amendment.amendment_number, 2);
  });

  it("uses TOC headings as hints and detects body Risk Factors and Use of Proceeds sections later", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: [
        "<html><body>",
        "Table of Contents",
        "Prospectus Summary 1",
        "Risk Factors 8",
        "Use of Proceeds 42",
        "Business 70",
        "Prospectus Summary",
        "This summary highlights selected information from this prospectus.",
        "Risk Factors",
        "Risks Related to Our Business",
        "We have a limited operating history and may not achieve profitability.",
        "Our business could be adversely affected by competition.",
        "Use of Proceeds",
        "We intend to use the net proceeds for working capital.",
        "</body></html>",
      ].join("\n"),
    });

    const sections = parserOutput.raw.sectionDetection?.sections ?? [];
    const tocHints = parserOutput.raw.sectionDetection?.tocHints ?? [];
    const prospectusSummary = sections.find((section) => section.key === "prospectus_summary");
    const riskSection = sections.find((section) => section.key === "risk_factors");
    const useOfProceeds = sections.find((section) => section.key === "use_of_proceeds");

    assert.ok(tocHints.some((section) => section.key === "risk_factors"));
    assert.ok(prospectusSummary);
    assert.ok(riskSection);
    assert.ok(useOfProceeds);
    assert.ok(riskSection.lineIndex > (tocHints.find((section) => section.key === "risk_factors")?.lineIndex ?? 0));
    assert.equal(parserOutput.raw.riskFactors?.sectionDetected, true);
    assert.deepEqual(parserOutput.raw.riskFactors?.categoryHeadings, ["Risks Related to Our Business"]);
    assert.equal(parserOutput.raw.riskFactors?.headingCount, 2);
  });

  it("detects F-1-specific foreign issuer phrases without judging them", () => {
    const parserOutput = parseS1F1Filing({
      formType: "F-1",
      accessionNumber: "0000000000-26-000002",
      filingText: documentBlock(
        "F-1",
        1,
        "issuer-f1.htm",
        "FORM F-1",
        [
          "Prospectus Summary",
          "We are a foreign private issuer offering American Depositary Shares representing ordinary shares.",
          "We are a Cayman Islands holding company with operations in the PRC and Hong Kong.",
          "Our WFOE has contractual arrangements with a variable interest entity, or VIE.",
          "Risk Factors",
          "HFCAA and PCAOB inspection rules may affect trading.",
          "Exchange Controls",
          "Dividend remittance may be restricted.",
          "Enforceability of Civil Liabilities",
          "Home Country Practice",
          "Description of American Depositary Shares",
        ].join("\n"),
      ),
    });

    const phrases = new Set((parserOutput.raw.foreignIssuerPhraseHits ?? []).map((hit) => hit.phrase));

    assert.equal(parserOutput.facts.foreign_issuer.is_foreign_private_issuer, true);
    assert.equal(parserOutput.facts.foreign_issuer.ads_offering, true);
    assert.ok(phrases.has("foreign private issuer"));
    assert.ok(phrases.has("ADS"));
    assert.ok(phrases.has("ordinary shares"));
    assert.ok(phrases.has("depositary"));
    assert.ok(phrases.has("Cayman"));
    assert.ok(phrases.has("PRC"));
    assert.ok(phrases.has("Hong Kong"));
    assert.ok(phrases.has("VIE"));
    assert.ok(phrases.has("WFOE"));
    assert.ok(phrases.has("contractual arrangements"));
    assert.ok(phrases.has("variable interest entity"));
    assert.ok(phrases.has("HFCAA"));
    assert.ok(phrases.has("PCAOB"));
    assert.ok(phrases.has("exchange control"));
    assert.ok(phrases.has("dividend remittance"));
    assert.ok(phrases.has("enforceability of civil liabilities"));
    assert.ok(phrases.has("home country practice"));
  });

  it("uses DOM-style blocks to separate dotted TOC entries from styled body headings", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div style="text-align:center;font-weight:bold">Table of Contents</div>
        <div>Prospectus Summary ........ 1</div>
        <div>Risk Factors ........ 8</div>
        <div>Use of Proceeds ........ 42</div>
        <div style="text-align:center"><b>Prospectus Summary</b></div>
        <p>This summary highlights selected information from this prospectus.</p>
        <div style="text-align:center;font-weight:bold">Risk Factors</div>
        <p>Investing in our common stock involves a high degree of risk.</p>
        <div style="text-align:center;font-weight:bold">Use of Proceeds</div>
        <p>We intend to use the net proceeds for working capital.</p>
      </body></html>`,
    });

    const sections = parserOutput.raw.sectionDetection?.sections ?? [];
    const tocHints = parserOutput.raw.sectionDetection?.tocHints ?? [];
    const riskSection = sections.find((section) => section.key === "risk_factors");
    const proceedsSection = sections.find((section) => section.key === "use_of_proceeds");

    assert.ok(tocHints.some((section) => section.key === "risk_factors"));
    assert.ok(tocHints.some((section) => section.key === "use_of_proceeds"));
    assert.equal(riskSection?.source, "dom_block");
    assert.equal(proceedsSection?.source, "dom_block");
    assert.ok((riskSection?.blockOrder ?? 0) > (tocHints.find((section) => section.key === "risk_factors")?.blockOrder ?? 0));
    assert.ok((proceedsSection?.score ?? 0) >= 55);
  });

  it("detects risk factor categories and styled sentence headings without counting normal paragraphs", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div style="text-align:center;font-weight:bold">Risk Factors</div>
        <p>Investing in our common stock involves a high degree of risk.</p>
        <p style="font-weight:bold">RISKS RELATED TO OUR BUSINESS</p>
        <p><b>We have a limited operating history and may not achieve profitability.</b></p>
        <p>This paragraph explains the preceding risk in normal body text and should not be counted as a separate risk heading even though it mentions risk.</p>
        <p><i>Our quarterly results may fluctuate.</i></p>
        <p><b>Government regulation could adversely affect our business.</b></p>
        <div style="text-align:center;font-weight:bold">Use of Proceeds</div>
        <p>We intend to use the proceeds for working capital.</p>
      </body></html>`,
    });

    const risks = parserOutput.raw.riskFactors;

    assert.equal(risks?.sectionDetected, true);
    assert.deepEqual(risks?.categoryHeadings, ["RISKS RELATED TO OUR BUSINESS"]);
    assert.equal(risks?.headingCount, 3);
    assert.ok(risks?.riskFactorHeadings.includes("We have a limited operating history and may not achieve profitability"));
    assert.ok(risks?.riskFactorHeadings.includes("Our quarterly results may fluctuate"));
    assert.ok(risks?.riskFactorHeadings.includes("Government regulation could adversely affect our business"));
    assert.ok(
      !risks?.riskFactorHeadings.some((heading) => heading.startsWith("This paragraph explains")),
    );
    assert.equal(risks?.groups?.[0].category, "RISKS RELATED TO OUR BUSINESS");
    assert.equal(risks?.groups?.[0].headings.length, 3);
  });

  it("associates common offering tables with nearby sections and preserves readable rows", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Use of Proceeds</b></div>
        <table><tr><th>Use</th><th>Amount</th></tr><tr><td>Working capital</td><td>$2.0 million</td></tr></table>
        <div><b>Capitalization</b></div>
        <table><tr><th></th><th>Actual</th><th>Pro forma as adjusted</th></tr><tr><td>Cash, in thousands</td><td>$1,000</td><td>$3,000</td></tr></table>
        <div><b>Dilution</b></div>
        <table><tr><th>Offering price</th><th>Net tangible book value</th></tr><tr><td>$5.00</td><td>($1.25)</td></tr></table>
        <div><b>Selling Stockholders</b></div>
        <table><tr><th>Name</th><th>Shares offered</th></tr><tr><td>Holder A</td><td>1,000,000 shares</td></tr></table>
        <div><b>Index to Financial Statements</b></div>
        <table><tr><th>Assets</th><th>2025</th></tr><tr><td>Total assets</td><td>$10,000</td></tr></table>
      </body></html>`,
    });

    const sectionTables = parserOutput.raw.sectionDetection?.tables ?? [];
    const tableText = parserOutput.raw.documentFilter?.tables?.map((table) => table.text).join("\n\n") ?? "";

    assert.ok(sectionTables.some((table) => table.sectionKey === "use_of_proceeds" && /Working capital \| \$2.0 million/.test(table.text)));
    assert.ok(sectionTables.some((table) => table.sectionKey === "capitalization" && /Pro forma as adjusted/.test(table.text)));
    assert.ok(sectionTables.some((table) => table.sectionKey === "dilution" && /\(\$1.25\)/.test(table.text)));
    assert.ok(sectionTables.some((table) => table.sectionKey === "selling_stockholders" && /1,000,000 shares/.test(table.text)));
    assert.ok(sectionTables.some((table) => table.sectionKey === "index_to_financial_statements" && /Total assets/.test(table.text)));
    assert.match(tableText, /Cash, in thousands \| \$1,000 \| \$3,000/);
  });

  it("does not promote table headers or row labels into top-level section starts", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Capitalization</b></div>
        <table>
          <tr><th>Risk Factors</th><th>Use of Proceeds</th><th>Amount</th></tr>
          <tr><td>Use of Proceeds</td><td>Working capital</td><td>$1,000</td></tr>
        </table>
        <p>The table above is not a section heading.</p>
      </body></html>`,
    });

    const sectionKeys = new Set((parserOutput.raw.sectionDetection?.sections ?? []).map((section) => section.key));

    assert.ok(sectionKeys.has("capitalization"));
    assert.equal(sectionKeys.has("risk_factors"), false);
    assert.equal(sectionKeys.has("use_of_proceeds"), false);
  });

  it("detects F-1 sections from body blocks while treating ADS and civil-liability TOC entries as hints", () => {
    const parserOutput = parseS1F1Filing({
      formType: "F-1",
      filingText: `<html><body>
        <div>Table of Contents</div>
        <div>Corporate History and Structure ..... 4</div>
        <div>Description of American Depositary Shares ..... 120</div>
        <div>Enforceability of Civil Liabilities ..... 150</div>
        <center><b>Corporate History and Structure</b></center>
        <p>We are a foreign private issuer with ordinary shares held through a Cayman Islands holding company.</p>
        <center><b>Description of American Depositary Shares</b></center>
        <p>The ADSs are issued by the depositary and represent ordinary shares.</p>
        <center><b>Enforceability of Civil Liabilities</b></center>
        <p>Investors may face limitations enforcing civil liabilities in Hong Kong and the PRC.</p>
      </body></html>`,
    });

    const sections = new Set((parserOutput.raw.sectionDetection?.sections ?? []).map((section) => section.key));
    const tocHints = new Set((parserOutput.raw.sectionDetection?.tocHints ?? []).map((section) => section.key));
    const phraseHits = new Set((parserOutput.raw.foreignIssuerPhraseHits ?? []).map((hit) => hit.phrase));

    assert.ok(tocHints.has("corporate_history_structure"));
    assert.ok(tocHints.has("description_of_ads"));
    assert.ok(tocHints.has("enforceability_civil_liabilities"));
    assert.ok(sections.has("corporate_history_structure"));
    assert.ok(sections.has("description_of_ads"));
    assert.ok(sections.has("enforceability_civil_liabilities"));
    assert.ok(phraseHits.has("foreign private issuer"));
    assert.ok(phraseHits.has("ordinary shares"));
    assert.ok(phraseHits.has("depositary"));
    assert.ok(phraseHits.has("Cayman"));
    assert.ok(phraseHits.has("PRC"));
    assert.ok(phraseHits.has("Hong Kong"));
  });
});

describe("S-1/F-1 section-specific extraction", () => {
  it("extracts IPO offering terms without treating assumed price as final price", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      metadata: { ticker: "IPOX", exchange: "Nasdaq Capital Market" },
      filingText: `<html><body>
        <div><b>Prospectus Summary</b></div>
        <p>This is our initial public offering. We are offering 10,000,000 shares of common stock.</p>
        <p>No public market currently exists for our common stock.</p>
        <div><b>The Offering</b></div>
        <p>The assumed initial public offering price is $5.00 per share.</p>
        <p>We currently estimate the price range will be $4.00 to $6.00 per share.</p>
        <p>Estimated gross proceeds will be $60 million and estimated net proceeds will be $54 million.</p>
        <div><b>Underwriting</b></div>
        <p>The underwriters are offering the shares on a firm commitment basis. The underwriting discount will be 7.0%.</p>
        <p>We have granted the underwriters an over-allotment option to purchase additional shares.</p>
      </body></html>`,
    });

    const offering = parserOutput.raw.sectionExtractions?.offeringTerms;

    assert.ok(offering);
    assert.equal(parserOutput.facts.offering.price_low, 4);
    assert.equal(parserOutput.facts.offering.price_high, 6);
    assert.ok(offering.offeringTypes.includes("primary"));
    assert.ok(offering.securities.includes("common stock"));
    assert.ok(offering.shareCountCandidates.some((item) => item.value.includes("10,000,000 shares")));
    assert.ok(offering.assumedOfferingPriceCandidates.some((item) => item.isAssumed));
    assert.ok(offering.priceRangeCandidates.some((item) => item.value.includes("$4.00 to $6.00")));
    assert.ok(offering.estimatedGrossProceedsCandidates.some((item) => item.value.includes("$60 million")));
    assert.ok(offering.estimatedNetProceedsCandidates.some((item) => item.value.includes("$54 million")));
    assert.ok(offering.underwritingDiscountCandidates.some((item) => item.value.includes("7.0%")));
    assert.ok(offering.overAllotmentCandidates.length > 0);
    assert.ok(offering.distributionMethodLanguage.some((item) => item.label === "firm_commitment"));
    assert.ok(offering.noPublicMarketLanguage.length > 0);
    assert.ok(offering.tickerCandidates.some((item) => item.value === "IPOX"));
    assert.ok(offering.exchangeCandidates.some((item) => item.value === "Nasdaq Capital Market"));
    assert.ok(offering.warnings.some((warning) => warning.includes("Assumed")));
  });

  it("preserves underwriting representative context for LLM analysis even without a clean section heading", () => {
    const filler = Array.from({ length: 120 }, (_, index) => `<p>Background paragraph ${index + 1} with ordinary issuer text.</p>`).join("\n");
    const parserOutput = parseS1F1Filing({
      formType: "S-1/A",
      filingText: `<html><body>
        <div><b>Prospectus Summary</b></div>
        <p>This is our initial public offering.</p>
        ${filler}
        <p>Morgan Stanley &amp; Co. LLC and J.P. Morgan Securities LLC are acting as representatives of the underwriters.</p>
        <p>Barclays Capital Inc. and BofA Securities, Inc. are also listed as underwriters.</p>
      </body></html>`,
    });

    const combinedBlocks = parserOutput.raw.cleanedSourceBlocks?.map((block) => block.text).join("\n") ?? "";

    assert.match(combinedBlocks, /Morgan Stanley/i);
    assert.match(combinedBlocks, /J\.P\. Morgan/i);
    assert.match(combinedBlocks, /representatives of the underwriters/i);
  });

  it("preserves source share-count basis rows in LLM source blocks", () => {
    const filler = Array.from({ length: 140 }, (_, index) => `<p>Background paragraph ${index + 1} with ordinary issuer text.</p>`).join("\n");
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Prospectus Summary</b></div>
        <p>This prospectus relates to the resale by selling stockholders of common stock.</p>
        ${filler}
        <table>
          <tr><td>Shares of Common Stock Outstanding Prior to this Offering</td><td>25,557,408 shares as of May 8, 2026</td></tr>
          <tr><td>Shares of Common Stock Outstanding assuming conversion of the Convertible Notes and exercise of all Warrants</td><td>43,782,033 shares</td></tr>
        </table>
      </body></html>`,
    });
    const llmInput = buildS1F1LlmSourceInput(parserOutput);
    const blocks = llmInput.cleaned_source_blocks as Array<Record<string, unknown>>;
    const basisBlock = blocks.find((block) => String(block.sectionKey || "").startsWith("share_count_basis_context"));

    assert.ok(basisBlock);
    assert.match(String(basisBlock.text), /Shares of Common Stock Outstanding Prior to this Offering/i);
    assert.match(String(basisBlock.text), /25,557,408 shares/i);
  });

  it("preserves source instrument underlying supply rows in LLM source blocks", () => {
    const filler = Array.from({ length: 140 }, (_, index) => `<p>Background paragraph ${index + 1} with ordinary issuer text.</p>`).join("\n");
    const parserOutput = parseS1F1Filing({
      formType: "F-1",
      filingText: `<html><body>
        <div><b>The Offering</b></div>
        <p>We are offering ordinary units and pre-funded units.</p>
        ${filler}
        <table>
          <tr><td>Up to 18,248,175 Class A Ordinary Shares Underlying the Pre-Funded Warrants</td></tr>
          <tr><td>Up to 95,802,920 Class A Ordinary Shares Underlying the Series A Warrants</td></tr>
          <tr><td>Up to 273,722,627 Class A Ordinary Shares Underlying the Series B Warrants, which contains a zero exercise price option</td></tr>
        </table>
      </body></html>`,
    });
    const llmInput = buildS1F1LlmSourceInput(parserOutput);
    const blocks = llmInput.cleaned_source_blocks as Array<Record<string, unknown>>;
    const supplyBlock = blocks.find(
      (block) => String(block.sectionKey || "").startsWith("instrument_supply_context") && String(block.text).includes("273,722,627"),
    );

    assert.ok(supplyBlock);
    assert.match(String(supplyBlock.text), /Class A Ordinary Shares Underlying the Series B Warrants/i);
    assert.match(String(supplyBlock.text), /zero exercise price/i);
  });

  it("preserves source reset and floor terms in LLM source blocks", () => {
    const filler = Array.from({ length: 140 }, (_, index) => `<p>Background paragraph ${index + 1} with ordinary issuer text.</p>`).join("\n");
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>The Offering</b></div>
        <p>We are offering common stock, pre-funded warrants, Series A Warrants and Series B Warrants.</p>
        ${filler}
        <p>The Series B Warrants will have an exercise price reset based on the Event Market Price, subject to a Floor Price of $0.31 per share.</p>
        <p>The exercise price may also be adjusted under anti-dilution provisions using the lowest VWAP during the reset period.</p>
      </body></html>`,
    });
    const llmInput = buildS1F1LlmSourceInput(parserOutput);
    const blocks = llmInput.cleaned_source_blocks as Array<Record<string, unknown>>;
    const resetFloorBlock = blocks.find((block) => String(block.sectionKey || "").startsWith("instrument_reset_floor_context"));

    assert.ok(resetFloorBlock);
    assert.match(String(resetFloorBlock.text), /exercise price reset/i);
    assert.match(String(resetFloorBlock.text), /Event Market Price/i);
    assert.match(String(resetFloorBlock.text), /Floor Price of \$0\.31/i);
    assert.match(String(resetFloorBlock.text), /anti-dilution/i);
    assert.match(String(resetFloorBlock.text), /lowest VWAP/i);
  });

  it("preserves source warrant exercise and term details in LLM source blocks", () => {
    const filler = Array.from({ length: 140 }, (_, index) => `<p>Background paragraph ${index + 1} with ordinary issuer text.</p>`).join("\n");
    const parserOutput = parseS1F1Filing({
      formType: "F-1",
      filingText: `<html><body>
        <div><b>The Offering</b></div>
        <p>We are offering ADSs and accompanying Common Warrants.</p>
        ${filler}
        <p>The placement agent warrants will have an exercise price equal to 125% of the public offering price per ADS and will expire five years from the commencement of sales.</p>
      </body></html>`,
    });
    const llmInput = buildS1F1LlmSourceInput(parserOutput);
    const blocks = llmInput.cleaned_source_blocks as Array<Record<string, unknown>>;
    const termBlock = blocks.find((block) => String(block.sectionKey || "").startsWith("instrument_term_context"));

    assert.ok(termBlock);
    assert.match(String(termBlock.text), /placement agent warrants/i);
    assert.match(String(termBlock.text), /exercise price equal to 125%/i);
    assert.match(String(termBlock.text), /expire five years/i);
  });

  it("preserves placement agent warrant term context when fee text appears earlier", () => {
    const filler = Array.from({ length: 160 }, (_, index) => `<p>Background paragraph ${index + 1} with ordinary issuer text.</p>`).join("\n");
    const parserOutput = parseS1F1Filing({
      formType: "F-1",
      filingText: `<html><body>
        <div><b>Cover Page</b></div>
        <p>We have agreed to issue to the Placement Agent warrants to purchase ADSs at an exercise price equal to 125% of the combined public offering price.</p>
        ${filler}
        <div><b>Plan of Distribution</b></div>
        <p>The Placement Agent Warrants will be immediately exercisable and will expire five years from the commencement of sales of this offering.</p>
      </body></html>`,
    });
    const llmInput = buildS1F1LlmSourceInput(parserOutput);
    const blocks = llmInput.cleaned_source_blocks as Array<Record<string, unknown>>;
    const placementTermBlock = blocks.find(
      (block) =>
        String(block.sectionKey || "").startsWith("placement_agent_warrant_term_context") &&
        /immediately exercisable/i.test(String(block.text)),
    );

    assert.ok(placementTermBlock);
    assert.match(String(placementTermBlock.text), /Placement Agent Warrants will be immediately exercisable/i);
    assert.match(String(placementTermBlock.text), /expire five years from the commencement of sales/i);
  });

  it("preserves current offering side-placement source excerpts in LLM source blocks", () => {
    const filler = Array.from({ length: 140 }, (_, index) => `<p>Background paragraph ${index + 1} with ordinary issuer text.</p>`).join("\n");
    const parserOutput = parseS1F1Filing({
      formType: "S-1/A",
      filingText: `<html><body>
        <div><b>The Offering</b></div>
        <p>We are offering common stock, pre-funded warrants, Series A Warrants and Series B Warrants.</p>
        ${filler}
        <p>In connection with the Waiver and VRT Prohibition, we will issue Series C Warrants and Series D Warrants to certain holders in a concurrent private placement.</p>
        <p>We will issue up to 46,118,464 shares of common stock upon exercise of the Series C Warrants and Series D Warrants.</p>
      </body></html>`,
    });
    const llmInput = buildS1F1LlmSourceInput(parserOutput);
    const blocks = llmInput.cleaned_source_blocks as Array<Record<string, unknown>>;
    const sidePlacementBlock = blocks.find((block) =>
      String(block.sectionKey || "").startsWith("current_offering_side_placement_source"),
    );

    assert.ok(sidePlacementBlock);
    assert.match(String(sidePlacementBlock.text), /Series C Warrants/i);
    assert.match(String(sidePlacementBlock.text), /Series D Warrants/i);
    assert.match(String(sidePlacementBlock.text), /46,118,464 shares/i);
  });

  it("uses ipo_listing for traditional and SPAC IPOs but not ordinary resale registrations", () => {
    const traditional = parseS1F1Filing({
      formType: "S-1",
      filingText:
        "This is our initial public offering of common stock. Prior to this offering, no public market currently exists. We intend to list on Nasdaq.",
    });
    const spac = parseS1F1Filing({
      formType: "S-1",
      filingText:
        "This is the initial public offering of units of a special purpose acquisition company and blank check company. We intend to list on Nasdaq.",
    });
    const resale = parseS1F1Filing({
      formType: "S-1",
      filingText:
        "This prospectus relates to the resale by the selling stockholders of 20,000,000 shares of common stock by an already-listed issuer.",
    });

    assert.equal(traditional.signals[0].event_type, "ipo_listing");
    assert.equal(traditional.facts.offering.ipo_kind, "traditional");
    assert.equal(spac.signals[0].event_type, "ipo_listing");
    assert.equal(spac.facts.offering.ipo_kind, "spac");
    assert.equal(resale.signals[0].event_type, "dilution_risk");
    assert.notEqual(resale.signals[0].event_type, "ipo_listing");
  });

  it("keeps resale, mixed offering, ADS ratio, warrants, units, and best-efforts language separate", () => {
    const parserOutput = parseS1F1Filing({
      formType: "F-1",
      filingText: `<html><body>
        <div><b>The Offering</b></div>
        <p>We are offering units consisting of ordinary shares and pre-funded warrants.</p>
        <p>We are also registering 3,000,000 ordinary shares for resale by the selling shareholders.</p>
        <p>Each American Depositary Share represents two ordinary shares.</p>
        <p>The offering is being conducted on a best efforts basis with a minimum offering and maximum offering amount.</p>
        <p>Our ADSs have been approved for listing on the Nasdaq Global Market under the symbol ADSX.</p>
      </body></html>`,
    });

    const offering = parserOutput.raw.sectionExtractions?.offeringTerms;

    assert.ok(offering?.offeringTypes.includes("primary"));
    assert.ok(offering?.offeringTypes.includes("resale"));
    assert.ok(offering?.securities.includes("ordinary shares"));
    assert.ok(offering?.securities.includes("ADS"));
    assert.ok(offering?.securities.includes("pre-funded warrants"));
    assert.ok(offering?.securities.includes("units"));
    assert.ok(offering?.adsRatioCandidates.some((item) => item.value.includes("represents two ordinary shares")));
    assert.ok(offering?.sellingStockholderLanguage.length);
    assert.ok(offering?.distributionMethodLanguage.some((item) => item.label === "best_efforts"));
    assert.ok(offering?.distributionMethodLanguage.some((item) => item.label === "minimum_offering"));
    assert.ok(offering?.distributionMethodLanguage.some((item) => item.label === "maximum_offering"));
    assert.ok(offering?.warnings.some((warning) => warning.includes("Mixed primary and resale")));
    assert.ok(offering?.warnings.some((warning) => warning.includes("warrants")));
  });

  it("leaves an assumed-only IPO price unresolved in core offering facts", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>The Offering</b></div>
        <p>We are offering 1,000,000 shares of common stock.</p>
        <p>The assumed initial public offering price is $8.00 per share.</p>
      </body></html>`,
    });

    assert.equal(parserOutput.facts.offering.price_low, null);
    assert.equal(parserOutput.facts.offering.price_high, null);
    assert.ok(parserOutput.raw.sectionExtractions?.offeringTerms.assumedOfferingPriceCandidates.length);
  });

  it("extracts Use of Proceeds categories, tables, placeholders, and conflicts without judgment", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Use of Proceeds</b></div>
        <p>We expect gross proceeds of $10 million and net proceeds of $8 million after offering expenses of $1 million.</p>
        <p>We intend to use proceeds for working capital, general corporate purposes, research and development, sales and marketing, capital expenditures and acquisitions.</p>
        <p>We may use proceeds for repayment of debt, repayment of convertible notes, bridge financing, and repayment to officers, directors and affiliates.</p>
        <p>We will not receive any proceeds from sales by the selling stockholders. Selling stockholders will receive proceeds from any resale.</p>
        <p>Placeholder amount: $[●].</p>
        <table>
          <tr><th>Use</th><th>Amount</th><th>Percent</th></tr>
          <tr><td>Working capital</td><td>$4 million</td><td>50%</td></tr>
          <tr><td>Debt repayment</td><td>$2 million</td><td>25%</td></tr>
          <tr><td>Total</td><td>$9 million</td><td>100%</td></tr>
        </table>
      </body></html>`,
    });

    const proceeds = parserOutput.raw.sectionExtractions?.useOfProceeds;
    const categoryLabels = new Set(proceeds?.useCategories.map((item) => item.label));

    assert.equal(proceeds?.sectionDetected, true);
    assert.ok(proceeds?.grossProceedsCandidates.some((item) => item.value.includes("$10 million")));
    assert.ok(proceeds?.netProceedsCandidates.some((item) => item.value.includes("$8 million")));
    assert.ok(proceeds?.offeringExpenseCandidates.some((item) => item.value.includes("$1 million")));
    assert.ok(categoryLabels.has("working_capital"));
    assert.ok(categoryLabels.has("general_corporate_purposes"));
    assert.ok(categoryLabels.has("research_and_development"));
    assert.ok(categoryLabels.has("sales_and_marketing"));
    assert.ok(categoryLabels.has("capital_expenditures"));
    assert.ok(categoryLabels.has("acquisitions"));
    assert.ok(categoryLabels.has("debt_repayment"));
    assert.ok(categoryLabels.has("related_party_repayment"));
    assert.ok(proceeds?.noIssuerProceedsLanguage.length);
    assert.ok(proceeds?.sellingHolderProceedsLanguage.length);
    assert.ok(proceeds?.placeholderCandidates.some((item) => item.isPlaceholder));
    assert.ok(proceeds?.tableRows.some((row) => row.text.includes("Working capital | $4 million | 50%")));
    assert.ok(proceeds?.warnings.some((warning) => warning.includes("conflict")));
  });

  it("extracts capitalization table rows, columns, units, conversions, splits, and F-1 ADS presentation", () => {
    const parserOutput = parseS1F1Filing({
      formType: "F-1",
      filingText: `<html><body>
        <div><b>Capitalization</b></div>
        <p>The table below is presented in thousands.</p>
        <p>It gives effect to the conversion of preferred stock and conversion of convertible notes and a 1-for-5 reverse share split.</p>
        <p>ADSs represent ordinary shares for presentation purposes.</p>
        <table>
          <tr><th></th><th>Actual</th><th>Pro forma</th><th>Pro forma as adjusted</th></tr>
          <tr><td>Cash and cash equivalents</td><td>$1,000</td><td>$1,500</td><td>$6,000</td></tr>
          <tr><td>Convertible notes</td><td>$2,000</td><td>-</td><td>-</td></tr>
          <tr><td>Preferred stock</td><td>$500</td><td>-</td><td>-</td></tr>
          <tr><td>Ordinary shares</td><td>$10</td><td>$12</td><td>$20</td></tr>
          <tr><td>Additional paid-in capital</td><td>$3,000</td><td>$5,000</td><td>$10,000</td></tr>
          <tr><td>Accumulated deficit</td><td>($7,000)</td><td>($7,000)</td><td>($7,000)</td></tr>
          <tr><td>Total stockholders' deficit</td><td>($1,000)</td><td>($500)</td><td>$3,000</td></tr>
          <tr><td>Total capitalization</td><td>$4,000</td><td>$5,000</td><td>$9,000</td></tr>
        </table>
      </body></html>`,
    });

    const cap = parserOutput.raw.sectionExtractions?.capitalization;

    assert.equal(cap?.sectionDetected, true);
    assert.ok(cap?.unitLabels.includes("in thousands"));
    assert.deepEqual(cap?.columnLabels, ["Actual", "Pro forma", "Pro forma as adjusted"]);
    assert.ok(cap?.rowCandidates.some((item) => item.value.includes("Cash and cash equivalents")));
    assert.ok(cap?.rowCandidates.some((item) => item.value.includes("Accumulated deficit | ($7,000)")));
    assert.ok(cap?.rowCandidates.some((item) => item.value.includes("Total stockholders' deficit")));
    assert.ok(cap?.conversionLanguage.some((item) => item.label === "preferred_stock_conversion"));
    assert.ok(cap?.conversionLanguage.some((item) => item.label === "convertible_note_conversion"));
    assert.ok(cap?.shareSplitLanguage.some((item) => item.value.includes("reverse share split")));
    assert.ok(cap?.adsPresentationLanguage.some((item) => item.value.includes("ADSs represent ordinary shares")));
  });

  it("extracts dilution values, ownership percentages, ADS ratio, placeholders, and keeps severity absent", () => {
    const parserOutput = parseS1F1Filing({
      formType: "F-1",
      filingText: `<html><body>
        <div><b>Dilution</b></div>
        <p>Each ADS represents two ordinary shares.</p>
        <p>Assumed initial public offering price is $5.00 per ADS.</p>
        <p>Historical net tangible book value was ($1.00) per share.</p>
        <p>Pro forma as adjusted net tangible book value will be $2.00 per ADS.</p>
        <p>The increase attributable to new investors is $3.00 per ADS.</p>
        <p>Dilution per ADS to new investors is $3.00.</p>
        <p>Existing stockholders will own 70% and new investors will own 30% after this offering.</p>
        <p>There will be 10,000,000 ordinary shares outstanding after this offering.</p>
        <table>
          <tr><th></th><th>Per ADS</th></tr>
          <tr><td>Assumed offering price per ADS</td><td>$5.00</td></tr>
          <tr><td>Historical net tangible book value per share</td><td>($1.00)</td></tr>
          <tr><td>Pro forma as adjusted net tangible book value per ADS</td><td>$2.00</td></tr>
          <tr><td>Dilution per ADS</td><td>$3.00</td></tr>
          <tr><td>Placeholder dilution</td><td>$[●]</td></tr>
        </table>
      </body></html>`,
    });

    const dilution = parserOutput.raw.sectionExtractions?.dilution;
    const serialized = JSON.stringify(dilution);

    assert.equal(dilution?.sectionDetected, true);
    assert.ok(dilution?.assumedOfferingPriceCandidates.some((item) => item.isAssumed));
    assert.ok(dilution?.netTangibleBookValueCandidates.some((item) => item.value.includes("Historical net tangible book value")));
    assert.ok(dilution?.netTangibleBookValueCandidates.some((item) => item.value.includes("Pro forma as adjusted net tangible book value")));
    assert.ok(dilution?.increaseAttributableCandidates.some((item) => item.value.includes("$3.00")));
    assert.ok(dilution?.dilutionPerShareCandidates.some((item) => item.value.includes("Dilution per ADS")));
    assert.ok(dilution?.ownershipPercentageCandidates.some((item) => item.value.includes("Existing stockholders")));
    assert.ok(dilution?.ownershipPercentageCandidates.some((item) => item.value.includes("new investors")));
    assert.ok(dilution?.shareCountCandidates.some((item) => item.value.includes("10,000,000 ordinary shares")));
    assert.ok(dilution?.adsRatioCandidates.some((item) => item.value.includes("represents two ordinary shares")));
    assert.ok(dilution?.placeholderCandidates.some((item) => item.isPlaceholder));
    assert.ok(dilution?.tableRows.some((row) => row.text.includes("Historical net tangible book value per share | ($1.00)")));
    assert.doesNotMatch(serialized, /severity|materiality|important/i);
  });
});

describe("S-1/F-1 MD&A and financial statement extraction", () => {
  it("extracts S-1 MD&A line items, liquidity phrases, and keeps missing sections non-fatal", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Management's Discussion and Analysis of Financial Condition and Results of Operations</b></div>
        <div><b>Results of Operations</b></div>
        <p>Revenue was $10.0 million for the year ended December 31, 2025 compared to $7.0 million for the year ended December 31, 2024.</p>
        <p>Net loss was $3.0 million for the year ended December 31, 2025.</p>
        <div><b>Liquidity and Capital Resources</b></div>
        <p>Cash and cash equivalents were $2.0 million and working capital deficit was $1.0 million.</p>
        <p>We need additional capital and may raise additional funds through debt financing, equity financing or bridge financing.</p>
        <p>We were in default under a covenant and received a waiver and forbearance.</p>
        <div><b>Cash Flows</b></div>
        <p>Net cash used in operating activities was $2.5 million.</p>
      </body></html>`,
    });

    const financial = parserOutput.raw.financialExtractions;
    const mdaLabels = new Set(financial?.mda.lineItems.map((item) => item.label));
    const liquidityLabels = new Set(financial?.liquidity.phrases.map((item) => item.label));

    assert.equal(financial?.mda.sectionDetected, true);
    assert.ok(financial?.mda.subsectionHeadings.includes("Results of Operations"));
    assert.ok(financial?.mda.subsectionHeadings.includes("Liquidity and Capital Resources"));
    assert.ok(mdaLabels.has("revenue"));
    assert.ok(mdaLabels.has("net_loss"));
    assert.ok(mdaLabels.has("cash_and_cash_equivalents"));
    assert.ok(mdaLabels.has("operating_cash_flow"));
    assert.ok(liquidityLabels.has("working_capital_deficit"));
    assert.ok(liquidityLabels.has("additional_capital"));
    assert.ok(liquidityLabels.has("debt_financing"));
    assert.ok(liquidityLabels.has("equity_financing"));
    assert.ok(liquidityLabels.has("bridge_financing"));
    assert.ok(liquidityLabels.has("default"));
    assert.ok(liquidityLabels.has("covenant_breach"));
    assert.ok(liquidityLabels.has("waiver"));
    assert.ok(liquidityLabels.has("forbearance"));
  });

  it("extracts F-1 OFR line items and preserves annual and interim period wording", () => {
    const parserOutput = parseS1F1Filing({
      formType: "F-1",
      filingText: `<html><body>
        <center><b>Operating and Financial Review and Prospects</b></center>
        <center><b>Operating Results</b></center>
        <p>Net revenue was RMB 20.0 million for the year ended December 31, 2025.</p>
        <p>Operating loss was RMB 4.0 million for the six months ended June 30, 2026.</p>
        <center><b>Capital Resources</b></center>
        <p>We require additional financing and had negative cash flows from operations.</p>
      </body></html>`,
    });

    const mda = parserOutput.raw.financialExtractions?.mda;
    const evidence = mda?.lineItems.map((item) => item.evidence).join("\n") ?? "";

    assert.equal(mda?.sectionDetected, true);
    assert.ok(mda?.lineItems.some((item) => item.label === "net_revenue"));
    assert.ok(mda?.lineItems.some((item) => item.label === "operating_loss"));
    assert.match(evidence, /year ended December 31, 2025/);
    assert.match(evidence, /six months ended June 30, 2026/);
    assert.ok(parserOutput.raw.financialExtractions?.liquidity.phrases.some((item) => item.label === "additional_capital"));
    assert.ok(parserOutput.raw.financialExtractions?.liquidity.phrases.some((item) => item.label === "negative_cash_flows"));
  });

  it("does not fail when MD&A is missing or a malformed table cannot align periods", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Index to Financial Statements</b></div>
        <table><tr><td>Consolidated Balance Sheets</td><td>Assets</td></tr><tr><td>Total assets</td><td>$1,000</td></tr></table>
      </body></html>`,
    });

    assert.equal(parserOutput.raw.financialExtractions?.mda.sectionDetected, false);
    assert.ok(parserOutput.raw.financialExtractions?.mda.warnings.some((warning) => warning.includes("MD&A")));
    assert.ok(parserOutput.raw.financialExtractions?.financialStatementTables[0]?.warnings.some((warning) => warning.includes("period columns")));
  });

  it("classifies financial statement tables and extracts key line items without promoting row labels to sections", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Index to Financial Statements</b></div>
        <table>
          <tr><th>Consolidated Balance Sheets (unaudited, in thousands, USD)</th><th>December 31, 2025</th><th>December 31, 2024</th></tr>
          <tr><td>Cash and cash equivalents</td><td>$1,000</td><td>$500</td></tr>
          <tr><td>Accounts receivable</td><td>$200</td><td>-</td></tr>
          <tr><td>Total assets</td><td>$5,000</td><td>$4,000</td></tr>
          <tr><td>Convertible notes</td><td>$2,000</td><td>$1,000</td></tr>
          <tr><td>Accumulated deficit</td><td>($7,000)</td><td>($4,000)</td></tr>
          <tr><td>Total stockholders' deficit</td><td>($1,000)</td><td>($500)</td></tr>
        </table>
        <table>
          <tr><th>Consolidated Statements of Operations</th><th>Year Ended December 31, 2025</th><th>Year Ended December 31, 2024</th></tr>
          <tr><td>Revenue</td><td>$10,000</td><td>$7,000</td></tr>
          <tr><td>Cost of revenue</td><td>$4,000</td><td>$3,000</td></tr>
          <tr><td>Gross profit</td><td>$6,000</td><td>$4,000</td></tr>
          <tr><td>Research and development</td><td>$2,000</td><td>$1,500</td></tr>
          <tr><td>Net loss</td><td>($3,000)</td><td>($2,000)</td></tr>
          <tr><td>Weighted average shares outstanding</td><td>10,000,000</td><td>9,000,000</td></tr>
        </table>
        <table>
          <tr><th>Consolidated Statements of Cash Flows</th><th>Year Ended December 31, 2025</th><th>Year Ended December 31, 2024</th></tr>
          <tr><td>Net cash used in operating activities</td><td>($2,500)</td><td>($1,500)</td></tr>
          <tr><td>Net cash provided by financing activities</td><td>$5,000</td><td>$2,000</td></tr>
          <tr><td>Capital expenditures</td><td>($300)</td><td>($200)</td></tr>
          <tr><td>Cash at end of period</td><td>$1,000</td><td>$500</td></tr>
        </table>
        <table>
          <tr><th>Consolidated Statements of Stockholders' Equity</th><th>Common Stock</th><th>Accumulated Deficit</th></tr>
          <tr><td>Balance at December 31, 2025</td><td>$10</td><td>($7,000)</td></tr>
        </table>
        <table>
          <tr><th>Use of Proceeds</th><th>Amount</th></tr>
          <tr><td>Working capital</td><td>$1,000</td></tr>
        </table>
      </body></html>`,
    });

    const financial = parserOutput.raw.financialExtractions;
    const classifications = new Set(financial?.financialStatementTables.map((table) => table.classification));
    const lineLabels = new Set(financial?.financialLineItems.map((item) => item.label));
    const sectionKeys = new Set((parserOutput.raw.sectionDetection?.sections ?? []).map((section) => section.key));

    assert.ok(classifications.has("balance_sheet"));
    assert.ok(classifications.has("statements_of_operations"));
    assert.ok(classifications.has("cash_flows"));
    assert.ok(classifications.has("stockholders_equity"));
    assert.equal(financial?.financialStatementTables.some((table) => /Use of Proceeds/.test(table.title ?? "")), false);
    assert.equal(financial?.financialStatementTables[0].auditedStatus, "unaudited");
    assert.equal(financial?.financialStatementTables[0].unit, "in thousands");
    assert.equal(financial?.financialStatementTables[0].currency, "USD");
    assert.ok(lineLabels.has("cash_and_cash_equivalents"));
    assert.ok(lineLabels.has("total_assets"));
    assert.ok(lineLabels.has("convertible_notes"));
    assert.ok(lineLabels.has("accumulated_deficit"));
    assert.ok(lineLabels.has("stockholders_deficit"));
    assert.ok(lineLabels.has("revenue"));
    assert.ok(lineLabels.has("cost_of_revenue"));
    assert.ok(lineLabels.has("gross_profit"));
    assert.ok(lineLabels.has("research_and_development"));
    assert.ok(lineLabels.has("net_loss"));
    assert.ok(lineLabels.has("weighted_average_shares"));
    assert.ok(lineLabels.has("operating_cash_flow"));
    assert.ok(lineLabels.has("financing_cash_flow"));
    assert.ok(lineLabels.has("capital_expenditures"));
    assert.ok(lineLabels.has("cash_end_period"));
    assert.equal(sectionKeys.has("cash_and_cash_equivalents"), false);
  });

  it("preserves same line item from MD&A and financial table as separate sources", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Management's Discussion and Analysis</b></div>
        <p>Revenue was $5.0 million for the year ended December 31, 2025.</p>
        <div><b>Index to Financial Statements</b></div>
        <table>
          <tr><th>Statements of Operations</th><th>Year Ended December 31, 2025</th></tr>
          <tr><td>Revenue</td><td>$5,000</td></tr>
        </table>
      </body></html>`,
    });

    const revenueItems = parserOutput.raw.financialExtractions?.financialLineItems.filter((item) => item.label === "revenue") ?? [];
    const mdaRevenue = parserOutput.raw.financialExtractions?.mda.lineItems.filter((item) => item.label === "revenue") ?? [];

    assert.ok(revenueItems.some((item) => item.source === "financial_statement_table"));
    assert.ok(mdaRevenue.some((item) => item.source === "mda_text"));
  });

  it("detects note topics in paragraph text and notes tables", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Index to Financial Statements</b></div>
        <p>Notes include revenue recognition, related party transactions, debt, convertible notes, warrants, commitments and contingencies, subsequent events, concentration of credit risk and material weakness.</p>
        <table>
          <tr><th>Notes to Financial Statements</th><th>Topic</th></tr>
          <tr><td>1</td><td>Stock-based compensation and leases</td></tr>
          <tr><td>2</td><td>Income taxes, fair value measurements, restatement and going concern</td></tr>
        </table>
      </body></html>`,
    });

    const topics = parserOutput.raw.financialExtractions?.notes.topics ?? [];
    const topicNames = new Set(topics.map((item) => item.topic));

    assert.ok(topicNames.has("revenue_recognition"));
    assert.ok(topicNames.has("related_party_transactions"));
    assert.ok(topicNames.has("debt"));
    assert.ok(topicNames.has("convertible_notes"));
    assert.ok(topicNames.has("warrants"));
    assert.ok(topicNames.has("commitments_and_contingencies"));
    assert.ok(topicNames.has("subsequent_events"));
    assert.ok(topicNames.has("concentration"));
    assert.ok(topicNames.has("material_weakness"));
    assert.ok(topicNames.has("stock_based_compensation"));
    assert.ok(topicNames.has("leases"));
    assert.ok(topicNames.has("income_taxes"));
    assert.ok(topicNames.has("fair_value_measurements"));
    assert.ok(topicNames.has("restatement"));
    assert.ok(topicNames.has("going_concern"));
    assert.ok(topics.some((item) => item.sourceLocation === "table"));
    assert.ok(topics.some((item) => item.sourceLocation === "paragraph"));
  });

  it("detects auditor report, accounting basis, currencies, and going-concern report language", () => {
    const parserOutput = parseS1F1Filing({
      formType: "F-1",
      filingText: `<html><body>
        <p>Report of Independent Registered Public Accounting Firm</p>
        <p>We are registered with the Public Company Accounting Oversight Board (PCAOB).</p>
        <p>The audited financial statements were prepared in accordance with U.S. GAAP and IFRS as issued by the IASB.</p>
        <p>The unaudited interim financial statements are presented for the six months ended June 30, 2026.</p>
        <p>The reporting currency is U.S. dollars and the functional currency is RMB.</p>
        <p>These translations are provided as a convenience translation.</p>
        <p>The explanatory paragraph refers to going concern and substantial doubt about our ability to continue.</p>
        <p>/s/ Example & Co. LLP</p>
        <p>March 15, 2026</p>
      </body></html>`,
    });

    const auditor = parserOutput.raw.financialExtractions?.auditorAndAccounting;
    const basisLabels = new Set(auditor?.accountingBasisPhrases.map((item) => item.label));

    assert.ok(auditor?.auditorReportTitleCandidates.length);
    assert.ok(auditor?.auditorNameCandidates.some((item) => item.value.includes("Example & Co. LLP")));
    assert.ok(auditor?.auditOpinionDateCandidates.some((item) => item.value === "March 15, 2026"));
    assert.ok(auditor?.pcaobPhrases.length);
    assert.ok(auditor?.goingConcernParagraphs.length);
    assert.ok(auditor?.auditedFinancialStatementPhrases.length);
    assert.ok(auditor?.unauditedInterimPhrases.length);
    assert.ok(basisLabels.has("us_gaap"));
    assert.ok(basisLabels.has("ifrs_iasb"));
    assert.ok(auditor?.reportingCurrencyCandidates.length);
    assert.ok(auditor?.functionalCurrencyCandidates.length);
    assert.ok(auditor?.accountingBasisPhrases.some((item) => item.label === "convenience_translation"));
    assert.ok(auditor?.warnings.some((warning) => warning.includes("IFRS and U.S. GAAP")));
  });

  it("preserves going-concern phrase context across auditor report, MD&A, and Risk Factors", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Risk Factors</b></div>
        <p><b>We may be unable to continue as a going concern.</b></p>
        <p>Risk factor body text.</p>
        <div><b>Management's Discussion and Analysis</b></div>
        <p>Management's plans include raise additional funds because there is substantial doubt about our ability to continue as a going concern.</p>
        <p>Report of Independent Registered Public Accounting Firm</p>
        <p>The auditor report includes a going concern explanatory paragraph.</p>
      </body></html>`,
    });

    const phrases = parserOutput.raw.financialExtractions?.liquidity.phrases ?? [];
    const sections = new Set(phrases.map((item) => item.sectionKey));

    assert.ok(sections.has("risk_factors"));
    assert.ok(sections.has("mda"));
    assert.ok(parserOutput.raw.financialExtractions?.liquidity.warnings.some((warning) => warning.includes("multiple sections")));
  });
});

describe("S-1/F-1 governance and holder extraction", () => {
  it("extracts related-party transaction evidence and preserves conflicting negative disclosure", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Use of Proceeds</b></div>
        <p>We intend to use $250,000 of proceeds for repayment of a note to an officer and affiliate.</p>
        <div><b>Certain Relationships and Related Party Transactions</b></div>
        <p>There have been no transactions with related persons required to be disclosed.</p>
        <table>
          <tr><th>Name</th><th>Relationship</th><th>Transaction</th><th>Amount</th><th>Terms</th></tr>
          <tr><td>Jane Doe</td><td>Chief Executive Officer and director</td><td>Loan and promissory note</td><td>$500,000</td><td>8% interest, matures December 31, 2026, outstanding balance $400,000</td></tr>
        </table>
        <p>Our related party transaction policy requires audit committee review.</p>
        <div><b>Index to Financial Statements</b></div>
        <p>Notes include related party transactions and a convertible note issued to an affiliate.</p>
      </body></html>`,
    });

    const related = parserOutput.raw.governanceExtractions?.relatedParty;
    const labels = new Set(related?.transactionTypeCandidates.map((item) => item.label));
    const hintLabels = new Set(parserOutput.raw.governanceExtractions?.crossSectionHints.map((item) => item.label));

    assert.equal(related?.sectionDetected, true);
    assert.ok(related?.negativeDisclosure.length);
    assert.ok(labels.has("loan"));
    assert.ok(labels.has("promissory_note"));
    assert.ok(labels.has("convertible_note"));
    assert.ok(related?.amountCandidates.some((item) => item.value === "$500,000"));
    assert.ok(related?.interestRateCandidates.some((item) => item.value === "8%"));
    assert.ok(related?.maturityCandidates.length);
    assert.ok(related?.outstandingBalanceCandidates.length);
    assert.ok(related?.policyLanguage.length);
    assert.ok(hintLabels.has("related_party_negative_disclosure_conflict"));
    assert.ok(hintLabels.has("use_of_proceeds_related_party_repayment"));
    assert.ok(related?.warnings.some((warning) => warning.includes("negative related-party disclosure")));
  });

  it("extracts legal proceeding evidence without treating Legal Matters counsel text as litigation", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Legal Proceedings</b></div>
        <p>We are not a party to any material legal proceedings.</p>
        <div><b>Commitments and Contingencies</b></div>
        <p>On March 1, 2026, Acme Corp filed a lawsuit against us seeking $2.0 million. We are subject to a government investigation, arbitration and settlement discussions.</p>
        <div><b>Legal Matters</b></div>
        <p>The validity of the securities offered hereby will be passed upon by Example Law LLP.</p>
      </body></html>`,
    });

    const legal = parserOutput.raw.governanceExtractions?.legalProceedings;
    const labels = new Set(legal?.proceedingCandidates.map((item) => item.label));

    assert.equal(legal?.sectionDetected, true);
    assert.ok(legal?.negativeDisclosure.length);
    assert.ok(labels.has("lawsuit"));
    assert.ok(labels.has("government_investigation"));
    assert.ok(labels.has("arbitration"));
    assert.ok(labels.has("settlement"));
    assert.ok(legal?.amountCandidates.some((item) => item.value === "$2.0 million"));
    assert.ok(legal?.dateCandidates.some((item) => item.value === "March 1, 2026"));
    assert.ok(legal?.partyCandidates.some((item) => item.value === "Acme Corp"));
    assert.ok(legal?.warnings.some((warning) => warning.includes("negative legal proceedings disclosure")));
    assert.equal(legal?.proceedingCandidates.some((item) => /validity of the securities/i.test(item.evidence)), false);
  });

  it("preserves principal stockholder ownership rows, footnotes, and control hints", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Principal Stockholders</b></div>
        <p>We may be a controlled company following this offering due to dual-class voting power.</p>
        <table>
          <tr><th>Name of Beneficial Owner</th><th>Class A Shares</th><th>Before Offering</th><th>After Offering</th><th>Voting Power</th></tr>
          <tr><td>Founder A (1)</td><td>1,000,000</td><td>20%</td><td>15%</td><td>40%</td></tr>
          <tr><td>Directors and executive officers as a group</td><td>1,500,000</td><td>30%</td><td>22%</td><td>55%</td></tr>
          <tr><td>5% Stockholder B</td><td>500,000 ADSs</td><td>10%</td><td>8%</td><td>10%</td></tr>
        </table>
        <p>(1) Includes options exercisable within 60 days and warrants exercisable within 60 days. Lock-up agreements restrict transfers.</p>
      </body></html>`,
    });

    const ownership = parserOutput.raw.governanceExtractions?.ownership;
    const languageLabels = new Set(ownership?.ownershipLanguage.map((item) => item.label));

    assert.equal(ownership?.sectionDetected, true);
    assert.equal(ownership?.ownerRows.length, 3);
    assert.ok(ownership?.columnLabels.some((label) => /Before Offering/i.test(label)));
    assert.ok(languageLabels.has("directors_officers_group"));
    assert.ok(languageLabels.has("five_percent_holder"));
    assert.ok(languageLabels.has("voting_power"));
    assert.ok(languageLabels.has("class_a_b"));
    assert.ok(languageLabels.has("ads_ownership"));
    assert.ok(languageLabels.has("options_60_days"));
    assert.ok(languageLabels.has("warrants_60_days"));
    assert.ok(ownership?.footnotes.length);
    assert.ok(ownership?.controlledCompanyHints.length);
    assert.ok(ownership?.dualClassVotingHints.length);
    assert.equal((parserOutput.raw.sectionDetection?.sections ?? []).some((section) => section.title === "Founder A (1)"), false);
  });

  it("extracts selling-holder table evidence and mixed primary/resale hints", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Prospectus Summary</b></div>
        <p>We are offering 1,000,000 shares and the selling stockholders are offering 500,000 shares. This is a primary and resale offering.</p>
        <div><b>Use of Proceeds</b></div>
        <p>We will not receive any proceeds from the sale of shares by selling stockholders. Selling stockholders will receive the proceeds.</p>
        <div><b>Selling Stockholders</b></div>
        <p>The shares were issued in a private placement with registration rights. Certain holders are affiliates or broker-dealers and may be deemed underwriters. Resale warrants and pre-funded warrants are being registered.</p>
        <table>
          <tr><th>Selling Stockholder</th><th>Relationship</th><th>Shares Owned Before Offering</th><th>Shares Offered</th><th>Shares Owned After Offering</th></tr>
          <tr><td>Investor A</td><td>Affiliate</td><td>1,000,000</td><td>500,000</td><td>500,000</td></tr>
        </table>
      </body></html>`,
    });

    const selling = parserOutput.raw.governanceExtractions?.sellingHolders;
    const securityLabels = new Set(selling?.securityTypeCandidates.map((item) => item.label));

    assert.equal(selling?.sectionDetected, true);
    assert.equal(selling?.holderRows.length, 1);
    assert.ok(selling?.relationshipCandidates.length);
    assert.ok(selling?.affiliateCandidates.length);
    assert.ok(selling?.brokerDealerCandidates.length);
    assert.ok(selling?.underwriterStatusCandidates.length);
    assert.ok(selling?.resaleLanguage.length);
    assert.ok(selling?.registrationRightsLanguage.length);
    assert.ok(selling?.privatePlacementLanguage.length);
    assert.ok(securityLabels.has("warrants"));
    assert.ok(securityLabels.has("pre_funded_warrants"));
    assert.ok(selling?.proceedsLanguage.some((item) => item.label === "no_issuer_proceeds"));
    assert.ok(selling?.proceedsLanguage.some((item) => item.label === "selling_holder_proceeds"));
    assert.ok(selling?.warnings.some((warning) => warning.includes("primary and resale")));
  });

  it("extracts management rows, committees, compensation presence, and related-party overlap hints", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Management</b></div>
        <table>
          <tr><th>Name</th><th>Age</th><th>Position</th></tr>
          <tr><td>Jane Doe</td><td>45</td><td>Chief Executive Officer and Director</td></tr>
          <tr><td>John Smith</td><td>50</td><td>Chief Financial Officer</td></tr>
        </table>
        <p>Jane Doe is an independent director and serves on the audit committee, compensation committee, and nominating and governance committee.</p>
        <p>There are no family relationships among our directors and executive officers.</p>
        <p>We entered into an employment agreement with Jane Doe.</p>
        <div><b>Executive Compensation</b></div>
        <table><tr><th>Summary Compensation Table</th><th>Salary</th><th>Option Awards</th><th>Stock Awards</th></tr><tr><td>Jane Doe</td><td>$200,000</td><td>$50,000</td><td>$25,000</td></tr></table>
        <div><b>Related Party Transactions</b></div>
        <p>Jane Doe provided consulting services to us for $75,000.</p>
      </body></html>`,
    });

    const management = parserOutput.raw.governanceExtractions?.management;
    const committeeLabels = new Set(management?.committeeLanguage.map((item) => item.label));

    assert.equal(management?.sectionDetected, true);
    assert.equal(management?.personRows.length, 2);
    assert.ok(committeeLabels.has("audit_committee"));
    assert.ok(committeeLabels.has("compensation_committee"));
    assert.ok(committeeLabels.has("nominating_governance_committee"));
    assert.ok(management?.independentDirectorLanguage.length);
    assert.ok(management?.familyRelationshipLanguage.length);
    assert.equal(management?.compensationTablePresence, true);
    assert.ok(management?.employmentAgreementLanguage.length);
    assert.ok(management?.relatedPartyOverlapHints.some((item) => item.value === "Jane Doe"));
    assert.ok(parserOutput.raw.governanceExtractions?.crossSectionHints.some((hint) => hint.label === "management_related_party_name_overlap"));
  });

  it("keeps risk-factor-only litigation language as a hint instead of a confirmed proceeding", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Risk Factors</b></div>
        <p><b>Litigation or investigations could harm our business.</b></p>
        <p>We may become subject to lawsuits, claims, regulatory proceedings or investigations in the future.</p>
        <div><b>Business</b></div>
        <p>We sell software.</p>
      </body></html>`,
    });

    const legal = parserOutput.raw.governanceExtractions?.legalProceedings;

    assert.equal(legal?.sectionDetected, false);
    assert.equal(legal?.proceedingCandidates.length, 0);
    assert.ok(legal?.riskFactorOnlyHints.length);
    assert.ok(legal?.warnings.some((warning) => warning.includes("Risk Factors")));
    assert.ok(parserOutput.raw.governanceExtractions?.crossSectionHints.some((hint) => hint.label === "litigation_terms_risk_factors_only"));
  });
});

describe("S-1/F-1 exhibit and agreement extraction", () => {
  it("extracts exhibit index rows, status flags, families, footnotes, and keeps rows out of section headings", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Exhibit Index</b></div>
        <table>
          <tr><th>Exhibit No.</th><th>Description</th><th>File</th></tr>
          <tr><td>1.1</td><td>Underwriting Agreement filed herewith</td><td>ex1-1.htm</td></tr>
          <tr><td>5.1</td><td>Opinion of Example Law LLP incorporated by reference (1)</td><td>ex5-1.htm</td></tr>
          <tr><td>10.1</td><td>Loan Agreement to be filed by amendment; schedules have been omitted</td><td>ex10-1.htm</td></tr>
          <tr><td>23.1</td><td>Consent of independent registered public accounting firm filed previously</td><td>ex23-1.htm</td></tr>
          <tr><td>107</td><td>Filing Fee Table filed herewith</td><td>ex107.htm</td></tr>
        </table>
        <p>(1) Previously filed with the registration statement.</p>
      </body></html>`,
    });

    const exhibitIndex = parserOutput.raw.exhibitExtractions?.exhibitIndex;
    const sectionTitles = new Set((parserOutput.raw.sectionDetection?.sections ?? []).map((section) => section.title));

    assert.equal(exhibitIndex?.sectionDetected, true);
    assert.equal(exhibitIndex?.items.length, 5);
    assert.equal(exhibitIndex?.familyCounts.underwriting_distribution, 1);
    assert.equal(exhibitIndex?.familyCounts.material_contract, 1);
    assert.equal(exhibitIndex?.familyCounts.filing_fee, 1);
    assert.ok(exhibitIndex?.items.some((item) => item.statusFlags.includes("filed_herewith") && item.filename === "ex1-1.htm"));
    assert.ok(exhibitIndex?.items.some((item) => item.statusFlags.includes("incorporated_by_reference")));
    assert.ok(exhibitIndex?.items.some((item) => item.statusFlags.includes("to_be_filed_by_amendment")));
    assert.ok(exhibitIndex?.items.some((item) => item.statusFlags.includes("redacted_or_omitted")));
    assert.ok(exhibitIndex?.footnotes.length);
    assert.equal(sectionTitles.has("1.1"), false);
  });

  it("does not fail when the exhibit index is missing", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body><div><b>Business</b></div><p>We sell software.</p></body></html>`,
    });

    assert.equal(parserOutput.raw.exhibitExtractions?.exhibitIndex.sectionDetected, false);
    assert.deepEqual(parserOutput.raw.exhibitExtractions?.exhibitIndex.items, []);
  });

  it("classifies attached exhibit inventory and preserves attachment/index mismatch hints", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<SEC-DOCUMENT>
        <DOCUMENT><TYPE>S-1</TYPE><SEQUENCE>1</SEQUENCE><FILENAME>s1.htm</FILENAME><DESCRIPTION>Main S-1</DESCRIPTION><TEXT>
          <html><body><div><b>Exhibit Index</b></div><table>
          <tr><th>Exhibit No.</th><th>Description</th><th>File</th></tr>
          <tr><td>5.1</td><td>Legal opinion filed herewith</td><td>ex5-1.htm</td></tr>
          <tr><td>23.1</td><td>Consent filed herewith</td><td>ex23-1.htm</td></tr>
          </table></body></html>
        </TEXT></DOCUMENT>
        <DOCUMENT><TYPE>EX-5.1</TYPE><SEQUENCE>2</SEQUENCE><FILENAME>ex5-1.htm</FILENAME><DESCRIPTION>Legal Opinion</DESCRIPTION><TEXT>Legal opinion of Example Law LLP regarding validity of the securities. May 1, 2026</TEXT></DOCUMENT>
        <DOCUMENT><TYPE>EX-23.1</TYPE><SEQUENCE>3</SEQUENCE><FILENAME>ex23-1.htm</FILENAME><DESCRIPTION>Auditor Consent</DESCRIPTION><TEXT>Consent of Independent Registered Public Accounting Firm Example & Co. LLP to use audit report.</TEXT></DOCUMENT>
        <DOCUMENT><TYPE>EX-1.1</TYPE><SEQUENCE>4</SEQUENCE><FILENAME>ex1-1.htm</FILENAME><DESCRIPTION>Legal Opinion mismatch</DESCRIPTION><TEXT>Opinion of counsel regarding validity of the securities.</TEXT></DOCUMENT>
      </SEC-DOCUMENT>`,
      attachments: [
        { name: "underwriting-agreement.htm", description: "Underwriting Agreement", text: "Firm commitment underwriting agreement." },
        { name: "lock-up.htm", description: "Lock-Up Agreement", text: "Lock-up agreement with directors and officers." },
        { name: "registration-rights.htm", description: "Registration Rights Agreement", text: "Demand registration rights and piggyback registration rights." },
        { name: "warrant-agreement.htm", description: "Warrant Agreement", text: "Warrant agreement with exercise price." },
        { name: "deposit-agreement.htm", description: "Deposit Agreement", text: "Deposit agreement for American Depositary Shares." },
        { name: "ex107.htm", description: "EX-107 Filing Fee Table", text: "Filing Fee Table." },
      ],
    });

    const attached = parserOutput.raw.exhibitExtractions?.attachedExhibits ?? [];
    const kinds = new Set(attached.map((item) => item.documentKind));
    const hintLabels = new Set(parserOutput.raw.exhibitExtractions?.consistencyHints.map((hint) => hint.label));

    assert.ok(kinds.has("legal_opinion"));
    assert.ok(kinds.has("auditor_consent"));
    assert.ok(kinds.has("underwriting_agreement"));
    assert.ok(kinds.has("lock_up_agreement"));
    assert.ok(kinds.has("registration_rights_agreement"));
    assert.ok(kinds.has("warrant_agreement"));
    assert.ok(kinds.has("deposit_agreement"));
    assert.ok(kinds.has("filing_fee_exhibit"));
    assert.ok(hintLabels.has("attachment_without_matching_exhibit_index_row"));
    assert.ok(hintLabels.has("exhibit_title_document_type_disagreement"));
  });

  it("extracts first-pass material contract terms without merging separate contracts", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body><div><b>Business</b></div><p>We entered into a license agreement with royalty payments.</p></body></html>`,
      attachments: [
        {
          name: "convertible-note.htm",
          description: "Convertible Note Agreement",
          text: "Convertible Note Agreement dated March 1, 2026 by and between Issuer Inc. and Investor A. The principal amount is $1,000,000 with 8% interest and matures December 31, 2026. The conversion price is $2.00. Default and covenant provisions apply.",
        },
        {
          name: "warrant.htm",
          description: "Warrant Agreement",
          text: "Warrant Agreement dated March 2, 2026 by and between Issuer Inc. and Investor B. The exercise price is $3.00 for 500,000 warrants and 500,000 shares.",
        },
        {
          name: "lease.htm",
          description: "Lease Agreement",
          text: "Lease Agreement between Issuer Inc. and an affiliate entity controlled by an officer. Certain information has been omitted.",
        },
        {
          name: "employment.htm",
          description: "Employment Agreement",
          text: "Employment Agreement with Jane Doe, Chief Executive Officer.",
        },
      ],
    });

    const contracts = parserOutput.raw.exhibitExtractions?.materialContracts;
    const typeLabels = new Set(contracts?.contractTypeCandidates.map((item) => item.label));
    const termLabels = new Set(contracts?.termCandidates.map((item) => item.label));
    const sourceDocuments = new Set(contracts?.termCandidates.map((item) => item.sourceDocument));

    assert.ok(typeLabels.has("convertible_note"));
    assert.ok(typeLabels.has("warrant_agreement"));
    assert.ok(typeLabels.has("lease_agreement"));
    assert.ok(typeLabels.has("employment_agreement"));
    assert.ok(termLabels.has("principal_amount"));
    assert.ok(termLabels.has("interest_rate"));
    assert.ok(termLabels.has("maturity_date"));
    assert.ok(termLabels.has("conversion_price"));
    assert.ok(termLabels.has("exercise_price"));
    assert.ok(termLabels.has("default"));
    assert.ok(termLabels.has("covenant"));
    assert.ok(contracts?.partyCandidates.some((item) => /affiliate|officer/i.test(item.value)));
    assert.ok(contracts?.redactionCandidates.length);
    assert.ok(sourceDocuments.has("convertible-note.htm"));
    assert.ok(sourceDocuments.has("warrant.htm"));
  });

  it("extracts underwriting, placement, lock-up, and registration-rights evidence from sections and exhibits", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Plan of Distribution</b></div>
        <p>Example Securities LLC will act as placement agent on a best efforts basis. We will pay a 7.0% commission, a non-accountable expense allowance, reimbursement, a tail fee and representative warrants. The agreement includes a right of first refusal, FINRA language, indemnification, termination, stabilization and lock-up provisions.</p>
        <div><b>Shares Eligible for Future Sale</b></div>
        <p>Our officers, directors and stockholders are subject to a 180 days lock-up. The underwriter may consent to release shares.</p>
        <div><b>Selling Stockholders</b></div>
        <p>The selling holders have demand registration rights, piggyback registration rights, shelf registration rights, resale registration rights and liquidated damages provisions from a private placement registration agreement.</p>
      </body></html>`,
      attachments: [
        { name: "placement.htm", description: "Placement Agency Agreement", text: "Best efforts placement agent agreement with Example Securities LLC. Over-allotment option is not applicable." },
        { name: "lockup.htm", description: "Lock-Up Agreement", text: "180 days lock-up agreement for directors and officers. Underwriter consent release language applies." },
        { name: "registration-rights.htm", description: "Registration Rights Agreement", text: "Demand registration rights, piggyback registration rights, shelf registration rights, resale registration and liquidated damages." },
      ],
    });

    const underwriting = parserOutput.raw.exhibitExtractions?.underwritingAgreements;
    const lockup = parserOutput.raw.exhibitExtractions?.lockupRegistrationRights;
    const feeLabels = new Set(underwriting?.feeCandidates.map((item) => item.label));
    const termLabels = new Set(underwriting?.termCandidates.map((item) => item.label));
    const registrationLabels = new Set(lockup?.registrationRightsLanguage.map((item) => item.label));

    assert.equal(underwriting?.sectionDetected, true);
    assert.ok(underwriting?.agentCandidates.length);
    assert.ok(underwriting?.methodLanguage.some((item) => item.label === "best_efforts"));
    assert.ok(feeLabels.has("commission"));
    assert.ok(feeLabels.has("expense_allowance"));
    assert.ok(feeLabels.has("tail_fee"));
    assert.ok(underwriting?.warrantCandidates.length);
    assert.ok(termLabels.has("right_of_first_refusal"));
    assert.ok(termLabels.has("finra"));
    assert.ok(termLabels.has("indemnification"));
    assert.ok(termLabels.has("termination"));
    assert.ok(lockup?.lockupLanguage.some((item) => item.label === "lockup_period"));
    assert.ok(lockup?.lockupLanguage.some((item) => item.label === "underwriter_release"));
    assert.ok(registrationLabels.has("demand_registration_rights"));
    assert.ok(registrationLabels.has("piggyback_registration_rights"));
    assert.ok(registrationLabels.has("shelf_registration_rights"));
    assert.ok(registrationLabels.has("resale_registration"));
    assert.ok(registrationLabels.has("liquidated_damages"));
  });

  it("extracts F-1 ADS and deposit agreement evidence and hints when deposit agreement is missing", () => {
    const withDeposit = parseS1F1Filing({
      formType: "F-1",
      filingText: `<html><body>
        <div><b>Description of American Depositary Shares</b></div>
        <p>Each ADS represents two ordinary shares. The depositary will be Deutsche Bank Trust Company Americas. ADS fees apply. Holders have voting rights, dividend distribution rights, withdrawal and cancellation rights.</p>
        <div><b>Exchange Controls</b></div><p>Exchange controls may apply.</p>
        <div><b>Enforceability of Civil Liabilities</b></div><p>Civil liabilities may be difficult to enforce.</p>
        <div><b>Home Country Practice</b></div><p>Home country practice exemptions apply.</p>
        <div><b>Foreign Private Issuer Status</b></div><p>We are a foreign private issuer.</p>
      </body></html>`,
      attachments: [{ name: "deposit-agreement.htm", description: "Deposit Agreement", text: "Deposit agreement for American Depositary Shares." }],
    });
    const withoutDeposit = parseS1F1Filing({
      formType: "F-1",
      filingText: `<html><body><div><b>Description of American Depositary Shares</b></div><p>Each ADS represents one ordinary share.</p></body></html>`,
    });

    const ads = withDeposit.raw.exhibitExtractions?.adsDepositAgreement;
    const rightLabels = new Set(ads?.rightsLanguage.map((item) => item.label));
    const missingHintLabels = new Set(withoutDeposit.raw.exhibitExtractions?.consistencyHints.map((hint) => hint.label));

    assert.equal(ads?.adsDetected, true);
    assert.ok(ads?.depositAgreementDocuments.length);
    assert.ok(ads?.adsRatioCandidates.some((item) => /two ordinary shares/i.test(item.value)));
    assert.ok(ads?.depositaryCandidates.length);
    assert.ok(ads?.feeCandidates.length);
    assert.ok(rightLabels.has("voting_rights"));
    assert.ok(rightLabels.has("dividend_distribution"));
    assert.ok(rightLabels.has("withdrawal_cancellation"));
    assert.ok(rightLabels.has("exchange_controls"));
    assert.ok(rightLabels.has("civil_liabilities"));
    assert.ok(rightLabels.has("home_country_practice"));
    assert.ok(rightLabels.has("foreign_private_issuer"));
    assert.ok(missingHintLabels.has("ads_without_deposit_agreement_hint"));
  });

  it("extracts legal opinion, consent, experts, and filing fee exhibit evidence", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: `<html><body>
        <div><b>Legal Matters</b></div>
        <p>The validity of the securities will be passed upon by Example Law LLP.</p>
        <div><b>Experts</b></div>
        <p>The financial statements were audited by Example & Co. LLP, independent registered public accounting firm.</p>
        <div><b>Exhibit Index</b></div>
        <table><tr><th>Exhibit No.</th><th>Description</th><th>File</th></tr><tr><td>23.2</td><td>Referenced consent file filed herewith</td><td>missing-consent.htm</td></tr></table>
        <table>
          <tr><th>Calculation of Filing Fee Table</th><th>Security Type</th><th>Amount Registered</th><th>Proposed Maximum Aggregate Offering Price</th><th>Fee Rate</th><th>Registration Fee</th></tr>
          <tr><td>Fees to be Paid</td><td>Common stock</td><td>1,000,000 shares</td><td>$10,000,000</td><td>0.00014760 per $1</td><td>$1,476</td></tr>
          <tr><td>Total Fee Due</td><td colspan="5">$1,476</td></tr>
          <tr><td colspan="6">(1) Offset and carry forward amounts are not used.</td></tr>
        </table>
      </body></html>`,
      attachments: [
        { name: "ex5-1.htm", description: "Legal Opinion", text: "Legal opinion of Example Law LLP regarding validity of the securities. /s/ Example Law LLP May 1, 2026" },
        { name: "ex8-1.htm", description: "Tax Opinion", text: "Tax opinion regarding material tax consequences." },
        { name: "ex23-1.htm", description: "Auditor Consent", text: "Example & Co. LLP consent to use audit report as experts. /s/ Example & Co. LLP May 2, 2026" },
        { name: "ex107.htm", description: "EX-107 Filing Fee Table", text: "Filing Fee Table" },
      ],
    });

    const legal = parserOutput.raw.exhibitExtractions?.legalOpinionsConsents;
    const fee = parserOutput.raw.exhibitExtractions?.filingFeeExhibits;
    const feeLabels = new Set(fee?.feeLineCandidates.map((item) => item.label));
    const hintLabels = new Set(parserOutput.raw.exhibitExtractions?.consistencyHints.map((hint) => hint.label));

    assert.ok(legal?.legalOpinionDocuments.length);
    assert.ok(legal?.taxOpinionDocuments.length);
    assert.ok(legal?.consentDocuments.length);
    assert.ok(legal?.lawFirmCandidates.some((item) => /Example Law LLP/.test(item.value)));
    assert.ok(legal?.auditorFirmCandidates.some((item) => /Example & Co. LLP/.test(item.value)));
    assert.ok(legal?.opinionLanguage.some((item) => item.label === "validity_opinion"));
    assert.ok(legal?.opinionLanguage.some((item) => item.label === "tax_opinion"));
    assert.ok(legal?.consentLanguage.some((item) => item.label === "consent_to_use_audit_report"));
    assert.ok(legal?.consentLanguage.some((item) => item.label === "expert_consent"));
    assert.ok(legal?.datedSignatureCandidates.length);
    assert.equal(fee?.sectionDetected, true);
    assert.ok(fee?.tableRows.length);
    assert.ok(feeLabels.has("security_type"));
    assert.ok(feeLabels.has("amount_registered"));
    assert.ok(feeLabels.has("maximum_aggregate_offering_price"));
    assert.ok(feeLabels.has("fee_rate"));
    assert.ok(feeLabels.has("registration_fee"));
    assert.ok(feeLabels.has("carry_forward_offset"));
    assert.ok(feeLabels.has("total_fee_due"));
    assert.ok(fee?.footnotes.length);
    assert.ok(hintLabels.has("exhibit_index_row_without_matching_attachment"));
  });
});
