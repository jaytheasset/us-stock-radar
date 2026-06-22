import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { filterS1F1SubmissionText } from "./documentFilter.ts";
import { parseS1F1Filing } from "./parser.ts";
import type { S1F1ParserInput } from "./types.ts";

const ROOM_URL = new URL("./", import.meta.url);

interface FilterFixture {
  input: S1F1ParserInput;
  expected: {
    bodyCount: number;
    importantExhibitCount: number;
    noiseCount: number;
    documentCount: number;
    includedTypes: string[];
    noiseTypes: string[];
  };
}

function loadFixture(): FilterFixture {
  return JSON.parse(
    readFileSync(new URL("fixtures/document-filter-complete-submission.json", ROOM_URL), "utf8"),
  ) as FilterFixture;
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

describe("S-1/F-1 complete submission document filter", () => {
  it("splits complete submissions into body, important exhibits, and noise", () => {
    const fixture = loadFixture();
    const result = filterS1F1SubmissionText(fixture.input.filingText, { formType: fixture.input.formType });

    assert.equal(result.summary.detectedCompleteSubmission, true);
    assert.equal(result.summary.documentCount, fixture.expected.documentCount);
    assert.equal(result.summary.bodyCount, fixture.expected.bodyCount);
    assert.equal(result.summary.importantExhibitCount, fixture.expected.importantExhibitCount);
    assert.equal(result.summary.noiseCount, fixture.expected.noiseCount);

    const includedTypes = result.summary.items
      .filter((item) => item.bucket !== "noise")
      .map((item) => item.type);
    const noiseTypes = result.summary.items
      .filter((item) => item.bucket === "noise")
      .map((item) => item.type);

    assert.deepEqual(includedTypes, fixture.expected.includedTypes);
    assert.deepEqual(noiseTypes, fixture.expected.noiseTypes);
    assert.match(result.text, /initial public offering/);
    assert.match(result.text, /Filing Fee Table/);
    assert.match(result.text, /Security Type\s+\|\s+Proposed Maximum Aggregate Offering Price/);
    assert.match(result.text, /Underwriting Agreement/);
    assert.match(result.text, /authorized to issue 900,000,000 shares/);
    assert.match(result.text, /Lock-Up Agreement/);
    assert.doesNotMatch(result.text, /executive receives base salary/);
    assert.doesNotMatch(result.text, /We consent to the use of our report/);
    assert.doesNotMatch(result.text, /binary image placeholder/);

    const feeTable = result.summary.items.find((item) => item.type === "EX-FILING FEES");
    assert.ok(feeTable?.snippets.some((snippet) => snippet.label === "table_or_terms"));
    assert.equal(feeTable?.included, true);

    const employmentAgreement = result.summary.items.find((item) => item.type === "EX-10.1");
    assert.equal(employmentAgreement?.bucket, "noise");
    assert.equal(employmentAgreement?.included, false);

    const lockupAgreement = result.summary.items.find((item) => item.type === "EX-10.2");
    assert.equal(lockupAgreement?.bucket, "important_exhibit");
    assert.equal(lockupAgreement?.included, true);
  });

  it("uses filtered complete-submission text in the parser", () => {
    const fixture = loadFixture();
    const parserOutput = parseS1F1Filing(fixture.input);

    assert.equal(parserOutput.facts.filing.filing_variant, "base_registration");
    assert.equal(parserOutput.facts.ticker, "TEST");
    assert.equal(parserOutput.signals[0].event_type, "ipo_listing");
    assert.equal(parserOutput.raw.documentFilter?.bodyCount, fixture.expected.bodyCount);
    assert.equal(parserOutput.raw.documentFilter?.importantExhibitCount, fixture.expected.importantExhibitCount);
    assert.equal(parserOutput.raw.documentFilter?.noiseCount, fixture.expected.noiseCount);
  });

  it("identifies an exact S-1 main document and classifies exhibit kinds", () => {
    const filingText = [
      "<SEC-DOCUMENT>sample",
      documentBlock(
        "GRAPHIC",
        1,
        "cover.jpg",
        "GRAPHIC",
        "binary placeholder",
      ),
      documentBlock(
        "S-1",
        2,
        "issuer-s1.htm",
        "FORM S-1",
        "<html><body><script>hidden()</script><div style=\"display:none\">hidden boilerplate</div>Prospectus Summary\nRisk Factors\nUse of Proceeds</body></html>",
      ),
      documentBlock("EX-FILING FEES", 3, "fees.htm", "Filing Fee Table", "Filing Fee Table"),
      documentBlock("EX-5.1", 4, "legal.htm", "Opinion of Counsel", "legal opinion"),
      documentBlock("EX-23.1", 5, "consent.htm", "Consent of Independent Registered Public Accounting Firm", "auditor consent"),
      documentBlock("EX-1.1", 6, "underwriting.htm", "Underwriting Agreement", "underwriting agreement"),
      documentBlock("EX-10.2", 7, "lockup.htm", "Lock-Up Agreement", "lock-up agreement"),
      documentBlock("EX-4.1", 8, "deposit.htm", "Deposit Agreement", "deposit agreement for American Depositary Shares"),
      documentBlock("EX-3.1", 9, "charter.htm", "Charter", "authorized shares and voting rights"),
      documentBlock("EX-21.1", 10, "subsidiaries.htm", "List of Subsidiaries", "subsidiaries"),
      documentBlock("EX-24.1", 11, "poa.htm", "Power of Attorney", "power of attorney"),
      documentBlock("EX-99.1", 12, "other.htm", "Other Exhibit", "other exhibit"),
      "</SEC-DOCUMENT>",
    ].join("\n");

    const result = filterS1F1SubmissionText(filingText, { formType: "S-1" });
    assert.equal(result.summary.mainDocument?.type, "S-1");
    assert.equal(result.summary.mainDocument?.filename, "issuer-s1.htm");
    assert.equal(result.summary.mainDocument?.confidence, "high");

    const byType = new Map(result.summary.items.map((item) => [item.type, item]));
    assert.equal(byType.get("S-1")?.isMainDocument, true);
    assert.equal(byType.get("S-1")?.documentKind, "main_filing");
    assert.equal(byType.get("EX-FILING FEES")?.documentKind, "filing_fee_exhibit");
    assert.equal(byType.get("EX-5.1")?.documentKind, "legal_opinion");
    assert.equal(byType.get("EX-23.1")?.documentKind, "auditor_consent");
    assert.equal(byType.get("EX-1.1")?.documentKind, "underwriting_agreement");
    assert.equal(byType.get("EX-10.2")?.documentKind, "lock_up_agreement");
    assert.equal(byType.get("EX-4.1")?.documentKind, "deposit_agreement");
    assert.equal(byType.get("EX-3.1")?.documentKind, "charter_bylaws");
    assert.equal(byType.get("EX-21.1")?.documentKind, "subsidiary_list");
    assert.equal(byType.get("EX-24.1")?.documentKind, "power_of_attorney");
    assert.equal(byType.get("EX-99.1")?.documentKind, "other_exhibit");
    assert.doesNotMatch(result.text, /hidden boilerplate/);
  });

  it("falls back to a strong F-1 HTML filename when document type is generic", () => {
    const filingText = [
      "<SEC-DOCUMENT>sample",
      documentBlock("GRAPHIC", 1, "cover.jpg", "GRAPHIC", "binary placeholder"),
      documentBlock(
        "HTML",
        2,
        "issuer-f1.htm",
        "Form F-1 Registration Statement",
        "<html><body>Registration Statement. Prospectus Summary\nRisk Factors\nUse of Proceeds\nDescription of American Depositary Shares</body></html>",
      ),
      "</SEC-DOCUMENT>",
    ].join("\n");

    const result = filterS1F1SubmissionText(filingText, { formType: "F-1" });

    assert.equal(result.summary.mainDocument?.filename, "issuer-f1.htm");
    assert.equal(result.summary.mainDocument?.confidence, "medium");
    assert.equal(result.summary.items.find((item) => item.filename === "issuer-f1.htm")?.bucket, "body");
  });

  it("preserves HTML table rows and numeric text in table metadata", () => {
    const filingText = documentBlock(
      "S-1",
      1,
      "issuer-s1.htm",
      "FORM S-1",
      `<html><body>
        <div><b>Use of Proceeds</b></div>
        <table>
          <tr><th>Use</th><th>Amount</th><th>Percent</th></tr>
          <tr><td>Working capital</td><td>$1,000</td><td>50%</td></tr>
          <tr><td>Repayment of debt</td><td>($500)</td><td>-</td></tr>
          <tr><td>Pro forma as adjusted cash, in thousands</td><td>$2,500</td><td>100%</td></tr>
        </table>
      </body></html>`,
    );

    const result = filterS1F1SubmissionText(filingText, { formType: "S-1" });
    const table = result.summary.tables?.[0];

    assert.ok(table);
    assert.deepEqual(table.headerRows[0], ["Use", "Amount", "Percent"]);
    assert.match(table.text, /Working capital \| \$1,000 \| 50%/);
    assert.match(table.text, /Repayment of debt \| \(\$500\) \| -/);
    assert.match(table.text, /Pro forma as adjusted cash, in thousands \| \$2,500 \| 100%/);
    assert.ok(result.summary.blocks?.some((block) => block.tag === "table" && block.insideTable));
    assert.ok(result.text.includes("Use | Amount | Percent"));
  });
});
