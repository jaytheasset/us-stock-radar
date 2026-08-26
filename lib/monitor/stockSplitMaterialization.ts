import { createHash } from "node:crypto";
import {
  materializeCorporateActionEvidence,
  validateCorporateActionAnalyzerTransportResult,
  validateCorporateActionEvidenceIdentity,
} from "./corporateActionCanonicalFacts.ts";
import type {
  CorporateActionAnalyzerInput,
  CorporateActionCanonicalFacts,
  CorporateActionEvidenceIdentity,
  CorporateActionEventKind,
} from "./corporateActionCanonicalFacts.ts";

export const STOCK_SPLIT_MATERIALIZATION_DIAGNOSTIC_VERSION =
  "stock_split_materialization_diagnostic_v1" as const;
export const STOCK_SPLIT_MATERIALIZATION_ERROR_PREFIX =
  "STOCK_SPLIT_MATERIALIZATION_DIAGNOSTIC:" as const;

export type StockSplitMaterializationFailureStage =
  | "ANALYZER_VALIDATION"
  | "PERSISTENCE";

export type StockSplitMaterializationDiagnostic = {
  version: typeof STOCK_SPLIT_MATERIALIZATION_DIAGNOSTIC_VERSION;
  status: "SPLIT_MATERIALIZATION_FAILED";
  diagnosticId: string;
  failureStage: StockSplitMaterializationFailureStage;
  failureReason: string;
  actionKind: CorporateActionEventKind;
  issuerCik: string;
  canonicalSecurityClassId: string;
  accessionNumber: string;
  acceptedAt: string;
  effectiveDate: string;
  oldShareUnits: string;
  newShareUnits: string;
  sourceRef: string;
  evidence: string;
  evidenceIdentity?: CorporateActionEvidenceIdentity;
};

export function buildPrevalidationStockSplitMaterializationDiagnostic(
  value: unknown,
  input: CorporateActionAnalyzerInput,
  failureReason: string,
): StockSplitMaterializationDiagnostic | null {
  const root = record(value);
  if (validateCorporateActionAnalyzerTransportResult(value).length > 0) return null;
  const issuer = input.issuer_context;
  const date = record(root?.effective_date);
  const ratio = record(root?.ratio);
  const affected = record(root?.affected_security);
  const actionKind = root?.event_kind;
  if (root?.applicable !== true
    || (actionKind !== "forward_split" && actionKind !== "reverse_split")
    || issuer?.availability !== "available"
    || !validCik(issuer.issuer_cik)
    || !validAccession(issuer.accession_number)
    || !validTimestamp(issuer.accepted_at)
    || date?.availability !== "available" || !validDate(date.value)
    || ratio?.availability !== "available"
    || !positiveDecimal(ratio.old_shares) || !positiveDecimal(ratio.new_shares)
    || (actionKind === "forward_split"
      && !(Number(ratio.new_shares) > Number(ratio.old_shares)))
    || affected?.availability !== "available"
    || affected.security_type !== "common_stock"
    || typeof affected.canonical_security_class_id !== "string") return null;

  const candidate = input.security_class_candidates?.find((item) =>
    item.canonical_security_class_id === affected.canonical_security_class_id
    && item.security_type === "common_stock");
  if (!candidate || !canonicalClassId(candidate.canonical_security_class_id, issuer.issuer_cik)) return null;

  const sourceSecurityTitle = text(affected.source_security_title);
  const affectedDocument = input.source_documents.find((item) => item.source_ref === affected.source_ref);
  if (!sourceSecurityTitle || !affectedDocument?.text.includes(sourceSecurityTitle)) return null;
  const dateEvidence = exactEvidence(date, input);
  const ratioEvidence = exactEvidence(ratio, input);
  const affectedEvidence = exactEvidence(affected, input);
  const timing = record(root.effective_timing);
  const activationEvidence = timing?.availability === "available"
    ? exactEvidence(timing, input) : dateEvidence;
  if (!dateEvidence?.identity || !ratioEvidence?.identity || !affectedEvidence?.identity
    || !activationEvidence?.identity) return null;
  const rootEvidence = materializeCorporateActionEvidence(
    typeof root.evidence === "string" ? root.evidence : null,
    text(root.source_ref),
    input.source_documents,
  );
  const selected = rootEvidence.identity ? rootEvidence : ratioEvidence;
  if (selected.evidence.availability !== "available") return null;

  return diagnostic({
    failureStage: "ANALYZER_VALIDATION",
    failureReason,
    actionKind,
    issuerCik: issuer.issuer_cik,
    canonicalSecurityClassId: candidate.canonical_security_class_id,
    accessionNumber: issuer.accession_number,
    acceptedAt: issuer.accepted_at,
    effectiveDate: String(date.value),
    oldShareUnits: String(ratio.old_shares),
    newShareUnits: String(ratio.new_shares),
    sourceRef: selected.identity!.source_ref,
    evidence: selected.evidence.value,
    evidenceIdentity: selected.identity!,
  });
}

export function buildPersistedStockSplitMaterializationDiagnostic(
  facts: CorporateActionCanonicalFacts,
  failureReason: string,
): StockSplitMaterializationDiagnostic | null {
  const issuer = facts.applicability?.issuer;
  const affected = facts.applicability?.affected_security;
  const ratio = facts.ratio.exact_source_components;
  const evidence = facts.evidence.availability === "available"
    ? facts.evidence
    : ratio?.availability === "available" && ratio.evidence?.availability === "available"
      ? ratio.evidence : null;
  const evidenceIdentity = facts.evidence_identity
    ?? (ratio?.availability === "available" ? ratio.evidence_identity : undefined);
  if (issuer?.availability !== "available" || affected?.availability !== "available"
    || facts.effective_date.availability !== "available"
    || ratio?.availability !== "available"
    || !evidence
    || !validCik(issuer.issuer_cik) || !validAccession(issuer.accession_number)
    || !validTimestamp(issuer.accepted_at)
    || !canonicalClassId(affected.canonical_security_class_id, issuer.issuer_cik)
    || !validDate(facts.effective_date.value)
    || !positiveDecimal(ratio.old_share_units) || !positiveDecimal(ratio.new_share_units)
    || !boundedText(evidence.value, 800)
    || (facts.calculation_activation && !completeFieldEvidenceIdentities(facts))) return null;
  return diagnostic({
    failureStage: "PERSISTENCE",
    failureReason,
    actionKind: facts.event_kind,
    issuerCik: issuer.issuer_cik,
    canonicalSecurityClassId: affected.canonical_security_class_id,
    accessionNumber: issuer.accession_number,
    acceptedAt: issuer.accepted_at,
    effectiveDate: facts.effective_date.value,
    oldShareUnits: ratio.old_share_units,
    newShareUnits: ratio.new_share_units,
    sourceRef: evidenceIdentity?.source_ref ?? facts.source_ref,
    evidence: evidence.value,
    ...(evidenceIdentity ? { evidenceIdentity } : {}),
  });
}

export function stockSplitMaterializationError(
  diagnosticValue: StockSplitMaterializationDiagnostic,
) {
  const parsed = readStockSplitMaterializationDiagnostic(diagnosticValue);
  if (!parsed) throw new Error("Stock split materialization diagnostic is invalid");
  return new Error(`${STOCK_SPLIT_MATERIALIZATION_ERROR_PREFIX}${JSON.stringify(parsed)}`);
}

export function readStockSplitMaterializationDiagnostic(
  value: unknown,
): StockSplitMaterializationDiagnostic | null {
  let candidate: unknown = value;
  if (typeof value === "string") {
    const offset = value.indexOf(STOCK_SPLIT_MATERIALIZATION_ERROR_PREFIX);
    if (offset < 0) return null;
    try {
      candidate = JSON.parse(value.slice(offset + STOCK_SPLIT_MATERIALIZATION_ERROR_PREFIX.length));
    } catch {
      return null;
    }
  }
  const row = record(candidate);
  if (!row || row.version !== STOCK_SPLIT_MATERIALIZATION_DIAGNOSTIC_VERSION
    || row.status !== "SPLIT_MATERIALIZATION_FAILED"
    || (row.failureStage !== "ANALYZER_VALIDATION" && row.failureStage !== "PERSISTENCE")
    || (row.actionKind !== "forward_split" && row.actionKind !== "reverse_split")
    || !/^ssmd:v1:[0-9a-f]{64}$/.test(text(row.diagnosticId))
    || !boundedText(row.failureReason, 500)
    || !validCik(row.issuerCik) || !validAccession(row.accessionNumber)
    || !validTimestamp(row.acceptedAt)
    || !canonicalClassId(row.canonicalSecurityClassId, String(row.issuerCik))
    || !validDate(row.effectiveDate)
    || !positiveDecimal(row.oldShareUnits) || !positiveDecimal(row.newShareUnits)
    || !boundedText(row.sourceRef, 240) || !boundedText(row.evidence, 800)
    || (row.evidenceIdentity !== undefined
      && validateCorporateActionEvidenceIdentity(row.evidenceIdentity).length > 0)) return null;
  const expectedId = diagnosticId({
    actionKind: row.actionKind as CorporateActionEventKind,
    issuerCik: String(row.issuerCik),
    canonicalSecurityClassId: String(row.canonicalSecurityClassId),
    accessionNumber: String(row.accessionNumber),
    effectiveDate: String(row.effectiveDate),
    oldShareUnits: String(row.oldShareUnits),
    newShareUnits: String(row.newShareUnits),
    sourceRef: String(row.sourceRef),
    evidence: String(row.evidence),
    ...(row.evidenceIdentity
      ? { evidenceIdentity: row.evidenceIdentity as CorporateActionEvidenceIdentity }
      : {}),
  });
  return row.diagnosticId === expectedId
    ? row as StockSplitMaterializationDiagnostic
    : null;
}

function diagnostic(input: Omit<
  StockSplitMaterializationDiagnostic,
  "version" | "status" | "diagnosticId"
>): StockSplitMaterializationDiagnostic {
  const failureReason = input.failureReason.trim().slice(0, 500) || "unknown";
  const identity = {
    actionKind: input.actionKind,
    issuerCik: input.issuerCik,
    canonicalSecurityClassId: input.canonicalSecurityClassId,
    accessionNumber: input.accessionNumber,
    effectiveDate: input.effectiveDate,
    oldShareUnits: input.oldShareUnits,
    newShareUnits: input.newShareUnits,
    sourceRef: input.sourceRef,
    evidence: input.evidence,
    ...(input.evidenceIdentity ? { evidenceIdentity: input.evidenceIdentity } : {}),
  };
  return {
    version: STOCK_SPLIT_MATERIALIZATION_DIAGNOSTIC_VERSION,
    status: "SPLIT_MATERIALIZATION_FAILED",
    diagnosticId: diagnosticId(identity),
    ...input,
    failureReason,
  };
}

function diagnosticId(input: {
  actionKind: CorporateActionEventKind;
  issuerCik: string;
  canonicalSecurityClassId: string;
  accessionNumber: string;
  effectiveDate: string;
  oldShareUnits: string;
  newShareUnits: string;
  sourceRef: string;
  evidence: string;
  evidenceIdentity?: CorporateActionEvidenceIdentity;
}) {
  return `ssmd:v1:${createHash("sha256").update(JSON.stringify([
    input.actionKind,
    input.issuerCik,
    input.canonicalSecurityClassId,
    input.accessionNumber,
    input.effectiveDate,
    input.oldShareUnits,
    input.newShareUnits,
    input.sourceRef,
    input.evidence,
    input.evidenceIdentity ?? null,
  ])).digest("hex")}`;
}

function exactEvidence(value: Record<string, unknown>, input: CorporateActionAnalyzerInput) {
  return materializeCorporateActionEvidence(
    typeof value.evidence === "string" ? value.evidence : null,
    text(value.source_ref),
    input.source_documents,
  );
}

function completeFieldEvidenceIdentities(facts: CorporateActionCanonicalFacts) {
  const date = facts.effective_date;
  const ratio = facts.ratio.exact_source_components;
  const affected = facts.applicability?.affected_security;
  const activation = facts.calculation_activation;
  if (date.availability !== "available" || ratio?.availability !== "available"
    || affected?.availability !== "available" || !activation
    || activation.state === "INDETERMINATE") return false;
  return [
    date.evidence_identity,
    ratio.evidence_identity,
    affected.evidence_identity,
    activation.evidence_identity,
  ].every((identity) => validateCorporateActionEvidenceIdentity(identity).length === 0);
}

function boundedText(value: unknown, max: number) {
  return typeof value === "string" && value.trim().length > 0
    && Array.from(value).length <= max;
}

function positiveDecimal(value: unknown) {
  return typeof value === "string"
    && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)
    && Number.isFinite(Number(value)) && Number(value) > 0;
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validCik(value: unknown) {
  return typeof value === "string" && /^\d{10}$/.test(value) && value !== "0000000000";
}

function validAccession(value: unknown) {
  return typeof value === "string" && /^\d{10}-\d{2}-\d{6}$/.test(value);
}

function canonicalClassId(value: unknown, cik: string) {
  return typeof value === "string" && new RegExp(
    `^sc:v1:${cik}:common_stock:(?:single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127}|custom:[0-9a-f]{64}:[A-Za-z][A-Za-z0-9_.-]{1,127})$`,
  ).test(value);
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
