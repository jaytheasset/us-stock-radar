import assert from "node:assert/strict";
import test from "node:test";
import {
  DILUTION_EVIDENCE_IDENTITY_VERSION,
  DILUTION_EXPOSURE_REGISTRATION_RELATIONSHIP_VERSION,
  DILUTION_EXPOSURE_TYPES,
  DILUTION_IDENTITY_CLAIM_VERSION,
  DILUTION_IDENTITY_DECISION_VERSION,
  DILUTION_REGISTRATION_OBSERVATION_KINDS,
  DILUTION_REGISTRATION_OBSERVATION_VERSION,
  DILUTION_SOURCE_OBSERVATION_KINDS,
  DILUTION_SOURCE_OBSERVATION_VERSION,
  buildDilutionEvidenceIdentity,
  buildRegistrationCanonicalKey,
  normalizeRegistrationFileNumber,
  validateDilutionEvidenceIdentity,
  validateDilutionExposureRegistrationRelationship,
  validateDilutionIdentityClaim,
  validateDilutionIdentityDecision,
  validateDilutionRegistrationObservation,
  validateDilutionSemanticField,
  validateDilutionSourceObservation,
  verifyDilutionEvidenceIdentity,
  type DilutionEvidenceIdentity,
  type DilutionExposureRegistrationRelationship,
  type DilutionIdentityClaim,
  type DilutionIdentityDecision,
  type DilutionRegistrationObservation,
  type DilutionSourceDocument,
  type DilutionSourceObservation,
} from "./economicExposureContracts.ts";

const sourceDocuments: readonly DilutionSourceDocument[] = [{
  source_ref: "sec_filing_block_1",
  text: [
    "The Series A Warrant covers 1,000,000 shares at $1.00 and expires on January 2, 2031.",
    "The Series B Warrant covers 1,000,000 shares at $1.00 and expires on January 2, 2031.",
    "The Original Note dated February 1, 2026 had a principal amount of $4,000,000.",
    "A separate Tranche B Note dated February 2, 2026 also had a principal amount of $4,000,000.",
    "The First Amendment expressly amends the Original Note dated February 1, 2026.",
    "The registration statement on Form S-3 has SEC File No. 333-123456.",
    "A later resale registration has SEC File No. 333-654321.",
    "The registration statement was declared effective on March 5, 2026.",
    "The company issued 500,000 shares of common stock at closing.",
    "The assumed offering price is $2.00 per share.",
    "A separate disclosure referenced a price of $2.00 without identifying its economic role.",
  ].join("\n"),
}];

test("A. normalized Securities Act file numbers produce the same registration canonical key", () => {
  assert.equal(normalizeRegistrationFileNumber("333 - 123456"), "333-123456");
  assert.equal(
    buildRegistrationCanonicalKey({ issuer_cik: "320193", registration_file_number: "333 - 123456" }),
    buildRegistrationCanonicalKey({ issuer_cik: "0000320193", registration_file_number: "333-123456" }),
  );
});

test("B. the same registration number under different issuers remains a different identity", () => {
  const first = buildRegistrationCanonicalKey({
    issuer_cik: "0000320193",
    registration_file_number: "333-123456",
  });
  const second = buildRegistrationCanonicalKey({
    issuer_cik: "0000789019",
    registration_file_number: "333-123456",
  });
  assert.notEqual(first, second);
});

test("C. Exchange Act 001 file numbers cannot become registration canonical keys", () => {
  assert.equal(normalizeRegistrationFileNumber("001-12345"), null);
  assert.equal(buildRegistrationCanonicalKey({
    issuer_cik: "0000320193",
    registration_file_number: "001-12345",
  }), null);
});

test("D. S-3, S-3/A, and EFFECT observations share one registration candidate identity", () => {
  const key = "reg:v1:0000320193:333-123456";
  const observations = [
    registrationObservation("registration_filed", "S-3", "0000320193-26-000001"),
    registrationObservation("registration_amended", "S-3/A", "0000320193-26-000002"),
    registrationObservation("effectiveness_declared", "EFFECT", "0000320193-26-000003"),
  ];
  for (const observation of observations) {
    assert.equal(observation.registration_canonical_key, key);
    assert.deepEqual(validateDilutionRegistrationObservation(observation, sourceDocuments), []);
  }
  assert.equal(new Set(observations.map((item) => item.registration_canonical_key)).size, 1);
});

test("E. an S-3ASR can express automatic effectiveness without a separate EFFECT filing", () => {
  const observation = registrationObservation(
    "automatically_effective",
    "S-3ASR",
    "0000320193-26-000004",
  );
  assert.deepEqual(validateDilutionRegistrationObservation(observation, sourceDocuments), []);
  assert.equal("effect_accession" in observation, false);
});

test("F. equal warrant economics cannot override conflicting series identity claims", () => {
  const seriesA = identityClaim("series_or_designation", "Series A Warrant", exact("Series A Warrant"));
  const seriesB = identityClaim("series_or_designation", "Series B Warrant", exact("Series B Warrant"));
  assert.notEqual(seriesA.value, seriesB.value);
  assert.deepEqual(validateDilutionIdentityClaim(seriesA, sourceDocuments), []);
  assert.deepEqual(validateDilutionIdentityClaim(seriesB, sourceDocuments), []);

  const conflict = identityDecision({
    decision: "CONFLICT",
    reason_code: "CONFLICTING_STRONG_IDENTITY_CLAIMS",
    target_exposure_id: null,
    identity_claim_kinds: ["series_or_designation"],
    identity_evidence: [seriesA.evidence_identity, seriesB.evidence_identity],
  });
  assert.deepEqual(validateDilutionIdentityDecision(conflict, sourceDocuments), []);

  const unsafeLink = { ...conflict, decision: "LINK_EXISTING", target_exposure_id: "W-001" };
  assert.match(validateDilutionIdentityDecision(unsafeLink, sourceDocuments).join("; "), /reason does not match/);
});

test("G. a matching note principal cannot erase conflicting original identity claims", () => {
  const designation = identityClaim(
    "designation_or_tranche",
    "Original Note dated February 1, 2026",
    exact("Original Note dated February 1, 2026"),
  );
  const conflictingDate = identityClaim(
    "original_issuance_or_closing_date",
    "2026-02-02",
    exact("February 2, 2026"),
    "instrument_issuance_date",
  );
  const conflict = identityDecision({
    decision: "CONFLICT",
    reason_code: "CONFLICTING_STRONG_IDENTITY_CLAIMS",
    target_exposure_id: null,
    identity_claim_kinds: ["designation_or_tranche", "original_issuance_or_closing_date"],
    identity_evidence: [designation.evidence_identity, conflictingDate.evidence_identity],
  });
  assert.deepEqual(validateDilutionIdentityDecision(conflict, sourceDocuments), []);
});

test("H. an explicit amendment reference can carry an AMEND_EXISTING decision", () => {
  const amendment = identityClaim(
    "amendment_reference",
    "First Amendment expressly amends the Original Note",
    exact("First Amendment expressly amends the Original Note"),
  );
  const decision = identityDecision({
    decision: "AMEND_EXISTING",
    reason_code: "EXPLICIT_AMENDMENT_REFERENCE_MATCH",
    target_exposure_id: "CN-001",
    identity_claim_kinds: ["amendment_reference"],
    identity_evidence: [amendment.evidence_identity],
  });
  assert.deepEqual(validateDilutionIdentityDecision(decision, sourceDocuments), []);
});

test("I. one registration can link to multiple economic exposures", () => {
  const links = ["CN-001", "W-001", "W-002"].map((exposureId) => relationship(
    exposureId,
    "reg:v1:0000320193:333-123456",
  ));
  assert.equal(new Set(links.map((item) => item.exposure_id)).size, 3);
  for (const link of links) {
    assert.deepEqual(validateDilutionExposureRegistrationRelationship(link, sourceDocuments), []);
  }
});

test("J. one economic exposure can link to multiple registrations", () => {
  const links = [
    relationship("CN-001", "reg:v1:0000320193:333-123456"),
    relationship("CN-001", "reg:v1:0000320193:333-654321"),
  ];
  assert.equal(new Set(links.map((item) => item.registration_canonical_key)).size, 2);
  for (const link of links) {
    assert.deepEqual(validateDilutionExposureRegistrationRelationship(link, sourceDocuments), []);
  }
});

test("K. registration effectiveness remains distinct from a security issuance observation", () => {
  assert.equal(DILUTION_REGISTRATION_OBSERVATION_KINDS.includes("effectiveness_declared"), true);
  assert.equal(DILUTION_REGISTRATION_OBSERVATION_KINDS.includes("security_issuance" as never), false);
  assert.equal(DILUTION_SOURCE_OBSERVATION_KINDS.includes("security_issuance"), true);
  const effect = registrationObservation(
    "effectiveness_declared",
    "EFFECT",
    "0000320193-26-000005",
  );
  assert.equal(effect.observation_kind, "effectiveness_declared");
  assert.equal("issuance_observation" in effect, false);

  const issuance: DilutionSourceObservation = {
    version: DILUTION_SOURCE_OBSERVATION_VERSION,
    issuer_cik: "0000320193",
    accession: "0000320193-26-000007",
    form: "8-K",
    filed_date: "2026-03-06",
    accepted_at: null,
    analysis_lineage: null,
    exposure_id: null,
    exposure_type: null,
    observation_kind: "security_issuance",
    observed_fields: [{
      field_name: "issued_common_shares",
      field: {
        availability: "available",
        value: "500000",
        semantic_role: null,
        evidence_identity: exact("issued 500,000 shares of common stock at closing"),
      },
    }],
    identity_claims: [],
    status: "VALIDATED",
  };
  assert.deepEqual(validateDilutionSourceObservation(issuance, sourceDocuments), []);
});

test("L. an unavailable or structurally wrong semantic role fails closed", () => {
  const unavailable = {
    availability: "unavailable",
    value: null,
    semantic_role: null,
    evidence_identity: exact("price of $2.00 without identifying its economic role"),
    reason: "SEMANTIC_ROLE_UNAVAILABLE",
  };
  assert.deepEqual(validateDilutionSemanticField(unavailable, sourceDocuments, "price"), []);

  const wrongRoleFamily = {
    availability: "available",
    value: "2026-03-05",
    semantic_role: "exercise_price",
    evidence_identity: exact("declared effective on March 5, 2026"),
  };
  assert.match(
    validateDilutionSemanticField(wrongRoleFamily, sourceDocuments, "date").join("; "),
    /semantic field role is invalid/,
  );
});

test("authoritative evidence retains exact range/hash and rejects source tampering", () => {
  const identity = exact("Series A Warrant");
  assert.equal(identity.version, DILUTION_EVIDENCE_IDENTITY_VERSION);
  assert.deepEqual(validateDilutionEvidenceIdentity(identity), []);
  assert.equal(verifyDilutionEvidenceIdentity(identity, sourceDocuments), true);
  const tampered = sourceDocuments.map((document) => ({
    ...document,
    text: document.text.replace("Series A Warrant", "Series X Warrant"),
  }));
  assert.equal(verifyDilutionEvidenceIdentity(identity, tampered), false);
});

test("an unresolved source observation keeps exposure_id null without becoming a new exposure", () => {
  const observation: DilutionSourceObservation = {
    version: DILUTION_SOURCE_OBSERVATION_VERSION,
    issuer_cik: "0000320193",
    accession: "0000320193-26-000006",
    form: "8-K",
    filed_date: "2026-02-01",
    accepted_at: "2026-02-01T12:34:56.000Z",
    analysis_lineage: {
      source_execution_id: "10000000-0000-5000-8000-000000000001",
      parent_primary_ai_run_id: "10000000-0000-5000-8000-000000000002",
      analyzer_key: "future_dilution_observation_sidecar",
      analyzer_contract_version: "v1",
    },
    exposure_id: null,
    exposure_type: "convertible_note",
    observation_kind: "exposure_identity",
    observed_fields: [],
    identity_claims: [identityClaim(
      "principal",
      "$4,000,000",
      exact("principal amount of $4,000,000"),
    )],
    status: "IDENTITY_UNRESOLVED",
  };
  assert.deepEqual(validateDilutionSourceObservation(observation, sourceDocuments), []);
  assert.equal(observation.exposure_id, null);
});

test("Registered Direct, PIPE, and plain common stock are not continuing exposure types", () => {
  assert.deepEqual(DILUTION_EXPOSURE_TYPES, [
    "convertible_note",
    "warrant",
    "prefunded_warrant",
    "convertible_preferred",
    "atm_program",
    "equity_line",
  ]);
  assert.equal(DILUTION_EXPOSURE_TYPES.includes("registered_direct" as never), false);
  assert.equal(DILUTION_EXPOSURE_TYPES.includes("pipe" as never), false);
  assert.equal(DILUTION_EXPOSURE_TYPES.includes("common_stock" as never), false);
});

function exact(text: string): DilutionEvidenceIdentity {
  const source = sourceDocuments[0];
  const rangeStart = source.text.indexOf(text);
  assert.ok(rangeStart >= 0, `fixture text not found: ${text}`);
  const identity = buildDilutionEvidenceIdentity({
    source_ref: source.source_ref,
    range_start: rangeStart,
    range_end: rangeStart + text.length,
    source_documents: sourceDocuments,
  });
  assert.ok(identity);
  return identity;
}

function identityClaim(
  claimKind: DilutionIdentityClaim["claim_kind"],
  value: string,
  evidenceIdentity: DilutionEvidenceIdentity,
  semanticRole: DilutionIdentityClaim["semantic_role"] = null,
): DilutionIdentityClaim {
  return {
    version: DILUTION_IDENTITY_CLAIM_VERSION,
    claim_kind: claimKind,
    value,
    semantic_role: semanticRole,
    evidence_identity: evidenceIdentity,
  };
}

function identityDecision(
  value: Omit<DilutionIdentityDecision, "version">,
): DilutionIdentityDecision {
  return { version: DILUTION_IDENTITY_DECISION_VERSION, ...value };
}

function registrationObservation(
  observationKind: DilutionRegistrationObservation["observation_kind"],
  form: string,
  accession: string,
): DilutionRegistrationObservation {
  const registrationFileNumber = "333-123456";
  return {
    version: DILUTION_REGISTRATION_OBSERVATION_VERSION,
    observation_kind: observationKind,
    issuer_cik: "0000320193",
    registration_file_number: registrationFileNumber,
    registration_canonical_key: buildRegistrationCanonicalKey({
      issuer_cik: "0000320193",
      registration_file_number: registrationFileNumber,
    }),
    accession,
    form,
    filed_date: "2026-03-05",
    accepted_at: "2026-03-05T12:34:56.000Z",
    evidence_identities: [exact("SEC File No. 333-123456")],
    status: "VALIDATED",
  };
}

function relationship(
  exposureId: string,
  registrationCanonicalKey: string,
): DilutionExposureRegistrationRelationship {
  const registrationFileNumber = registrationCanonicalKey.split(":").at(-1);
  assert.ok(registrationFileNumber);
  return {
    version: DILUTION_EXPOSURE_REGISTRATION_RELATIONSHIP_VERSION,
    relationship_kind: "resale_registration",
    exposure_id: exposureId,
    registration_canonical_key: registrationCanonicalKey,
    evidence_identities: [exact(`SEC File No. ${registrationFileNumber}`)],
    status: "VALIDATED",
  };
}
