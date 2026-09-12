import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseSection16XmlFiling,
  type Section16XmlForm,
} from "./parser.ts";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const baseXml = readFileSync(path.join(fixtureDir, "0000094049-26-000015-form5a.xml"), "utf8");

test("Forms 5 and 5/A preserve derivative transactionTotalValue and only its own field footnotes", () => {
  for (const formType of ["5", "5/A"] as const) {
    const withTotalValue = replaceDerivativeContent(
      formXml(formType),
        "<transactionShares><value>262.832</value></transactionShares>",
        '<transactionTotalValue><value>500000</value><footnoteId id="F8"/></transactionTotalValue>',
    );
    const xml = replaceDerivativeContent(
      withTotalValue,
      "<transactionPricePerShare><value>70.32</value></transactionPricePerShare>",
      '<transactionPricePerShare><value>70.32</value><footnoteId id="F9"/></transactionPricePerShare>',
    );
    const row = derivativeTransaction(parse(formType, xml));

    assert.equal(row.shares.status, "missing");
    assert.deepEqual(row.transactionTotalValue, {
      xmlPath: "/ownershipDocument/derivativeTable/derivativeTransaction[0]/transactionAmounts/transactionTotalValue",
      status: "exact",
      value: "500000",
      rawValue: "500000",
      footnoteIds: ["F8"],
    });
    assert.deepEqual(row.pricePerShare.footnoteIds, ["F9"]);
    assert.deepEqual(row.securityTitle.footnoteIds, ["F5"]);
    assert.deepEqual(row.transactionTotalValue.footnoteIds, ["F8"]);
    assert.equal(typeof row.transactionTotalValue.value, "string");
    assert.equal(row.transactionTotalValue.footnoteIds.includes("F5"), false);
    assert.equal(row.transactionTotalValue.footnoteIds.includes("F9"), false);
    assert.ok(row.footnoteIds.includes("F8"));
    assert.ok(row.footnoteIds.includes("F9"));
  }
});

test("transactionTotalValue keeps exact zero, footnote-only, and missing states distinct", () => {
  const formType = "5/A";
  const zeroXml = formXml(formType).replace(
    "<transactionShares><value>262.832</value></transactionShares>",
    "<transactionTotalValue><value>0</value></transactionTotalValue>",
  );
  const zero = derivativeTransaction(parse(formType, zeroXml)).transactionTotalValue;
  assert.equal(zero.status, "exact");
  assert.equal(zero.value, "0");
  assert.equal(zero.rawValue, "0");

  const footnoteOnlyXml = formXml(formType).replace(
    "<transactionShares><value>262.832</value></transactionShares>",
    '<transactionTotalValue><footnoteId id="F8"/></transactionTotalValue>',
  );
  const footnoteOnly = derivativeTransaction(parse(formType, footnoteOnlyXml)).transactionTotalValue;
  assert.equal(footnoteOnly.status, "footnote_only");
  assert.equal(footnoteOnly.value, null);
  assert.equal(footnoteOnly.rawValue, "");
  assert.deepEqual(footnoteOnly.footnoteIds, ["F8"]);

  const emptyXml = formXml(formType).replace(
    "<transactionShares><value>262.832</value></transactionShares>",
    "<transactionTotalValue/>",
  );
  const empty = derivativeTransaction(parse(formType, emptyXml)).transactionTotalValue;
  assert.equal(empty.status, "empty");
  assert.equal(empty.value, null);
  assert.equal(empty.rawValue, "");
  assert.deepEqual(empty.footnoteIds, []);

  const rowWithSharesAndPrice = derivativeTransaction(parse(formType, formXml(formType)));
  assert.equal(rowWithSharesAndPrice.shares.value, "262.832");
  assert.equal(rowWithSharesAndPrice.pricePerShare.value, "70.32");
  assert.deepEqual(rowWithSharesAndPrice.transactionTotalValue, {
    xmlPath: "/ownershipDocument/derivativeTable/derivativeTransaction[0]/transactionAmounts/transactionTotalValue",
    status: "missing",
    value: null,
    rawValue: null,
    footnoteIds: [],
  });
});

function formXml(formType: Section16XmlForm) {
  if (formType === "5/A") return baseXml;
  return baseXml
    .replace("<documentType>5/A</documentType>", "<documentType>5</documentType>")
    .replace(/\s*<dateOfOriginalSubmission>[\s\S]*?<\/dateOfOriginalSubmission>/, "");
}

function parse(formType: "5" | "5/A", xml: string) {
  const accessionNumber = "0000094049-26-000015";
  return parseSection16XmlFiling({
    source_unique_id: accessionNumber,
    raw_payload: {
      form_type: formType,
      accession_number: accessionNumber,
      ownership_issuer_cik: "0000094049",
      ownership_source_url: `https://www.sec.gov/Archives/edgar/data/94049/000009404926000015/form5${formType.endsWith("/A") ? "a" : ""}.xml`,
      ownership_source_format: "ownership_xml",
      ownership_source_text: xml,
      ownership_source_text_char_count: xml.length,
      ownership_source_text_truncated: false,
    },
  });
}

function replaceDerivativeContent(xml: string, search: string, replacement: string) {
  const block = /<derivativeTransaction>[\s\S]*?<\/derivativeTransaction>/.exec(xml)?.[0];
  assert.ok(block, "Expected one derivative transaction fixture block");
  assert.ok(block.includes(search), `Expected derivative transaction content: ${search}`);
  return xml.replace(block, block.replace(search, replacement));
}

function derivativeTransaction(parsed: ReturnType<typeof parseSection16XmlFiling>) {
  const row = parsed.transactions.find((candidate) => candidate.rowKind === "derivative");
  assert.ok(row);
  return row;
}
