import { createHash } from "node:crypto";
import type {
  Level2ShareCountHistoryObservation,
  ShareCountHistoryRepository,
  ShareCountHistoryWriteResult,
} from "./shareCountHistory.ts";
import {
  deriveLevel2CanonicalSecurityClassIdentity,
  SHARE_COUNT_SECURITY_CLASS_KIND,
  type CanonicalSecurityClassSupport,
} from "./shareCountSecurityIdentity.ts";

export const LEVEL2_SHARE_COUNT_OBSERVATION_FIELD = "share_count_observation" as const;
export const LEVEL2_SHARE_COUNT_OBSERVATION_TYPE = "source_stated" as const;
export const LEVEL2_SHARE_COUNT_SOURCE_TYPE = "sec_filing_text_level2" as const;
export const LEVEL2_SHARE_COUNT_DECISION_VERSION = "level2-share-count-observation-v1" as const;
export const LEVEL2_SHARE_COUNT_SHARE_BASIS = "shares_outstanding:source_stated" as const;

export const LEVEL2_SHARE_COUNT_PROVIDER_SCHEMA = {
  type: "object",
  required: [
    "observation_type",
    "shares_outstanding",
    "as_of",
    "security_class_kind",
    "security_class_title",
    "source_ref",
    "evidence",
  ],
  properties: {
    observation_type: { type: "string", enum: [LEVEL2_SHARE_COUNT_OBSERVATION_TYPE] },
    shares_outstanding: { type: "string" },
    as_of: { type: "string", format: "date" },
    security_class_kind: { type: "string", enum: [SHARE_COUNT_SECURITY_CLASS_KIND] },
    security_class_title: { type: "string" },
    basis: { type: "string" },
    source_ref: { type: "string" },
    evidence: { type: "string" },
  },
} as const;

export const LEVEL2_SHARE_COUNT_PROMPT_CONTRACT = [
  `OPTIONAL SHARE COUNT SIDECAR: You may add one root ${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD} object only for an SEC filing source that explicitly states an exact shares-outstanding observation. Omit the field entirely when no eligible observation is present.`,
  `The sidecar has exactly observation_type, shares_outstanding, as_of, security_class_kind, security_class_title, source_ref, evidence, and optional basis. observation_type is ${LEVEL2_SHARE_COUNT_OBSERVATION_TYPE}. security_class_kind is exactly ${SHARE_COUNT_SECURITY_CLASS_KIND}. shares_outstanding is an undecorated positive base-10 integer string. as_of is the exact source-stated YYYY-MM-DD measurement date. security_class_title is the sufficiently clear source-stated security class/title.`,
  "The LLM alone judges whether the sentence means shares outstanding and explicitly refers to common stock, then extracts the exact count, exact as-of date, and stated security class. Emit nothing for preferred stock, ADS/ADR or ordinary-share ambiguity, weighted-average, authorized, issued-only, reserved, float, treasury, warrant/option exposure, offering size, approximate, missing-date, or class-ambiguous values. Do not estimate, calculate, split-adjust, infer an ADS ratio, infer a security class, or coerce another share concept.",
  "source_ref must be one supplied SEC source_ref. evidence must be one compact contiguous verbatim excerpt from that exact source document that supports the observation. Do not join passages or paraphrase.",
  "Include basis only when the source explicitly states additional basis metadata for the outstanding count; preserve that stated basis without normalization. Omit basis when it is not explicit. The sidecar is an observation only and never identifies a current, latest, preferred, authoritative, or winning value.",
].join("\n");

export type Level2ShareCountSourceDocument = {
  source_ref: string;
  text: string;
  document_name?: string | null;
  label?: string | null;
};

export type Level2ShareCountProviderCandidate = {
  observation_type: typeof LEVEL2_SHARE_COUNT_OBSERVATION_TYPE;
  shares_outstanding: string;
  as_of: string;
  security_class_kind: typeof SHARE_COUNT_SECURITY_CLASS_KIND;
  security_class_title: string;
  basis?: string;
  source_ref: string;
  evidence: string;
};

export type Level2ShareCountValidatedCandidate = {
  observationType: typeof LEVEL2_SHARE_COUNT_OBSERVATION_TYPE;
  sharesOutstanding: string;
  asOf: string;
  securityClassKind: typeof SHARE_COUNT_SECURITY_CLASS_KIND;
  securityClassTitle: string;
  basis: string | null;
  accessionNumber: string;
  sourceDocument: string;
  sourceDocumentUrl: string;
  sourceRef: string;
  evidence: string;
  sourceContentHash: string;
};

export type Level2ShareCountSidecarExtraction = {
  domainPayload: Record<string, unknown>;
  candidate: Level2ShareCountValidatedCandidate | null;
  errors: string[];
  present: boolean;
};

export function extractLevel2ShareCountSidecar(input: {
  payload: Record<string, unknown>;
  accessionNumber: string | null;
  sourceDocumentUrl: string | null;
  sourceDocuments: readonly Level2ShareCountSourceDocument[];
}): Level2ShareCountSidecarExtraction {
  const domainPayload = { ...input.payload };
  const raw = domainPayload[LEVEL2_SHARE_COUNT_OBSERVATION_FIELD];
  delete domainPayload[LEVEL2_SHARE_COUNT_OBSERVATION_FIELD];
  if (raw === undefined) return { domainPayload, candidate: null, errors: [], present: false };

  const errors: string[] = [];
  const candidate = record(raw);
  if (!candidate) {
    return {
      domainPayload,
      candidate: null,
      errors: [`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD} must be an object when present`],
      present: true,
    };
  }
  exactKeys(candidate, [
    "observation_type",
    "shares_outstanding",
    "as_of",
    "security_class_kind",
    "security_class_title",
    "source_ref",
    "evidence",
  ], ["basis"], LEVEL2_SHARE_COUNT_OBSERVATION_FIELD, errors);
  if (candidate.observation_type !== LEVEL2_SHARE_COUNT_OBSERVATION_TYPE) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD}.observation_type must be source_stated`);
  }
  if (!POSITIVE_INTEGER_PATTERN.test(text(candidate.shares_outstanding))) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD}.shares_outstanding must be an exact positive integer string`);
  }
  if (!validDate(candidate.as_of)) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD}.as_of must be an exact YYYY-MM-DD date`);
  }
  if (candidate.security_class_kind !== SHARE_COUNT_SECURITY_CLASS_KIND) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD}.security_class_kind must be common_stock`);
  }
  if (!boundedText(candidate.security_class_title, 240)) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD}.security_class_title is invalid`);
  }
  if (candidate.basis !== undefined && !boundedText(candidate.basis, 240)) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD}.basis is invalid`);
  }
  if (!ACCESSION_PATTERN.test(text(input.accessionNumber))) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD} requires an exact SEC accession`);
  }
  if (!SEC_URL_PATTERN.test(text(input.sourceDocumentUrl))) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD} requires an exact SEC source URL`);
  }
  const sourceRef = text(candidate.source_ref);
  const source = input.sourceDocuments.find((document) => document.source_ref === sourceRef);
  if (!source) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD}.source_ref must identify a supplied SEC source document`);
  }
  const evidence = textPreserve(candidate.evidence);
  if (!evidence || Array.from(evidence).length > 600) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD}.evidence must be 1 to 600 characters`);
  } else if (source && !source.text.includes(evidence)) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD}.evidence must be a contiguous excerpt from the cited source document`);
  }
  const sourceDocument = source
    ? text(source.document_name) || text(source.label) || source.source_ref
    : "";
  if (!sourceDocument || sourceDocument.length > 500) {
    errors.push(`${LEVEL2_SHARE_COUNT_OBSERVATION_FIELD} source document identity is invalid`);
  }
  if (errors.length || !source) return { domainPayload, candidate: null, errors, present: true };

  return {
    domainPayload,
    candidate: {
      observationType: LEVEL2_SHARE_COUNT_OBSERVATION_TYPE,
      sharesOutstanding: text(candidate.shares_outstanding),
      asOf: text(candidate.as_of),
      securityClassKind: SHARE_COUNT_SECURITY_CLASS_KIND,
      securityClassTitle: textPreserve(candidate.security_class_title),
      basis: candidate.basis === undefined ? null : textPreserve(candidate.basis),
      accessionNumber: text(input.accessionNumber),
      sourceDocument,
      sourceDocumentUrl: text(input.sourceDocumentUrl),
      sourceRef,
      evidence,
      sourceContentHash: sha256(source.text),
    },
    errors: [],
    present: true,
  };
}

export type Level2ShareCountPersistenceContext = {
  issuerCik: string;
  form: string;
  filedDate: string;
  acceptedAt: string | null;
  acceptedAtSource: "sec_raw_payload_acceptance" | "unavailable";
  acceptedAtProvenance: Record<string, unknown>;
  ingestedAt: string;
  rawItemId: string;
  eventId: string;
  parentPrimaryAiRunId: string;
  sourceExecutionId: string;
  analyzerKey: string;
  canonicalSecurityClassSupports: readonly CanonicalSecurityClassSupport[];
};

export async function writeLevel2ShareCountObservation(input: {
  repository: ShareCountHistoryRepository;
  candidate: Level2ShareCountValidatedCandidate;
  context: Level2ShareCountPersistenceContext;
}): Promise<ShareCountHistoryWriteResult> {
  const observation = toLevel2ShareCountHistoryObservation(input.candidate, input.context);
  const inserted = await input.repository.insertObservation(observation);
  return { inserted: inserted ? 1 : 0, deduped: inserted ? 0 : 1 };
}

export function toLevel2ShareCountHistoryObservation(
  candidate: Level2ShareCountValidatedCandidate,
  context: Level2ShareCountPersistenceContext,
): Level2ShareCountHistoryObservation {
  validatePersistenceInput(candidate, context);
  const sourceFactKey = sha256(JSON.stringify({
    accessionNumber: candidate.accessionNumber,
    sourceDocument: candidate.sourceDocument,
    sourceRef: candidate.sourceRef,
    sharesOutstanding: candidate.sharesOutstanding,
    asOf: candidate.asOf,
    securityClassTitle: candidate.securityClassTitle,
    basis: candidate.basis,
    evidence: candidate.evidence,
  }));
  const classHash = sha256(candidate.securityClassTitle);
  const canonicalSecurityClass = deriveLevel2CanonicalSecurityClassIdentity({
    issuerCik: context.issuerCik,
    securityClassKind: candidate.securityClassKind,
    sourceTitle: candidate.securityClassTitle,
    supports: context.canonicalSecurityClassSupports,
  });
  return {
    observationType: LEVEL2_SHARE_COUNT_OBSERVATION_TYPE,
    issuerCik: context.issuerCik,
    sharesOutstanding: candidate.sharesOutstanding,
    asOf: candidate.asOf,
    securityClassBasis: "SOURCE_STATED_SECURITY_CLASS",
    securityClassIdentity: {
      canonicalKey: `SOURCE_STATED_SECURITY_CLASS|${classHash}`,
      identity: { title: candidate.securityClassTitle },
    },
    securityClassMetadata: {
      sourceRef: candidate.sourceRef,
      evidence: candidate.evidence,
      sourceDeclaredClassKind: candidate.securityClassKind,
    },
    canonicalSecurityClassId: canonicalSecurityClass.canonicalSecurityClassId,
    canonicalSecurityClassKind: canonicalSecurityClass.canonicalSecurityClassKind,
    canonicalSecurityClassStatus: canonicalSecurityClass.status,
    canonicalSecurityClassProvenance: canonicalSecurityClass.provenance,
    shareBasisIdentity: LEVEL2_SHARE_COUNT_SHARE_BASIS,
    shareBasisMetadata: {
      measurement: "shares_outstanding",
      unit: { kind: "shares", representation: "positive_integer" },
      sourceStatedBasis: candidate.basis,
    },
    accessionNumber: candidate.accessionNumber,
    form: context.form,
    filingDocument: candidate.sourceDocument,
    filedDate: context.filedDate,
    acceptedAt: context.acceptedAt === null ? null : new Date(context.acceptedAt).toISOString(),
    acceptedAtSource: context.acceptedAtSource,
    acceptedAtProvenance: structuredClone(context.acceptedAtProvenance),
    ingestedAt: new Date(context.ingestedAt).toISOString(),
    sourceConceptNamespaceUri: null,
    sourceConceptLocalName: null,
    sourceFactKey,
    sourceContextRef: candidate.sourceRef,
    sourceArtifactId: context.rawItemId,
    filingLedgerRawSourceId: null,
    sourceFactIdentity: {
      factKey: sourceFactKey,
      sourceRef: candidate.sourceRef,
      accession: candidate.accessionNumber,
      documentName: candidate.sourceDocument,
      observationType: LEVEL2_SHARE_COUNT_OBSERVATION_TYPE,
    },
    sourceContext: {
      sourceRef: candidate.sourceRef,
      asOf: candidate.asOf,
      issuerCik: context.issuerCik,
    },
    sourceDimensions: [],
    sourceProvenance: {
      rawItemId: context.rawItemId,
      eventId: context.eventId,
      parentPrimaryAiRunId: context.parentPrimaryAiRunId,
      sourceExecutionId: context.sourceExecutionId,
      analyzerKey: context.analyzerKey,
      sourceRef: candidate.sourceRef,
    },
    sourceType: LEVEL2_SHARE_COUNT_SOURCE_TYPE,
    authoritativeStatus: null,
    authoritativeDecisionVersion: null,
    authoritativeDecisionReason: null,
    authoritativeDecisionLineage: null,
    sourceDocumentUrl: candidate.sourceDocumentUrl,
    sourceContentHash: candidate.sourceContentHash,
    sourceEvidence: candidate.evidence,
    sourceAnalyzer: context.analyzerKey,
  };
}

function validatePersistenceInput(
  candidate: Level2ShareCountValidatedCandidate,
  context: Level2ShareCountPersistenceContext,
) {
  if (candidate.observationType !== LEVEL2_SHARE_COUNT_OBSERVATION_TYPE
    || !POSITIVE_INTEGER_PATTERN.test(candidate.sharesOutstanding)
    || !validDate(candidate.asOf)
    || candidate.securityClassKind !== SHARE_COUNT_SECURITY_CLASS_KIND
    || !ACCESSION_PATTERN.test(candidate.accessionNumber)
    || !boundedText(candidate.securityClassTitle, 240)
    || (candidate.basis !== null && !boundedText(candidate.basis, 240))
    || !boundedText(candidate.sourceDocument, 500)
    || !SEC_URL_PATTERN.test(candidate.sourceDocumentUrl)
    || !boundedText(candidate.sourceRef, 240)
    || !boundedText(candidate.evidence, 600)
    || !HEX_64_PATTERN.test(candidate.sourceContentHash)) {
    throw new Error("Level 2 share-count candidate is incomplete");
  }
  if (!CIK_PATTERN.test(context.issuerCik) || context.issuerCik === "0000000000"
    || !boundedText(context.form, 40)
    || !validDate(context.filedDate)
    || (context.acceptedAt !== null && !validTimestamp(context.acceptedAt))
    || (context.acceptedAt === null && context.acceptedAtSource !== "unavailable")
    || (context.acceptedAt !== null && context.acceptedAtSource !== "sec_raw_payload_acceptance")
    || !record(context.acceptedAtProvenance)
    || !validTimestamp(context.ingestedAt)
    || !UUID_PATTERN.test(context.rawItemId)
    || !UUID_PATTERN.test(context.eventId)
    || !UUID_PATTERN.test(context.parentPrimaryAiRunId)
    || !UUID_PATTERN.test(context.sourceExecutionId)
    || !boundedText(context.analyzerKey, 120)) {
    throw new Error("Level 2 share-count persistence lineage is incomplete");
  }
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  errors: string[],
) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${path}.${key} is not allowed`);
  for (const key of required) if (!(key in value)) errors.push(`${path}.${key} is required`);
}

function validDate(value: unknown) {
  const candidate = text(value);
  if (!DATE_PATTERN.test(candidate)) return false;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === candidate;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && Array.from(value).length <= max;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function textPreserve(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const ACCESSION_PATTERN = /^[0-9]{10}-[0-9]{2}-[0-9]{6}$/;
const CIK_PATTERN = /^[0-9]{10}$/;
const DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/;
const SEC_URL_PATTERN = /^https:\/\/([a-z0-9-]+\.)*sec\.gov\//;
const TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
