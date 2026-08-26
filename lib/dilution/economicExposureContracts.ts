import { createHash } from "node:crypto";

/**
 * Phase 2A pure contracts only. This module has no database, persistence,
 * provider, calculation, or identity-resolver side effects.
 */

export const DILUTION_SOURCE_OBSERVATION_VERSION = "dilution_source_observation_v1" as const;
export const DILUTION_EVIDENCE_IDENTITY_VERSION = "dilution_evidence_identity_v1" as const;
export const DILUTION_IDENTITY_CLAIM_VERSION = "dilution_identity_claim_v1" as const;
export const DILUTION_IDENTITY_DECISION_VERSION = "dilution_identity_decision_v1" as const;
export const DILUTION_REGISTRATION_OBSERVATION_VERSION = "dilution_registration_observation_v1" as const;
export const DILUTION_EXPOSURE_REGISTRATION_RELATIONSHIP_VERSION =
  "dilution_exposure_registration_relationship_v1" as const;

export const DILUTION_EXPOSURE_TYPES = [
  "convertible_note",
  "warrant",
  "prefunded_warrant",
  "convertible_preferred",
  "atm_program",
  "equity_line",
] as const;

export type DilutionExposureType = (typeof DILUTION_EXPOSURE_TYPES)[number];

export const DILUTION_SOURCE_OBSERVATION_KINDS = [
  "exposure_identity",
  "exposure_terms",
  "exposure_amendment",
  "issuance_availability",
  "security_issuance",
  "registration_relationship",
  "realized_issuance",
] as const;

export type DilutionSourceObservationKind = (typeof DILUTION_SOURCE_OBSERVATION_KINDS)[number];

export const DILUTION_ISSUANCE_AVAILABILITY_STATES = [
  "AVAILABLE",
  "CONDITIONAL",
  "NOT_AVAILABLE",
  "INDETERMINATE",
] as const;

export type DilutionIssuanceAvailability =
  (typeof DILUTION_ISSUANCE_AVAILABILITY_STATES)[number];

export const DILUTION_DATE_SEMANTIC_ROLES = [
  "agreement_signing_date",
  "instrument_issuance_date",
  "funding_date",
  "terms_effective_date",
  "conversion_eligibility_date",
  "registration_filed_date",
  "registration_effective_date",
  "maturity_date",
  "expiration_date",
] as const;

export const DILUTION_PRICE_SEMANTIC_ROLES = [
  "original_conversion_price",
  "current_conversion_price",
  "floor_price",
  "exercise_price",
  "assumed_offering_price",
  "purchase_price",
] as const;

export type DilutionDateSemanticRole = (typeof DILUTION_DATE_SEMANTIC_ROLES)[number];
export type DilutionPriceSemanticRole = (typeof DILUTION_PRICE_SEMANTIC_ROLES)[number];
export type DilutionSemanticRole = DilutionDateSemanticRole | DilutionPriceSemanticRole;

export const DILUTION_FAIL_CLOSED_STATUSES = [
  "EVIDENCE_IDENTITY_MISMATCH",
  "SEMANTIC_ROLE_UNAVAILABLE",
  "IDENTITY_UNRESOLVED",
  "IDENTITY_CONFLICT",
  "REGISTRATION_IDENTITY_UNRESOLVED",
  "REGISTRATION_RELATIONSHIP_UNRESOLVED",
  "TERMS_VERSION_UNRESOLVED",
  "ISSUANCE_AVAILABILITY_INDETERMINATE",
  "CURRENT_CONTRACT_RESULT_INCOMPLETE_OR_FAILED",
  "REALIZED_ISSUANCE_ATTRIBUTION_UNRESOLVED",
] as const;

export type DilutionFailClosedStatus = (typeof DILUTION_FAIL_CLOSED_STATUSES)[number];
export type DilutionObservationStatus = "VALIDATED" | DilutionFailClosedStatus;

export type DilutionSourceDocument = Readonly<{
  source_ref: string;
  text: string;
}>;

export type DilutionEvidenceIdentity = Readonly<{
  version: typeof DILUTION_EVIDENCE_IDENTITY_VERSION;
  source_ref: string;
  range_start: number;
  range_end: number;
  source_content_hash: string;
  exact_source: true;
}>;

export type DilutionAnalysisLineage = Readonly<{
  source_execution_id: string;
  parent_primary_ai_run_id: string;
  analyzer_key: string;
  analyzer_contract_version: string;
}>;

export type DilutionObservedScalar = string | number | boolean;

export type DilutionSourceBackedField<TValue extends DilutionObservedScalar = DilutionObservedScalar> =
  | Readonly<{
      availability: "available";
      value: TValue;
      semantic_role: DilutionSemanticRole | null;
      evidence_identity: DilutionEvidenceIdentity;
    }>
  | Readonly<{
      availability: "unavailable";
      value: null;
      semantic_role: null;
      evidence_identity: DilutionEvidenceIdentity | null;
      reason: "SEMANTIC_ROLE_UNAVAILABLE" | "EVIDENCE_IDENTITY_MISMATCH";
    }>;

export type DilutionSemanticField<
  TValue extends DilutionObservedScalar = DilutionObservedScalar,
  TRole extends DilutionSemanticRole = DilutionSemanticRole,
> =
  | Readonly<{
      availability: "available";
      value: TValue;
      semantic_role: TRole;
      evidence_identity: DilutionEvidenceIdentity;
    }>
  | Readonly<{
      availability: "unavailable";
      value: null;
      semantic_role: null;
      evidence_identity: DilutionEvidenceIdentity | null;
      reason: "SEMANTIC_ROLE_UNAVAILABLE" | "EVIDENCE_IDENTITY_MISMATCH";
    }>;

export type DilutionObservedField = Readonly<{
  field_name: string;
  field: DilutionSourceBackedField;
}>;

export const DILUTION_IDENTITY_CLAIM_KINDS = [
  "original_instrument_reference",
  "agreement_reference",
  "amendment_reference",
  "designation_or_tranche",
  "series_or_designation",
  "certificate_of_designation_reference",
  "original_issuance_or_closing_date",
  "holder_or_investor",
  "counterparty",
  "principal",
  "underlying_share_quantity",
  "expiration_date",
  "sales_agreement_reference",
  "sales_agreement_date",
  "sales_agent",
  "exhibit_or_accession_reference",
  "original_program_capacity",
  "purchase_agreement_reference",
  "purchase_agreement_date",
  "committed_amount",
] as const;

export type DilutionIdentityClaimKind = (typeof DILUTION_IDENTITY_CLAIM_KINDS)[number];

export const DILUTION_IDENTITY_CLAIM_KINDS_BY_EXPOSURE_TYPE = {
  convertible_note: [
    "original_instrument_reference",
    "agreement_reference",
    "amendment_reference",
    "designation_or_tranche",
    "original_issuance_or_closing_date",
    "holder_or_investor",
    "principal",
    "exhibit_or_accession_reference",
  ],
  warrant: [
    "original_instrument_reference",
    "agreement_reference",
    "amendment_reference",
    "series_or_designation",
    "original_issuance_or_closing_date",
    "holder_or_investor",
    "underlying_share_quantity",
    "expiration_date",
    "exhibit_or_accession_reference",
  ],
  prefunded_warrant: [
    "original_instrument_reference",
    "agreement_reference",
    "amendment_reference",
    "series_or_designation",
    "original_issuance_or_closing_date",
    "holder_or_investor",
    "underlying_share_quantity",
    "expiration_date",
    "exhibit_or_accession_reference",
  ],
  convertible_preferred: [
    "original_instrument_reference",
    "amendment_reference",
    "series_or_designation",
    "certificate_of_designation_reference",
    "original_issuance_or_closing_date",
    "holder_or_investor",
    "exhibit_or_accession_reference",
  ],
  atm_program: [
    "amendment_reference",
    "sales_agreement_reference",
    "sales_agreement_date",
    "sales_agent",
    "exhibit_or_accession_reference",
    "original_program_capacity",
  ],
  equity_line: [
    "amendment_reference",
    "purchase_agreement_reference",
    "purchase_agreement_date",
    "counterparty",
    "exhibit_or_accession_reference",
    "committed_amount",
  ],
} as const satisfies Record<DilutionExposureType, readonly DilutionIdentityClaimKind[]>;

export type DilutionIdentityClaim = Readonly<{
  version: typeof DILUTION_IDENTITY_CLAIM_VERSION;
  claim_kind: DilutionIdentityClaimKind;
  value: string;
  semantic_role: DilutionSemanticRole | null;
  evidence_identity: DilutionEvidenceIdentity;
}>;

export type DilutionSourceObservation = Readonly<{
  version: typeof DILUTION_SOURCE_OBSERVATION_VERSION;
  issuer_cik: string;
  accession: string;
  form: string;
  filed_date: string;
  accepted_at: string | null;
  analysis_lineage: DilutionAnalysisLineage | null;
  exposure_id: string | null;
  exposure_type: DilutionExposureType | null;
  observation_kind: DilutionSourceObservationKind;
  observed_fields: readonly DilutionObservedField[];
  identity_claims: readonly DilutionIdentityClaim[];
  status: DilutionObservationStatus;
}>;

export const DILUTION_IDENTITY_DECISIONS = [
  "CREATE_NEW",
  "LINK_EXISTING",
  "AMEND_EXISTING",
  "UNRESOLVED",
  "CONFLICT",
] as const;

export type DilutionIdentityDecisionKind = (typeof DILUTION_IDENTITY_DECISIONS)[number];

export const DILUTION_IDENTITY_DECISION_REASON_CODES = [
  "NO_PRIOR_CANDIDATE",
  "SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY",
  "EXPLICIT_SOURCE_REFERENCE_MATCH",
  "EXPLICIT_AMENDMENT_REFERENCE_MATCH",
  "SOURCE_BACKED_STRONG_IDENTITY_MATCH",
  "INSUFFICIENT_SOURCE_BACKED_IDENTITY",
  "CONFLICTING_STRONG_IDENTITY_CLAIMS",
  "CROSS_ISSUER_IDENTITY_CONFLICT",
  "EXPOSURE_TYPE_CONFLICT",
  "AMBIGUOUS_STRONG_IDENTITY_MATCH",
  "AMBIGUOUS_AMENDMENT_TARGET",
  "NON_EXPOSURE_OBSERVATION",
  "EVIDENCE_VALIDATION_FAILED",
] as const;

export type DilutionIdentityDecisionReasonCode =
  (typeof DILUTION_IDENTITY_DECISION_REASON_CODES)[number];

export type DilutionIdentityDecision = Readonly<{
  version: typeof DILUTION_IDENTITY_DECISION_VERSION;
  decision: DilutionIdentityDecisionKind;
  reason_code: DilutionIdentityDecisionReasonCode;
  target_exposure_id: string | null;
  identity_claim_kinds: readonly DilutionIdentityClaimKind[];
  identity_evidence: readonly DilutionEvidenceIdentity[];
}>;

export const DILUTION_REGISTRATION_OBSERVATION_KINDS = [
  "registration_filed",
  "registration_amended",
  "automatically_effective",
  "effectiveness_declared",
  "post_effective_amendment",
  "prospectus_supplement",
  "withdrawn_or_terminated",
] as const;

export type DilutionRegistrationObservationKind =
  (typeof DILUTION_REGISTRATION_OBSERVATION_KINDS)[number];

export type DilutionRegistrationObservation = Readonly<{
  version: typeof DILUTION_REGISTRATION_OBSERVATION_VERSION;
  observation_kind: DilutionRegistrationObservationKind;
  issuer_cik: string;
  registration_file_number: string | null;
  registration_canonical_key: string | null;
  accession: string;
  form: string;
  filed_date: string;
  accepted_at: string | null;
  evidence_identities: readonly DilutionEvidenceIdentity[];
  status: "VALIDATED" | "REGISTRATION_IDENTITY_UNRESOLVED" | "EVIDENCE_IDENTITY_MISMATCH";
}>;

export const DILUTION_EXPOSURE_REGISTRATION_RELATIONSHIP_KINDS = [
  "primary_offering",
  "resale_registration",
  "underlying_share_registration",
  "program_registration",
] as const;

export type DilutionExposureRegistrationRelationshipKind =
  (typeof DILUTION_EXPOSURE_REGISTRATION_RELATIONSHIP_KINDS)[number];

export type DilutionExposureRegistrationRelationship = Readonly<{
  version: typeof DILUTION_EXPOSURE_REGISTRATION_RELATIONSHIP_VERSION;
  relationship_kind: DilutionExposureRegistrationRelationshipKind;
  exposure_id: string | null;
  registration_canonical_key: string | null;
  evidence_identities: readonly DilutionEvidenceIdentity[];
  status: "VALIDATED" | "REGISTRATION_RELATIONSHIP_UNRESOLVED" | "EVIDENCE_IDENTITY_MISMATCH";
}>;

export function normalizeIssuerCik(value: unknown) {
  const digits = stringValue(value);
  if (!/^\d{1,10}$/.test(digits) || /^0+$/.test(digits)) return null;
  return digits.padStart(10, "0");
}

export function normalizeRegistrationFileNumber(value: unknown) {
  const compact = stringValue(value).toUpperCase().replace(/\s+/g, "");
  return /^333-\d{1,12}(?:-\d{1,4})?$/.test(compact) ? compact : null;
}

export function buildRegistrationCanonicalKey(input: {
  issuer_cik: unknown;
  registration_file_number: unknown;
}) {
  const issuerCik = normalizeIssuerCik(input.issuer_cik);
  const registrationFileNumber = normalizeRegistrationFileNumber(input.registration_file_number);
  return issuerCik && registrationFileNumber
    ? `reg:v1:${issuerCik}:${registrationFileNumber}`
    : null;
}

export function buildDilutionEvidenceIdentity(input: {
  source_ref: string;
  range_start: number;
  range_end: number;
  source_documents: readonly DilutionSourceDocument[];
}): DilutionEvidenceIdentity | null {
  // The semantic caller selects the exact range. Code only verifies source
  // membership and derives the immutable identity for that selected range.
  const document = input.source_documents.find((item) => item.source_ref === input.source_ref);
  if (!document
    || !stableSourceRef(input.source_ref)
    || !Number.isInteger(input.range_start)
    || !Number.isInteger(input.range_end)
    || input.range_start < 0
    || input.range_end <= input.range_start
    || input.range_end > document.text.length) {
    return null;
  }
  const exactSource = document.text.slice(input.range_start, input.range_end);
  if (!exactSource) return null;
  return {
    version: DILUTION_EVIDENCE_IDENTITY_VERSION,
    source_ref: input.source_ref,
    range_start: input.range_start,
    range_end: input.range_end,
    source_content_hash: sha256(exactSource),
    exact_source: true,
  };
}

export function validateDilutionEvidenceIdentity(value: unknown) {
  const errors: string[] = [];
  const identity = record(value);
  if (!identity) return ["evidence identity must be an object"];
  exactKeys(identity, [
    "version",
    "source_ref",
    "range_start",
    "range_end",
    "source_content_hash",
    "exact_source",
  ], "evidence identity", errors);
  if (identity.version !== DILUTION_EVIDENCE_IDENTITY_VERSION) {
    errors.push("evidence identity version is invalid");
  }
  if (!stableSourceRef(identity.source_ref)) errors.push("evidence identity source_ref is invalid");
  if (!Number.isInteger(identity.range_start) || Number(identity.range_start) < 0) {
    errors.push("evidence identity range_start is invalid");
  }
  if (!Number.isInteger(identity.range_end)
    || Number(identity.range_end) <= Number(identity.range_start)) {
    errors.push("evidence identity range_end is invalid");
  }
  if (typeof identity.source_content_hash !== "string"
    || !/^[0-9a-f]{64}$/.test(identity.source_content_hash)) {
    errors.push("evidence identity source_content_hash is invalid");
  }
  if (identity.exact_source !== true) errors.push("evidence identity exact_source must be true");
  return errors;
}

export function verifyDilutionEvidenceIdentity(
  value: unknown,
  sourceDocuments: readonly DilutionSourceDocument[],
) {
  if (validateDilutionEvidenceIdentity(value).length) return false;
  const identity = value as DilutionEvidenceIdentity;
  const document = sourceDocuments.find((item) => item.source_ref === identity.source_ref);
  if (!document || identity.range_end > document.text.length) return false;
  const exactSource = document.text.slice(identity.range_start, identity.range_end);
  return exactSource.length > 0 && sha256(exactSource) === identity.source_content_hash;
}

export function validateDilutionSemanticField(
  value: unknown,
  sourceDocuments: readonly DilutionSourceDocument[],
  roleFamily: "date" | "price" | "any" = "any",
) {
  // This validator checks the declared role enum and evidence authenticity. It
  // intentionally does not classify source prose or manufacture a field role.
  const errors: string[] = [];
  const field = record(value);
  if (!field) return ["semantic field must be an object"];
  if (field.availability === "unavailable") {
    exactKeys(field, [
      "availability",
      "value",
      "semantic_role",
      "evidence_identity",
      "reason",
    ], "semantic field", errors);
    if (field.value !== null) errors.push("unavailable semantic field value must be null");
    if (field.semantic_role !== null) errors.push("unavailable semantic field role must be null");
    if (!includes(DILUTION_FAIL_CLOSED_STATUSES, field.reason)
      || !["SEMANTIC_ROLE_UNAVAILABLE", "EVIDENCE_IDENTITY_MISMATCH"].includes(String(field.reason))) {
      errors.push("unavailable semantic field reason is invalid");
    }
    if (field.evidence_identity !== null
      && !verifyDilutionEvidenceIdentity(field.evidence_identity, sourceDocuments)) {
      errors.push("unavailable semantic field evidence identity is invalid");
    }
    return errors;
  }
  exactKeys(field, [
    "availability",
    "value",
    "semantic_role",
    "evidence_identity",
  ], "semantic field", errors);
  if (field.availability !== "available") errors.push("semantic field availability is invalid");
  if (!isObservedScalar(field.value)) errors.push("semantic field value is invalid");
  const allowedRoles = roleFamily === "date"
    ? DILUTION_DATE_SEMANTIC_ROLES
    : roleFamily === "price"
      ? DILUTION_PRICE_SEMANTIC_ROLES
      : [...DILUTION_DATE_SEMANTIC_ROLES, ...DILUTION_PRICE_SEMANTIC_ROLES];
  if (!includes(allowedRoles, field.semantic_role)) errors.push("semantic field role is invalid");
  if (!verifyDilutionEvidenceIdentity(field.evidence_identity, sourceDocuments)) {
    errors.push("semantic field evidence identity is invalid");
  }
  return errors;
}

export function validateDilutionIdentityClaim(
  value: unknown,
  sourceDocuments: readonly DilutionSourceDocument[],
) {
  const errors: string[] = [];
  const claim = record(value);
  if (!claim) return ["identity claim must be an object"];
  exactKeys(claim, [
    "version",
    "claim_kind",
    "value",
    "semantic_role",
    "evidence_identity",
  ], "identity claim", errors);
  if (claim.version !== DILUTION_IDENTITY_CLAIM_VERSION) errors.push("identity claim version is invalid");
  if (!includes(DILUTION_IDENTITY_CLAIM_KINDS, claim.claim_kind)) errors.push("identity claim kind is invalid");
  if (!boundedText(claim.value, 1_000)) errors.push("identity claim value is invalid");
  if (claim.semantic_role !== null
    && !includes([...DILUTION_DATE_SEMANTIC_ROLES, ...DILUTION_PRICE_SEMANTIC_ROLES], claim.semantic_role)) {
    errors.push("identity claim semantic role is invalid");
  }
  if (!verifyDilutionEvidenceIdentity(claim.evidence_identity, sourceDocuments)) {
    errors.push("identity claim evidence identity is invalid");
  }
  return errors;
}

export function validateDilutionSourceObservation(
  value: unknown,
  sourceDocuments: readonly DilutionSourceDocument[],
) {
  const errors: string[] = [];
  const observation = record(value);
  if (!observation) return ["source observation must be an object"];
  exactKeys(observation, [
    "version",
    "issuer_cik",
    "accession",
    "form",
    "filed_date",
    "accepted_at",
    "analysis_lineage",
    "exposure_id",
    "exposure_type",
    "observation_kind",
    "observed_fields",
    "identity_claims",
    "status",
  ], "source observation", errors);
  if (observation.version !== DILUTION_SOURCE_OBSERVATION_VERSION) errors.push("source observation version is invalid");
  if (normalizeIssuerCik(observation.issuer_cik) !== observation.issuer_cik) errors.push("source observation issuer_cik is invalid");
  if (!ACCESSION_PATTERN.test(stringValue(observation.accession))) errors.push("source observation accession is invalid");
  if (!boundedText(observation.form, 40)) errors.push("source observation form is invalid");
  if (!validDate(observation.filed_date)) errors.push("source observation filed_date is invalid");
  if (observation.accepted_at !== null && !validTimestamp(observation.accepted_at)) {
    errors.push("source observation accepted_at is invalid");
  }
  validateAnalysisLineage(observation.analysis_lineage, errors);
  if (observation.exposure_id !== null && !boundedText(observation.exposure_id, 200)) {
    errors.push("source observation exposure_id is invalid");
  }
  if (observation.exposure_type !== null && !includes(DILUTION_EXPOSURE_TYPES, observation.exposure_type)) {
    errors.push("source observation exposure_type is invalid");
  }
  if (!includes(DILUTION_SOURCE_OBSERVATION_KINDS, observation.observation_kind)) {
    errors.push("source observation kind is invalid");
  }
  if (!includes(["VALIDATED", ...DILUTION_FAIL_CLOSED_STATUSES], observation.status)) {
    errors.push("source observation status is invalid");
  }
  if (observation.status === "IDENTITY_UNRESOLVED" && observation.exposure_id !== null) {
    errors.push("unresolved source observation exposure_id must be null");
  }
  const observedFields = arrayRecords(observation.observed_fields);
  if (!Array.isArray(observation.observed_fields) || observedFields.length !== observation.observed_fields.length) {
    errors.push("source observation observed_fields is invalid");
  }
  for (const [index, item] of observedFields.entries()) {
    if (!boundedText(item.field_name, 120)) errors.push(`observed_fields[${index}].field_name is invalid`);
    errors.push(...validateSourceBackedField(item.field, sourceDocuments)
      .map((error) => `observed_fields[${index}]: ${error}`));
  }
  const identityClaims = arrayRecords(observation.identity_claims);
  if (!Array.isArray(observation.identity_claims) || identityClaims.length !== observation.identity_claims.length) {
    errors.push("source observation identity_claims is invalid");
  }
  for (const [index, claim] of identityClaims.entries()) {
    errors.push(...validateDilutionIdentityClaim(claim, sourceDocuments)
      .map((error) => `identity_claims[${index}]: ${error}`));
    if (includes(DILUTION_EXPOSURE_TYPES, observation.exposure_type)
      && includes(DILUTION_IDENTITY_CLAIM_KINDS, claim.claim_kind)
      && !includes(
        DILUTION_IDENTITY_CLAIM_KINDS_BY_EXPOSURE_TYPE[observation.exposure_type],
        claim.claim_kind,
      )) {
      errors.push(`identity_claims[${index}] is not allowed for ${String(observation.exposure_type)}`);
    }
  }
  if (observation.exposure_type === null && identityClaims.length) {
    errors.push("source observation without an exposure type cannot carry exposure identity claims");
  }
  return errors;
}

export function validateDilutionIdentityDecision(
  value: unknown,
  sourceDocuments: readonly DilutionSourceDocument[],
) {
  const errors: string[] = [];
  const decision = record(value);
  if (!decision) return ["identity decision must be an object"];
  exactKeys(decision, [
    "version",
    "decision",
    "reason_code",
    "target_exposure_id",
    "identity_claim_kinds",
    "identity_evidence",
  ], "identity decision", errors);
  if (decision.version !== DILUTION_IDENTITY_DECISION_VERSION) errors.push("identity decision version is invalid");
  if (!includes(DILUTION_IDENTITY_DECISIONS, decision.decision)) errors.push("identity decision is invalid");
  if (!includes(DILUTION_IDENTITY_DECISION_REASON_CODES, decision.reason_code)) {
    errors.push("identity decision reason code is invalid");
  }
  const targetRequired = decision.decision === "LINK_EXISTING" || decision.decision === "AMEND_EXISTING";
  if (targetRequired) {
    if (!boundedText(decision.target_exposure_id, 200)) {
      errors.push("identity decision target_exposure_id is required");
    }
  } else if (decision.target_exposure_id !== null) {
    errors.push("identity decision target_exposure_id must be null");
  }
  const allowedReasons: Record<DilutionIdentityDecisionKind, readonly DilutionIdentityDecisionReasonCode[]> = {
    CREATE_NEW: ["NO_PRIOR_CANDIDATE", "SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY"],
    LINK_EXISTING: ["EXPLICIT_SOURCE_REFERENCE_MATCH", "SOURCE_BACKED_STRONG_IDENTITY_MATCH"],
    AMEND_EXISTING: ["EXPLICIT_AMENDMENT_REFERENCE_MATCH"],
    UNRESOLVED: [
      "INSUFFICIENT_SOURCE_BACKED_IDENTITY",
      "NON_EXPOSURE_OBSERVATION",
      "EVIDENCE_VALIDATION_FAILED",
    ],
    CONFLICT: [
      "CONFLICTING_STRONG_IDENTITY_CLAIMS",
      "CROSS_ISSUER_IDENTITY_CONFLICT",
      "EXPOSURE_TYPE_CONFLICT",
      "AMBIGUOUS_STRONG_IDENTITY_MATCH",
      "AMBIGUOUS_AMENDMENT_TARGET",
    ],
  };
  if (includes(DILUTION_IDENTITY_DECISIONS, decision.decision)
    && !includes(allowedReasons[decision.decision as DilutionIdentityDecisionKind], decision.reason_code)) {
    errors.push("identity decision reason does not match the decision");
  }
  const mayLackClaimReferences = decision.decision === "UNRESOLVED"
    && (decision.reason_code === "NON_EXPOSURE_OBSERVATION"
      || decision.reason_code === "EVIDENCE_VALIDATION_FAILED");
  if (!Array.isArray(decision.identity_claim_kinds)
    || (!mayLackClaimReferences && decision.identity_claim_kinds.length === 0)
    || decision.identity_claim_kinds.some((kind) => !includes(DILUTION_IDENTITY_CLAIM_KINDS, kind))) {
    errors.push("identity decision claim references are invalid");
  }
  if (!Array.isArray(decision.identity_evidence)
    || (!mayLackClaimReferences && decision.identity_evidence.length === 0)
    || decision.identity_evidence.some((identity) => !verifyDilutionEvidenceIdentity(identity, sourceDocuments))) {
    errors.push("identity decision evidence references are invalid");
  }
  return errors;
}

export function validateDilutionRegistrationObservation(
  value: unknown,
  sourceDocuments: readonly DilutionSourceDocument[],
) {
  const errors: string[] = [];
  const observation = record(value);
  if (!observation) return ["registration observation must be an object"];
  exactKeys(observation, [
    "version",
    "observation_kind",
    "issuer_cik",
    "registration_file_number",
    "registration_canonical_key",
    "accession",
    "form",
    "filed_date",
    "accepted_at",
    "evidence_identities",
    "status",
  ], "registration observation", errors);
  if (observation.version !== DILUTION_REGISTRATION_OBSERVATION_VERSION) {
    errors.push("registration observation version is invalid");
  }
  if (!includes(DILUTION_REGISTRATION_OBSERVATION_KINDS, observation.observation_kind)) {
    errors.push("registration observation kind is invalid");
  }
  const canonicalKey = buildRegistrationCanonicalKey({
    issuer_cik: observation.issuer_cik,
    registration_file_number: observation.registration_file_number,
  });
  if (observation.status === "VALIDATED") {
    if (!canonicalKey || observation.registration_canonical_key !== canonicalKey) {
      errors.push("validated registration observation canonical identity is invalid");
    }
  } else if (observation.status === "REGISTRATION_IDENTITY_UNRESOLVED") {
    if (observation.registration_canonical_key !== null) {
      errors.push("unresolved registration observation canonical key must be null");
    }
  } else if (observation.status !== "EVIDENCE_IDENTITY_MISMATCH") {
    errors.push("registration observation status is invalid");
  }
  if (!ACCESSION_PATTERN.test(stringValue(observation.accession))) errors.push("registration observation accession is invalid");
  const form = stringValue(observation.form).toUpperCase();
  if (!form || form.length > 40) errors.push("registration observation form is invalid");
  if (observation.observation_kind === "automatically_effective" && !["S-3ASR", "F-3ASR"].includes(form)) {
    errors.push("automatically effective observation requires an ASR form");
  }
  if (observation.observation_kind === "effectiveness_declared" && form !== "EFFECT") {
    errors.push("declared effectiveness observation requires EFFECT form");
  }
  if (observation.observation_kind === "prospectus_supplement" && !/^424B(?:[1-5]|7|8)?$/.test(form)) {
    errors.push("prospectus supplement observation requires a 424B form");
  }
  if (!validDate(observation.filed_date)) errors.push("registration observation filed_date is invalid");
  if (observation.accepted_at !== null && !validTimestamp(observation.accepted_at)) {
    errors.push("registration observation accepted_at is invalid");
  }
  if (!Array.isArray(observation.evidence_identities)
    || observation.evidence_identities.length === 0
    || observation.evidence_identities.some((identity) => !verifyDilutionEvidenceIdentity(identity, sourceDocuments))) {
    errors.push("registration observation evidence identities are invalid");
  }
  return errors;
}

export function validateDilutionExposureRegistrationRelationship(
  value: unknown,
  sourceDocuments: readonly DilutionSourceDocument[],
) {
  const errors: string[] = [];
  const relationship = record(value);
  if (!relationship) return ["exposure-registration relationship must be an object"];
  exactKeys(relationship, [
    "version",
    "relationship_kind",
    "exposure_id",
    "registration_canonical_key",
    "evidence_identities",
    "status",
  ], "exposure-registration relationship", errors);
  if (relationship.version !== DILUTION_EXPOSURE_REGISTRATION_RELATIONSHIP_VERSION) {
    errors.push("exposure-registration relationship version is invalid");
  }
  if (!includes(DILUTION_EXPOSURE_REGISTRATION_RELATIONSHIP_KINDS, relationship.relationship_kind)) {
    errors.push("exposure-registration relationship kind is invalid");
  }
  if (relationship.status === "VALIDATED") {
    if (!boundedText(relationship.exposure_id, 200)) errors.push("validated relationship exposure_id is required");
    if (!isRegistrationCanonicalKey(relationship.registration_canonical_key)) {
      errors.push("validated relationship registration key is invalid");
    }
  } else if (relationship.status === "REGISTRATION_RELATIONSHIP_UNRESOLVED") {
    if (relationship.exposure_id !== null || relationship.registration_canonical_key !== null) {
      errors.push("unresolved relationship identities must be null");
    }
  } else if (relationship.status !== "EVIDENCE_IDENTITY_MISMATCH") {
    errors.push("exposure-registration relationship status is invalid");
  }
  if (!Array.isArray(relationship.evidence_identities)
    || relationship.evidence_identities.length === 0
    || relationship.evidence_identities.some((identity) => !verifyDilutionEvidenceIdentity(identity, sourceDocuments))) {
    errors.push("exposure-registration relationship evidence identities are invalid");
  }
  return errors;
}

function validateSourceBackedField(
  value: unknown,
  sourceDocuments: readonly DilutionSourceDocument[],
) {
  const field = record(value);
  if (!field) return ["source-backed field must be an object"];
  if (field.availability === "unavailable") {
    return validateDilutionSemanticField(field, sourceDocuments);
  }
  const errors: string[] = [];
  exactKeys(field, ["availability", "value", "semantic_role", "evidence_identity"], "source-backed field", errors);
  if (field.availability !== "available") errors.push("source-backed field availability is invalid");
  if (!isObservedScalar(field.value)) errors.push("source-backed field value is invalid");
  if (field.semantic_role !== null
    && !includes([...DILUTION_DATE_SEMANTIC_ROLES, ...DILUTION_PRICE_SEMANTIC_ROLES], field.semantic_role)) {
    errors.push("source-backed field semantic role is invalid");
  }
  if (!verifyDilutionEvidenceIdentity(field.evidence_identity, sourceDocuments)) {
    errors.push("source-backed field evidence identity is invalid");
  }
  return errors;
}

function validateAnalysisLineage(value: unknown, errors: string[]) {
  if (value === null) return;
  const lineage = record(value);
  if (!lineage) {
    errors.push("source observation analysis_lineage is invalid");
    return;
  }
  exactKeys(lineage, [
    "source_execution_id",
    "parent_primary_ai_run_id",
    "analyzer_key",
    "analyzer_contract_version",
  ], "analysis lineage", errors);
  if (!UUID_PATTERN.test(stringValue(lineage.source_execution_id))
    || !UUID_PATTERN.test(stringValue(lineage.parent_primary_ai_run_id))
    || !boundedText(lineage.analyzer_key, 120)
    || !boundedText(lineage.analyzer_contract_version, 120)) {
    errors.push("source observation analysis lineage is incomplete");
  }
}

function isRegistrationCanonicalKey(value: unknown) {
  const text = stringValue(value);
  const match = /^reg:v1:(\d{10}):(333-\d{1,12}(?:-\d{1,4})?)$/.exec(text);
  return Boolean(match && buildRegistrationCanonicalKey({
    issuer_cik: match[1],
    registration_file_number: match[2],
  }) === text);
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  errors: string[],
) {
  const expected = new Set(required);
  for (const key of required) {
    if (!(key in value)) errors.push(`${path}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function includes<T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}

function arrayRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function stableSourceRef(value: unknown) {
  return typeof value === "string"
    && value.length >= 1
    && value.length <= 240
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function isObservedScalar(value: unknown): value is DilutionObservedScalar {
  return (typeof value === "string" && value.length > 0)
    || (typeof value === "number" && Number.isFinite(value))
    || typeof value === "boolean";
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
