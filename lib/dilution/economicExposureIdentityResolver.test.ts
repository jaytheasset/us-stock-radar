import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DILUTION_EVIDENCE_IDENTITY_VERSION,
  DILUTION_IDENTITY_CLAIM_VERSION,
  DILUTION_SOURCE_OBSERVATION_VERSION,
  type DilutionEvidenceIdentity,
  type DilutionExposureType,
  type DilutionIdentityClaim,
  type DilutionIdentityClaimKind,
  type DilutionSourceObservation,
} from "./economicExposureContracts.ts";
import { ACTUAL_CACHED_SEC_EXPOSURE_IDENTITY_FIXTURES } from "./economicExposureIdentityResolver.actualSecFixtures.ts";
import {
  ECONOMIC_EXPOSURE_IDENTITY_RESOLVER_VERSION,
  evaluateExposureIdentityClaim,
  resolveExposureIdentity,
  type EconomicExposureIdentityCandidate,
} from "./economicExposureIdentityResolver.ts";

const issuerCik = "0001809750";
const registrationKey = `reg:v1:${issuerCik}:333-123456`;

test("A. same Note exact original reference links the existing exposure", () => {
  const result = evaluateExposureIdentityClaim({
    observation: observation("convertible_note", [
      claim("original_instrument_reference", "Promissory Note A-1", "obs-a"),
    ]),
    candidateExposure: candidate("note-a", "convertible_note", [
      claim("original_instrument_reference", "Promissory Note A-1", "candidate-a"),
    ]),
  });
  assert.equal(result.decision, "LINK_EXISTING");
  assert.equal(result.target_exposure_id, "note-a");
  assert.equal(result.candidate_exposure_identity?.exposure_type, "convertible_note");
  assert.equal(result.matched_strong_claims.length, 1);
});

test("B. explicit Note amendment resolves exactly one target", () => {
  const result = resolveExposureIdentity({
    observation: observation("convertible_note", [
      claim("amendment_reference", "Promissory Note A-1", "note-amendment"),
    ], { observation_kind: "exposure_amendment" }),
    candidateExposures: [candidate("note-a", "convertible_note", [
      claim("original_instrument_reference", "Promissory Note A-1", "note-original"),
    ])],
  });
  assert.equal(result.decision, "AMEND_EXISTING");
  assert.equal(result.reason_code, "EXPLICIT_AMENDMENT_REFERENCE_MATCH");
  assert.equal(result.target_exposure_id, "note-a");
});

test("C. same principal and holder only stays unresolved", () => {
  const supportingClaims = [
    claim("principal", "$2,170,000", "principal"),
    claim("holder_or_investor", "Streeterville Capital, LLC", "holder"),
  ];
  const result = evaluateExposureIdentityClaim({
    observation: observation("convertible_note", supportingClaims),
    candidateExposure: candidate("note-a", "convertible_note", supportingClaims),
  });
  assert.equal(result.decision, "UNRESOLVED");
  assert.equal(result.reason_code, "INSUFFICIENT_SOURCE_BACKED_IDENTITY");
  assert.equal(result.matched_strong_claims.length, 0);
});

test("D. different explicit Note identity creates a separate exposure despite equal principal", () => {
  const result = evaluateExposureIdentityClaim({
    observation: observation("convertible_note", [
      claim("designation_or_tranche", "Secured Promissory Note B", "note-b"),
      claim("principal", "$2,170,000", "same-principal-observation"),
    ]),
    candidateExposure: candidate("note-a", "convertible_note", [
      claim("designation_or_tranche", "Promissory Note A-1", "note-a"),
      claim("principal", "$2,170,000", "same-principal-candidate"),
    ]),
  });
  assert.equal(result.decision, "CREATE_NEW");
  assert.equal(result.reason_code, "SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY");
  assert.equal(result.target_exposure_id, null);
});

test("conflicting primary Note identities fail closed instead of tie-breaking", () => {
  const result = evaluateExposureIdentityClaim({
    observation: observation("convertible_note", [
      claim("original_instrument_reference", "Original Note", "same-note-observation"),
      claim("designation_or_tranche", "Tranche B", "tranche-b"),
    ]),
    candidateExposure: candidate("note-a", "convertible_note", [
      claim("original_instrument_reference", "Original Note", "same-note-candidate"),
      claim("designation_or_tranche", "Tranche A", "tranche-a"),
    ]),
  });
  assert.equal(result.decision, "CONFLICT");
  assert.equal(result.reason_code, "CONFLICTING_STRONG_IDENTITY_CLAIMS");
  assert.ok(result.matched_strong_claims.length > 0);
  assert.ok(result.conflicting_strong_claims.length > 0);
});

test("E. Warrant Series A and Series B remain separate under one agreement", () => {
  const result = evaluateExposureIdentityClaim({
    observation: observation("warrant", [
      claim("agreement_reference", "Securities Purchase Agreement", "warrant-agreement-observation"),
      claim("series_or_designation", "Series B Warrant", "series-b"),
    ]),
    candidateExposure: candidate("warrant-a", "warrant", [
      claim("agreement_reference", "Securities Purchase Agreement", "warrant-agreement-candidate"),
      claim("series_or_designation", "Series A Warrant", "series-a"),
    ]),
  });
  assert.equal(result.decision, "CREATE_NEW");
});

test("F. same warrant quantity and price only stays unresolved", () => {
  const result = evaluateExposureIdentityClaim({
    observation: observation("warrant", [
      claim("underlying_share_quantity", "1,000,000", "warrant-quantity-observation"),
    ], { observed_fields: [observedField("exercise_price", "$1.00")] }),
    candidateExposure: candidate("warrant-a", "warrant", [
      claim("underlying_share_quantity", "1,000,000", "warrant-quantity-candidate"),
    ]),
  });
  assert.equal(result.decision, "UNRESOLVED");
});

test("G. explicit Warrant amendment resolves the original warrant", () => {
  const result = resolveExposureIdentity({
    observation: observation("warrant", [
      claim("amendment_reference", "Series A Warrant", "warrant-amendment"),
    ], { observation_kind: "exposure_amendment" }),
    candidateExposures: [candidate("warrant-a", "warrant", [
      claim("series_or_designation", "Series A Warrant", "warrant-series-a"),
    ])],
  });
  assert.equal(result.decision, "AMEND_EXISTING");
  assert.equal(result.target_exposure_id, "warrant-a");
});

test("H. the same registration never collapses distinct instruments", () => {
  const result = resolveExposureIdentity({
    observation: observation("convertible_note", [
      claim("designation_or_tranche", "Secured Promissory Note B", "registered-note-b"),
    ]),
    registration_canonical_keys: [registrationKey],
    candidateExposures: [candidate("note-a", "convertible_note", [
      claim("designation_or_tranche", "Promissory Note A-1", "registered-note-a"),
    ], { registration_canonical_keys: [registrationKey] })],
  });
  assert.equal(result.decision, "CREATE_NEW");
  assert.deepEqual(result.supporting_registration_matches, []);

  const linked = resolveExposureIdentity({
    observation: observation("convertible_note", [
      claim("designation_or_tranche", "Promissory Note A-1", "registered-link-observation"),
    ]),
    registration_canonical_keys: [registrationKey],
    candidateExposures: [candidate("note-a", "convertible_note", [
      claim("designation_or_tranche", "Promissory Note A-1", "registered-link-candidate"),
    ], { registration_canonical_keys: [registrationKey] })],
  });
  assert.equal(linked.decision, "LINK_EXISTING");
  assert.deepEqual(linked.supporting_registration_matches, [registrationKey]);
});

test("I. repeated exact ATM sales agreement links", () => {
  const result = evaluateExposureIdentityClaim({
    observation: observation("atm_program", [
      claim("sales_agreement_reference", "Open Market Sale Agreement SM", "atm-repeat-observation"),
    ]),
    candidateExposure: candidate("atm-gme", "atm_program", [
      claim("sales_agreement_reference", "Open Market Sale Agreement SM", "atm-repeat-candidate"),
    ]),
  });
  assert.equal(result.decision, "LINK_EXISTING");
});

test("J. explicit ATM agreement amendment amends the resolved program", () => {
  const result = resolveExposureIdentity({
    observation: observation("atm_program", [
      claim("amendment_reference", "Open Market Sale Agreement SM", "atm-amendment"),
    ], { observation_kind: "exposure_amendment" }),
    candidateExposures: [candidate("atm-gme", "atm_program", [
      claim("sales_agreement_reference", "Open Market Sale Agreement SM", "atm-original"),
    ])],
  });
  assert.equal(result.decision, "AMEND_EXISTING");
});

test("K. a new exact ATM agreement creates a new program; same agent is not enough", () => {
  const result = evaluateExposureIdentityClaim({
    observation: observation("atm_program", [
      claim("sales_agreement_reference", "2026 Open Market Sale Agreement", "new-atm-agreement"),
      claim("sales_agreement_date", "2026-05-18", "new-atm-date"),
      claim("sales_agent", "Same Agent LLC", "same-atm-agent-observation"),
    ]),
    candidateExposure: candidate("atm-old", "atm_program", [
      claim("sales_agreement_reference", "2024 Open Market Sale Agreement", "old-atm-agreement"),
      claim("sales_agreement_date", "2024-05-17", "old-atm-date"),
      claim("sales_agent", "Same Agent LLC", "same-atm-agent-candidate"),
      claim("original_program_capacity", "$100,000,000", "same-atm-capacity"),
    ]),
  });
  assert.equal(result.decision, "CREATE_NEW");
});

test("L. same ELOC counterparty and amount with a different exact agreement stays separate", () => {
  const result = evaluateExposureIdentityClaim({
    observation: observation("equity_line", [
      claim("purchase_agreement_reference", "2026 Equity Purchase Agreement", "new-eloc-agreement"),
      claim("purchase_agreement_date", "2026-01-10", "same-eloc-date-observation"),
      claim("counterparty", "Investor LLC", "same-eloc-counterparty-observation"),
      claim("committed_amount", "$25,000,000", "same-eloc-amount-observation"),
    ]),
    candidateExposure: candidate("eloc-old", "equity_line", [
      claim("purchase_agreement_reference", "2025 Equity Purchase Agreement", "old-eloc-agreement"),
      claim("purchase_agreement_date", "2026-01-10", "same-eloc-date-candidate"),
      claim("counterparty", "Investor LLC", "same-eloc-counterparty-candidate"),
      claim("committed_amount", "$25,000,000", "same-eloc-amount-candidate"),
    ]),
  });
  assert.equal(result.decision, "CREATE_NEW");
});

test("M. an exact cross-issuer identity reference conflicts and ticker is absent", () => {
  const result = resolveExposureIdentity({
    observation: observation("convertible_note", [
      claim("original_instrument_reference", "Original Note 2026", "cross-issuer-observation"),
    ]),
    candidateExposures: [candidate("other-issuer-note", "convertible_note", [
      claim("original_instrument_reference", "Original Note 2026", "cross-issuer-candidate"),
    ], { issuer_cik: "0001829794" })],
  });
  assert.equal(result.decision, "CONFLICT");
  assert.equal(result.reason_code, "CROSS_ISSUER_IDENTITY_CONFLICT");
  assert.equal("ticker" in result, false);
});

test("N. an ambiguous amendment target conflicts without a tie-break", () => {
  const result = resolveExposureIdentity({
    observation: observation("warrant", [
      claim("amendment_reference", "Original Warrant Form", "ambiguous-amendment"),
    ], { observation_kind: "exposure_amendment" }),
    candidateExposures: ["warrant-1", "warrant-2"].map((exposureId) =>
      candidate(exposureId, "warrant", [
        claim("original_instrument_reference", "Original Warrant Form", exposureId),
      ])),
  });
  assert.equal(result.decision, "CONFLICT");
  assert.equal(result.reason_code, "AMBIGUOUS_AMENDMENT_TARGET");
});

test("O. no strong identity is unresolved rather than auto-created", () => {
  const result = resolveExposureIdentity({
    observation: observation("atm_program", [
      claim("sales_agent", "Only Agent LLC", "agent-only"),
      claim("original_program_capacity", "$50,000,000", "capacity-only"),
    ]),
    candidateExposures: [],
  });
  assert.equal(result.decision, "UNRESOLVED");
});

test("P/Q. transaction wrappers and plain common shares are not exposure identities", () => {
  for (const label of ["Registered Direct", "PIPE", "Plain common shares"]) {
    const result = resolveExposureIdentity({
      observation: observation(null, [], {
        observation_kind: "security_issuance",
        form: label,
      }),
      candidateExposures: [],
    });
    assert.equal(result.decision, "UNRESOLVED", label);
    assert.equal(result.reason_code, "NON_EXPOSURE_OBSERVATION", label);
    assert.equal(result.target_exposure_id, null, label);
  }
});

test("pre-funded warrant subtype conflicts with the same ordinary-warrant identity", () => {
  const result = resolveExposureIdentity({
    observation: observation("prefunded_warrant", [
      claim("series_or_designation", "Pre-Funded Warrant Form", "prefunded-subtype-observation"),
    ]),
    candidateExposures: [candidate("ordinary-warrant", "warrant", [
      claim("series_or_designation", "Pre-Funded Warrant Form", "ordinary-subtype-candidate"),
    ])],
  });
  assert.equal(result.decision, "CONFLICT");
  assert.equal(result.reason_code, "EXPOSURE_TYPE_CONFLICT");
});

test("convertible preferred Series A and Series B remain distinct", () => {
  const result = evaluateExposureIdentityClaim({
    observation: observation("convertible_preferred", [
      claim("series_or_designation", "Series B Preferred Stock", "preferred-series-b"),
    ]),
    candidateExposure: candidate("preferred-a", "convertible_preferred", [
      claim("series_or_designation", "Series A Preferred Stock", "preferred-series-a"),
    ]),
  });
  assert.equal(result.decision, "CREATE_NEW");
});

test("exact comparison does not case-fold or fuzzy-match", () => {
  const result = evaluateExposureIdentityClaim({
    observation: observation("convertible_note", [
      claim("original_instrument_reference", "Original Note Alpha", "exact-case-observation"),
    ]),
    candidateExposure: candidate("note-alpha", "convertible_note", [
      claim("original_instrument_reference", "original note alpha", "exact-case-candidate"),
    ]),
  });
  assert.equal(result.decision, "CREATE_NEW");
  assert.equal(result.matched_strong_claims.length, 0);
});

test("R. chronological, reverse, shuffled, and duplicate candidate sets are identical", () => {
  const target = candidate("atm-target", "atm_program", [
    claim("sales_agreement_reference", "Target Sales Agreement", "ordering-target"),
  ]);
  const otherA = candidate("atm-a", "atm_program", [
    claim("sales_agreement_reference", "A Sales Agreement", "ordering-a"),
  ]);
  const otherZ = candidate("atm-z", "atm_program", [
    claim("sales_agreement_reference", "Z Sales Agreement", "ordering-z"),
  ]);
  const observed = observation("atm_program", [
    claim("sales_agreement_reference", "Target Sales Agreement", "ordering-observation"),
  ]);
  const variants = [
    [otherA, target, otherZ],
    [otherZ, target, otherA],
    [target, otherZ, otherA],
    [otherA, target, target, otherZ],
  ];
  const results = variants.map((candidateExposures) => resolveExposureIdentity({
    observation: observed,
    candidateExposures,
  }));
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(results[0].decision, "LINK_EXISTING");
  assert.equal(results[0].resolver_version, ECONOMIC_EXPOSURE_IDENTITY_RESOLVER_VERSION);
});

test("actual cached SEC excerpts retain accession, range, and exact SHA-256 provenance", () => {
  assert.equal(ACTUAL_CACHED_SEC_EXPOSURE_IDENTITY_FIXTURES.length, 8);
  for (const fixture of ACTUAL_CACHED_SEC_EXPOSURE_IDENTITY_FIXTURES) {
    assert.match(fixture.issuer_cik, /^\d{10}$/);
    assert.ok(fixture.accessions.every((accession) => /^\d{10}-\d{2}-\d{6}$/.test(accession)));
    assert.equal(
      createHash("sha256").update(fixture.excerpt, "utf8").digest("hex"),
      fixture.excerpt_sha256,
      fixture.history_id,
    );
    assert.equal(
      fixture.original_range_end - fixture.original_range_start,
      fixture.excerpt.length,
      fixture.history_id,
    );
    assert.ok(fixture.raw_derived_strong_claims.length > 0);
    assert.ok(fixture.missing_current_claims.length > 0);
  }
  const currentContractResults = ACTUAL_CACHED_SEC_EXPOSURE_IDENTITY_FIXTURES.map((fixture) =>
    resolveExposureIdentity({
      observation: observation(fixture.exposure_type, [], {
        issuer_cik: fixture.issuer_cik,
        accession: fixture.accessions[0],
        form: fixture.form,
      }),
      candidateExposures: [],
    }));
  assert.equal(currentContractResults.filter((result) => result.decision === "UNRESOLVED").length, 8);
  assert.equal(currentContractResults.filter((result) => result.decision !== "UNRESOLVED").length, 0);
});

test("actual cached EDBL note designations stay separate under one purchase agreement", () => {
  const fixture = actualFixture("edbl_two_note_designations_one_registration");
  const result = evaluateExposureIdentityClaim({
    observation: observation("convertible_note", [
      actualClaim(fixture, "agreement_reference", "Notes Purchase Agreement"),
      actualClaim(fixture, "designation_or_tranche", "Secured Promissory Note B"),
    ], { issuer_cik: fixture.issuer_cik, accession: fixture.accessions[0], form: fixture.form }),
    candidateExposure: candidate("edbl-note-a", "convertible_note", [
      actualClaim(fixture, "agreement_reference", "Notes Purchase Agreement"),
      actualClaim(fixture, "designation_or_tranche", "Promissory Note A‑1"),
    ], { issuer_cik: fixture.issuer_cik }),
  });
  assert.equal(result.decision, "CREATE_NEW");
});

test("actual cached SKK prospectus update links the same agreement, not an agreement amendment", () => {
  const fixture = actualFixture("skk_same_atm_agreement_prospectus_update");
  const agreement = "Sales Agreement between SKK Holdings Limited and A.G.P./Alliance Global Partners";
  const result = evaluateExposureIdentityClaim({
    observation: observation("atm_program", [
      actualClaim(fixture, "sales_agreement_reference", agreement),
    ], { issuer_cik: fixture.issuer_cik, accession: fixture.accessions[0], form: fixture.form }),
    candidateExposure: candidate("skk-atm", "atm_program", [
      actualClaim(fixture, "sales_agreement_reference", agreement),
    ], { issuer_cik: fixture.issuer_cik }),
  });
  assert.equal(result.decision, "LINK_EXISTING");
  assert.notEqual(result.decision, "AMEND_EXISTING");
});

test("resolver source contains no scoring, similarity, recency, ticker, or raw-text reader", () => {
  const source = readFileSync("lib/dilution/economicExposureIdentityResolver.ts", "utf8");
  for (const forbidden of [
    /levenshtein/i,
    /fuzzy/i,
    /similarity/i,
    /ticker/i,
    /recency/i,
    /body_text/i,
    /source_documents/i,
    /readFile/i,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});

function observation(
  exposureType: DilutionExposureType | null,
  claims: readonly DilutionIdentityClaim[],
  overrides: Partial<DilutionSourceObservation> = {},
): DilutionSourceObservation {
  return {
    version: DILUTION_SOURCE_OBSERVATION_VERSION,
    issuer_cik: issuerCik,
    accession: "0001477932-26-004651",
    form: "8-K",
    filed_date: "2026-06-12",
    accepted_at: null,
    analysis_lineage: null,
    exposure_id: null,
    exposure_type: exposureType,
    observation_kind: "exposure_identity",
    observed_fields: [],
    identity_claims: claims,
    status: "VALIDATED",
    ...overrides,
  };
}

function candidate(
  exposureId: string,
  exposureType: DilutionExposureType,
  claims: readonly DilutionIdentityClaim[],
  overrides: Partial<EconomicExposureIdentityCandidate> = {},
): EconomicExposureIdentityCandidate {
  return {
    exposure_id: exposureId,
    issuer_cik: issuerCik,
    exposure_type: exposureType,
    identity_claims: claims,
    registration_canonical_keys: [],
    ...overrides,
  };
}

function claim(
  claimKind: DilutionIdentityClaimKind,
  value: string,
  evidenceLabel: string,
): DilutionIdentityClaim {
  return {
    version: DILUTION_IDENTITY_CLAIM_VERSION,
    claim_kind: claimKind,
    value,
    semantic_role: semanticRole(claimKind),
    evidence_identity: evidence(value, evidenceLabel),
  };
}

function actualClaim(
  fixture: (typeof ACTUAL_CACHED_SEC_EXPOSURE_IDENTITY_FIXTURES)[number],
  claimKind: DilutionIdentityClaimKind,
  value: string,
): DilutionIdentityClaim {
  return {
    version: DILUTION_IDENTITY_CLAIM_VERSION,
    claim_kind: claimKind,
    value,
    semantic_role: semanticRole(claimKind),
    evidence_identity: {
      version: DILUTION_EVIDENCE_IDENTITY_VERSION,
      source_ref: fixture.source_ref,
      range_start: fixture.original_range_start,
      range_end: fixture.original_range_end,
      source_content_hash: fixture.excerpt_sha256,
      exact_source: true,
    },
  };
}

function evidence(text: string, label: string): DilutionEvidenceIdentity {
  return {
    version: DILUTION_EVIDENCE_IDENTITY_VERSION,
    source_ref: `sec_test_${label.replace(/[^a-z0-9_]+/gi, "_")}`,
    range_start: 0,
    range_end: text.length,
    source_content_hash: createHash("sha256").update(text).digest("hex"),
    exact_source: true,
  };
}

function semanticRole(claimKind: DilutionIdentityClaimKind): DilutionIdentityClaim["semantic_role"] {
  if (claimKind === "sales_agreement_date" || claimKind === "purchase_agreement_date") {
    return "agreement_signing_date";
  }
  if (claimKind === "original_issuance_or_closing_date") return "instrument_issuance_date";
  if (claimKind === "expiration_date") return "expiration_date";
  return null;
}

function observedField(fieldName: string, value: string) {
  return {
    field_name: fieldName,
    field: {
      availability: "available" as const,
      value,
      semantic_role: "exercise_price" as const,
      evidence_identity: evidence(value, `observed_${fieldName}`),
    },
  };
}

function actualFixture(historyId: string) {
  const fixture = ACTUAL_CACHED_SEC_EXPOSURE_IDENTITY_FIXTURES.find((item) =>
    item.history_id === historyId);
  assert.ok(fixture);
  return fixture;
}
