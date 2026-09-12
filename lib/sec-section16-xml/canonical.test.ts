import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertSection16CallerMatchesStored,
  buildSection16CanonicalPayload,
  Section16CanonicalSourceError,
  validateSection16CanonicalRead,
} from "./canonical.ts";
import { preserveSection16XmlSource } from "../sources/sec/forms/section16Xml/parser.ts";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../sources/sec/forms/section16Xml/fixtures");
const manifest = JSON.parse(readFileSync(path.join(fixtureDir, "sources.json"), "utf8")) as {
  fixtures: Fixture[];
};

test("canonical Section 16 rows round-trip every parser field with and without a declared source hash", () => {
  for (const fixture of manifest.fixtures) {
    for (const includeDeclaredHash of [true, false]) {
      const rawItem = fixtureRawItem(fixture, fixtureXml(fixture), includeDeclaredHash);
      const payload = buildSection16CanonicalPayload("71000000-0000-4000-8000-000000000001", rawItem);
      assert.ok(payload);
      const validation = validateSection16CanonicalRead({
        filing: payload.filing,
        reportingOwners: payload.reportingOwners,
        transactions: payload.transactions,
        holdings: payload.holdings,
        footnotes: payload.footnotes,
        signatures: payload.signatures,
      });
      assert.equal(validation.ok, true, `${fixture.formType} declared hash=${includeDeclaredHash}`);
      if (validation.ok) assert.deepEqual(validation.parsed, payload.parsed);
    }
  }
});

test("Form 3 holdings stay separate from transactions and Form 5 row dates stay distinct from filing dates", () => {
  const form3 = requiredFixture("3/A");
  const form3Payload = buildSection16CanonicalPayload(
    "71000000-0000-4000-8000-000000000002",
    fixtureRawItem(form3, fixtureXml(form3), true),
  );
  assert.ok(form3Payload);
  assert.equal(form3Payload.transactions.length, 0);
  assert.equal(form3Payload.holdings.length, 2);

  const syntheticForm3Xml = fixtureXml(form3)
    .replace("<documentType>3/A</documentType>", "<documentType>3</documentType>")
    .replace(/\s*<dateOfOriginalSubmission>[\s\S]*?<\/dateOfOriginalSubmission>/, "");
  const syntheticForm3 = {
    ...form3,
    formType: "3" as const,
    sourceUrl: form3.sourceUrl.replace("form3a.xml", "form3.xml"),
  };
  const form3InitialPayload = buildSection16CanonicalPayload(
    "71000000-0000-4000-8000-000000000007",
    fixtureRawItem(syntheticForm3, syntheticForm3Xml, true),
  );
  assert.ok(form3InitialPayload);
  assert.equal(form3InitialPayload.filing.form_type_raw, "3");
  assert.equal(form3InitialPayload.transactions.length, 0);
  assert.equal(form3InitialPayload.holdings.length, 2);

  const form5 = requiredFixture("5");
  const form5Payload = buildSection16CanonicalPayload(
    "71000000-0000-4000-8000-000000000003",
    fixtureRawItem(form5, fixtureXml(form5), true),
  );
  assert.ok(form5Payload);
  assert.equal(form5Payload.filing.filing_date_raw, "2026-02-13");
  assert.equal(form5Payload.transactions[0]?.transaction_date_raw, "2025-04-29");
  assert.equal(form5Payload.holdings.length, 0);
});

test("direct transactionTotalValue states persist as exact strings without calculation", () => {
  const fixture = requiredFixture("5/A");
  const base = fixtureXml(fixture);
  const cases = [
    {
      replacement: "<transactionTotalValue><value>500000</value><footnoteId id=\"F8\"/></transactionTotalValue>",
      expected: { status: "exact", raw: "500000", footnotes: ["F8"] },
    },
    {
      replacement: "<transactionTotalValue><value>0</value></transactionTotalValue>",
      expected: { status: "exact", raw: "0", footnotes: [] },
    },
    {
      replacement: "<transactionTotalValue><footnoteId id=\"F8\"/></transactionTotalValue>",
      expected: { status: "footnote_only", raw: "", footnotes: ["F8"] },
    },
  ] as const;
  for (const item of cases) {
    const xml = replaceFirstDerivativeShares(base, item.replacement);
    const payload = buildSection16CanonicalPayload(
      "71000000-0000-4000-8000-000000000004",
      fixtureRawItem(fixture, xml, true),
    );
    assert.ok(payload);
    const row = payload.transactions.find((candidate) => candidate.row_kind === "derivative");
    assert.ok(row);
    assert.equal(row.transaction_total_value_raw, item.expected.raw);
    const structural = row.structural_payload as Record<string, any>;
    assert.equal(structural.transactionTotalValue.status, item.expected.status);
    assert.deepEqual(structural.transactionTotalValue.footnoteIds, item.expected.footnotes);
  }

  const missingPayload = buildSection16CanonicalPayload(
    "71000000-0000-4000-8000-000000000005",
    fixtureRawItem(fixture, base, true),
  );
  assert.ok(missingPayload);
  const missing = missingPayload.transactions.find((candidate) => candidate.row_kind === "derivative");
  assert.ok(missing);
  assert.equal(missing.transaction_total_value_raw, null);
  assert.equal((missing.structural_payload as Record<string, any>).transactionTotalValue.status, "missing");
});

test("stored source mismatch and child corruption fail closed", () => {
  const fixture = requiredFixture("5");
  const stored = fixtureRawItem(fixture, fixtureXml(fixture), true);
  const caller = structuredClone(stored);
  (caller.raw_payload as Record<string, unknown>).ownership_source_url = String(
    (caller.raw_payload as Record<string, unknown>).ownership_source_url,
  ).replace("000003614626000004", "000003614626000005");
  assert.throws(
    () => assertSection16CallerMatchesStored(caller, stored),
    (error) => error instanceof Section16CanonicalSourceError && error.code === "stored_source_mismatch",
  );

  const payload = buildSection16CanonicalPayload("71000000-0000-4000-8000-000000000006", stored);
  assert.ok(payload);
  assert.deepEqual(
    validateSection16CanonicalRead({
      filing: { ...payload.filing, raw_item_id: "not-a-uuid" },
      reportingOwners: payload.reportingOwners,
      transactions: payload.transactions,
      holdings: payload.holdings,
      footnotes: payload.footnotes,
      signatures: payload.signatures,
    }),
    { ok: false, reason: "raw_item_identity_invalid" },
  );
  const corrupted = structuredClone(payload.transactions);
  corrupted[0]!.shares_raw = "999999999";
  assert.deepEqual(
    validateSection16CanonicalRead({
      filing: payload.filing,
      reportingOwners: payload.reportingOwners,
      transactions: corrupted,
      holdings: payload.holdings,
      footnotes: payload.footnotes,
      signatures: payload.signatures,
    }),
    { ok: false, reason: "transaction_columns_mismatch" },
  );
});

type Fixture = {
  file: string;
  formType: "3" | "3/A" | "5" | "5/A";
  accessionNumber: string;
  issuerCik: string;
  filingDate: string;
  acceptedAt: string;
  sourceUrl: string;
};

function requiredFixture(formType: "3/A" | "5" | "5/A") {
  const fixture = manifest.fixtures.find((candidate) => candidate.formType === formType);
  assert.ok(fixture);
  return fixture;
}

function fixtureXml(fixture: Fixture) {
  return readFileSync(path.join(fixtureDir, fixture.file), "utf8");
}

function fixtureRawItem(fixture: Fixture, xml: string, includeDeclaredHash: boolean): Record<string, unknown> {
  const preserved = preserveSection16XmlSource({
    formType: fixture.formType,
    sourceUrl: fixture.sourceUrl,
    text: xml,
  });
  if (!includeDeclaredHash) delete (preserved as Partial<typeof preserved>).ownership_source_sha256;
  return {
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: fixture.accessionNumber,
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

function replaceFirstDerivativeShares(xml: string, replacement: string) {
  const block = /<derivativeTransaction>[\s\S]*?<\/derivativeTransaction>/.exec(xml)?.[0];
  assert.ok(block);
  assert.match(block, /<transactionShares><value>262\.832<\/value><\/transactionShares>/);
  return xml.replace(
    block,
    block.replace("<transactionShares><value>262.832</value></transactionShares>", replacement),
  );
}
