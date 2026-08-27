import {
  DILUTION_DATE_SEMANTIC_ROLES,
  DILUTION_EXPOSURE_TYPES,
  DILUTION_IDENTITY_CLAIM_KINDS,
  DILUTION_IDENTITY_CLAIM_KINDS_BY_EXPOSURE_TYPE,
  DILUTION_IDENTITY_CLAIM_VERSION,
  DILUTION_SOURCE_OBSERVATION_VERSION,
  buildDilutionEvidenceIdentity,
  normalizeIssuerCik,
  validateDilutionIdentityClaim,
  validateDilutionSourceObservation,
  type DilutionExposureType,
  type DilutionIdentityClaim,
  type DilutionIdentityClaimKind,
  type DilutionSemanticRole,
  type DilutionSourceDocument,
  type DilutionSourceObservation,
} from "./economicExposureContracts.ts";
import { parseJsonWithoutDuplicateKeys } from "../minimalOfferingMonitor.ts";

export const ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD =
  "economic_exposure_identity_observations" as const;
export const ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD = "eeio" as const;
export const ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_MAX_OBSERVATIONS = 4;
export const ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_MAX_CLAIMS = 6;

export type EconomicExposureIdentitySourceBlock = Readonly<{
  block_id?: unknown;
  source_ref?: unknown;
  block_type?: unknown;
  text?: unknown;
}>;

export type EconomicExposureIdentitySidecarTransportResult = Readonly<{
  observations: readonly DilutionSourceObservation[];
  rejected: readonly string[];
}>;

const SIDECAR_OBSERVATION_KINDS = ["exposure_identity", "exposure_amendment"] as const;
const SIDE_CAR_ALLOWED_KEYS = new Set(["exposure_type", "observation_kind", "identity_claims"]);
const SIDE_CAR_CLAIM_ALLOWED_KEYS = new Set([
  "claim_kind",
  "value",
  "semantic_role",
  "evidence",
]);
const SIDE_CAR_EVIDENCE_ALLOWED_KEYS = new Set(["source_block_index", "exact_quote"]);

export const economicExposureIdentitySidecarProviderSchema = {
  // Gemini's 8-K schemas exceed its finite-state limit when this nested contract is expanded here.
  // Transport decodes this string and validates the full bounded array/object contract below.
  type: "string",
} as const;

export const ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROMPT = [
  "Optional Economic Exposure Identity Observation Sidecar:",
  `Return provider root ${ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD} as one JSON string encoding the ${ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD} array with at most ${ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_MAX_OBSERVATIONS} observations and at most ${ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_MAX_CLAIMS} claims per observation; return the exact string "[]" when the source does not state a continuing exposure identity.`,
  "Each encoded observation must contain exactly exposure_type, observation_kind, and identity_claims. Each identity_claims item must contain exactly claim_kind, value, semantic_role, and evidence; evidence must contain exactly source_block_index and exact_quote.",
  "Before returning, scan every cleaned_source_blocks item for explicitly named continuing instruments and agreements. When the supplied source explicitly names a supported exposure identity, returning [] is invalid; extract the source-stated claims even when the filing is mainly a registration, resale prospectus, ATM update, or wrapper transaction.",
  "Create separate observations for separately designated notes or warrant series. For a repeated ATM or equity-line discussion, extract the source-stated agreement title/date/agent or counterparty without deciding whether it matches a prior exposure.",
  "Extract only source-stated identity facts for convertible_note, warrant, prefunded_warrant, convertible_preferred, atm_program, or equity_line. Registered Direct, PIPE, plain common shares, and a registration statement are not exposures by themselves.",
  `claim_kind must be one exact locked value: ${DILUTION_IDENTITY_CLAIM_KINDS.join(", ")}. Use only claim kinds allowed for the selected exposure type.`,
  "Do not infer sameness, canonical identity, a missing designation, a missing original date, or identity from the same amount, price, holder, counterparty, shelf registration, or wrapper transaction.",
  "Never output exposure_id, canonical_id, confidence, same_as_previous, link/create/amend flags, current terms, potential shares, remaining amounts, dilution, or any final identity decision.",
  "For each claim, cite the zero-based index of the exact cleaned_source_blocks item used and copy one claim-specific exact_quote from that block. Do not cite another filing or context outside the supplied analysis bundle.",
  "Use exposure_amendment only when the source explicitly identifies an amended instrument or agreement; output the source-stated target as amendment_reference and do not decide AMEND_EXISTING.",
  "Use prefunded_warrant only when the cited source explicitly states pre-funded. Keep separately designated notes and warrant series as separate observations.",
  "Use semantic_role agreement_signing_date for sales_agreement_date and purchase_agreement_date; instrument_issuance_date or funding_date for an explicit original issuance/closing date; expiration_date for expiration_date; otherwise semantic_role must be null. If the meaning is unclear, omit the claim.",
].join("\n");

export function withEconomicExposureIdentitySidecarSchema<TSchema extends {
  properties: Record<string, unknown>;
  required?: readonly string[];
}>(schema: TSchema): TSchema {
  return {
    ...schema,
    required: [...(schema.required || []), ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD],
    properties: {
      ...schema.properties,
      [ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD]: economicExposureIdentitySidecarProviderSchema,
    },
  };
}

export function transportEconomicExposureIdentitySidecar(input: {
  provider_output: unknown;
  source_blocks: readonly EconomicExposureIdentitySourceBlock[];
  issuer_cik: unknown;
  accession: unknown;
  form: unknown;
  filed_date: unknown;
  accepted_at?: unknown;
}): EconomicExposureIdentitySidecarTransportResult {
  const root = record(input.provider_output);
  const providerWire = root?.[ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_PROVIDER_FIELD]
    ?? root?.[ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_FIELD];
  if (providerWire === undefined || providerWire === null) return { observations: [], rejected: [] };
  const wire = decodeProviderSidecar(providerWire);
  if (!Array.isArray(wire)) return { observations: [], rejected: ["sidecar must be an array"] };
  if (wire.length > ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_MAX_OBSERVATIONS) {
    return { observations: [], rejected: ["sidecar observation bound exceeded"] };
  }

  const issuerCik = normalizeIssuerCik(input.issuer_cik);
  const accession = stringValue(input.accession);
  const form = stringValue(input.form);
  const filedDate = dateValue(input.filed_date);
  const acceptedAt = timestampValue(input.accepted_at);
  if (!issuerCik || !accession || !form || !filedDate) {
    return { observations: [], rejected: ["filing identity is incomplete"] };
  }

  const sourceDocuments = input.source_blocks.map((block, index) => ({
    source_ref: sourceRef(block, accession, index),
    text: stringValuePreserve(block.text),
  }));
  const observations: DilutionSourceObservation[] = [];
  const rejected: string[] = [];

  wire.forEach((rawObservation, observationIndex) => {
    const observation = record(rawObservation);
    const prefix = `observation[${observationIndex}]`;
    if (!observation || !exactKeys(observation, SIDE_CAR_ALLOWED_KEYS)) {
      rejected.push(`${prefix} shape is invalid`);
      return;
    }
    const exposureType = isExposureType(observation.exposure_type) ? observation.exposure_type : null;
    const observationKind = includes(SIDECAR_OBSERVATION_KINDS, observation.observation_kind)
      ? observation.observation_kind
      : null;
    const rawClaims = observation.identity_claims;
    if (!exposureType || !observationKind || !Array.isArray(rawClaims)) {
      rejected.push(`${prefix} contract is invalid`);
      return;
    }
    if (rawClaims.length > ECONOMIC_EXPOSURE_IDENTITY_SIDECAR_MAX_CLAIMS) {
      rejected.push(`${prefix} claim bound exceeded`);
      return;
    }
    if (exposureType === "prefunded_warrant" && !rawClaims.some((rawClaim) => {
      const claim = record(rawClaim);
      const evidence = record(claim?.evidence);
      return /pre[\s-]*funded/i.test(stringValuePreserve(evidence?.exact_quote));
    })) {
      rejected.push(`${prefix} pre-funded subtype is not explicit in evidence`);
      return;
    }

    const claims: DilutionIdentityClaim[] = [];
    rawClaims.forEach((rawClaim, claimIndex) => {
      const claim = materializeClaim({
        rawClaim,
        exposureType,
        observationKind,
        sourceDocuments,
      });
      if (typeof claim === "string") rejected.push(`${prefix}.identity_claims[${claimIndex}] ${claim}`);
      else claims.push(claim);
    });

    if (!claims.length) {
      rejected.push(`${prefix} has no valid source-backed claims`);
      return;
    }
    const materialized: DilutionSourceObservation = {
      version: DILUTION_SOURCE_OBSERVATION_VERSION,
      issuer_cik: issuerCik,
      accession,
      form,
      filed_date: filedDate,
      accepted_at: acceptedAt,
      analysis_lineage: null,
      exposure_id: null,
      exposure_type: exposureType,
      observation_kind: observationKind,
      observed_fields: [],
      identity_claims: claims,
      status: "VALIDATED",
    };
    const validationErrors = validateDilutionSourceObservation(materialized, sourceDocuments);
    if (validationErrors.length) rejected.push(`${prefix} ${validationErrors.join("; ")}`);
    else observations.push(materialized);
  });

  return { observations, rejected };
}

export function economicExposureIdentityFilingMetadata(filingPackage: Record<string, unknown>) {
  const rawPayload = record(filingPackage.rawPayload) || record(filingPackage.raw_payload) || {};
  const primaryIssuer = record(filingPackage.issuer) || {};
  return {
    issuer_cik: firstValue(
      filingPackage.issuer_cik,
      filingPackage.cik,
      primaryIssuer.cik,
      rawPayload.issuer_cik,
      rawPayload.cik,
    ),
    accession: firstValue(
      filingPackage.accession_number,
      filingPackage.accessionNumber,
      rawPayload.accession_number,
      rawPayload.accessionNumber,
    ),
    form: firstValue(filingPackage.form_type, filingPackage.form, rawPayload.form_type, rawPayload.form),
    filed_date: firstValue(
      filingPackage.filed_at,
      filingPackage.filedAt,
      filingPackage.published_at,
      rawPayload.filing_date,
      rawPayload.filed_at,
    ),
    accepted_at: firstValue(
      filingPackage.accepted_at,
      filingPackage.acceptedAt,
      rawPayload.accepted_at,
      rawPayload.acceptance_datetime,
    ) || null,
  };
}

function materializeClaim(input: {
  rawClaim: unknown;
  exposureType: DilutionExposureType;
  observationKind: (typeof SIDECAR_OBSERVATION_KINDS)[number];
  sourceDocuments: readonly DilutionSourceDocument[];
}): DilutionIdentityClaim | string {
  const claim = record(input.rawClaim);
  if (!claim || !exactKeys(claim, SIDE_CAR_CLAIM_ALLOWED_KEYS)) return "shape is invalid";
  const evidence = record(claim.evidence);
  if (!evidence || !exactKeys(evidence, SIDE_CAR_EVIDENCE_ALLOWED_KEYS)) return "evidence shape is invalid";
  const claimKind = isClaimKind(claim.claim_kind) ? claim.claim_kind : null;
  if (!claimKind || !DILUTION_IDENTITY_CLAIM_KINDS_BY_EXPOSURE_TYPE[input.exposureType].includes(claimKind as never)) {
    return "claim kind is not allowed for exposure type";
  }
  if (claimKind === "amendment_reference" && input.observationKind !== "exposure_amendment") {
    return "amendment reference requires exposure_amendment";
  }
  if (input.observationKind === "exposure_amendment" && claimKind !== "amendment_reference") {
    return "exposure_amendment accepts amendment_reference only";
  }
  const semanticRole = claim.semantic_role === null || includes(DILUTION_DATE_SEMANTIC_ROLES, claim.semantic_role)
    ? claim.semantic_role as DilutionSemanticRole | null
    : undefined;
  const value = stringValue(claim.value);
  if (semanticRole === undefined || !validSemanticRole(claimKind, semanticRole, value)) return "semantic role is invalid";
  const exactQuote = stringValuePreserve(evidence.exact_quote);
  const sourceIndex = Number(evidence.source_block_index);
  const sourceDocument = input.sourceDocuments[sourceIndex];
  if (!value || value.length > 300 || !exactQuote || exactQuote.length > 800 || !Number.isInteger(sourceIndex) || !sourceDocument) {
    return "value or source membership is invalid";
  }
  const first = sourceDocument.text.indexOf(exactQuote);
  if (first < 0 || sourceDocument.text.indexOf(exactQuote, first + 1) >= 0) return "exact quote is absent or ambiguous";
  const evidenceIdentity = buildDilutionEvidenceIdentity({
    source_ref: sourceDocument.source_ref,
    range_start: first,
    range_end: first + exactQuote.length,
    source_documents: input.sourceDocuments,
  });
  if (!evidenceIdentity) return "evidence identity could not be built";
  const materialized: DilutionIdentityClaim = {
    version: DILUTION_IDENTITY_CLAIM_VERSION,
    claim_kind: claimKind,
    value,
    semantic_role: semanticRole,
    evidence_identity: evidenceIdentity,
  };
  const validationErrors = validateDilutionIdentityClaim(materialized, input.sourceDocuments);
  return validationErrors.length ? validationErrors.join("; ") : materialized;
}

function validSemanticRole(kind: DilutionIdentityClaimKind, role: DilutionSemanticRole | null, value: string) {
  if (kind === "sales_agreement_date" || kind === "purchase_agreement_date") {
    return role === "agreement_signing_date" && validDateValue(value);
  }
  if (kind === "original_issuance_or_closing_date") {
    return (role === "instrument_issuance_date" || role === "funding_date") && validDateValue(value);
  }
  if (kind === "expiration_date") return role === "expiration_date" && validDateValue(value);
  return role === null;
}

function validDateValue(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sourceRef(block: EconomicExposureIdentitySourceBlock, accession: string, index: number) {
  const blockId = stringValue(block.block_id);
  const prefix = stringValue(block.block_type) === "parent_filing_context" ? "parent-analysis-source" : "analysis-source";
  return `${prefix}:${accession}:${blockId || index}`;
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function decodeProviderSidecar(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return parseJsonWithoutDuplicateKeys(value);
  } catch {
    return null;
  }
}

function isExposureType(value: unknown): value is DilutionExposureType {
  return includes(DILUTION_EXPOSURE_TYPES, value);
}

function isClaimKind(value: unknown): value is DilutionIdentityClaimKind {
  return includes(DILUTION_IDENTITY_CLAIM_KINDS, value);
}

function includes<T>(values: readonly T[], value: unknown): value is T {
  return values.includes(value as T);
}

function dateValue(value: unknown) {
  const text = stringValue(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function timestampValue(value: unknown) {
  const text = stringValue(value);
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function firstValue(...values: unknown[]) {
  return values.find((value) => stringValue(value)) ?? "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringValuePreserve(value: unknown) {
  return typeof value === "string" ? value : "";
}
