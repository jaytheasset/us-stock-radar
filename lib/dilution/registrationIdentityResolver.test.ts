import assert from "node:assert/strict";
import test from "node:test";
import {
  DILUTION_EVIDENCE_IDENTITY_VERSION,
  type DilutionEvidenceIdentity,
  type DilutionRegistrationObservationKind,
} from "./economicExposureContracts.ts";
import {
  resolveRegistrationIdentities,
  type RegistrationIdentityConflict,
  type RegistrationIdentityResolved,
  type RegistrationIdentityResolverObservation,
  type RegistrationIdentityUnresolved,
} from "./registrationIdentityResolver.ts";

test("A. same CIK + 333 base, amendment, and EFFECT form one registration", () => {
  const input = [
    observation({ accession: "0000000001-26-000001", form: "S-1", number: "333-123456" }),
    observation({ accession: "0000000001-26-000002", form: "S-1/A", number: "333-123456" }),
    observation({ cik: "1", accession: "9999999995-26-000003", form: "EFFECT", number: "333-123456" }),
  ];

  const result = resolveRegistrationIdentities(input);
  assert.equal(result.length, 1);
  const registration = onlyResolved(result);
  assert.equal(registration.canonical_key, "reg:v1:0000000001:333-123456");
  assert.deepEqual(registration.supporting_observations.map((item) => item.form), ["S-1", "S-1/A", "EFFECT"]);
  assert.deepEqual(registration.supporting_accessions, [
    "0000000001-26-000001",
    "0000000001-26-000002",
    "9999999995-26-000003",
  ]);
});

test("B. same CIK + 333 registration and 424B observations form one registration", () => {
  const result = resolveRegistrationIdentities([
    observation({ accession: "0000000002-26-000001", form: "S-3", number: "333-222222" }),
    observation({ accession: "0000000002-26-000002", form: "424B5", number: "333-222222" }),
    observation({ accession: "0000000002-26-000003", form: "424B3", number: "333-222222" }),
  ]);

  const registration = onlyResolved(result);
  assert.equal(registration.registration_file_number, "333-222222");
  assert.deepEqual(registration.supporting_observations.map((item) => item.form), ["S-3", "424B5", "424B3"]);
});

test("C. same registration number under different issuer CIKs remains different identity", () => {
  const resolved = resolvedResults(resolveRegistrationIdentities([
    observation({ cik: "1", accession: "0000000001-26-000010", form: "S-3", number: "333-300000" }),
    observation({ cik: "2", accession: "0000000002-26-000010", form: "S-3", number: "333-300000" }),
  ]));

  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved.map((item) => item.canonical_key), [
    "reg:v1:0000000001:333-300000",
    "reg:v1:0000000002:333-300000",
  ]);
});

test("D. Exchange Act 001-only claim remains unresolved", () => {
  const result = resolveRegistrationIdentities([
    observation({ accession: "0000000003-26-000001", form: "S-3", number: "001-12345" }),
  ]);

  const unresolved = onlyUnresolved(result);
  assert.equal(unresolved.reason, "INVALID_REGISTRATION_FILE_NUMBER");
  assert.equal(unresolved.observation.registration_file_number, null);
  assert.equal(unresolved.observation.claimed_registration_file_number, "001-12345");
});

test("E. malformed 333 claim remains unresolved", () => {
  const unresolved = onlyUnresolved(resolveRegistrationIdentities([
    observation({ accession: "0000000004-26-000001", form: "S-3", number: "333-ABC" }),
  ]));

  assert.equal(unresolved.reason, "INVALID_REGISTRATION_FILE_NUMBER");
});

test("F. missing number plus exact parent accession resolves", () => {
  const parentAccession = "0000000005-26-000001";
  const result = resolveRegistrationIdentities([
    observation({ accession: parentAccession, form: "S-3", number: "333-500000" }),
    observation({
      accession: "0000000005-26-000002",
      form: "424B5",
      number: null,
      parent: parentAccession,
    }),
  ]);

  const registration = onlyResolved(result);
  const child = registration.supporting_observations.find((item) => item.form === "424B5");
  assert.equal(child?.resolution_basis, "EXACT_PARENT_ACCESSION");
  assert.equal(registration.canonical_key, "reg:v1:0000000005:333-500000");
});

test("G. exact number and exact parent agreement resolves", () => {
  const parentAccession = "0000000006-26-000001";
  const registration = onlyResolved(resolveRegistrationIdentities([
    observation({ accession: parentAccession, form: "S-3", number: "333-600000" }),
    observation({
      accession: "0000000006-26-000002",
      form: "S-3/A",
      number: "333 - 600000",
      parent: parentAccession,
    }),
  ]));

  assert.ok(registration.resolution_bases.includes("EXACT_NUMBER_AND_PARENT_ACCESSION_AGREE"));
});

test("H. exact number and exact parent disagreement is a conflict", () => {
  const parentAccession = "0000000007-26-000001";
  const result = resolveRegistrationIdentities([
    observation({ accession: parentAccession, form: "S-3", number: "333-700001" }),
    observation({
      accession: "0000000007-26-000002",
      form: "S-3/A",
      number: "333-700002",
      parent: parentAccession,
    }),
  ]);

  const conflict = conflictFor(result, "0000000007-26-000002");
  assert.equal(conflict.reason, "REGISTRATION_NUMBER_PARENT_DISAGREE");
  assert.deepEqual(conflict.conflicting_identities.map((item) => item.registration_file_number), [
    "333-700001",
    "333-700002",
  ]);
});

test("I. cross-issuer exact parent is a conflict", () => {
  const parentAccession = "0000000008-26-000001";
  const result = resolveRegistrationIdentities([
    observation({ cik: "8", accession: parentAccession, form: "S-3", number: "333-800000" }),
    observation({
      cik: "9",
      accession: "0000000009-26-000002",
      form: "424B3",
      number: null,
      parent: parentAccession,
    }),
  ]);

  const conflict = conflictFor(result, "0000000009-26-000002");
  assert.equal(conflict.reason, "CROSS_ISSUER_PARENT");
  assert.deepEqual(conflict.conflicting_issuer_ciks, ["0000000008", "0000000009"]);
});

test("J. recent or similar same-issuer filing without source identity remains unresolved", () => {
  const result = resolveRegistrationIdentities([
    observation({
      cik: "10",
      accession: "0000000010-26-000001",
      form: "S-3",
      number: "333-100000",
      filedDate: "2026-01-01",
    }),
    observation({
      cik: "10",
      accession: "0000000010-26-000002",
      form: "S-3/A",
      number: null,
      filedDate: "2026-01-02",
    }),
  ]);

  const unresolved = unresolvedFor(result, "0000000010-26-000002");
  assert.equal(unresolved.reason, "NO_SOURCE_BACKED_IDENTITY");
});

test("K. S-3ASR resolves without a separate EFFECT observation", () => {
  const result = resolveRegistrationIdentities([
    observation({ accession: "0000000011-26-000001", form: "S-3ASR", number: "333-110000" }),
  ]);

  const registration = onlyResolved(result);
  assert.deepEqual(registration.supporting_observations.map((item) => item.form), ["S-3ASR"]);
  assert.equal(registration.supporting_observations[0].observation_kind, "automatically_effective");
});

test("L. chronological, reverse, shuffled, and duplicate input is deterministic and idempotent", () => {
  const parentAccession = "0000000012-26-000001";
  const chronological = [
    observation({ accession: parentAccession, form: "S-3", number: "333-120000", filedDate: "2026-02-01" }),
    observation({ accession: "0000000012-26-000002", form: "S-3/A", number: "333-120000", filedDate: "2026-02-02" }),
    observation({
      accession: "9999999995-26-000012",
      form: "EFFECT",
      number: null,
      parent: parentAccession,
      filedDate: "2026-02-03",
    }),
  ];
  const expected = resolveRegistrationIdentities(chronological);

  assert.deepEqual(resolveRegistrationIdentities([...chronological].reverse()), expected);
  assert.deepEqual(resolveRegistrationIdentities([chronological[2], chronological[0], chronological[1]]), expected);
  assert.deepEqual(resolveRegistrationIdentities([...chronological, chronological[1]]), expected);
  assert.deepEqual(resolveRegistrationIdentities(chronological), expected);
});

test("M. one issuer with multiple 333 registrations never collapses", () => {
  const resolved = resolvedResults(resolveRegistrationIdentities([
    observation({ accession: "0000000013-26-000001", form: "S-3", number: "333-130001" }),
    observation({ accession: "0000000013-26-000002", form: "S-3", number: "333-130002" }),
  ]));

  assert.equal(resolved.length, 2);
  assert.deepEqual(resolved.map((item) => item.registration_file_number), ["333-130001", "333-130002"]);
});

test("N. ambiguous exact parent accession keeps 424B unresolved as conflict", () => {
  const ambiguousParent = "0000000014-26-000001";
  const childAccession = "0000000014-26-000002";
  const result = resolveRegistrationIdentities([
    observation({ accession: ambiguousParent, form: "S-3", number: "333-140001" }),
    observation({ accession: ambiguousParent, form: "S-3", number: "333-140002" }),
    observation({ accession: childAccession, form: "424B3", number: null, parent: ambiguousParent }),
  ]);

  const conflict = conflictFor(result, childAccession);
  assert.equal(conflict.reason, "AMBIGUOUS_PARENT_ACCESSION");
  assert.equal(conflict.conflicting_identities.length, 2);
});

test("O. registration identity resolution creates no Economic Exposure or issuance arithmetic", () => {
  const result = resolveRegistrationIdentities([
    observation({ accession: "0000000015-26-000001", form: "S-3", number: "333-150000" }),
  ]);
  const forbiddenKeys = new Set([
    "exposure_id",
    "exposure_type",
    "relationship_kind",
    "potential_shares",
    "dilution_percent",
    "atm_remaining",
    "conversion_price",
    "issuance_status",
  ]);

  walkObject(result, (key) => assert.equal(forbiddenKeys.has(key), false, `forbidden output key: ${key}`));
});

test("P. POS AM and MEF link only through exact 333 or exact parent accession", () => {
  const parentAccession = "0000000016-26-000001";
  const result = resolveRegistrationIdentities([
    observation({ accession: parentAccession, form: "S-3", number: "333-160000" }),
    observation({ accession: "0000000016-26-000002", form: "POS AM", number: "333-160000" }),
    observation({ accession: "0000000016-26-000003", form: "S-3MEF", number: null, parent: parentAccession }),
    observation({ accession: "0000000016-26-000004", form: "S-3MEF", number: null }),
  ]);

  const registration = onlyResolved(resolvedResults(result));
  assert.deepEqual(registration.supporting_observations.map((item) => item.form), ["S-3", "POS AM", "S-3MEF"]);
  assert.equal(unresolvedFor(result, "0000000016-26-000004").reason, "NO_SOURCE_BACKED_IDENTITY");
});

function observation(input: {
  cik?: string;
  accession: string;
  form: string;
  number: string | null;
  parent?: string | null;
  filedDate?: string;
}): RegistrationIdentityResolverObservation {
  const claimEvidence = evidence(input.accession);
  return {
    issuer_cik: input.cik ?? input.accession.slice(0, 10),
    accession: input.accession,
    form: input.form,
    filed_date: input.filedDate ?? dateFromAccession(input.accession),
    accepted_at: null,
    registration_number_claim: input.number === null
      ? null
      : { value: input.number, evidence_identity: claimEvidence },
    explicit_parent_accession_claim: input.parent
      ? { value: input.parent, evidence_identity: claimEvidence }
      : null,
    observation_kind: observationKind(input.form),
    evidence_identities: [claimEvidence],
  };
}

function evidence(accession: string): DilutionEvidenceIdentity {
  return {
    version: DILUTION_EVIDENCE_IDENTITY_VERSION,
    source_ref: `sec_${accession.replace(/-/g, "_")}`,
    range_start: 0,
    range_end: 1,
    source_content_hash: "a".repeat(64),
    exact_source: true,
  };
}

function observationKind(form: string): DilutionRegistrationObservationKind {
  const normalized = form.toUpperCase();
  if (normalized === "EFFECT") return "effectiveness_declared";
  if (normalized === "S-3ASR" || normalized === "F-3ASR") return "automatically_effective";
  if (/^424B/.test(normalized)) return "prospectus_supplement";
  if (normalized === "POS AM") return "post_effective_amendment";
  if (normalized.endsWith("/A")) return "registration_amended";
  return "registration_filed";
}

function dateFromAccession(accession: string) {
  const sequence = Number(accession.slice(-2));
  return `2026-01-${String(Math.max(1, Math.min(28, sequence))).padStart(2, "0")}`;
}

function resolvedResults(
  results: readonly ReturnType<typeof resolveRegistrationIdentities>[number][],
): RegistrationIdentityResolved[] {
  return results.filter((result): result is RegistrationIdentityResolved => result.status === "RESOLVED");
}

function onlyResolved(
  results: readonly ReturnType<typeof resolveRegistrationIdentities>[number][],
) {
  const resolved = resolvedResults(results);
  assert.equal(resolved.length, 1);
  return resolved[0];
}

function onlyUnresolved(
  results: readonly ReturnType<typeof resolveRegistrationIdentities>[number][],
) {
  const unresolved = results.filter((result): result is RegistrationIdentityUnresolved => result.status === "UNRESOLVED");
  assert.equal(unresolved.length, 1);
  return unresolved[0];
}

function unresolvedFor(
  results: readonly ReturnType<typeof resolveRegistrationIdentities>[number][],
  accession: string,
) {
  const unresolved = results.find((result): result is RegistrationIdentityUnresolved =>
    result.status === "UNRESOLVED" && result.observation.accession === accession);
  assert.ok(unresolved, `missing unresolved result for ${accession}`);
  return unresolved;
}

function conflictFor(
  results: readonly ReturnType<typeof resolveRegistrationIdentities>[number][],
  accession: string,
) {
  const conflict = results.find((result): result is RegistrationIdentityConflict =>
    result.status === "CONFLICT" && result.observation.accession === accession);
  assert.ok(conflict, `missing conflict result for ${accession}`);
  return conflict;
}

function walkObject(value: unknown, visitKey: (key: string) => void) {
  if (Array.isArray(value)) {
    for (const item of value) walkObject(item, visitKey);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    visitKey(key);
    walkObject(item, visitKey);
  }
}
