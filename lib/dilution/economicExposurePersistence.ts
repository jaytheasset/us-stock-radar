import {
  DILUTION_EXPOSURE_TYPES,
  DILUTION_IDENTITY_CLAIM_KINDS,
  DILUTION_IDENTITY_CLAIM_KINDS_BY_EXPOSURE_TYPE,
  DILUTION_IDENTITY_CLAIM_VERSION,
  DILUTION_IDENTITY_DECISION_REASON_CODES,
  DILUTION_IDENTITY_DECISION_VERSION,
  DILUTION_SOURCE_OBSERVATION_VERSION,
  normalizeIssuerCik,
  validateDilutionEvidenceIdentity,
  type DilutionExposureType,
  type DilutionIdentityClaim,
  type DilutionIdentityDecisionKind,
  type DilutionSourceObservation,
} from "./economicExposureContracts.ts";
import {
  ECONOMIC_EXPOSURE_IDENTITY_RESOLVER_VERSION,
  resolveExposureIdentity,
  type EconomicExposureIdentityCandidate,
} from "./economicExposureIdentityResolver.ts";

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const OBSERVATION_KEY_PATTERN = /^economic-observation:v1:[0-9a-f]{64}$/;
const EXPOSURE_ID_PATTERN = /^economic-exposure:v1:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERSISTED_OBSERVATION_KINDS = new Set(["exposure_identity", "exposure_amendment"]);

const REASONS_BY_DECISION = {
  CREATE_NEW: new Set(["NO_PRIOR_CANDIDATE", "SOURCE_BACKED_INDEPENDENT_STRONG_IDENTITY"]),
  LINK_EXISTING: new Set(["EXPLICIT_SOURCE_REFERENCE_MATCH", "SOURCE_BACKED_STRONG_IDENTITY_MATCH"]),
  AMEND_EXISTING: new Set(["EXPLICIT_AMENDMENT_REFERENCE_MATCH"]),
  UNRESOLVED: new Set([
    "INSUFFICIENT_SOURCE_BACKED_IDENTITY",
    "NON_EXPOSURE_OBSERVATION",
    "EVIDENCE_VALIDATION_FAILED",
  ]),
  CONFLICT: new Set([
    "CONFLICTING_STRONG_IDENTITY_CLAIMS",
    "CROSS_ISSUER_IDENTITY_CONFLICT",
    "EXPOSURE_TYPE_CONFLICT",
    "AMBIGUOUS_STRONG_IDENTITY_MATCH",
    "AMBIGUOUS_AMENDMENT_TARGET",
  ]),
} as const;

export type EconomicExposurePersistenceDependencies = Readonly<{
  rpc(functionName: string, payload: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
    error?: string;
  }>;
}>;

export type EconomicExposurePersistenceRow = Readonly<{
  status: "saved" | "idempotent";
  observationKey: string;
  decision: DilutionIdentityDecisionKind;
  targetExposureId: string | null;
}>;

export type EconomicExposurePersistenceBatchResult = Readonly<{
  status: "not_applicable" | "saved" | "idempotent" | "saved_with_replay";
  observationCount: number;
  savedCount: number;
  idempotentCount: number;
  rows: readonly EconomicExposurePersistenceRow[];
}>;

const defaultDependencies: EconomicExposurePersistenceDependencies = {
  rpc: async (functionName, payload) => {
    const repository = await import("../supabase.ts");
    return repository.supabaseRpc(functionName, payload);
  },
};

/**
 * Persists validated identity-sidecar observations in source order. The locked
 * resolver remains the sole identity decision owner. Replays are detected by
 * the database-derived deterministic observation key before resolving again.
 */
export async function persistEconomicExposureIdentityObservations(input: {
  observations: readonly unknown[];
  dependencies?: EconomicExposurePersistenceDependencies;
}): Promise<EconomicExposurePersistenceBatchResult> {
  if (!Array.isArray(input.observations)) {
    throw new Error("Economic exposure persistence rejected: observations must be an array");
  }
  if (input.observations.length === 0) {
    return {
      status: "not_applicable",
      observationCount: 0,
      savedCount: 0,
      idempotentCount: 0,
      rows: [],
    };
  }

  // Validate the complete batch before the first write. A malformed later row
  // therefore cannot leave earlier rows from the same ingest partially saved.
  const observations = input.observations.map((value, index) => {
    const errors = validateEconomicExposurePersistenceObservation(value);
    if (errors.length) {
      throw new Error(`Economic exposure persistence rejected observation[${index}]: ${errors.join("; ")}`);
    }
    return value as DilutionSourceObservation;
  });

  const dependencies = input.dependencies || defaultDependencies;
  const rows: EconomicExposurePersistenceRow[] = [];
  for (const observation of observations) {
    rows.push(await persistOneObservation(observation, dependencies));
  }

  const savedCount = rows.filter((row) => row.status === "saved").length;
  const idempotentCount = rows.length - savedCount;
  return {
    status: savedCount === rows.length
      ? "saved"
      : idempotentCount === rows.length
        ? "idempotent"
        : "saved_with_replay",
    observationCount: rows.length,
    savedCount,
    idempotentCount,
    rows,
  };
}

export function validateEconomicExposurePersistenceObservation(value: unknown): string[] {
  const errors: string[] = [];
  const observation = record(value);
  if (!observation) return ["observation must be an object"];
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
  ], "observation", errors);
  if (observation.version !== DILUTION_SOURCE_OBSERVATION_VERSION) errors.push("version is invalid");
  if (normalizeIssuerCik(observation.issuer_cik) !== observation.issuer_cik) errors.push("issuer_cik is invalid");
  if (!ACCESSION_PATTERN.test(stringValue(observation.accession))) errors.push("accession is invalid");
  if (!boundedTrimmedText(observation.form, 40)) errors.push("form is invalid");
  if (!validDate(observation.filed_date)) errors.push("filed_date is invalid");
  if (observation.accepted_at !== null && !validTimestamp(observation.accepted_at)) errors.push("accepted_at is invalid");
  validateLineage(observation.analysis_lineage, errors);
  if (observation.exposure_id !== null) errors.push("pre-resolution exposure_id must be null");
  if (!isExposureType(observation.exposure_type)) errors.push("exposure_type is invalid");
  if (!PERSISTED_OBSERVATION_KINDS.has(stringValue(observation.observation_kind))) {
    errors.push("observation_kind is outside Persistence V1");
  }
  if (observation.status !== "VALIDATED") errors.push("only VALIDATED observations may persist");
  if (!Array.isArray(observation.observed_fields) || observation.observed_fields.length !== 0) {
    errors.push("observed_fields must remain empty in identity Persistence V1");
  }

  const claims = Array.isArray(observation.identity_claims) ? observation.identity_claims : [];
  if (claims.length < 1 || claims.length > 6) errors.push("identity_claims count is invalid");
  const exposureType = isExposureType(observation.exposure_type) ? observation.exposure_type : null;
  if (exposureType) {
    claims.forEach((claim, index) => validateClaim(
      claim,
      exposureType,
      stringValue(observation.accession),
      `identity_claims[${index}]`,
      errors,
    ));
  }
  const amendmentClaimCount = claims.filter((claim) => record(claim)?.claim_kind === "amendment_reference").length;
  if (observation.observation_kind === "exposure_amendment" && amendmentClaimCount === 0) {
    errors.push("exposure_amendment requires amendment_reference");
  }
  if (observation.observation_kind === "exposure_identity" && amendmentClaimCount > 0) {
    errors.push("exposure_identity cannot carry amendment_reference");
  }
  return errors;
}

async function persistOneObservation(
  observation: DilutionSourceObservation,
  dependencies: EconomicExposurePersistenceDependencies,
): Promise<EconomicExposurePersistenceRow> {
  const contextResponse = await dependencies.rpc("read_dilution_exposure_resolution_context", {
    p_observation: observation,
  });
  if (!contextResponse.ok) {
    throw new Error(`Economic exposure context read failed: ${contextResponse.error || contextResponse.status}`);
  }
  const context = parseResolutionContext(contextResponse.data, observation);
  if (context.status === "already_persisted") {
    return {
      status: "idempotent",
      observationKey: context.observationKey,
      decision: context.decision,
      targetExposureId: context.targetExposureId,
    };
  }

  const resolution = resolveExposureIdentity({
    observation,
    candidateExposures: context.candidates,
  });
  const resolutionErrors = validateEconomicExposurePersistenceResolution(resolution, observation);
  if (resolutionErrors.length) {
    throw new Error(`Economic exposure resolver result rejected: ${resolutionErrors.join("; ")}`);
  }
  const writeResponse = await dependencies.rpc("persist_dilution_exposure_resolution_v1", {
    p_observation: observation,
    p_resolution: resolution,
  });
  if (!writeResponse.ok) {
    throw new Error(`Economic exposure persistence failed: ${writeResponse.error || writeResponse.status}`);
  }
  return parsePersistenceResult(writeResponse.data, resolution.decision, context.observationKey);
}

function validateEconomicExposurePersistenceResolution(
  value: unknown,
  observation: DilutionSourceObservation,
) {
  const errors: string[] = [];
  const resolution = record(value);
  if (!resolution) return ["resolution must be an object"];
  exactKeys(resolution, [
    "version",
    "resolver_version",
    "decision",
    "reason_code",
    "target_exposure_id",
    "identity_claim_kinds",
    "identity_evidence",
    "matched_strong_claims",
    "conflicting_strong_claims",
    "independent_strong_claims",
    "supporting_evidence_references",
    "supporting_registration_matches",
    "candidate_exposure_identity",
  ], "resolution", errors);
  if (resolution.version !== DILUTION_IDENTITY_DECISION_VERSION) errors.push("resolution version is invalid");
  if (resolution.resolver_version !== ECONOMIC_EXPOSURE_IDENTITY_RESOLVER_VERSION) {
    errors.push("resolver version is invalid");
  }
  const decision = isDecision(resolution.decision) ? resolution.decision : null;
  if (!decision) errors.push("decision is invalid");
  if (!includes(DILUTION_IDENTITY_DECISION_REASON_CODES, resolution.reason_code)) {
    errors.push("reason_code is invalid");
  } else if (decision && !REASONS_BY_DECISION[decision].has(resolution.reason_code as never)) {
    errors.push("reason_code does not match decision");
  }
  if (!Array.isArray(resolution.identity_claim_kinds) || resolution.identity_claim_kinds.length === 0
    || resolution.identity_claim_kinds.some((kind) => !includes(DILUTION_IDENTITY_CLAIM_KINDS, kind))) {
    errors.push("identity_claim_kinds are invalid");
  }
  for (const field of [
    "identity_evidence",
    "matched_strong_claims",
    "conflicting_strong_claims",
    "independent_strong_claims",
    "supporting_evidence_references",
    "supporting_registration_matches",
  ]) {
    if (!Array.isArray(resolution[field])) errors.push(`${field} must be an array`);
  }
  for (const field of ["identity_evidence", "supporting_evidence_references"]) {
    const evidence = Array.isArray(resolution[field]) ? resolution[field] as unknown[] : [];
    if (field === "identity_evidence" && evidence.length === 0) errors.push("identity_evidence is required");
    evidence.forEach((item, index) => {
      if (validateDilutionEvidenceIdentity(item).length) errors.push(`${field}[${index}] is invalid`);
    });
  }

  const targetRequired = decision === "LINK_EXISTING" || decision === "AMEND_EXISTING";
  if (targetRequired) {
    if (!EXPOSURE_ID_PATTERN.test(stringValue(resolution.target_exposure_id))) {
      errors.push("target_exposure_id is required");
    }
    const candidate = record(resolution.candidate_exposure_identity);
    if (!candidate
      || candidate.exposure_id !== resolution.target_exposure_id
      || candidate.issuer_cik !== observation.issuer_cik
      || candidate.exposure_type !== observation.exposure_type) {
      errors.push("candidate_exposure_identity does not match the exact target");
    }
  } else if (resolution.target_exposure_id !== null || resolution.candidate_exposure_identity !== null) {
    errors.push("non-target decision must preserve a null target");
  }
  return errors;
}

type ResolutionContext =
  | Readonly<{
      status: "ready";
      observationKey: string;
      candidates: readonly EconomicExposureIdentityCandidate[];
    }>
  | Readonly<{
      status: "already_persisted";
      observationKey: string;
      decision: DilutionIdentityDecisionKind;
      targetExposureId: string | null;
    }>;

function parseResolutionContext(value: unknown, observation: DilutionSourceObservation): ResolutionContext {
  const context = record(value);
  const observationKey = stringValue(context?.observation_key);
  if (!context || !OBSERVATION_KEY_PATTERN.test(observationKey)) {
    throw new Error("Economic exposure context response is invalid");
  }
  if (context.status === "already_persisted") {
    if (!isDecision(context.decision)) throw new Error("Persisted decision response is invalid");
    const targetExposureId = nullableString(context.target_exposure_id);
    if (["CREATE_NEW", "LINK_EXISTING", "AMEND_EXISTING"].includes(context.decision)
      ? !EXPOSURE_ID_PATTERN.test(targetExposureId || "")
      : targetExposureId !== null) {
      throw new Error("Persisted target response is invalid");
    }
    return {
      status: "already_persisted",
      observationKey,
      decision: context.decision,
      targetExposureId,
    };
  }
  if (context.status !== "ready" || !Array.isArray(context.candidates)) {
    throw new Error("Economic exposure context status is invalid");
  }
  const candidates = context.candidates.map((candidate, index) =>
    parseCandidate(candidate, observation.issuer_cik, index));
  return { status: "ready", observationKey, candidates };
}

function parseCandidate(value: unknown, issuerCik: string, index: number): EconomicExposureIdentityCandidate {
  const candidate = record(value);
  if (!candidate
    || !EXPOSURE_ID_PATTERN.test(stringValue(candidate.exposure_id))
    || candidate.issuer_cik !== issuerCik
    || !isExposureType(candidate.exposure_type)
    || !Array.isArray(candidate.identity_claims)
    || !Array.isArray(candidate.registration_canonical_keys)) {
    throw new Error(`Economic exposure candidate[${index}] is invalid`);
  }
  const errors: string[] = [];
  candidate.identity_claims.forEach((claim, claimIndex) => validateClaim(
    claim,
    candidate.exposure_type as DilutionExposureType,
    null,
    `candidate[${index}].identity_claims[${claimIndex}]`,
    errors,
  ));
  if (errors.length) throw new Error(`Economic exposure context rejected: ${errors.join("; ")}`);
  return candidate as EconomicExposureIdentityCandidate;
}

function parsePersistenceResult(
  value: unknown,
  expectedDecision: DilutionIdentityDecisionKind,
  expectedObservationKey: string,
): EconomicExposurePersistenceRow {
  const result = record(value);
  if (!result || (result.status !== "saved" && result.status !== "idempotent")) {
    throw new Error("Economic exposure persistence response is invalid");
  }
  const observationKey = stringValue(result.observation_key);
  const targetExposureId = nullableString(result.target_exposure_id);
  if (observationKey !== expectedObservationKey
    || result.decision !== expectedDecision
    || (["CREATE_NEW", "LINK_EXISTING", "AMEND_EXISTING"].includes(expectedDecision)
      ? !EXPOSURE_ID_PATTERN.test(targetExposureId || "")
      : targetExposureId !== null)) {
    throw new Error("Economic exposure persistence response does not match the authoritative decision");
  }
  return {
    status: result.status,
    observationKey,
    decision: expectedDecision,
    targetExposureId,
  };
}

function validateClaim(
  value: unknown,
  exposureType: DilutionExposureType,
  accession: string | null,
  path: string,
  errors: string[],
) {
  const claim = record(value);
  if (!claim) {
    errors.push(`${path} must be an object`);
    return;
  }
  exactKeys(claim, ["version", "claim_kind", "value", "semantic_role", "evidence_identity"], path, errors);
  if (claim.version !== DILUTION_IDENTITY_CLAIM_VERSION) errors.push(`${path}.version is invalid`);
  if (!includes(DILUTION_IDENTITY_CLAIM_KINDS_BY_EXPOSURE_TYPE[exposureType], claim.claim_kind)) {
    errors.push(`${path}.claim_kind is invalid for ${exposureType}`);
  }
  if (!boundedTrimmedText(claim.value, 1_000)) errors.push(`${path}.value is invalid`);
  if (!validClaimSemanticRole(claim as unknown as DilutionIdentityClaim)) {
    errors.push(`${path}.semantic_role is invalid`);
  }
  if (validateDilutionEvidenceIdentity(claim.evidence_identity).length) {
    errors.push(`${path}.evidence_identity is invalid`);
  } else if (accession && !stringValue(record(claim.evidence_identity)?.source_ref).includes(accession)) {
    errors.push(`${path}.evidence_identity does not identify the filing accession`);
  }
}

function validClaimSemanticRole(claim: DilutionIdentityClaim) {
  if (claim.claim_kind === "sales_agreement_date" || claim.claim_kind === "purchase_agreement_date") {
    return claim.semantic_role === "agreement_signing_date";
  }
  if (claim.claim_kind === "original_issuance_or_closing_date") {
    return claim.semantic_role === "instrument_issuance_date" || claim.semantic_role === "funding_date";
  }
  if (claim.claim_kind === "expiration_date") return claim.semantic_role === "expiration_date";
  return claim.semantic_role === null;
}

function validateLineage(value: unknown, errors: string[]) {
  if (value === null) return;
  const lineage = record(value);
  if (!lineage) {
    errors.push("analysis_lineage is invalid");
    return;
  }
  exactKeys(lineage, [
    "source_execution_id",
    "parent_primary_ai_run_id",
    "analyzer_key",
    "analyzer_contract_version",
  ], "analysis_lineage", errors);
  if (!UUID_PATTERN.test(stringValue(lineage.source_execution_id))
    || !UUID_PATTERN.test(stringValue(lineage.parent_primary_ai_run_id))
    || !boundedTrimmedText(lineage.analyzer_key, 120)
    || !boundedTrimmedText(lineage.analyzer_contract_version, 120)) {
    errors.push("analysis_lineage is incomplete");
  }
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  errors: string[],
) {
  const expected = new Set(required);
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${path}.${key} is not allowed`);
}

function isExposureType(value: unknown): value is DilutionExposureType {
  return includes(DILUTION_EXPOSURE_TYPES, value);
}

function isDecision(value: unknown): value is DilutionIdentityDecisionKind {
  return value === "CREATE_NEW"
    || value === "LINK_EXISTING"
    || value === "AMEND_EXISTING"
    || value === "UNRESOLVED"
    || value === "CONFLICT";
}

function includes<T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}

function boundedTrimmedText(value: unknown, max: number) {
  return typeof value === "string" && value.trim() === value && value.length >= 1 && value.length <= max;
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  return value === null ? null : stringValue(value) || null;
}
