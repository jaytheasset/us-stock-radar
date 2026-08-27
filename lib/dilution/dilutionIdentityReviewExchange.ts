import {
  DILUTION_IDENTITY_DECISIONS,
  type DilutionIdentityDecisionKind,
} from "./economicExposureContracts.ts";

export const DILUTION_IDENTITY_REVIEW_PACKET_VERSION =
  "dilution_identity_review_packet_v1" as const;
export const DILUTION_IDENTITY_REVIEW_CONFIDENCE = [
  "HIGH",
  "MEDIUM",
  "LOW",
] as const;

export type DilutionIdentityReviewConfidence =
  (typeof DILUTION_IDENTITY_REVIEW_CONFIDENCE)[number];

export type DilutionIdentityReviewRpc = (
  functionName: string,
  payload: Record<string, unknown>,
) => Promise<{
  ok: boolean;
  status: number;
  data: unknown;
  error?: string;
}>;

export type DilutionIdentityReviewCaseSummary = Readonly<{
  observationKey: string;
  reviewCaseId: string;
  issuerCik: string;
  ticker: string | null;
  accession: string;
  form: string;
  filedDate: string;
  exposureType: string;
  originalDecision: "UNRESOLVED" | "CONFLICT";
  originalReasonCode: string;
  reviewStatus: "PENDING" | "APPLIED";
  effectiveDecision: DilutionIdentityDecisionKind;
  effectiveTargetExposureId: string | null;
  appliedAt: string | null;
}>;

export type DilutionIdentityReviewDecision = Readonly<{
  review_case_id: string;
  input_hash: string;
  decision: DilutionIdentityDecisionKind;
  target_exposure_id?: string;
  confidence: DilutionIdentityReviewConfidence;
  reason: string;
  evidence_refs: readonly string[];
}>;

export type DilutionIdentityReviewPacket = Readonly<{
  packet_version: typeof DILUTION_IDENTITY_REVIEW_PACKET_VERSION;
  task_instructions: readonly string[];
  review_case_id: string;
  input_hash: string;
  issuer: Record<string, unknown>;
  new_observation: Record<string, unknown>;
  resolver_original: Record<string, unknown>;
  candidate_identity: unknown;
  source_backed_claims: readonly Record<string, unknown>[];
  evidence_refs: readonly Record<string, unknown>[];
  relevant_existing_economic_exposures: readonly Record<string, unknown>[];
  identity_observation_history: readonly Record<string, unknown>[];
  allowed_decisions: readonly DilutionIdentityDecisionKind[];
  allowed_target_exposure_ids: readonly string[];
  gpt_output_contract: Record<string, unknown>;
}>;

export type DilutionIdentityReviewPreview = Readonly<{
  reviewCaseId: string;
  inputHash: string;
  originalDecision: string;
  originalTargetExposureId: string | null;
  proposedDecision: DilutionIdentityDecisionKind;
  proposedTargetExposureId: string | null;
  targetExposure: Record<string, unknown> | null;
  confidence: DilutionIdentityReviewConfidence;
  reason: string;
  evidenceRefs: readonly string[];
}>;

export type DilutionIdentityReviewValidation =
  | Readonly<{
      ok: true;
      decision: DilutionIdentityReviewDecision;
      preview: DilutionIdentityReviewPreview;
    }>
  | Readonly<{
      ok: false;
      errors: readonly Readonly<{ code: string; message: string }>[];
    }>;

export type DilutionIdentityReviewApplyResult = Readonly<{
  status: "applied" | "idempotent";
  adjudicationId: string;
  observationKey: string;
  originalDecision: string;
  effectiveDecision: DilutionIdentityDecisionKind;
  targetExposureId: string | null;
  appliedAt: string;
}>;

export class DilutionIdentityReviewError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    code: string,
    message: string,
    status = 400,
  ) {
    super(message);
    this.name = "DilutionIdentityReviewError";
    this.code = code;
    this.status = status;
  }
}

const defaultRpc: DilutionIdentityReviewRpc = async (functionName, payload) => {
  const repository = await import("../supabase.ts");
  return repository.supabaseRpc(functionName, payload);
};

export async function listDilutionIdentityReviewCases(input: {
  limit?: number;
  rpc?: DilutionIdentityReviewRpc;
} = {}): Promise<readonly DilutionIdentityReviewCaseSummary[]> {
  const limit = Number.isInteger(input.limit) ? Math.max(1, Math.min(input.limit!, 200)) : 100;
  const response = await (input.rpc || defaultRpc)(
    "list_dilution_identity_review_cases_v1",
    { p_limit: limit },
  );
  if (!response.ok) throw rpcError(response.error, response.status);
  if (!Array.isArray(response.data)) {
    throw new DilutionIdentityReviewError(
      "REVIEW_CASE_LIST_INVALID",
      "The review case list response is invalid.",
      502,
    );
  }
  return response.data.map(parseCaseSummary);
}

export async function getDilutionIdentityReviewPacket(input: {
  observationKey: string;
  rpc?: DilutionIdentityReviewRpc;
}): Promise<DilutionIdentityReviewPacket> {
  const observationKey = requiredPattern(
    input.observationKey,
    /^economic-observation:v1:[0-9a-f]{64}$/,
    "REVIEW_OBSERVATION_KEY_INVALID",
    "Choose a valid persisted dilution observation.",
  );
  const response = await (input.rpc || defaultRpc)(
    "read_dilution_identity_review_case_v1",
    { p_observation_key: observationKey },
  );
  if (!response.ok) throw rpcError(response.error, response.status);
  return buildReviewPacket(response.data);
}

export function formatDilutionIdentityReviewPacket(
  packet: DilutionIdentityReviewPacket,
) {
  return JSON.stringify(packet, null, 2);
}

export function validateDilutionIdentityReviewDecision(input: {
  packet: DilutionIdentityReviewPacket;
  pastedDecision: string;
}): DilutionIdentityReviewValidation {
  const errors: Array<{ code: string; message: string }> = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.pastedDecision);
  } catch {
    return failure("REVIEW_JSON_INVALID", "Paste one valid JSON object returned from ChatGPT.");
  }

  const value = object(parsed);
  if (!value) return failure("REVIEW_DECISION_SCHEMA_INVALID", "The GPT decision must be a JSON object.");
  const allowedKeys = new Set([
    "review_case_id",
    "input_hash",
    "decision",
    "target_exposure_id",
    "confidence",
    "reason",
    "evidence_refs",
  ]);
  const unexpected = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unexpected.length) {
    errors.push({
      code: "REVIEW_DECISION_SCHEMA_INVALID",
      message: `Remove unsupported field${unexpected.length === 1 ? "" : "s"}: ${unexpected.join(", ")}.`,
    });
  }

  const reviewCaseId = string(value.review_case_id);
  const inputHash = string(value.input_hash);
  if (reviewCaseId !== input.packet.review_case_id) {
    errors.push({ code: "REVIEW_CASE_ID_MISMATCH", message: "The response belongs to another review case." });
  }
  if (inputHash !== input.packet.input_hash) {
    errors.push({
      code: "STALE_REVIEW_INPUT",
      message: "The response was produced from stale registry or observation state. Copy a new packet.",
    });
  }

  const decision = isDecision(value.decision) ? value.decision : null;
  if (!decision) {
    errors.push({ code: "REVIEW_DECISION_INVALID", message: "Choose one allowed identity decision." });
  }

  const target = optionalString(value.target_exposure_id);
  if (decision === "LINK_EXISTING" || decision === "AMEND_EXISTING") {
    if (!target) {
      errors.push({ code: "REVIEW_TARGET_REQUIRED", message: `${decision} requires target_exposure_id.` });
    } else if (!input.packet.allowed_target_exposure_ids.includes(target)) {
      errors.push({
        code: "REVIEW_TARGET_NOT_IN_PACKET",
        message: "The target exposure was not included in this review packet.",
      });
    }
  } else if (target) {
    errors.push({
      code: "REVIEW_TARGET_FORBIDDEN",
      message: "Only LINK_EXISTING or AMEND_EXISTING may include target_exposure_id.",
    });
  }

  const confidence = isConfidence(value.confidence) ? value.confidence : null;
  if (!confidence) {
    errors.push({ code: "REVIEW_CONFIDENCE_INVALID", message: "confidence must be HIGH, MEDIUM, or LOW." });
  }
  const reason = string(value.reason);
  if (!reason || reason.length > 4000 || reason !== reason.trim()) {
    errors.push({ code: "REVIEW_REASON_INVALID", message: "reason must be 1–4,000 trimmed characters." });
  }

  const allowedEvidenceRefs = new Set(
    input.packet.evidence_refs.map((ref) => string(ref.ref)).filter(Boolean),
  );
  const evidenceRefs = Array.isArray(value.evidence_refs)
    ? value.evidence_refs.map(string)
    : [];
  if (evidenceRefs.length < 1 || evidenceRefs.length > 40
    || evidenceRefs.some((ref) => !ref || ref.length > 240 || ref !== ref.trim())) {
    errors.push({
      code: "REVIEW_EVIDENCE_REFS_INVALID",
      message: "evidence_refs must contain 1–40 non-empty packet evidence references.",
    });
  } else if (new Set(evidenceRefs).size !== evidenceRefs.length) {
    errors.push({ code: "REVIEW_EVIDENCE_REFS_INVALID", message: "evidence_refs cannot contain duplicates." });
  } else if (evidenceRefs.some((ref) => !allowedEvidenceRefs.has(ref))) {
    errors.push({
      code: "REVIEW_EVIDENCE_REF_NOT_IN_PACKET",
      message: "Every evidence reference must come from the current review packet.",
    });
  }

  if (errors.length || !decision || !confidence || !reason) return { ok: false, errors };

  const normalized: DilutionIdentityReviewDecision = {
    review_case_id: reviewCaseId,
    input_hash: inputHash,
    decision,
    ...(target ? { target_exposure_id: target } : {}),
    confidence,
    reason,
    evidence_refs: evidenceRefs,
  };
  const resolver = object(input.packet.resolver_original) || {};
  const targetExposure = target
    ? input.packet.relevant_existing_economic_exposures.find(
        (exposure) => string(exposure.exposure_id) === target,
      ) || null
    : null;
  return {
    ok: true,
    decision: normalized,
    preview: {
      reviewCaseId,
      inputHash,
      originalDecision: string(resolver.decision),
      originalTargetExposureId: optionalString(resolver.target_exposure_id),
      proposedDecision: decision,
      proposedTargetExposureId: target,
      targetExposure,
      confidence,
      reason,
      evidenceRefs,
    },
  };
}

export async function validateCurrentDilutionIdentityReviewDecision(input: {
  observationKey: string;
  pastedDecision: string;
  rpc?: DilutionIdentityReviewRpc;
}) {
  const packet = await getDilutionIdentityReviewPacket(input);
  return { packet, validation: validateDilutionIdentityReviewDecision({ packet, ...input }) };
}

export async function applyDilutionIdentityReviewDecision(input: {
  observationKey: string;
  pastedDecision: string;
  appliedByUserId: string;
  rpc?: DilutionIdentityReviewRpc;
}): Promise<DilutionIdentityReviewApplyResult> {
  const decision = parseDilutionIdentityReviewDecisionForApply(input.pastedDecision);
  const actor = requiredPattern(
    input.appliedByUserId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "REVIEW_ACTOR_INVALID",
    "The administrator identity is invalid.",
  );
  const response = await (input.rpc || defaultRpc)("apply_dilution_identity_review_v1", {
    p_observation_key: input.observationKey,
    p_decision: decision,
    p_applied_by_user_id: actor,
  });
  if (!response.ok) throw rpcError(response.error, response.status);
  return parseApplyResult(response.data);
}

function parseDilutionIdentityReviewDecisionForApply(
  pastedDecision: string,
): DilutionIdentityReviewDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(pastedDecision);
  } catch {
    throw new DilutionIdentityReviewError(
      "REVIEW_JSON_INVALID",
      "Paste one valid JSON object returned from ChatGPT.",
    );
  }
  const value = object(parsed);
  const allowedKeys = new Set([
    "review_case_id", "input_hash", "decision", "target_exposure_id",
    "confidence", "reason", "evidence_refs",
  ]);
  if (!value || Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new DilutionIdentityReviewError(
      "REVIEW_DECISION_SCHEMA_INVALID",
      "The GPT decision does not match the required JSON schema.",
    );
  }
  const reviewCaseId = string(value.review_case_id);
  const inputHash = string(value.input_hash);
  const decision = isDecision(value.decision) ? value.decision : null;
  const target = optionalString(value.target_exposure_id);
  const confidence = isConfidence(value.confidence) ? value.confidence : null;
  const reason = string(value.reason);
  const evidenceRefs = Array.isArray(value.evidence_refs)
    ? value.evidence_refs.map(string)
    : [];
  const targetInvalid = decision === "LINK_EXISTING" || decision === "AMEND_EXISTING"
    ? !target || !/^economic-exposure:v1:[0-9a-f]{64}$/.test(target)
    : Boolean(target);
  if (!/^dilution-review-case:v1:[0-9a-f]{64}$/.test(reviewCaseId)
    || !/^dilution-review-input:v1:[0-9a-f]{64}$/.test(inputHash)
    || !decision || targetInvalid || !confidence
    || !reason || reason !== reason.trim() || reason.length > 4000
    || evidenceRefs.length < 1 || evidenceRefs.length > 40
    || new Set(evidenceRefs).size !== evidenceRefs.length
    || evidenceRefs.some((ref) => !ref || ref !== ref.trim() || ref.length > 240)) {
    throw new DilutionIdentityReviewError(
      "REVIEW_DECISION_SCHEMA_INVALID",
      "The GPT decision does not match the required JSON schema.",
    );
  }
  return {
    review_case_id: reviewCaseId,
    input_hash: inputHash,
    decision,
    ...(target ? { target_exposure_id: target } : {}),
    confidence,
    reason,
    evidence_refs: evidenceRefs,
  };
}

export async function readEffectiveDilutionIdentityDecision(input: {
  observationKey: string;
  rpc?: DilutionIdentityReviewRpc;
}) {
  const observationKey = requiredPattern(
    input.observationKey,
    /^economic-observation:v1:[0-9a-f]{64}$/,
    "REVIEW_OBSERVATION_KEY_INVALID",
    "Choose a valid persisted dilution observation.",
  );
  const response = await (input.rpc || defaultRpc)(
    "read_effective_dilution_identity_decision_v1",
    { p_observation_key: observationKey },
  );
  if (!response.ok) throw rpcError(response.error, response.status);
  const result = object(response.data);
  if (!result || !object(result.original) || !object(result.effective)) {
    throw new DilutionIdentityReviewError(
      "REVIEW_EFFECTIVE_DECISION_INVALID",
      "The effective identity decision response is invalid.",
      502,
    );
  }
  return result;
}

function buildReviewPacket(value: unknown): DilutionIdentityReviewPacket {
  const context = object(value);
  const reviewCaseId = string(context?.review_case_id);
  const inputHash = string(context?.input_hash);
  const issuer = object(context?.issuer);
  const reviewObservation = object(context?.review_observation);
  const observation = object(reviewObservation?.observation);
  const resolver = object(reviewObservation?.resolver_original);
  const exposures = records(context?.existing_economic_exposures);
  const history = records(context?.identity_observation_history);
  const allowedTargets = strings(context?.allowed_target_exposure_ids);
  const allowedEvidenceRefs = strings(context?.allowed_evidence_refs);
  if (!/^dilution-review-case:v1:[0-9a-f]{64}$/.test(reviewCaseId)
    || !/^dilution-review-input:v1:[0-9a-f]{64}$/.test(inputHash)
    || !issuer || !reviewObservation || !observation || !resolver
    || !Array.isArray(context?.existing_economic_exposures)
    || !Array.isArray(context?.identity_observation_history)
    || !Array.isArray(context?.allowed_target_exposure_ids)
    || !Array.isArray(context?.allowed_evidence_refs)) {
    throw new DilutionIdentityReviewError(
      "REVIEW_PACKET_CONTEXT_INVALID",
      "The stored review context is invalid.",
      502,
    );
  }

  const newClaims = records(observation.identity_claims);
  const sourceBackedClaims = newClaims.map((claim, index) => ({
    claim_ref: `new-observation-claim:${index + 1}`,
    claim_kind: claim.claim_kind,
    value: claim.value,
    semantic_role: claim.semantic_role ?? null,
    source_excerpt: claim.value,
    evidence_identity: claim.evidence_identity,
  }));
  const evidenceDetails = collectEvidenceDetails([...newClaims, ...allClaims(exposures, history)]);
  const evidenceRefs = allowedEvidenceRefs.map((ref) => ({
    ref,
    ...(evidenceDetails.get(ref) || { source_ref: ref }),
  }));
  const candidateIdentity = object(resolver.result)?.candidate_exposure_identity ?? null;

  return {
    packet_version: DILUTION_IDENTITY_REVIEW_PACKET_VERSION,
    task_instructions: [
      "Review whether the new source observation identifies a new or existing economic exposure.",
      "Use only the source-backed claims, evidence references, canonical identities, and history in this packet.",
      "Return exactly one JSON object matching gpt_output_contract; do not add Markdown or commentary.",
      "Never invent an exposure ID. LINK_EXISTING and AMEND_EXISTING may use only allowed_target_exposure_ids.",
      "Omit target_exposure_id for CREATE_NEW, UNRESOLVED, and CONFLICT.",
    ],
    review_case_id: reviewCaseId,
    input_hash: inputHash,
    issuer,
    new_observation: reviewObservation,
    resolver_original: resolver,
    candidate_identity: candidateIdentity,
    source_backed_claims: sourceBackedClaims,
    evidence_refs: evidenceRefs,
    relevant_existing_economic_exposures: exposures,
    identity_observation_history: history,
    allowed_decisions: DILUTION_IDENTITY_DECISIONS,
    allowed_target_exposure_ids: allowedTargets,
    gpt_output_contract: {
      schema: {
        type: "object",
        additionalProperties: false,
        required: [
          "review_case_id",
          "input_hash",
          "decision",
          "confidence",
          "reason",
          "evidence_refs",
        ],
        properties: {
          review_case_id: { const: reviewCaseId },
          input_hash: { const: inputHash },
          decision: { enum: DILUTION_IDENTITY_DECISIONS },
          target_exposure_id: { enum: allowedTargets },
          confidence: { enum: DILUTION_IDENTITY_REVIEW_CONFIDENCE },
          reason: { type: "string", minLength: 1, maxLength: 4000 },
          evidence_refs: {
            type: "array",
            minItems: 1,
            maxItems: 40,
            uniqueItems: true,
            items: { enum: allowedEvidenceRefs },
          },
        },
      },
      decision_rules: {
        LINK_EXISTING: "target_exposure_id is required and must come from allowed_target_exposure_ids.",
        AMEND_EXISTING: "target_exposure_id is required and must come from allowed_target_exposure_ids.",
        CREATE_NEW: "Omit target_exposure_id. Stock Radar generates the exposure ID only after human Apply.",
        UNRESOLVED: "Omit target_exposure_id.",
        CONFLICT: "Omit target_exposure_id.",
      },
    },
  };
}

function collectEvidenceDetails(claims: readonly Record<string, unknown>[]) {
  const details = new Map<string, Record<string, unknown>>();
  for (const claim of claims) {
    const evidence = object(claim.evidence_identity);
    const sourceRef = string(evidence?.source_ref);
    if (!sourceRef || details.has(sourceRef)) continue;
    details.set(sourceRef, {
      source_ref: sourceRef,
      source_excerpt: string(claim.value),
      range_start: evidence?.range_start,
      range_end: evidence?.range_end,
      source_content_hash: evidence?.source_content_hash,
      exact_source: evidence?.exact_source,
    });
  }
  return details;
}

function allClaims(
  exposures: readonly Record<string, unknown>[],
  history: readonly Record<string, unknown>[],
) {
  return [
    ...exposures.flatMap((exposure) => records(exposure.canonical_identity_claims)),
    ...history.flatMap((item) => records(object(item.observation)?.identity_claims)),
  ];
}

function parseCaseSummary(value: unknown): DilutionIdentityReviewCaseSummary {
  const row = object(value);
  const originalDecision = row?.original_decision;
  const reviewStatus = row?.review_status;
  const effectiveDecision = row?.effective_decision;
  if (!row
    || !/^economic-observation:v1:[0-9a-f]{64}$/.test(string(row.observation_key))
    || !/^dilution-review-case:v1:[0-9a-f]{64}$/.test(string(row.review_case_id))
    || (originalDecision !== "UNRESOLVED" && originalDecision !== "CONFLICT")
    || (reviewStatus !== "PENDING" && reviewStatus !== "APPLIED")
    || !isDecision(effectiveDecision)) {
    throw new DilutionIdentityReviewError(
      "REVIEW_CASE_LIST_INVALID",
      "A stored review case summary is invalid.",
      502,
    );
  }
  return {
    observationKey: string(row.observation_key),
    reviewCaseId: string(row.review_case_id),
    issuerCik: string(row.issuer_cik),
    ticker: optionalString(row.ticker),
    accession: string(row.accession),
    form: string(row.form),
    filedDate: string(row.filed_date),
    exposureType: string(row.exposure_type),
    originalDecision,
    originalReasonCode: string(row.original_reason_code),
    reviewStatus,
    effectiveDecision,
    effectiveTargetExposureId: optionalString(row.effective_target_exposure_id),
    appliedAt: optionalString(row.applied_at),
  };
}

function parseApplyResult(value: unknown): DilutionIdentityReviewApplyResult {
  const result = object(value);
  if (!result
    || (result.status !== "applied" && result.status !== "idempotent")
    || !/^dilution-adjudication:v1:[0-9a-f]{64}$/.test(string(result.adjudication_id))
    || !/^economic-observation:v1:[0-9a-f]{64}$/.test(string(result.observation_key))
    || !isDecision(result.effective_decision)
    || !string(result.applied_at)) {
    throw new DilutionIdentityReviewError(
      "REVIEW_APPLY_RESPONSE_INVALID",
      "The applied adjudication response is invalid.",
      502,
    );
  }
  return {
    status: result.status,
    adjudicationId: string(result.adjudication_id),
    observationKey: string(result.observation_key),
    originalDecision: string(result.original_decision),
    effectiveDecision: result.effective_decision,
    targetExposureId: optionalString(result.target_exposure_id),
    appliedAt: string(result.applied_at),
  };
}

function rpcError(message: string | undefined, status: number) {
  const text = message || "Dilution identity review storage is unavailable.";
  const known = [
    "STALE_REVIEW_INPUT",
    "REVIEW_ALREADY_ADJUDICATED",
    "REVIEW_CASE_ID_MISMATCH",
    "REVIEW_CASE_NOT_FOUND",
    "REVIEW_CASE_NOT_REVIEWABLE",
    "REVIEW_DECISION_SCHEMA_INVALID",
    "REVIEW_TARGET_REQUIRED",
    "REVIEW_TARGET_FORBIDDEN",
    "REVIEW_TARGET_NOT_FOUND",
    "REVIEW_TARGET_ISSUER_MISMATCH",
    "REVIEW_TARGET_TYPE_MISMATCH",
    "REVIEW_TARGET_NOT_IN_PACKET",
    "REVIEW_EVIDENCE_REF_NOT_IN_PACKET",
  ].find((code) => text.includes(code));
  const code = known || "REVIEW_STORAGE_UNAVAILABLE";
  const conflict = code === "STALE_REVIEW_INPUT" || code === "REVIEW_ALREADY_ADJUDICATED";
  return new DilutionIdentityReviewError(
    code,
    reviewErrorMessage(code),
    conflict ? 409 : (status >= 400 && status < 600 ? status : 503),
  );
}

export function reviewErrorMessage(code: string) {
  const messages: Record<string, string> = {
    STALE_REVIEW_INPUT: "Registry or observation state changed. Copy a new review packet.",
    REVIEW_ALREADY_ADJUDICATED: "This case already has a different final adjudication.",
    REVIEW_CASE_ID_MISMATCH: "The response belongs to another review case.",
    REVIEW_CASE_NOT_FOUND: "That review case no longer exists.",
    REVIEW_CASE_NOT_REVIEWABLE: "Only persisted UNRESOLVED or CONFLICT observations are reviewable in V1.",
    REVIEW_DECISION_SCHEMA_INVALID: "The GPT decision does not match the required JSON schema.",
    REVIEW_TARGET_REQUIRED: "LINK_EXISTING and AMEND_EXISTING require a target exposure.",
    REVIEW_TARGET_FORBIDDEN: "This decision must not include a target exposure.",
    REVIEW_TARGET_NOT_FOUND: "The target exposure does not exist.",
    REVIEW_TARGET_ISSUER_MISMATCH: "The target exposure belongs to another issuer.",
    REVIEW_TARGET_TYPE_MISMATCH: "The target exposure has another exposure type.",
    REVIEW_TARGET_NOT_IN_PACKET: "The target exposure was not included in the review packet.",
    REVIEW_EVIDENCE_REF_NOT_IN_PACKET: "An evidence reference was not included in the review packet.",
  };
  return messages[code] || "The dilution identity review operation is unavailable.";
}

function failure(code: string, message: string): DilutionIdentityReviewValidation {
  return { ok: false, errors: [{ code, message }] };
}

function requiredPattern(
  value: unknown,
  pattern: RegExp,
  code: string,
  message: string,
) {
  const normalized = string(value);
  if (!pattern.test(normalized)) throw new DilutionIdentityReviewError(code, message);
  return normalized;
}

function isDecision(value: unknown): value is DilutionIdentityDecisionKind {
  return typeof value === "string"
    && DILUTION_IDENTITY_DECISIONS.includes(value as DilutionIdentityDecisionKind);
}

function isConfidence(value: unknown): value is DilutionIdentityReviewConfidence {
  return typeof value === "string"
    && DILUTION_IDENTITY_REVIEW_CONFIDENCE.includes(value as DilutionIdentityReviewConfidence);
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(object).filter(Boolean) as Record<string, unknown>[] : [];
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(string).filter(Boolean) : [];
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

function optionalString(value: unknown) {
  const normalized = string(value).trim();
  return normalized || null;
}
