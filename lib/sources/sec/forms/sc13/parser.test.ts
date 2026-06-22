import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "./testExpect";
import { parseSc13Filing } from "./parser";
import { APPROVED_EVENT_TYPES, type Sc13Fixture } from "./types";

const roomDir = dirname(fileURLToPath(import.meta.url));
const fixtureNames = [
  "passive-13g",
  "activist-13d",
  "material-13da",
  "routine-13ga",
  "market-context-13d",
  "institutional-base-13g",
  "exit-13ga",
  "sales-plan-13da",
  "state-street-old-html-13ga",
  "blackrock-nos-cover-13da",
  "citadel-see-row-13g",
  "viking-spaced-cover-13ga",
  "icahn-signature-only-13da",
  "initial-13d-items-1-7",
  "variation-13da-item4-heading",
  "initial-13g-items-1-10",
  "split-heading-13g",
  "uncertain-title-boundary-13d",
  "multi-reporting-13d-cover",
  "ownership-conflict-13da",
  "multi-reporting-star-13g",
  "malformed-cover-13ga",
  "table-ish-cover-values-13d",
  "exhibits-simple-13d",
  "exhibits-amendment-13da",
  "exhibits-empty-missing-13d",
  "item7-13g-not-exhibits",
  "rendered-xml-13d",
  "rendered-xml-13g",
  "html-table-13d",
  "full-submission-13d",
  "malformed-markup-13d",
  "ownership-only-13da",
  "substantive-item6-13g",
  "litigation-13d",
];

function loadFixture(name: string): Sc13Fixture {
  return JSON.parse(readFileSync(join(roomDir, "fixtures", `${name}.json`), "utf8")) as Sc13Fixture;
}

describe("SC 13 parser", () => {
  it.each(fixtureNames)("extracts source-backed facts for %s", (name) => {
    const fixture = loadFixture(name);
    const parserOutput = parseSc13Filing(fixture.filing, {
      marketContext: fixture.market_context ?? null,
    });

    expect(parserOutput.parserVersion).toBe("sc13-v1");
    expect(parserOutput.parserGroup).toBe("sc13");
    expect(parserOutput.isSupported).toBe(true);
    expect(parserOutput.accessionNumber).toBe(fixture.filing.accessionNumber);
    expect(parserOutput.cleaned_source_blocks.length).toBeGreaterThan(0);
    expect(parserOutput.cleaned_source_blocks.some((block) => block.block_type === "filing_metadata")).toBe(true);
    expect(parserOutput.cleaned_source_blocks.some((block) => block.block_type === "item_section" || block.block_type === "cover_page")).toBe(true);
    expect(APPROVED_EVENT_TYPES).toContain(fixture.expected?.event_type);

    for (const [factKey, expectedValue] of Object.entries(fixture.expected?.extracted_facts ?? {})) {
      expect(parserOutput.facts[factKey as keyof typeof parserOutput.facts]).toEqual(expectedValue);
    }
  });

  it("keeps market context outside parser facts except as fixture context", () => {
    const fixture = loadFixture("market-context-13d");
    const parserOutput = parseSc13Filing(fixture.filing, {
      marketContext: fixture.market_context ?? null,
    });

    expect(fixture.market_context?.market_cap).toBe(45000000);
    expect(parserOutput.facts.financingAmountUsd).toBe(20000000);
    expect(JSON.stringify(parserOutput.facts)).not.toContain("market_cap");
    expect(JSON.stringify(parserOutput.raw)).not.toContain("market_cap");
  });

  it("warns instead of summing repeated reporting-person cover rows", () => {
    const fixture = loadFixture("institutional-base-13g");
    const parserOutput = parseSc13Filing(fixture.filing);

    expect(parserOutput.facts.reportingPersonDetails).toHaveLength(2);
    expect(parserOutput.facts.hasMultipleReportingPersons).toBe(true);
    expect(parserOutput.facts.sharesBeneficiallyOwned).toBe(4200000);
    expect(parserOutput.warnings).toContain(
      "Multiple reporting persons found; do not sum ownership rows unless the filing states an aggregate.",
    );
  });

  it("extracts exit filing and sales-table mechanics without investor judgment", () => {
    const exitFixture = loadFixture("exit-13ga");
    const exitOutput = parseSc13Filing(exitFixture.filing);

    expect(exitOutput.facts.isExitFiling).toBe(true);
    expect(exitOutput.facts.percentOwned).toBe(0);
    expect(exitOutput.signals).toEqual([]);

    const salesFixture = loadFixture("sales-plan-13da");
    const salesOutput = parseSc13Filing(salesFixture.filing);

    expect(salesOutput.facts.salesPlanLanguage).toBe(true);
    expect(salesOutput.facts.salesTable).toHaveLength(2);
    expect(salesOutput.facts.salesTable[0]?.sharesSold).toBe(3255);
  });

  it("does not treat Schedule 13D/A tender-offer final-amendment boilerplate as an exit filing", () => {
    const parserOutput = parseSc13Filing({
      formType: "SC 13D/A",
      accessionNumber: "0001104659-26-066737",
      issuerName: "Genco Shipping & Trading Limited",
      text: [
        "SC TO-T/A",
        "SCHEDULE TO",
        "(Amendment No. 5)",
        "Check the following box if the filing is a final amendment reporting the results of the tender offer: o",
        "As permitted by General Instruction G to Schedule TO, this Schedule TO is also Amendment No. 14 to the Schedule 13D filed by Diana Shipping Inc.",
        "CUSIP No. Y2685T131",
        "1 NAMES OF REPORTING PERSONS Diana Shipping Inc.",
        "7 SOLE VOTING POWER 6,264,548",
        "9 SOLE DISPOSITIVE POWER 6,264,548",
        "11 AGGREGATE AMOUNT BENEFICIALLY OWNED BY EACH REPORTING PERSON 6,264,548",
        "13 PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW (11) 14.4%",
        "ITEMS 1 THROUGH 9 AND ITEM 11.",
        "The Offer Price is increased from $23.50 per Share to $24.80 per Share.",
      ].join("\n"),
    });

    expect(parserOutput.facts.scheduleType).toBe("13D");
    expect(parserOutput.facts.isAmendment).toBe(true);
    expect(parserOutput.facts.percentOwned).toBe(14.4);
    expect(parserOutput.facts.isExitFiling).toBe(false);
  });

  it("handles live SEC cover-table edge cases without row-number or boilerplate pollution", () => {
    const stateStreet = parseSc13Filing(loadFixture("state-street-old-html-13ga").filing);
    expect(stateStreet.facts.ruleBasis).toBe("13d-1(b)");
    expect(stateStreet.facts.cusip).toBe("989701107");
    expect(stateStreet.facts.reportingPersons).toEqual(["STATE STREET CORPORATION"]);

    const blackRock = parseSc13Filing(loadFixture("blackrock-nos-cover-13da").filing);
    expect(blackRock.facts.reportingPersons).toEqual(["BlackRock, Inc."]);
    expect(blackRock.facts.reportingPersons.join(" ")).not.toMatch(/NOS\. OF|IRS|Identification/i);
    expect(blackRock.facts.reportingPersonDetails[0]?.groupCheckbox).toEqual({ a: false, b: true });

    const citadel = parseSc13Filing(loadFixture("citadel-see-row-13g").filing);
    expect(citadel.facts.sharesBeneficiallyOwned).toBeNull();
    expect(citadel.facts.reportingPersonDetails[0]?.dispositivePower.shared).toBeNull();
    expect(citadel.facts.reportingPersonDetails[0]?.votingPower.shared).toBe(3160781);

    const viking = parseSc13Filing(loadFixture("viking-spaced-cover-13ga").filing);
    expect(viking.facts.reportingPersons).toEqual(["Viking Global Investors LP"]);
    expect(viking.facts.reportingPersons.join(" ")).not.toMatch(/Delaware|NUMBER OF SHARES/i);
    expect(viking.facts.reportingPersonDetails[0]?.groupCheckbox).toEqual({ a: false, b: true });

    const icahn = parseSc13Filing(loadFixture("icahn-signature-only-13da").filing);
    expect(icahn.facts.reportingPersons).toContain("IEP ENERGY HOLDING LLC");
    expect(icahn.facts.reportingPersons).toContain("CARL C. ICAHN");
    expect(icahn.facts.reportingPersons.join(" ")).not.toMatch(/Ted Papapostolou|Chief Financial Officer|Signature Page/i);
    expect(icahn.facts.sharesBeneficiallyOwned).toBeNull();
    expect(icahn.facts.item4Purpose).toContain("tender offer");
  });

  it("handles compact real SEC Schedule 13G source formats found in live sampling", () => {
    const inlineItems = parseSc13Filing({
      formType: "SC 13G",
      accessionNumber: "0001019432-24-000001",
      issuerName: "Leviticus Partners LP sample",
      text: [
        "SCHEDULE 13G",
        "CUSIP No. 000000000",
        "1 NAME OF REPORTING PERSON Leviticus Partners LP",
        "11 AGGREGATE AMOUNT BENEFICIALLY OWNED BY EACH REPORTING PERSON 1,234,567",
        "13 PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW (11) 8.7%",
        "ITEM 1: SECURITY AND ISSUER: Sample issuer ITEM 2: IDENTITY AND BACKGROUND: Leviticus Partners LP ITEM 3: IF THIS STATEMENT IS FILED PURSUANT TO RULE 13d-1(b): Not applicable ITEM 4: OWNERSHIP: (a) Amount beneficially owned: 1,234,567 (b) Percent of class: 8.7% ITEM 5: OWNERSHIP OF FIVE PERCENT OR LESS OF A CLASS: / / ITEM 6: OWNERSHIP OF MORE THAN FIVE PERCENT ON BEHALF OF ANOTHER PERSON: Not applicable ITEM 7: IDENTIFICATION AND CLASSIFICATION OF THE SUBSIDIARY: Inapplicable ITEM 8: IDENTIFICATION AND CLASSIFICATION OF MEMBERS OF THE GROUP: Not applicable ITEM 9: NOTICE OF DISSOLUTION OF GROUP: Not applicable ITEM 10: CERTIFICATION: By signing below I certify.",
      ].join("\n"),
    });

    expect(inlineItems.facts.itemSections.item4).toContain("Amount beneficially owned: 1,234,567");
    expect(inlineItems.facts.itemSections.item5).toContain("OWNERSHIP OF FIVE PERCENT OR LESS");
    expect(inlineItems.facts.itemSections.item10).toContain("By signing below I certify");
    expect(inlineItems.facts.sharesBeneficiallyOwned).toBe(1234567);
    expect(inlineItems.facts.percentOwned).toBe(8.7);

    const parenthesizedCoverRows = parseSc13Filing({
      formType: "SC 13G/A",
      accessionNumber: "0001037389-24-000013",
      issuerName: "Nicholas Financial Inc.",
      text: [
        "SCHEDULE 13G/A",
        "CUSIP No. 65373J209",
        "(1) NAMES OF REPORTING PERSONS. I.R.S. IDENTIFICATION NOS. OF ABOVE PERSONS (entities only). Renaissance Technologies LLC 26-0385758",
        "(11) AGGREGATE AMOUNT BENEFICIALLY OWNED BY EACH REPORTING PERSON 351,951",
        "(13) PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW (11) 4.83%",
        "(1) NAMES OF REPORTING PERSONS. I.R.S. IDENTIFICATION NOS. OF ABOVE PERSONS (entities only). RENAISSANCE TECHNOLOGIES HOLDINGS CORPORATION 13-3127734",
        "(11) AGGREGATE AMOUNT BENEFICIALLY OWNED BY EACH REPORTING PERSON 351,951",
        "(13) PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW (11) 4.83%",
        "Item 1. Issuer. Nicholas Financial Inc.",
        "Item 4. Ownership. 351,951 shares, 4.83%.",
        "Item 5. Ownership of Five Percent or Less of a Class. If this statement is being filed to report the fact that as of the date hereof the reporting person has ceased to be the beneficial owner of more than five percent of the class of securities, check the following [X].",
        "Item 10. Certification. By signing below I certify.",
      ].join("\n"),
    });

    expect(parenthesizedCoverRows.facts.reportingPersons).toEqual([
      "Renaissance Technologies LLC",
      "RENAISSANCE TECHNOLOGIES HOLDINGS CORPORATION",
    ]);
    expect(parenthesizedCoverRows.facts.reportingPersonDetails).toHaveLength(2);
    expect(parenthesizedCoverRows.facts.sharesBeneficiallyOwned).toBe(351951);
    expect(parenthesizedCoverRows.facts.percentOwned).toBe(4.83);
    expect(parenthesizedCoverRows.facts.isExitFiling).toBe(true);

    const splitHtmlItemTitle = parseSc13Filing({
      formType: "SC 13G/A",
      accessionNumber: "0001019056-24-000072",
      issuerName: "Nicholas Financial Inc.",
      text: [
        "SCHEDULE 13G/A",
        "1 NAMES OF REPORTING PERSONS PELHAM INVESTMENT PARTNERS, LP",
        "Item 4.",
        "Ownership. 483,437 shares, 6.63%.",
        "Item 5.",
        "Ownership of Five Percent or Less of a Class.",
        "If this statement is being filed to report the fact that as of the date hereof the reporting person has ceased to be the beneficial owner of more than five percent of the class of securities, check the following: o.",
        "Item 6.",
        "Not applicable.",
      ].join("\n"),
    });
    expect(splitHtmlItemTitle.facts.itemSections.item5).toContain("Ownership of Five Percent or Less of a Class");

    const subsectionCoverName = parseSc13Filing({
      formType: "SC 13G/A",
      accessionNumber: "0001890906-24-000079",
      issuerName: "Mativ Holdings, Inc.",
      text: [
        "SCHEDULE 13G/A",
        "CUSIP No. 808541106",
        "1. (a) Names of Reporting Persons.",
        "Allspring Global Investments Holdings, LLC",
        "(b) Tax ID",
        "36-4863445",
        "Item 4. Ownership. 4,132,265 shares, 7.62%.",
        "Item 5. Ownership of Five Percent or Less of a Class. Not applicable.",
      ].join("\n"),
    });
    expect(subsectionCoverName.facts.reportingPersons).toEqual(["Allspring Global Investments Holdings, LLC"]);

    const item2NameFallback = parseSc13Filing({
      formType: "SC 13G",
      accessionNumber: "0001023875-24-000002",
      issuerName: "Alexander & Baldwin Inc.",
      text: [
        "SCHEDULE 13G",
        "Item 2.",
        "(a) Name of Person Filing",
        "Franklin Mutual Advisers, LLC",
        "Item 4.",
        "Ownership. 3,642,996 shares and 9.0% of class.",
        "Item 5.",
        "Ownership of Five Percent or Less of a Class. Not applicable.",
      ].join("\n"),
    });
    expect(item2NameFallback.facts.reportingPersons).toEqual(["Franklin Mutual Advisers, LLC"]);

    const item2Schedule13dFallback = parseSc13Filing({
      formType: "SC 13D",
      accessionNumber: "0001493152-24-047227",
      issuerName: "Ming Shing Group Holdings Ltd",
      text: [
        "SCHEDULE 13D",
        "Item 1. Security and Issuer.",
        "CUSIP Number. G61440106",
        "Item 2. Identity and Background",
        "This statement on Schedule 13D is being filed by Mr. Chi Ming Lam, the holder of 11,250,000 Ordinary Shares of the Issuer (the \"Reporting Person\").",
        "Item 4. Purpose of Transaction.",
        "Item 5. Interest in Securities of the Issuer.",
      ].join("\n"),
    });
    expect(item2Schedule13dFallback.facts.reportingPersons).toEqual(["Chi Ming Lam"]);

    const splitItemWord = parseSc13Filing({
      formType: "SC 13D",
      accessionNumber: "0001104659-24-116684",
      issuerName: "Universal Stainless & Alloy Products Inc.",
      text: [
        "SCHEDULE 13D",
        "Item 5. Interest in Securities of the Issuer.",
        "Shares represented beneficial ownership of approximately 5.99% of the Shares.",
        "I tem 6. contracts, arrangements, understandings or relationships with respect to the securities of the issuer",
        "Pursuant to Rule 13d-1(k)(1), the Reporting Persons have entered into a joint filing agreement.",
      ].join("\n"),
    });
    expect(splitItemWord.facts.itemSections.item6).toContain("joint filing agreement");
  });

  it("segments SC 13D/G item headings across legacy, newer, split, and title-only variants", () => {
    const initial13d = parseSc13Filing(loadFixture("initial-13d-items-1-7").filing);
    expect(initial13d.formType).toBe("SC 13D");
    expect(initial13d.facts.scheduleType).toBe("13D");
    for (const itemNumber of [1, 2, 3, 4, 5, 6, 7]) {
      expect(initial13d.facts.itemSections[`item${itemNumber}` as keyof typeof initial13d.facts.itemSections]).toBeTruthy();
    }
    expect(initial13d.facts.itemSections.item8).toBeNull();
    expect(initial13d.facts.itemSections.item4).toContain("acquired for investment purposes");
    expect(initial13d.facts.itemSections.item6).toContain("There are no contracts");

    const variation13da = parseSc13Filing(loadFixture("variation-13da-item4-heading").filing);
    expect(variation13da.formType).toBe("SCHEDULE 13D/A");
    expect(variation13da.isSupported).toBe(true);
    expect(variation13da.facts.isAmendment).toBe(true);
    expect(variation13da.facts.amendmentNumber).toBe(2);
    expect(variation13da.facts.itemSections.item4).toContain("letter agreement with the Issuer");

    const initial13g = parseSc13Filing(loadFixture("initial-13g-items-1-10").filing);
    expect(initial13g.formType).toBe("SC 13G");
    expect(initial13g.isSupported).toBe(true);
    for (const itemNumber of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(initial13g.facts.itemSections[`item${itemNumber}` as keyof typeof initial13g.facts.itemSections]).toBeTruthy();
    }

    const exit13ga = parseSc13Filing(loadFixture("exit-13ga").filing);
    expect(exit13ga.facts.itemSections.item5).toMatch(/ceased to be the beneficial owner of more than 5 percent/i);

    const split13g = parseSc13Filing(loadFixture("split-heading-13g").filing);
    expect(split13g.formType).toBe("SCHEDULE 13G");
    expect(split13g.isSupported).toBe(true);
    expect(split13g.facts.itemSections.item4).toContain("3,400,000 Ordinary Shares");

    const uncertain13d = parseSc13Filing(loadFixture("uncertain-title-boundary-13d").filing);
    expect(uncertain13d.facts.itemSections.item4).toContain("may review its investment");
    expect(uncertain13d.warnings).toContain('Item 4 boundary inferred from title-only heading "Purpose of Transaction".');
  });

  it("recognizes legacy SC names and newer Schedule names as supported form-family inputs", () => {
    const legacy = parseSc13Filing(loadFixture("passive-13g").filing);
    expect(legacy.formType).toBe("SC 13G");
    expect(legacy.isSupported).toBe(true);

    const schedule13d = parseSc13Filing(loadFixture("variation-13da-item4-heading").filing);
    expect(schedule13d.formType).toBe("SCHEDULE 13D/A");
    expect(schedule13d.isSupported).toBe(true);

    const schedule13g = parseSc13Filing(loadFixture("split-heading-13g").filing);
    expect(schedule13g.formType).toBe("SCHEDULE 13G");
    expect(schedule13g.isSupported).toBe(true);
  });

  it("keeps separate cover-page facts and raw evidence for multiple reporting persons", () => {
    const output13d = parseSc13Filing(loadFixture("multi-reporting-13d-cover").filing);
    expect(output13d.facts.reportingPersonDetails).toHaveLength(2);
    expect(output13d.facts.reportingPersonDetails.map((detail) => detail.name)).toEqual(["Mesa Partners LP", "Mesa GP LLC"]);
    expect(output13d.facts.reportingPersonDetails[0]?.rawSourceText).toContain("Shared Voting Power");
    expect(output13d.facts.reportingPersonDetails[1]?.rawValues?.typeOfReportingPerson).toBe("OO");
    expect(output13d.warnings).toContain(
      "Multiple reporting persons found; do not sum ownership rows unless the filing states an aggregate.",
    );

    const output13g = parseSc13Filing(loadFixture("multi-reporting-star-13g").filing);
    expect(output13g.facts.reportingPersonDetails).toHaveLength(2);
    expect(output13g.facts.reportingPersonDetails[0]?.rawValues?.percentOwned).toBe("*");
    expect(output13g.facts.percentOwned).toBeNull();
    expect(output13g.warnings).toContain("At least one cover page has a checked group-membership checkbox.");
    expect(output13g.warnings).toContain("Percent of class for Index Manager LP is a star-only or footnote-only cover-page value.");
    expect(output13g.warnings).toContain("Share count for Index Manager LP contains unresolved footnote markers.");
    expect(output13g.warnings).toContain("Item 8 appears non-empty in this Schedule 13G.");
    expect(output13g.warnings).toContain("Item 9 appears non-empty in this Schedule 13G.");
  });

  it("normalizes split cover-row ownership values conservatively and warns on visible ambiguity", () => {
    const tableish = parseSc13Filing(loadFixture("table-ish-cover-values-13d").filing);
    expect(tableish.isSupported).toBe(true);
    expect(tableish.facts.reportingPersonDetails[0]?.votingPower.sole).toBe(1250000);
    expect(tableish.facts.reportingPersonDetails[0]?.sharesBeneficiallyOwned).toBe(1250000);
    expect(tableish.facts.reportingPersonDetails[0]?.percentOwned).toBe(7.5);
    expect(tableish.facts.reportingPersonDetails[0]?.rawValues?.sharesBeneficiallyOwned).toBe("1,250,000 (1)");
    expect(tableish.facts.reportingPersonDetails[0]?.groupCheckbox).toEqual({ a: false, b: true });
    expect(tableish.warnings).toContain("At least one cover page has a checked group-membership checkbox.");
    expect(tableish.warnings).toContain("Share count for Slate Capital LLC contains unresolved footnote markers.");
  });

  it("warns when cover-page ownership values conflict with item text or cover rows are incomplete", () => {
    const conflict = parseSc13Filing(loadFixture("ownership-conflict-13da").filing);
    expect(conflict.facts.percentOwned).toBe(6);
    expect(conflict.facts.itemSections.item5).toContain("representing 5.4%");
    expect(conflict.warnings).toContain("Cover-page percent of class conflicts with ownership percentage stated in item text.");
    expect(conflict.warnings).toContain("Item 6 appears non-empty; preserve source text for review.");

    const malformed = parseSc13Filing(loadFixture("malformed-cover-13ga").filing);
    expect(malformed.facts.reportingPersons).toEqual(["River Plain Fund LP"]);
    expect(malformed.facts.sharesBeneficiallyOwned).toBeNull();
    expect(malformed.facts.percentOwned).toBeNull();
    expect(malformed.facts.itemSections.item5).toMatch(/ceased to be the beneficial owner of more than 5 percent/i);
    expect(malformed.warnings).toContain("Schedule 13G certification section was not found.");
  });

  it("extracts 13D Item 7 exhibit references without treating 13G Item 7 as exhibits", () => {
    const simple = parseSc13Filing(loadFixture("exhibits-simple-13d").filing);
    expect(simple.facts.exhibitReferences.filter((reference) => reference.source === "item7")).toMatchObject([
      {
        normalizedLabel: "EX-1",
        title: "Joint Filing Agreement",
        sourceLocation: "Item 7",
        agreementLike: true,
        matchedItem6: true,
      },
      {
        normalizedLabel: "EX-2",
        title: "Power of Attorney",
        sourceLocation: "Item 7",
        agreementLike: true,
      },
    ]);
    expect(simple.warnings).toContain("Schedule 13D Item 7 contains exhibit references.");
    expect(simple.warnings).toContain("Agreement-like exhibit title detected.");

    const schedule13g = parseSc13Filing(loadFixture("item7-13g-not-exhibits").filing);
    expect(schedule13g.facts.scheduleType).toBe("13G");
    expect(schedule13g.facts.itemSections.item7).toContain("Maple Index Sub-Adviser LLC");
    expect(schedule13g.facts.exhibitReferences).toHaveLength(0);
    expect(schedule13g.warnings).toContain("Schedule 13G Item 7 contains substantive text but is not treated as an exhibit section.");
  });

  it("captures amendment EX-style references, duplicate labels, incomplete titles, body references, and attachment inventory", () => {
    const output = parseSc13Filing(loadFixture("exhibits-amendment-13da").filing);
    const labels = output.facts.exhibitReferences.map((reference) => reference.normalizedLabel);

    expect(labels).toContain("EX-99.1");
    expect(labels).toContain("EX-99.2");
    expect(labels).toContain("EX-99.3");
    expect(labels).toContain("EX-99.4");
    expect(output.facts.exhibitReferences.some((reference) => reference.source === "body" && reference.normalizedLabel === "EX-99.3")).toBe(true);
    expect(output.facts.exhibitReferences.some((reference) => reference.source === "attachment" && reference.title === "Letter Agreement")).toBe(true);
    expect(output.facts.exhibitReferences.find((reference) => reference.normalizedLabel === "EX-99.2")?.matchedItem6).toBe(true);
    expect(output.warnings).toContain("Duplicate exhibit label found: EX-99.1.");
    expect(output.warnings).toContain("Exhibit title is incomplete or ambiguous.");
    expect(output.warnings).toContain("Document inventory mentions an exhibit not found in Item 7.");
  });

  it("warns factually when Item 6 and Item 7 exhibit text diverge", () => {
    const output = parseSc13Filing(loadFixture("exhibits-empty-missing-13d").filing);
    expect(output.facts.exhibitReferences).toHaveLength(0);
    expect(output.warnings).toContain("Item 7 states that no exhibits are filed.");
    expect(output.warnings).toContain("Item 6 appears non-empty but Item 7 is missing or states no exhibits.");
  });

  it("compares amendment exhibits only when prior exhibit references are supplied", () => {
    const currentFixture = loadFixture("exhibits-amendment-13da");
    const output = parseSc13Filing(currentFixture.filing, {
      priorExhibitReferences: [
        {
          label: "EX-99.1",
          normalizedLabel: "EX-99.1",
          title: "Prior Voting Agreement",
          source: "item7",
          sourceLocation: "Item 7",
          rawText: "EX-99.1 Prior Voting Agreement",
          uncertain: false,
          agreementLike: true,
          matchedItem6: false,
        },
        {
          label: "EX-99.9",
          normalizedLabel: "EX-99.9",
          title: "Removed Agreement",
          source: "item7",
          sourceLocation: "Item 7",
          rawText: "EX-99.9 Removed Agreement",
          uncertain: false,
          agreementLike: true,
          matchedItem6: false,
        },
      ],
    });

    expect(output.facts.exhibitComparison?.added.map((reference) => reference.normalizedLabel)).toContain("EX-99.2");
    expect(output.facts.exhibitComparison?.removed.map((reference) => reference.normalizedLabel)).toContain("EX-99.9");
    expect(output.facts.exhibitComparison?.changedTitles).toContainEqual({
      normalizedLabel: "EX-99.1",
      currentTitle: "Voting Agreement",
      priorTitle: "Prior Voting Agreement",
    });
    expect(output.warnings).toContain("Prior/current exhibit comparison found added exhibit references.");
    expect(output.warnings).toContain("Prior/current exhibit comparison found removed exhibit references.");
    expect(output.warnings).toContain("Prior/current exhibit comparison found changed exhibit titles.");
  });

  it("normalizes rendered XML, HTML tables, and malformed markup into the existing parser pipeline", () => {
    const rendered13d = parseSc13Filing(loadFixture("rendered-xml-13d").filing);
    expect(rendered13d.facts.sourceFlavor).toBe("rendered_xml");
    expect(rendered13d.facts.itemSections.item4).toContain("Item 4 source text must remain preserved");
    expect(rendered13d.facts.itemSections.item6).toContain("Letter Agreement");
    expect(rendered13d.facts.exhibitReferences.some((reference) => reference.normalizedLabel === "EX-99.1")).toBe(true);
    expect(rendered13d.warnings).toContain("RENDERED XML normalization applied before parsing.");

    const rendered13g = parseSc13Filing(loadFixture("rendered-xml-13g").filing);
    expect(rendered13g.facts.sourceFlavor).toBe("rendered_xml");
    expect(rendered13g.facts.itemSections.item10).toContain("By signing below I certify");
    expect(rendered13g.facts.exhibitReferences).toHaveLength(0);
    expect(rendered13g.warnings).toContain("Schedule 13G Item 7 contains substantive text but is not treated as an exhibit section.");

    const html = parseSc13Filing(loadFixture("html-table-13d").filing);
    expect(html.facts.sourceFlavor).toBe("html");
    expect(html.facts.reportingPersons).toEqual(["Browser Stone LLC"]);
    expect(html.facts.votingPower.shared).toBe(3300000);
    expect(html.facts.itemSections.item4).toContain("HTML Item 4 text is preserved");

    const malformed = parseSc13Filing(loadFixture("malformed-markup-13d").filing);
    expect(malformed.facts.sourceFlavor).toBe("html");
    expect(malformed.facts.itemSections.item4).toContain("Fallback Item 4 text");
    expect(malformed.warnings).toContain("Source contained malformed markup; normalization fallback was used.");
  });

  it("selects the primary Schedule 13 document from full submission text and preserves attachment evidence", () => {
    const output = parseSc13Filing(loadFixture("full-submission-13d").filing);

    expect(output.facts.sourceFlavor).toBe("full_submission");
    expect(output.facts.sourceDocuments).toEqual([
      {
        type: "SC 13D",
        filename: "primary.htm",
        description: "SCHEDULE 13D",
        selectedPrimary: true,
      },
      {
        type: "EX-99.1",
        filename: "ex991.htm",
        description: "Support Agreement",
        selectedPrimary: false,
      },
    ]);
    expect(output.facts.itemSections.item4).toContain("Primary Item 4 text only");
    expect(output.facts.itemSections.item4).not.toContain("Attachment Item 4");
    expect(output.facts.itemSections.item6).toContain("Primary Item 6 references a Support Agreement");
    expect(output.facts.exhibitReferences.some((reference) => reference.source === "attachment" && reference.normalizedLabel === "EX-99.1")).toBe(true);
    expect(output.warnings).toContain("Source flavor detected as full SEC submission text.");
    expect(output.warnings).toContain("Primary Schedule 13 document selected from full submission text.");
  });

  it("keeps prior heading edge cases working after source normalization changes", () => {
    const split13g = parseSc13Filing(loadFixture("split-heading-13g").filing);
    expect(split13g.facts.itemSections.item4).toContain("3,400,000 Ordinary Shares");

    const uncertain13d = parseSc13Filing(loadFixture("uncertain-title-boundary-13d").filing);
    expect(uncertain13d.facts.itemSections.item4).toContain("may review its investment");
    expect(uncertain13d.warnings).toContain('Item 4 boundary inferred from title-only heading "Purpose of Transaction".');
  });

  it("records Item 4 governance and transaction keywords as factual evidence", () => {
    const activist = parseSc13Filing(loadFixture("activist-13d").filing);
    expect(activist.facts.itemSections.item4).toContain("board representation");
    expect(activist.facts.item4KeywordHits.map((hit) => hit.keyword)).toEqual(
      expect.arrayContaining(["board", "board representation", "nominate", "governance"]),
    );
    expect(activist.facts.item4KeywordHits[0]?.evidence).toContain("Board");
    expect(activist.facts.item4HasActivistLanguage).toBe(true);
    expect(activist.facts.ownershipIntent).toBe("active");
    expect(activist.signals).toEqual([]);

    const material = parseSc13Filing(loadFixture("material-13da").filing);
    expect(material.facts.transactionKeywordHits.map((hit) => hit.keyword)).toEqual(expect.arrayContaining(["merger", "support agreement"]));
    expect(material.signals).toEqual([]);
  });

  it("records 13G certification and non-empty 13G items factually without adding new importance conclusions", () => {
    const passive = parseSc13Filing(loadFixture("passive-13g").filing);
    expect(passive.facts.passiveCertification).toBe(true);
    expect(passive.facts.ordinaryCourseCertification).toBe(false);
    expect(passive.signals).toEqual([]);

    const multi = parseSc13Filing(loadFixture("multi-reporting-star-13g").filing);
    expect(multi.warnings).toContain("Item 8 appears non-empty in this Schedule 13G.");
    expect(multi.warnings).toContain("Item 9 appears non-empty in this Schedule 13G.");
    expect(multi.warnings.join(" ")).not.toMatch(/\b(?:activist|control intent|market-moving|bullish|bearish|alert-worthy)\b/i);
  });

  it("keeps agreement and high-ownership observations source-backed and factual", () => {
    const exhibits = parseSc13Filing(loadFixture("exhibits-amendment-13da").filing);
    expect(exhibits.facts.exhibitReferences.some((reference) => reference.title === "Voting Agreement" && reference.agreementLike)).toBe(true);
    expect(exhibits.warnings).toContain("Agreement-like exhibit title detected.");

    const large = parseSc13Filing(loadFixture("full-submission-13d").filing);
    expect(large.facts.percentOwned).toBe(10);
    expect(large.signals).toEqual([]);
  });

  it("does not emit parser classification handoff or event hints", () => {
    const passive = parseSc13Filing(loadFixture("passive-13g").filing);
    const exit = parseSc13Filing(loadFixture("exit-13ga").filing);
    const ownershipOnly13d = parseSc13Filing(loadFixture("ownership-only-13da").filing);

    for (const output of [passive, exit, ownershipOnly13d]) {
      expect(JSON.stringify(output.facts)).not.toMatch(/classificationHandoff|deterministicEventType|deterministicDisplayType|routerRequired/i);
      expect(JSON.stringify(output.signals)).not.toMatch(/event_type_hint|deterministic|insider_ownership|leadership_governance|strategic_transaction|dilution_risk|legal_risk/i);
    }
  });

  it("preserves non-routine or ambiguous Schedule 13 source evidence without parser route decisions", () => {
    const item6 = parseSc13Filing(loadFixture("substantive-item6-13g").filing);
    expect(item6.facts.itemSections.item6).toContain("managed account");
    expect(item6.cleaned_source_blocks.some((block) => block.title.includes("Item 6"))).toBe(true);

    const groupItems = parseSc13Filing(loadFixture("multi-reporting-star-13g").filing);
    expect(groupItems.cleaned_source_blocks.some((block) => block.title.includes("Item 8"))).toBe(true);
    expect(groupItems.cleaned_source_blocks.some((block) => block.title.includes("Item 9"))).toBe(true);

    const governance = parseSc13Filing(loadFixture("activist-13d").filing);
    expect(governance.cleaned_source_blocks.some((block) => block.title.includes("Item 4"))).toBe(true);

    const transaction = parseSc13Filing(loadFixture("material-13da").filing);
    expect(transaction.cleaned_source_blocks.some((block) => /tender|merger|transaction/i.test(block.text))).toBe(true);

    const agreement = parseSc13Filing(loadFixture("exhibits-amendment-13da").filing);
    expect(agreement.cleaned_source_blocks.some((block) => block.block_type === "exhibit_reference")).toBe(true);

    const financing = parseSc13Filing(loadFixture("market-context-13d").filing);
    expect(financing.cleaned_source_blocks.some((block) => /financing|preferred stock|warrant|convertible/i.test(block.text))).toBe(true);

    const legal = parseSc13Filing(loadFixture("litigation-13d").filing);
    expect(legal.facts.legalKeywordHits.map((hit) => hit.keyword)).toEqual(expect.arrayContaining(["litigation", "regulatory"]));
    expect(legal.cleaned_source_blocks.some((block) => /litigation|regulatory/i.test(block.text))).toBe(true);
  });

  it("handles Schedule 13G XML aliases without treating boolean item flags or signatures as cover facts", () => {
    const output = parseSc13Filing({
      formType: "SC 13G",
      accessionNumber: "0001104659-26-046016",
      issuerName: "DIANA SHIPPING INC.",
      text: `
        <schedule13G>
          <nameOfIssuer>DIANA SHIPPING INC.</nameOfIssuer>
          <securitiesClassTitle>Shares of Common Stock, par value $0.01 per share</securitiesClassTitle>
          <issuerCusips><issuerCusipNumber>Y2066G104</issuerCusipNumber></issuerCusips>
          <reportingPerson>
            <nameOfReportingPerson>F. Laeisz GmbH</nameOfReportingPerson>
            <solePowerOrDirectToVote>0</solePowerOrDirectToVote>
            <sharedPowerOrDirectToVote>7482248</sharedPowerOrDirectToVote>
            <solePowerOrDirectToDispose>0</solePowerOrDirectToDispose>
            <sharedPowerOrDirectToDispose>7482248</sharedPowerOrDirectToDispose>
            <reportingPersonBeneficiallyOwnedAggregateNumberOfShares>7482248</reportingPersonBeneficiallyOwnedAggregateNumberOfShares>
            <classPercent>6.0</classPercent>
            <typeOfReportingPerson>CO</typeOfReportingPerson>
          </reportingPerson>
          <item5><notApplicableFlag>Y</notApplicableFlag></item5>
          <item6><notApplicableFlag>Y</notApplicableFlag></item6>
          <item8><notApplicableFlag>Y</notApplicableFlag></item8>
          <item9><notApplicableFlag>Y</notApplicableFlag></item9>
          <item10>
            <notApplicableFlag>N</notApplicableFlag>
            <certification>By signing below I certify that the securities were not acquired or held for the purpose of changing or influencing control.</certification>
          </item10>
          <signature>
            <nameOfReportingPerson>F. Laeisz GmbH /s/ Hannes Thiede Hannes Thiede, Managing Director/COO 04/21/2026</nameOfReportingPerson>
          </signature>
        </schedule13G>
      `,
    });

    expect(output.facts.cusip).toBe("Y2066G104");
    expect(output.facts.securityClass).toContain("Shares of Common Stock");
    expect(output.facts.reportingPersons).toEqual(["F. Laeisz GmbH"]);
    expect(output.facts.reportingPersonDetails).toHaveLength(1);
    expect(output.facts.sharesBeneficiallyOwned).toBe(7482248);
    expect(output.facts.percentOwned).toBe(6);
    expect(output.facts.itemSections.item6).toBeNull();
    expect(output.facts.itemSections.item8).toBeNull();
    expect(output.facts.itemSections.item9).toBeNull();
    expect(JSON.stringify(output.facts)).not.toMatch(/classificationHandoff|routerRequired/i);
  });
});
