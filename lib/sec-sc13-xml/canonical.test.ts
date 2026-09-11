import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildSc13CanonicalPayload,
  Sc13CanonicalSourceError,
  validateSc13CanonicalRead,
} from "./canonical.ts";

const ACCESSION = "0000000001-26-000001";
const SOURCE_URL = "https://www.sec.gov/Archives/edgar/data/2222222/000000000126000001/primary_doc.xml";

function schedule13dXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D">
  <schemaVersion>X0202</schemaVersion>
  <headerData>
    <submissionType>SCHEDULE 13D/A</submissionType>
    <previousAccessionNumber>0000000001-25-000009</previousAccessionNumber>
    <filerInfo><filer><filerCredentials><cik>0002222222</cik><ccc>XXXXXXXX</ccc></filerCredentials></filer></filerInfo>
  </headerData>
  <formData>
    <coverPageHeader>
      <amendmentNo>07</amendmentNo><securitiesClassTitle>Common Stock &amp; Rights</securitiesClassTitle><dateOfEvent>09/01/2026</dateOfEvent>
      <issuerInfo><issuerCIK>0001111111</issuerCIK><issuerCusips><issuerCusipNumber>111111111</issuerCusipNumber><issuerCusipNumber>222222222</issuerCusipNumber></issuerCusips><issuerName>Issuer 😀 &amp; Co.</issuerName></issuerInfo>
    </coverPageHeader>
    <reportingPersons>
      <reportingPersonInfo>
        <reportingPersonCIK>0002222222</reportingPersonCIK><reportingPersonNoCIK>N</reportingPersonNoCIK><reportingPersonName>Alpha Fund LP</reportingPersonName><memberOfGroup>a</memberOfGroup><fundType>WC</fundType>
        <soleVotingPower>000123.40</soleVotingPower><sharedVotingPower>5.00</sharedVotingPower><soleDispositivePower>000123.40</soleDispositivePower><sharedDispositivePower>5.00</sharedDispositivePower><aggregateAmountOwned>000128.40</aggregateAmountOwned><isAggregateExcludeShares>N</isAggregateExcludeShares><percentOfClass>07.50</percentOfClass><typeOfReportingPerson>PN</typeOfReportingPerson>
      </reportingPersonInfo>
      <reportingPersonInfo>
        <reportingPersonName>Alpha GP LLC</reportingPersonName><reportingPersonNoCIK>Y</reportingPersonNoCIK>
        <soleVotingPower>0.00</soleVotingPower><soleDispositivePower>0.00</soleDispositivePower><aggregateAmountOwned>0.00</aggregateAmountOwned><percentOfClass>0.00</percentOfClass><typeOfReportingPerson>OO</typeOfReportingPerson>
      </reportingPersonInfo>
    </reportingPersons>
  </formData>
</edgarSubmission>`;
}

function rawItem(overrides: Record<string, unknown> = {}) {
  const xml = schedule13dXml();
  return {
    source_unique_id: ACCESSION,
    body_text: "",
    analysis_text: "",
    raw_payload: {
      form_type: "SC 13D/A",
      accession_number: ACCESSION,
      ownership_issuer_cik: "0001111111",
      filer_cik: "0002222222",
      accepted_at: "2026-09-02T01:02:03.000Z",
      sc13_source_text: xml,
      sc13_source_format: "sec_schedule_13_xml",
      sc13_source_url: SOURCE_URL,
      sc13_source_text_char_count: xml.length,
      sc13_source_text_truncated: false,
      sc13_index_subject_cik: "0001111111",
      sc13_index_subject_cik_count: 1,
      sc13_index_filed_by_ciks: ["0002222222"],
      sc13_index_canonical_xml_url: SOURCE_URL,
      ...overrides,
    },
  };
}

test("builds immutable filing and one row per reporter without aggregating or losing raw decimals", () => {
  const payload = buildSc13CanonicalPayload("88000000-0000-4000-8000-000000000001", rawItem());
  assert.ok(payload);
  assert.equal(payload.filing.issuer_cik, "0001111111");
  assert.equal(payload.filing.header_filer_cik, "0002222222");
  assert.equal(payload.filing.previous_accession_number_raw, "0000000001-25-000009");
  assert.equal(payload.filing.amendment_number_raw, "07");
  assert.equal(payload.filing.event_date, "2026-09-01");
  assert.deepEqual(payload.filing.cusips_raw, ["111111111", "222222222"]);
  assert.equal(payload.reporters.length, 2);
  assert.equal(payload.reporters[0]?.aggregate_amount_owned_raw, "000128.40");
  assert.equal(payload.reporters[0]?.percent_of_class_raw, "07.50");
  assert.equal(payload.reporters[1]?.aggregate_amount_owned_raw, "0.00");
  assert.equal(payload.reporters[1]?.shared_voting_power_raw, null);
  assert.equal(payload.filing.raw_xml_char_count, schedule13dXml().length);
  assert.equal(payload.filing.raw_xml_utf8_byte_count, Buffer.byteLength(schedule13dXml(), "utf8"));
});

test("uses official index roles instead of ambiguous legacy CIK fields and fails closed on source mismatch", () => {
  const legacyMismatch = buildSc13CanonicalPayload(
    "88000000-0000-4000-8000-000000000001",
    rawItem({ ownership_issuer_cik: null, cik: "0002222222", filer_cik: "0001111111" }),
  );
  assert.equal(legacyMismatch?.filing.issuer_cik, "0001111111");
  assert.equal(legacyMismatch?.filing.header_filer_cik, "0002222222");
  assert.throws(
    () => buildSc13CanonicalPayload("88000000-0000-4000-8000-000000000001", {
      ...rawItem(),
      source_unique_id: "0000000001-26-000002",
    }),
    (error) => error instanceof Sc13CanonicalSourceError && error.code === "accession_mismatch",
  );
  assert.throws(
    () => buildSc13CanonicalPayload("88000000-0000-4000-8000-000000000001", rawItem({ sc13_index_subject_cik_count: 0 })),
    (error) => error instanceof Sc13CanonicalSourceError && error.code === "source_unavailable",
  );
});

test("re-parses persisted XML during readback and rejects changed structural rows", () => {
  const payload = buildSc13CanonicalPayload("88000000-0000-4000-8000-000000000001", rawItem());
  assert.ok(payload);
  const filing: Record<string, unknown> = { ...payload.filing, amendment_number: 7 };
  const reporters: Array<Record<string, unknown>> = payload.reporters.map((reporter) => ({
    ...reporter,
    reporting_person_cik: reporter.reporting_person_cik ?? null,
    sole_voting_power: decimal(reporter.sole_voting_power_raw),
    shared_voting_power: decimal(reporter.shared_voting_power_raw),
    sole_dispositive_power: decimal(reporter.sole_dispositive_power_raw),
    shared_dispositive_power: decimal(reporter.shared_dispositive_power_raw),
    aggregate_amount_owned: decimal(reporter.aggregate_amount_owned_raw),
    percent_of_class: decimal(reporter.percent_of_class_raw),
    aggregate_excludes_certain_shares: reporter.aggregate_excludes_certain_shares_flag_raw === "Y"
      ? true
      : reporter.aggregate_excludes_certain_shares_flag_raw === "N" ? false : null,
  }));
  const valid = validateSc13CanonicalRead(filing, reporters);
  assert.equal(valid.ok, true);

  const changed = reporters.map((reporter) => ({ ...reporter }));
  changed[0] = { ...changed[0], aggregate_amount_owned_raw: "999.00" };
  assert.deepEqual(validateSc13CanonicalRead(filing, changed), { ok: false, reason: "reporter_columns_mismatch" });

  const changedXml = { ...filing, raw_xml: `${filing.raw_xml as string} ` };
  assert.deepEqual(validateSc13CanonicalRead(changedXml, reporters), { ok: false, reason: "source_hash_mismatch" });
  for (const changedFiling of [
    { ...filing, issuer_cik: "0001517137" },
    { ...filing, security_class_raw: "WRONG CLASS" },
    { ...filing, event_date: "2000-01-01" },
  ]) {
    assert.deepEqual(validateSc13CanonicalRead(changedFiling, reporters), {
      ok: false,
      reason: "filing_columns_mismatch",
    });
  }
});

function decimal(value: unknown) {
  return typeof value === "string" ? Number(value) : null;
}
