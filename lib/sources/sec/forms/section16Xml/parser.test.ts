import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SEC_OWNERSHIP_FORMS } from "../common/forms.ts";
import { ownershipFormAdapter } from "../ownership/adapter.ts";
import {
  SECTION_16_XML_FORMS,
  Section16XmlParseError,
  parseSection16XmlFiling,
  preserveSection16XmlSource,
} from "./parser.ts";

type FixtureMetadata = {
  file: string;
  formType: "3" | "3/A" | "5" | "5/A";
  accessionNumber: string;
  issuerCik: string;
  filingDate: string;
  acceptedAt: string;
  sourceUrl: string;
  completeSubmissionUrl: string;
  sha256: string;
};

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixtureManifest = JSON.parse(readFileSync(path.join(fixtureDir, "sources.json"), "utf8")) as {
  fixturePolicy: Record<string, string>;
  fixtures: FixtureMetadata[];
};

test("official SEC fixture manifest records sources and exact local SHA-256 bytes", () => {
  assert.equal(fixtureManifest.fixturePolicy.liveByteIdentity, "unverified_sec_downloads_returned_403_or_browser_blocked");
  for (const fixture of fixtureManifest.fixtures) {
    const xml = fixtureXml(fixture);
    assert.match(fixture.sourceUrl, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
    assert.match(fixture.completeSubmissionUrl, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
    assert.equal(sha256(xml), fixture.sha256, fixture.file);
  }
});

test("Form 3/A remains a holdings snapshot with exact zero, empty, and missing states", () => {
  const parsed = parseFixture("0000891839-26-000252-form3a.xml");
  assert.equal(parsed.parserMode, "xml_only_no_llm");
  assert.equal(parsed.formType, "3/A");
  assert.equal(parsed.isAmendment, true);
  assert.equal(parsed.filing.filingDate.value, "2026-06-18");
  assert.equal(parsed.filing.acceptedAt.value, "2026-06-18 16:18:13");
  assert.equal(parsed.filing.periodOfReport.value, "2026-06-01");
  assert.equal(parsed.filing.dateOfOriginalSubmission.value, "2026-06-05");
  assert.deepEqual(parsed.filing.noSecuritiesOwned, {
    xmlPath: "/ownershipDocument/noSecuritiesOwned",
    status: "exact",
    value: false,
    rawValue: "0",
    footnoteIds: [],
  });
  assert.equal(parsed.filing.form3HoldingsReported.status, "missing");
  assert.equal(parsed.issuer.foreignTradingSymbol.status, "empty");
  assert.equal(parsed.reportingOwners.length, 1);
  assert.equal(parsed.reportingOwners[0].relationship.isDirector.value, true);
  assert.equal(parsed.reportingOwners[0].relationship.isOfficer.value, false);
  assert.equal(parsed.transactions.length, 0);
  assert.equal(parsed.holdings.length, 2);
  assert.equal(parsed.holdings[0].rowKind, "non_derivative");
  assert.equal(parsed.holdings[0].amountOwned.value, "20000");
  assert.equal(typeof parsed.holdings[0].amountOwned.value, "string");
  assert.equal(parsed.holdings[1].rowKind, "derivative");
  assert.equal(parsed.holdings[1].underlyingSecurityShares.value, "25000");
  assert.equal(parsed.holdings[1].amountOwned.status, "missing");
  assert.equal(parsed.source.unknownElementsPreserved, true);
  assert.match(parsed.source.canonicalXml, /<issuerForeignTradingSymbol><\/issuerForeignTradingSymbol>/);
});

test("Form 3 no-securities and absent holdings states are preserved without inventing transactions", () => {
  const base = fixtureByFile("0000891839-26-000252-form3a.xml");
  const form3 = {
    ...base,
    formType: "3" as const,
    sourceUrl: base.sourceUrl.replace("form3a.xml", "form3.xml"),
  };
  const withoutTables = fixtureXml(base)
    .replace("<documentType>3/A</documentType>", "<documentType>3</documentType>")
    .replace(/\s*<dateOfOriginalSubmission>[\s\S]*?<\/dateOfOriginalSubmission>/, "")
    .replace("<noSecuritiesOwned>0</noSecuritiesOwned>", "<noSecuritiesOwned>1</noSecuritiesOwned>")
    .replace(/\s*<nonDerivativeTable>[\s\S]*?<\/nonDerivativeTable>/, "")
    .replace(/\s*<derivativeTable>[\s\S]*?<\/derivativeTable>/, "");
  const parsed = parseSection16XmlFiling(rawItem(form3, withoutTables));
  assert.equal(parsed.formType, "3");
  assert.equal(parsed.filing.noSecuritiesOwned.value, true);
  assert.equal(parsed.holdings.length, 0);
  assert.equal(parsed.transactions.length, 0);

  const missingIndicator = withoutTables.replace("<noSecuritiesOwned>1</noSecuritiesOwned>", "");
  const missingParsed = parseSection16XmlFiling(rawItem(form3, missingIndicator));
  assert.equal(missingParsed.filing.noSecuritiesOwned.status, "missing");
  assert.equal(missingParsed.holdings.length, 0);
  assert.equal(missingParsed.transactions.length, 0);
});

test("Form 5 keeps document, filing, report, transaction, and row form dates and identities separate", () => {
  const parsed = parseFixture("0000036146-26-000004-form5.xml");
  assert.equal(parsed.formType, "5");
  assert.equal(parsed.filing.documentType.value, "5");
  assert.equal(parsed.filing.filingDate.value, "2026-02-13");
  assert.equal(parsed.filing.acceptedAt.value, "2026-02-13 16:29:10");
  assert.equal(parsed.filing.periodOfReport.value, "2025-12-31");
  assert.equal(parsed.filing.dateOfOriginalSubmission.status, "missing");
  assert.equal(parsed.filing.form3HoldingsReported.value, false);
  assert.equal(parsed.filing.form4TransactionsReported.value, true);
  assert.equal(parsed.filing.aff10b5One.value, false);
  assert.equal(parsed.transactions.length, 6);
  assert.equal(parsed.holdings.length, 0);
  assert.ok(parsed.transactions.every((row) => row.transactionFormType.value === "4"));
  assert.equal(parsed.transactions[0].transactionDate.value, "2025-04-29");
  assert.equal(parsed.transactions[0].transactionTimeliness.status, "missing");
  assert.equal(parsed.transactions[0].shares.value, "10");
  assert.equal(parsed.transactions[0].pricePerShare.value, "34.09");
  assert.equal("transactionValue" in parsed.transactions[0], false);
});

test("Form 5/A preserves mixed row form types, late versus empty, exact zero, holdings, and footnote-only values", () => {
  const parsed = parseFixture("0000094049-26-000015-form5a.xml");
  assert.equal(parsed.formType, "5/A");
  assert.equal(parsed.filing.filingDate.value, "2026-02-19");
  assert.equal(parsed.filing.acceptedAt.value, "2026-02-19 19:18:38");
  assert.equal(parsed.filing.periodOfReport.value, "2024-12-31");
  assert.equal(parsed.filing.dateOfOriginalSubmission.value, "2025-02-14");
  assert.equal(parsed.transactions.length, 5);
  assert.equal(parsed.holdings.length, 7);
  assert.deepEqual([...new Set(parsed.transactions.map((row) => row.transactionFormType.value))].sort(), ["4", "5"]);
  assert.equal(parsed.transactions[0].transactionTimeliness.value, "L");
  assert.equal(parsed.transactions[1].transactionTimeliness.status, "empty");
  assert.equal(parsed.transactions[1].pricePerShare.status, "exact");
  assert.equal(parsed.transactions[1].pricePerShare.value, "0");
  assert.equal(parsed.transactions[1].postTransactionShares.value, "0");
  assert.equal(parsed.holdings[2].amountOwned.value, "0");
  assert.equal(parsed.holdings[2].transactionFormType.status, "missing");
  const derivative = parsed.transactions.find((row) => row.rowKind === "derivative");
  assert.ok(derivative);
  assert.equal(derivative.conversionOrExercisePrice.status, "footnote_only");
  assert.deepEqual(derivative.conversionOrExercisePrice.footnoteIds, ["F6"]);
  assert.equal(derivative.exerciseDate.status, "footnote_only");
  assert.deepEqual(derivative.exerciseDate.footnoteIds, ["F7"]);
  assert.match(parsed.footnotes.find((footnote) => footnote.id === "F3")?.text ?? "", /"67\.214"/);
});

test("shares and value XML choices remain distinct source strings without conversion", () => {
  const fixture = fixtureByFile("0000891839-26-000252-form3a.xml");
  const xml = fixtureXml(fixture).replace(
    "<underlyingSecurityShares>\n                    <value>25000</value>\n                </underlyingSecurityShares>",
    "<underlyingSecurityValue>\n                    <value>25000.000000000000000001</value>\n                </underlyingSecurityValue>",
  );
  const parsed = parseSection16XmlFiling(rawItem(fixture, xml));
  assert.equal(parsed.holdings[1].underlyingSecurityShares.status, "missing");
  assert.equal(parsed.holdings[1].underlyingSecurityValue.value, "25000.000000000000000001");
});

test("self-closing values are empty, entities decode once, and published_at cannot impersonate accepted_at", () => {
  const form3 = fixtureByFile("0000891839-26-000252-form3a.xml");
  const selfClosing = fixtureXml(form3).replace("<noSecuritiesOwned>0</noSecuritiesOwned>", "<noSecuritiesOwned/>");
  const emptyParsed = parseSection16XmlFiling(rawItem(form3, selfClosing));
  assert.equal(emptyParsed.filing.noSecuritiesOwned.status, "empty");

  const form5 = fixtureByFile("0000036146-26-000004-form5.xml");
  const entityXml = fixtureXml(form5).replace("<issuerName>TRUSTMARK CORP</issuerName>", "<issuerName>TRUSTMARK &amp;#49;</issuerName>");
  const entityParsed = parseSection16XmlFiling(rawItem(form5, entityXml));
  assert.equal(entityParsed.issuer.name.rawValue, "TRUSTMARK &amp;#49;");
  assert.equal(entityParsed.issuer.name.value, "TRUSTMARK &#49;");

  const cdataXml = fixtureXml(form5).replace(
    "<issuerName>TRUSTMARK CORP</issuerName>",
    "<issuerName><![CDATA[A &amp; B]]></issuerName>",
  );
  const cdataParsed = parseSection16XmlFiling(rawItem(form5, cdataXml));
  assert.equal(cdataParsed.issuer.name.rawValue, "A &amp; B");
  assert.equal(cdataParsed.issuer.name.value, "A &amp; B");

  const item = rawItem(form5, fixtureXml(form5));
  delete (item.raw_payload as Record<string, unknown>).accepted_at;
  item.published_at = "2026-02-13T16:29:10Z";
  assert.equal(parseSection16XmlFiling(item).filing.acceptedAt.status, "missing");
});

test("known fields are read only from their exact parent path while unknown extensions remain in source", () => {
  const fixture = fixtureByFile("0000891839-26-000252-form3a.xml");
  const xml = fixtureXml(fixture).replace(
    /<securityTitle>([\s\S]*?)<\/securityTitle>/,
    "<unknownExtension><securityTitle>$1</securityTitle></unknownExtension>",
  );
  const parsed = parseSection16XmlFiling(rawItem(fixture, xml));
  assert.equal(parsed.holdings[0].securityTitle.status, "missing");
  assert.equal(parsed.holdings[0].securityTitle.value, null);
  assert.match(parsed.source.canonicalXml, /<unknownExtension><securityTitle>/);
});

test("malformed XML, comments, duplicate identity, and source integrity conditions fail closed", () => {
  const fixture = fixtureByFile("0000891839-26-000252-form3a.xml");
  const xml = fixtureXml(fixture);

  expectCode(() => parseSection16XmlFiling(rawItem(fixture, xml.replace("</nonDerivativeHolding>", ""))), "malformed_xml");

  const commentXml = xml.replace(
    "<issuer>",
    "<!-- <issuer><issuerCik>9999999999</issuerCik></issuer> -->\n    <issuer>",
  );
  assert.equal(parseSection16XmlFiling(rawItem(fixture, commentXml)).issuer.cik.value, "0001854445");

  const issuerBlock = /<issuer>[\s\S]*?<\/issuer>/.exec(xml)?.[0] ?? "";
  expectCode(() => parseSection16XmlFiling(rawItem(fixture, xml.replace(issuerBlock, `${issuerBlock}${issuerBlock}`))), "duplicate_element");

  const wrongUrl = rawItem(fixture, xml);
  (wrongUrl.raw_payload as Record<string, unknown>).ownership_source_url =
    "https://www.sec.gov/Archives/edgar/data/1854445/000089183926000253/form3a.xml";
  expectCode(() => parseSection16XmlFiling(wrongUrl), "source_accession_mismatch");

  const wrongIssuer = rawItem(fixture, xml);
  (wrongIssuer.raw_payload as Record<string, unknown>).ownership_issuer_cik = "not-a-cik";
  (wrongIssuer.raw_payload as Record<string, unknown>).cik = "also-invalid";
  expectCode(() => parseSection16XmlFiling(wrongIssuer), "issuer_cik_mismatch");

  const wrongDocument = rawItem(fixture, xml);
  (wrongDocument.raw_payload as Record<string, unknown>).form_type = "3";
  expectCode(() => parseSection16XmlFiling(wrongDocument), "document_type_mismatch");

  const truncated = rawItem(fixture, xml);
  (truncated.raw_payload as Record<string, unknown>).ownership_source_text_truncated = true;
  expectCode(() => parseSection16XmlFiling(truncated), "truncated_source");

  const nonXml = rawItem(fixture, xml);
  (nonXml.raw_payload as Record<string, unknown>).ownership_source_format = "raw_xml";
  expectCode(() => parseSection16XmlFiling(nonXml), "non_xml_source");

  const badHash = rawItem(fixture, xml);
  (badHash.raw_payload as Record<string, unknown>).ownership_source_sha256 = "0".repeat(64);
  expectCode(() => parseSection16XmlFiling(badHash), "source_sha256_mismatch");

  const badLength = rawItem(fixture, xml);
  (badLength.raw_payload as Record<string, unknown>).ownership_source_text_char_count = xml.length + 1;
  expectCode(() => parseSection16XmlFiling(badLength), "source_length_mismatch");

  const badIdentity = rawItem(fixture, xml);
  badIdentity.source_unique_id = "0000891839-26-000253";
  expectCode(() => parseSection16XmlFiling(badIdentity), "accession_identity_mismatch");

  const namespaced = xml.replace("<ownershipDocument>", '<ownershipDocument xmlns="urn:unrelated">');
  expectCode(() => parseSection16XmlFiling(rawItem(fixture, namespaced)), "unsupported_namespace");

  const childNamespaced = xml.replace("<issuer>", '<issuer xmlns="urn:unrelated">');
  expectCode(() => parseSection16XmlFiling(rawItem(fixture, childNamespaced)), "unsupported_namespace");
});

test("Form 3/5 XML-only contract remains isolated from Form 4/144 site analysis", () => {
  assert.deepEqual(SEC_OWNERSHIP_FORMS, ["4", "4/A", "144", "144/A"]);
  assert.deepEqual(SECTION_16_XML_FORMS, ["3", "3/A", "5", "5/A"]);
  for (const form of SECTION_16_XML_FORMS) assert.equal(ownershipFormAdapter.matches(form), false);
  assert.equal(ownershipFormAdapter.matches("4"), true);
  expectCode(
    () => preserveSection16XmlSource({
      formType: "4",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/000000000000000001/form4.xml",
      text: "<ownershipDocument><documentType>4</documentType></ownershipDocument>",
    }),
    "unsupported_form",
  );
});

function parseFixture(file: string) {
  const fixture = fixtureByFile(file);
  return parseSection16XmlFiling(rawItem(fixture, fixtureXml(fixture)));
}

function rawItem(fixture: FixtureMetadata, xml: string) {
  const digest = sha256(xml);
  const preserved = preserveSection16XmlSource({
    formType: fixture.formType,
    sourceUrl: fixture.sourceUrl,
    text: xml,
    sha256: digest,
  });
  return {
    source_unique_id: fixture.accessionNumber,
    published_at: fixture.acceptedAt,
    raw_payload: {
      form_type: fixture.formType,
      accession_number: fixture.accessionNumber,
      ownership_issuer_cik: fixture.issuerCik,
      filing_date: fixture.filingDate,
      accepted_at: fixture.acceptedAt,
      ...preserved,
    },
  };
}

function fixtureByFile(file: string) {
  const fixture = fixtureManifest.fixtures.find((candidate) => candidate.file === file);
  assert.ok(fixture, `Missing fixture metadata: ${file}`);
  return fixture;
}

function fixtureXml(fixture: FixtureMetadata) {
  return readFileSync(path.join(fixtureDir, fixture.file), "utf8");
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function expectCode(action: () => unknown, code: string) {
  assert.throws(action, (error) => error instanceof Section16XmlParseError && error.code === code);
}
