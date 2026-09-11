import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveSc13StoredLineage,
  type Sc13LineageFiling,
  type Sc13LineageReporter,
} from "./lineage.ts";

const ROOT = "0000000001-26-000001";
const AMENDMENT_1 = "0000000001-26-000002";
const AMENDMENT_2 = "0000000001-26-000003";

test("links an explicit original and projects each reporter without summing", () => {
  const root = filing({
    accessionNumber: ROOT,
    reporters: [
      reporter("0000000101", "Adviser", "100", "10"),
      reporter("0000000102", "General Partner", "80", "8"),
    ],
  });
  const amendment = filing({
    accessionNumber: AMENDMENT_1,
    formTypeRaw: "SCHEDULE 13D/A",
    previousAccessionNumberRaw: ROOT,
    amendmentNumber: 1,
    filedAt: "2026-06-02T10:00:00.000Z",
    reporters: [
      reporter("0000000101", "Adviser", "100", "9"),
      reporter("0000000102", "General Partner", "80", "7"),
    ],
  });

  const projection = resolveSc13StoredLineage([amendment, root]);
  assert.deepEqual(projection.links, [{
    accessionNumber: AMENDMENT_1,
    referencedAccessionNumber: ROOT,
    status: "linked",
    reason: null,
    evidence: "xml_previous_accession_number",
  }]);
  assert.equal(projection.secGlobalCompleteness, "not_verified");
  const position = projection.positions[0]!;
  assert.equal(position.status, "available_stored_history");
  if (position.status !== "available_stored_history") return;
  assert.equal(position.headAccessionNumber, AMENDMENT_1);
  assert.equal(position.currentReporters.length, 2);
  assert.deepEqual(position.currentReporters.map((item) => ({
    cik: item.reportingPersonCik,
    aggregate: item.values.aggregateAmountOwnedRaw.valueRaw,
    percent: item.values.percentOfClassRaw.valueRaw,
  })), [
    { cik: "0000000101", aggregate: "100", percent: "9" },
    { cik: "0000000102", aggregate: "80", percent: "7" },
  ]);
});

test("accepts direct-to-original amendment anchors only with a complete ordered amendment sequence", () => {
  const root = filing({ accessionNumber: ROOT });
  const amendment1 = filing({
    accessionNumber: AMENDMENT_1,
    formTypeRaw: "SCHEDULE 13D/A",
    previousAccessionNumberRaw: ROOT,
    amendmentNumber: 1,
    filedAt: "2026-06-02T10:00:00.000Z",
  });
  const amendment2 = filing({
    accessionNumber: AMENDMENT_2,
    formTypeRaw: "SCHEDULE 13D/A",
    previousAccessionNumberRaw: ROOT,
    amendmentNumber: 2,
    filedAt: "2026-06-03T10:00:00.000Z",
  });

  const projection = resolveSc13StoredLineage([amendment2, root, amendment1]);
  assert.deepEqual(projection.links.map((item) => item.status), ["linked", "linked"]);
  assert.equal(projection.positions[0]?.status, "available_stored_history");
  assert.equal(projection.positions[0]?.headAccessionNumber, AMENDMENT_2);

  const missingMiddle = resolveSc13StoredLineage([root, amendment2]);
  assert.equal(missingMiddle.positions[0]?.status, "unresolved");
  assert.ok(missingMiddle.positions[0]?.issues.includes("missing_amendment_sequence"));
});

test("fails closed for duplicate amendment numbers and reversed filing order", () => {
  const root = filing({ accessionNumber: ROOT });
  const duplicate = filing({
    accessionNumber: AMENDMENT_2,
    formTypeRaw: "SCHEDULE 13D/A",
    previousAccessionNumberRaw: ROOT,
    amendmentNumber: 1,
    filedAt: "2026-05-31T10:00:00.000Z",
  });
  const amendment1 = filing({
    accessionNumber: AMENDMENT_1,
    formTypeRaw: "SCHEDULE 13D/A",
    previousAccessionNumberRaw: ROOT,
    amendmentNumber: 1,
    filedAt: "2026-06-02T10:00:00.000Z",
  });
  const projection = resolveSc13StoredLineage([root, amendment1, duplicate]);
  const position = projection.positions[0]!;
  assert.equal(position.status, "unresolved");
  assert.ok(position.issues.includes("duplicate_amendment_number"));
  assert.ok(projection.links.some((link) => link.reason === "filing_order_reversed"));
});

test("keeps missing predecessors and ungrounded 13D to 13G transitions unresolved", () => {
  const root = filing({ accessionNumber: ROOT });
  const missing = filing({
    accessionNumber: AMENDMENT_1,
    formTypeRaw: "SCHEDULE 13D/A",
    previousAccessionNumberRaw: "0000000009-26-000009",
    amendmentNumber: 1,
    filedAt: "2026-06-02T10:00:00.000Z",
  });
  const transition = filing({
    accessionNumber: AMENDMENT_2,
    formTypeRaw: "SCHEDULE 13G/A",
    previousAccessionNumberRaw: ROOT,
    amendmentNumber: 1,
    filedAt: "2026-06-03T10:00:00.000Z",
  });
  const projection = resolveSc13StoredLineage([root, missing, transition]);
  assert.equal(projection.links.find((item) => item.accessionNumber === AMENDMENT_1)?.reason, "missing_predecessor");
  assert.equal(projection.links.find((item) => item.accessionNumber === AMENDMENT_2)?.reason, "form_family_mismatch");
  assert.equal(projection.positions.every((position) => position.status === "unresolved"), true);
});

test("keeps issuer, class, CUSIP, header filer, and reporter identity checks separate", () => {
  const root = filing({ accessionNumber: ROOT });
  const variants: Array<[string, Partial<Sc13LineageFiling>]> = [
    ["issuer_identity_mismatch", { issuerCik: "0000000099" }],
    ["security_class_identity_mismatch", { securityClassRaw: "Class B Common Stock" }],
    ["cusip_identity_mismatch", { cusipsRaw: ["999999999"] }],
    ["header_filer_identity_mismatch", { headerFilerCik: "0000000098" }],
    ["reporter_identity_mismatch", { reporters: [reporter("0000000199", "Other", "100", "10")] }],
  ];
  for (const [reason, patch] of variants) {
    const amendment = filing({
      accessionNumber: AMENDMENT_1,
      formTypeRaw: "SCHEDULE 13D/A",
      previousAccessionNumberRaw: ROOT,
      amendmentNumber: 1,
      filedAt: "2026-06-02T10:00:00.000Z",
      ...patch,
    });
    const projection = resolveSc13StoredLineage([root, amendment]);
    assert.equal(projection.links[0]?.reason, reason, reason);
    assert.equal(projection.positions.every((position) => position.status === "unresolved"), true, reason);
  }
});

test("does not turn missing current fields or missing reporters into zero or an exit", () => {
  const root = filing({ accessionNumber: ROOT, reporters: [reporter("0000000101", "Adviser", "100", "10")] });
  const missingFieldReporter = reporter("0000000101", "Adviser", null, "0");
  const amendment = filing({
    accessionNumber: AMENDMENT_1,
    formTypeRaw: "SCHEDULE 13D/A",
    previousAccessionNumberRaw: ROOT,
    amendmentNumber: 1,
    filedAt: "2026-06-02T10:00:00.000Z",
    reporters: [missingFieldReporter],
  });
  const projection = resolveSc13StoredLineage([root, amendment]);
  const position = projection.positions[0]!;
  assert.equal(position.status, "available_stored_history");
  if (position.status !== "available_stored_history") return;
  const values = position.currentReporters[0]!.values;
  assert.deepEqual(values.aggregateAmountOwnedRaw, {
    status: "unresolved",
    valueRaw: null,
    sourceAccessionNumber: null,
    reason: "current_filing_field_missing",
    lastReported: { valueRaw: "100", sourceAccessionNumber: ROOT },
  });
  assert.equal(values.percentOfClassRaw.status, "available");
  assert.equal(values.percentOfClassRaw.valueRaw, "0");

  const reporterMissing = resolveSc13StoredLineage([root, {
    ...amendment,
    reporters: [],
  }]);
  assert.equal(reporterMissing.positions.every((item) => item.status === "unresolved"), true);
  assert.equal(reporterMissing.links[0]?.reason, "reporter_identity_mismatch");
});

test("keeps the same reporter's multiple security classes as separate positions", () => {
  const classA = filing({ accessionNumber: ROOT, securityClassRaw: "Class A Common Stock", cusipsRaw: ["111111111"] });
  const classB = filing({ accessionNumber: "0000000002-26-000001", securityClassRaw: "Class B Common Stock", cusipsRaw: ["222222222"] });
  const projection = resolveSc13StoredLineage([classB, classA]);
  assert.equal(projection.positions.length, 2);
  assert.equal(projection.positions.every((position) => position.status === "available_stored_history"), true);
});

test("an overlapping unresolved partial-reporter amendment also blocks the prior reporter position", () => {
  const reporterA = reporter("0000000101", "Adviser", "100", "10");
  const reporterB = reporter("0000000102", "Partner", "80", "8");
  const root = filing({ accessionNumber: ROOT, reporters: [reporterA, reporterB] });
  const unresolvedPartial = filing({
    accessionNumber: AMENDMENT_1,
    formTypeRaw: "SCHEDULE 13D/A",
    amendmentNumber: 1,
    previousAccessionNumberRaw: null,
    filedAt: "2026-06-02T10:00:00.000Z",
    reporters: [reporterA, { ...reporter("0000000198", "Missing CIK", "20", "2"), reportingPersonCik: null }],
  });
  const unrelated = filing({
    accessionNumber: "0000000002-26-000002",
    formTypeRaw: "SCHEDULE 13D/A",
    amendmentNumber: 1,
    previousAccessionNumberRaw: null,
    filedAt: "2026-06-02T11:00:00.000Z",
    reporters: [reporter("0000000199", "Unrelated", "50", "5")],
  });
  const projection = resolveSc13StoredLineage([root, unresolvedPartial, unrelated]);
  const rootPosition = projection.positions.find((position) => position.rootAccessionNumber === ROOT)!;
  assert.equal(rootPosition.status, "unresolved");
  assert.ok(rootPosition.issues.some((issue) => issue === `overlapping_unresolved_filing:${AMENDMENT_1}`));
  const unrelatedPosition = projection.positions.find((position) => position.positionKey.includes("cik:0000000199"))!;
  assert.equal(unrelatedPosition.issues.some((issue) => issue.includes(ROOT)), false);
});

test("same reporter and security across 13D and 13G roots remains a cross-family latestness boundary", () => {
  const schedule13d = filing({ accessionNumber: ROOT });
  const schedule13g = filing({ accessionNumber: "0000000002-26-000001", formTypeRaw: "SCHEDULE 13G" });
  const projection = resolveSc13StoredLineage([schedule13d, schedule13g]);
  assert.equal(projection.positions.length, 2);
  assert.equal(projection.positions.every((position) => position.status === "unresolved"), true);
  assert.equal(projection.positions.every((position) => position.issues.some((issue) => issue.startsWith("cross_form_family_overlap:"))), true);
});

function filing(overrides: Partial<Sc13LineageFiling> & Pick<Sc13LineageFiling, "accessionNumber">): Sc13LineageFiling {
  return {
    accessionNumber: overrides.accessionNumber,
    formTypeRaw: overrides.formTypeRaw ?? "SCHEDULE 13D",
    previousAccessionNumberRaw: overrides.previousAccessionNumberRaw ?? null,
    amendmentNumber: overrides.amendmentNumber ?? null,
    filedAt: overrides.filedAt ?? "2026-06-01T10:00:00.000Z",
    eventDate: overrides.eventDate ?? "2026-05-30",
    headerFilerCik: overrides.headerFilerCik ?? "0000000101",
    issuerCik: overrides.issuerCik ?? "0000000201",
    securityClassRaw: overrides.securityClassRaw ?? "Common Stock",
    cusipsRaw: overrides.cusipsRaw ?? ["123456789"],
    reporters: overrides.reporters ?? [reporter("0000000101", "Adviser", "100", "10")],
  };
}

function reporter(
  cik: string,
  name: string,
  aggregate: string | null,
  percent: string | null,
): Sc13LineageReporter {
  return {
    reportingPersonIndex: 0,
    reportingPersonCik: cik,
    reportingPersonNameRaw: name,
    values: {
      soleVotingPowerRaw: "0",
      sharedVotingPowerRaw: aggregate,
      soleDispositivePowerRaw: "0",
      sharedDispositivePowerRaw: aggregate,
      aggregateAmountOwnedRaw: aggregate,
      percentOfClassRaw: percent,
    },
  };
}
