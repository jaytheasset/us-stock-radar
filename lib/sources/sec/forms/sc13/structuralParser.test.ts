import assert from "node:assert/strict";
import { test } from "node:test";

import { parseSc13StructuralXml } from "./structuralParser.ts";

const SOURCE_URL = "https://www.sec.gov/Archives/edgar/data/1111111/000000000126000001/primary_doc.xml";
const ACCESSION = "0000000001-26-000001";

function schedule13dXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D" xmlns:com="http://www.sec.gov/edgar/common">
  <schemaVersion>X0202</schemaVersion>
  <headerData>
    <submissionType>SCHEDULE 13D/A</submissionType>
    <previousAccessionNumber>0000000001-25-000009</previousAccessionNumber>
    <filerInfo><filer><filerCredentials><cik>0002222222</cik><ccc>XXXXXXXX</ccc></filerCredentials></filer><liveTestFlag>LIVE</liveTestFlag></filerInfo>
  </headerData>
  <formData>
    <coverPageHeader>
      <amendmentNo>07</amendmentNo>
      <securitiesClassTitle>Common Stock &amp; Rights</securitiesClassTitle>
      <dateOfEvent>09/01/2026</dateOfEvent>
      <issuerInfo>
        <issuerCIK>0001111111</issuerCIK>
        <issuerCusips><issuerCusipNumber>111111111</issuerCusipNumber><issuerCusipNumber>222222222</issuerCusipNumber></issuerCusips>
        <issuerName>Example &amp; Co.</issuerName>
        <address><com:street1>1 Main St</com:street1></address>
      </issuerInfo>
    </coverPageHeader>
    <reportingPersons>
      <reportingPersonInfo>
        <reportingPersonCIK>0002222222</reportingPersonCIK><reportingPersonNoCIK>N</reportingPersonNoCIK>
        <reportingPersonName>Alpha Fund LP</reportingPersonName><memberOfGroup>a</memberOfGroup><fundType>WC</fundType>
        <soleVotingPower>000123.40</soleVotingPower><sharedVotingPower>5.00</sharedVotingPower>
        <soleDispositivePower>000123.40</soleDispositivePower><sharedDispositivePower>5.00</sharedDispositivePower>
        <aggregateAmountOwned>000128.40</aggregateAmountOwned><isAggregateExcludeShares>N</isAggregateExcludeShares>
        <percentOfClass>07.50</percentOfClass><typeOfReportingPerson>PN</typeOfReportingPerson>
      </reportingPersonInfo>
      <reportingPersonInfo>
        <reportingPersonCIK>0003333333</reportingPersonCIK><reportingPersonNoCIK>N</reportingPersonNoCIK>
        <reportingPersonName>Alpha GP LLC</reportingPersonName>
        <soleVotingPower>0.00</soleVotingPower><sharedVotingPower>000128.40</sharedVotingPower>
        <soleDispositivePower>0.00</soleDispositivePower><sharedDispositivePower>000128.40</sharedDispositivePower>
        <aggregateAmountOwned>000128.40</aggregateAmountOwned><percentOfClass>07.50</percentOfClass>
        <typeOfReportingPerson>OO</typeOfReportingPerson>
      </reportingPersonInfo>
    </reportingPersons>
    <signatureInfo><signaturePerson><reportingPersonName>Alpha Fund LP</reportingPersonName></signaturePerson></signatureInfo>
  </formData>
</edgarSubmission>`;
}

function parse(rawXml = schedule13dXml(), overrides: Record<string, unknown> = {}) {
  return parseSc13StructuralXml({
    rawXml,
    sourceFormat: "sec_schedule_13_xml",
    sourceUrl: SOURCE_URL,
    expectedAccessionNumber: ACCESSION,
    expectedFormType: "SC 13D/A",
    indexSubjectCik: "0001111111",
    indexSubjectCikCount: 1,
    indexFiledByCiks: ["0002222222"],
    indexCanonicalXmlUrl: SOURCE_URL,
    ...overrides,
  });
}

test("preserves XSD class/CUSIP nesting, reporter rows, and raw decimal precision without aggregation", () => {
  const result = parse();
  assert.equal(result.status, "parsed");
  assert.equal(result.xsdPackageVersion, "2.3");
  assert.equal(result.provenance.indexStatus, "verified");
  assert.equal(result.provenance.urlArchiveDirectoryRole, "issuer");
  assert.equal(result.filing?.previousAccessionNumberRaw, "0000000001-25-000009");
  assert.equal(result.filing?.amendmentNumberRaw, "07");
  assert.equal(result.filing?.eventDateRaw, "09/01/2026");
  assert.deepEqual(result.filing?.issuer.security, {
    classTitleRaw: "Common Stock & Rights",
    cusipsRaw: ["111111111", "222222222"],
  });
  assert.equal(result.filing?.reportingPersons.length, 2);
  assert.equal(result.filing?.reportingPersons[0]?.soleVotingPowerRaw, "000123.40");
  assert.equal(result.filing?.reportingPersons[0]?.aggregateAmountOwnedRaw, "000128.40");
  assert.equal(result.filing?.reportingPersons[0]?.percentOfClassRaw, "07.50");
  assert.equal("cusip" in (result.filing?.reportingPersons[0] ?? {}), false);
  assert.equal("aggregateReportingPersonShares" in (result.filing ?? {}), false);
});

test("does not trust URL directory CIK as issuer and can identify a distinct header filer", () => {
  const filerUrl = SOURCE_URL.replace("/1111111/", "/2222222/");
  const result = parse(schedule13dXml(), { sourceUrl: filerUrl, indexCanonicalXmlUrl: filerUrl });
  assert.equal(result.status, "parsed");
  assert.equal(result.filing?.issuer.issuerCikRaw, "0001111111");
  assert.equal(result.filing?.headerFilerCikRaw, "0002222222");
  assert.equal(result.provenance.urlArchiveDirectoryRole, "multiple");
});

test("parses Schedule 13G's distinct XSD element names without inventing reporter CIKs", () => {
  const url = "https://www.sec.gov/Archives/edgar/data/4444444/000000000226000002/primary_doc.xml";
  const xml = `<?xml version="1.0"?><edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13g">
    <schemaVersion>X0202</schemaVersion>
    <headerData><submissionType>SCHEDULE 13G/A</submissionType><previousAccessionNumber>0000000002-25-000003</previousAccessionNumber><filerInfo><filer><filerCredentials><cik>0005555555</cik><ccc>XXXXXXXX</ccc></filerCredentials></filer></filerInfo></headerData>
    <formData>
      <coverPageHeader><amendmentNo>1</amendmentNo><securitiesClassTitle>Ordinary Shares</securitiesClassTitle><eventDateRequiresFilingThisStatement>08/31/2026</eventDateRequiresFilingThisStatement><issuerInfo><issuerCik>0004444444</issuerCik><issuerName>G Issuer</issuerName><issuerCusips><issuerCusipNumber>444444444</issuerCusipNumber></issuerCusips><issuerPrincipalExecutiveOfficeAddress/></issuerInfo></coverPageHeader>
      <coverPageHeaderReportingPersonDetails><reportingPersonName>G Reporter</reportingPersonName><reportingPersonBeneficiallyOwnedNumberOfShares><soleVotingPower>265059.00</soleVotingPower><sharedVotingPower>0.00</sharedVotingPower><soleDispositivePower>265059.00</soleDispositivePower><sharedDispositivePower>0.00</sharedDispositivePower></reportingPersonBeneficiallyOwnedNumberOfShares><reportingPersonBeneficiallyOwnedAggregateNumberOfShares>265059.00</reportingPersonBeneficiallyOwnedAggregateNumberOfShares><classPercent>4.90</classPercent><typeOfReportingPerson>CO</typeOfReportingPerson></coverPageHeaderReportingPersonDetails>
      <signatureInformation><reportingPersonName>G Reporter</reportingPersonName><signatureDetails><signature>/s/ G Reporter</signature><title>Manager</title><date>09/01/2026</date></signatureDetails></signatureInformation>
    </formData>
  </edgarSubmission>`;
  const result = parseSc13StructuralXml({
    rawXml: xml,
    sourceFormat: "sec_schedule_13_xml",
    sourceUrl: url,
    expectedAccessionNumber: "0000000002-26-000002",
    expectedFormType: "SC 13G/A",
    indexSubjectCik: "0004444444",
    indexSubjectCikCount: 1,
    indexFiledByCiks: ["0005555555"],
    indexCanonicalXmlUrl: url,
  });
  assert.equal(result.status, "parsed");
  assert.equal(result.filing?.reportingPersons[0]?.reportingPersonCikRaw, null);
  assert.equal(result.filing?.reportingPersons[0]?.aggregateAmountOwnedRaw, "265059.00");
  assert.equal(result.filing?.reportingPersons[0]?.percentOfClassRaw, "4.90");
});

test("ignores comment lookalikes but fails closed on structure and namespace attacks", () => {
  const xml = schedule13dXml();
  const comment = parse(xml.replace("<issuerCIK>", "<!-- <issuerCIK>0000000009</issuerCIK> --><issuerCIK>"));
  assert.equal(comment.status, "parsed");
  assert.equal(comment.filing?.issuer.issuerCikRaw, "0001111111");

  const cases = [
    xml.replace("<issuerCIK>", '<issuerCIK xmlns="urn:foreign">'),
    xml.replace("<issuerCIK>", '<issuerCIK xmlns="">'),
    xml.replace("<aggregateAmountOwned>", "<aggregateAmountOwned>1.00</aggregateAmountOwned><aggregateAmountOwned>"),
    xml.replace(/<reportingPersonName>Alpha Fund LP<\/reportingPersonName>/, ""),
    `${xml}<evil/>`,
  ];
  for (const invalidXml of cases) assert.equal(parse(invalidXml).status, "unavailable");
});

test("fails closed on invalid source, identity, accession, truncation, and field formats", () => {
  const xml = schedule13dXml();
  const cases = [
    { sourceFormat: "text/html" },
    { sourceUrl: "http://www.sec.gov/Archives/edgar/data/1111111/000000000126000001/primary_doc.xml" },
    { sourceUrl: SOURCE_URL.replace("000000000126000001", "000000000126000002") },
    { sourceUrl: SOURCE_URL.replace("/1111111/", "/9999999/"), indexCanonicalXmlUrl: SOURCE_URL.replace("/1111111/", "/9999999/") },
    { expectedAccessionNumber: `garbage${ACCESSION}garbage` },
    { sourceTextCharCount: xml.length + 1 },
    { rawXml: xml.replace("<issuerCIK>0001111111</issuerCIK>", "<issuerCIK>junk0001111111junk</issuerCIK>") },
    { rawXml: xml.replace("<percentOfClass>07.50</percentOfClass>", "<percentOfClass>101.00</percentOfClass>") },
    { rawXml: xml.slice(0, -20) },
  ];
  for (const overrides of cases) {
    const result = parse(typeof overrides.rawXml === "string" ? overrides.rawXml : xml, overrides);
    assert.equal(result.status, "unavailable", JSON.stringify(overrides));
    assert.equal(result.filing, null);
  }
});

test("fails closed when official index Subject, Filed by, or canonical href provenance is missing or mismatched", () => {
  const cases = [
    { indexSubjectCik: null, indexSubjectCikCount: 0 },
    { indexSubjectCik: "0009999999" },
    { indexFiledByCiks: ["0009999999"] },
    { indexCanonicalXmlUrl: SOURCE_URL.replace("000000000126000001", "000000000126000002") },
    { indexSubjectCik: "0002222222", indexFiledByCiks: ["0002222222"] },
  ];
  for (const overrides of cases) {
    const result = parse(schedule13dXml(), overrides);
    assert.equal(result.status, "unavailable");
    assert.notEqual(result.provenance.indexStatus, "verified");
  }
});
