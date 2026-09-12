import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveSection16StoredLineage, type Section16LineageFiling } from "./lineage.ts";
import { parseSection16XmlFiling, preserveSection16XmlSource } from "../sources/sec/forms/section16Xml/parser.ts";

type Fixture = {
  file: string;
  formType: "3" | "3/A" | "5" | "5/A";
  accessionNumber: string;
  issuerCik: string;
  filingDate: string;
  acceptedAt: string;
  sourceUrl: string;
  sha256: string;
};

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../sources/sec/forms/section16Xml/fixtures");
const originalManifest = JSON.parse(readFileSync(path.join(fixtureDir, "lineage-sources.json"), "utf8")) as {
  fixturePolicy: Record<string, string>;
  fixtures: Fixture[];
};
const existingManifest = JSON.parse(readFileSync(path.join(fixtureDir, "sources.json"), "utf8")) as {
  fixtures: Fixture[];
};

test("lineage counterpart fixtures retain exact officially downloaded bytes", () => {
  assert.equal(originalManifest.fixturePolicy.kind, "exact_bytes_from_official_sec_archive");
  for (const fixture of originalManifest.fixtures) {
    const xml = readFileSync(path.join(fixtureDir, fixture.file), "utf8");
    assert.equal(createHash("sha256").update(xml, "utf8").digest("hex"), fixture.sha256);
    assert.match(fixture.sourceUrl, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//);
  }
});

test("real Form 3/A stays unresolved when its no-securities original cannot confirm security identity", () => {
  const projection = resolveSection16StoredLineage([
    parseFixture(requiredOriginal("3")),
    parseFixture(requiredExisting("3/A")),
  ]);
  assert.equal(projection.links.length, 1);
  assert.deepEqual(projection.links[0], {
    accessionNumber: "0000891839-26-000252",
    referencedAccessionNumber: "0000891839-26-000231",
    status: "unresolved",
    reason: "security_identity_unverified",
    evidence: {
      source: "date_of_original_submission",
      originalSubmissionDateRaw: "2026-06-05",
      issuerIdentity: "confirmed",
      reporterIdentity: "confirmed",
      securityIdentity: "unresolved",
    },
  });
  assert.equal(projection.transactions.length, 0, "Form 3 holdings never enter transaction dedupe");
  assert.equal(projection.holdings.length, 2);
  assert.ok(projection.holdings.every((row) => row.preservationStatus === "preserved_filing_snapshot"));
});

test("real Form 5/A links only on verified identities and preserves new transactions plus the explicit holding correction", () => {
  const projection = resolveSection16StoredLineage([
    parseFixture(requiredExisting("5/A")),
    parseFixture(requiredOriginal("5")),
  ]);
  assert.equal(projection.links[0]?.status, "linked");
  assert.equal(projection.links[0]?.referencedAccessionNumber, "0001127602-25-004959");
  assert.equal(projection.transactions.length, 5);
  assert.ok(projection.transactions.every((row) => row.aggregationStatus === "included" && row.reason === "distinct_transaction"));
  assert.equal(projection.holdings.length, 16, "both filing snapshots remain present, including zero-valued rows");
  assert.deepEqual(projection.holdingCorrections.map((item) => ({
    accessionNumber: item.accessionNumber,
    rowOrdinal: item.rowOrdinal,
    corrects: item.corrects,
    previousValueRaw: item.previousValueRaw,
    correctedValueRaw: item.correctedValueRaw,
    footnoteId: item.evidence.footnoteId,
  })), [{
    accessionNumber: "0000094049-26-000015",
    rowOrdinal: 6,
    corrects: { accessionNumber: "0001127602-25-004959", rowOrdinal: 4 },
    previousValueRaw: "67.214",
    correctedValueRaw: "67214",
    footnoteId: "F3",
  }]);
});

test("excludes an exact repeated transaction only when one affirmative SEC statement uniquely identifies it", () => {
  const original = parseFixture(requiredExisting("5"));
  const amendment = amendmentFrom(original, {
    accessionNumber: "0000036146-26-900001",
    remarks: "The transaction on 2025-04-29 for 10 shares of Common Stock, transaction code P, was previously reported in Form 5 filed 2026-02-13 and is unchanged.",
  });
  const projection = resolveSection16StoredLineage([amendment, original]);
  assert.equal(projection.links[0]?.status, "linked");
  assert.equal(projection.transactions.filter((row) => row.aggregationStatus === "excluded_confirmed_duplicate").length, 1);
  const excluded = projection.transactions.find((row) => row.aggregationStatus === "excluded_confirmed_duplicate");
  assert.deepEqual(excluded?.duplicateOf, { accessionNumber: original.accessionNumber, rowOrdinal: 0 });
  assert.equal(excluded?.evidence?.source, "remarks");
});

test("negation, duplicate amendment rows, and quantity changes all fail closed without excluding transactions", () => {
  const original = parseFixture(requiredExisting("5"));
  const negative = amendmentFrom(original, {
    accessionNumber: "0000036146-26-900002",
    remarks: "The transaction on 2025-04-29 for 10 shares of Common Stock, transaction code P, was not previously reported in Form 5 filed 2026-02-13; it is not a duplicate and is unchanged.",
  });
  let projection = resolveSection16StoredLineage([original, negative]);
  assert.equal(projection.transactions.filter((row) => row.aggregationStatus === "excluded_confirmed_duplicate").length, 0);
  assert.equal(projection.transactions.at(6)?.reason, "possible_repeat_without_explicit_sec_evidence");

  const contradictory = amendmentFrom(original, {
    accessionNumber: "0000036146-26-900010",
    remarks: "The transaction on 2025-04-29 for 10 shares of Common Stock, transaction code P, was previously reported in Form 5 filed 2026-02-13 and is unchanged. This statement is incorrect. This is a different transaction.",
  });
  projection = resolveSection16StoredLineage([original, contradictory]);
  assert.equal(projection.transactions.filter((row) => row.aggregationStatus === "excluded_confirmed_duplicate").length, 0);
  assert.equal(projection.transactions.at(6)?.reason, "possible_repeat_without_explicit_sec_evidence");

  const unrelatedQuantity = amendmentFrom(original, {
    accessionNumber: "0000036146-26-900012",
    remarks: "The transaction on 2025-04-29 for 100 shares of Common Stock, transaction code P, was previously reported in Form 5 filed 2026-02-13 and is unchanged at a price of 10 dollars.",
  });
  projection = resolveSection16StoredLineage([original, unrelatedQuantity]);
  assert.equal(projection.transactions.filter((row) => row.aggregationStatus === "excluded_confirmed_duplicate").length, 0);
  assert.equal(projection.transactions.at(6)?.reason, "possible_repeat_without_explicit_sec_evidence");

  const duplicated = amendmentFrom(original, {
    accessionNumber: "0000036146-26-900003",
    remarks: "The transaction on 2025-04-29 for 10 shares of Common Stock, transaction code P, was previously reported in Form 5 filed 2026-02-13 and is unchanged.",
  });
  duplicated.parsed.transactions.splice(1, duplicated.parsed.transactions.length - 1, structuredClone(duplicated.parsed.transactions[0]!));
  projection = resolveSection16StoredLineage([original, duplicated]);
  assert.equal(projection.transactions.filter((row) => row.aggregationStatus === "excluded_confirmed_duplicate").length, 0);
  assert.equal(projection.transactions.at(6)?.reason, "ambiguous_prior_transaction_match");
  assert.equal(projection.transactions.at(7)?.reason, "ambiguous_prior_transaction_match");

  const changed = amendmentFrom(original, {
    accessionNumber: "0000036146-26-900004",
    remarks: "The transaction on 2025-04-29 for 11 shares of Common Stock, transaction code P, was previously reported in Form 5 filed 2026-02-13 and is unchanged.",
  });
  changed.parsed.transactions.splice(1);
  changed.parsed.transactions[0]!.shares.value = "11";
  changed.parsed.transactions[0]!.shares.rawValue = "11";
  projection = resolveSection16StoredLineage([original, changed]);
  assert.equal(projection.transactions.at(6)?.aggregationStatus, "included");
  assert.equal(projection.transactions.at(6)?.reason, "distinct_transaction");
  assert.equal(projection.transactions.filter((row) => row.accessionNumber === original.accessionNumber).length, 6, "original rows are not deleted");
});

test("same-date multiple candidates and reporter, security, and ordering mismatches remain unresolved", () => {
  const original = parseFixture(requiredExisting("5"));
  const amendment = amendmentFrom(original, { accessionNumber: "0000036146-26-900005", remarks: "" });
  const secondRoot = structuredClone(original);
  secondRoot.accessionNumber = "0000036146-26-900006";
  assert.equal(resolveSection16StoredLineage([original, secondRoot, amendment]).links[0]?.reason, "multiple_original_candidates");

  const unverifiedRoot = structuredClone(original);
  unverifiedRoot.accessionNumber = "0000036146-26-900011";
  unverifiedRoot.parsed.reportingOwners[0]!.cik = {
    xmlPath: unverifiedRoot.parsed.reportingOwners[0]!.cik.xmlPath,
    status: "missing",
    value: null,
    rawValue: null,
    footnoteIds: [],
  };
  assert.equal(
    resolveSection16StoredLineage([original, unverifiedRoot, amendment]).links[0]?.reason,
    "multiple_unverified_original_candidates",
  );

  const reporterMismatch = amendmentFrom(original, { accessionNumber: "0000036146-26-900007", remarks: "" });
  reporterMismatch.parsed.reportingOwners[0]!.cik.value = "0000000001";
  reporterMismatch.parsed.reportingOwners[0]!.cik.rawValue = "0000000001";
  assert.equal(resolveSection16StoredLineage([original, reporterMismatch]).links[0]?.reason, "reporter_identity_mismatch");

  const securityMismatch = amendmentFrom(original, { accessionNumber: "0000036146-26-900008", remarks: "" });
  securityMismatch.parsed.transactions[0]!.securityTitle.value = "Preferred Stock";
  securityMismatch.parsed.transactions[0]!.securityTitle.rawValue = "Preferred Stock";
  assert.equal(resolveSection16StoredLineage([original, securityMismatch]).links[0]?.reason, "security_identity_mismatch");

  const mixedClock = amendmentFrom(original, { accessionNumber: "0000036146-26-900009", remarks: "" });
  mixedClock.parsed.filing.filingDate.value = original.parsed.filing.filingDate.value;
  mixedClock.parsed.filing.filingDate.rawValue = original.parsed.filing.filingDate.rawValue;
  mixedClock.parsed.filing.acceptedAt.value = "2026-02-13T17:00:00Z";
  mixedClock.parsed.filing.acceptedAt.rawValue = "2026-02-13T17:00:00Z";
  assert.equal(resolveSection16StoredLineage([mixedClock, original]).links[0]?.reason, "filing_order_reversed_or_unverified");

  const stepanOriginal = parseFixture(requiredOriginal("5"));
  const derivativeMismatch = parseFixture(requiredExisting("5/A"));
  const derivativeRow = derivativeMismatch.parsed.transactions.find((row: { rowKind: string }) => row.rowKind === "derivative");
  assert.ok(derivativeRow);
  derivativeRow.expirationDate = exactField("2030-01-01", derivativeRow.expirationDate.xmlPath);
  assert.equal(
    resolveSection16StoredLineage([stepanOriginal, derivativeMismatch]).links[0]?.reason,
    "security_identity_mismatch",
  );
});

function amendmentFrom(
  original: Section16LineageFiling,
  input: { accessionNumber: string; remarks: string },
): MutableLineageFiling {
  const amendment = structuredClone(original) as MutableLineageFiling;
  amendment.accessionNumber = input.accessionNumber;
  amendment.parsed.formType = "5/A";
  amendment.parsed.isAmendment = true;
  amendment.parsed.filing.documentType.value = "5/A";
  amendment.parsed.filing.documentType.rawValue = "5/A";
  amendment.parsed.filing.dateOfOriginalSubmission = exactField("2026-02-13", "/ownershipDocument/dateOfOriginalSubmission");
  amendment.parsed.filing.filingDate = exactField("2026-03-01", "raw_payload.filing_date");
  amendment.parsed.filing.acceptedAt = exactField("2026-03-01 12:00:00", "raw_payload.accepted_at");
  amendment.parsed.filing.remarks = input.remarks
    ? exactField(input.remarks, "/ownershipDocument/remarks")
    : { xmlPath: "/ownershipDocument/remarks", status: "missing", value: null, rawValue: null, footnoteIds: [] };
  return amendment;
}

function exactField(value: string, xmlPath: string) {
  return { xmlPath, status: "exact" as const, value, rawValue: value, footnoteIds: [] };
}

function parseFixture(fixture: Fixture): MutableLineageFiling {
  const xml = readFileSync(path.join(fixtureDir, fixture.file), "utf8");
  const preserved = preserveSection16XmlSource({
    formType: fixture.formType,
    sourceUrl: fixture.sourceUrl,
    text: xml,
    sha256: fixture.sha256,
  });
  return {
    accessionNumber: fixture.accessionNumber,
    parsed: parseSection16XmlFiling({
      source_unique_id: fixture.accessionNumber,
      raw_payload: {
        form_type: fixture.formType,
        accession_number: fixture.accessionNumber,
        ownership_issuer_cik: fixture.issuerCik,
        filing_date: fixture.filingDate,
        accepted_at: fixture.acceptedAt,
        ...preserved,
      },
    }),
  };
}

function requiredOriginal(formType: "3" | "5") {
  const fixture = originalManifest.fixtures.find((item) => item.formType === formType);
  assert.ok(fixture);
  return fixture;
}

function requiredExisting(formType: "3/A" | "5" | "5/A") {
  const fixture = existingManifest.fixtures.find((item) => item.formType === formType);
  assert.ok(fixture);
  return fixture;
}

type MutableLineageFiling = {
  -readonly [Key in keyof Section16LineageFiling]: Section16LineageFiling[Key] extends object
    ? any
    : Section16LineageFiling[Key];
};
