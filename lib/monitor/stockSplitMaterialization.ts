import { createHash } from "node:crypto";
import type {
  CorporateActionAnalyzerInput,
  CorporateActionCanonicalFacts,
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
};

export function buildPrevalidationStockSplitMaterializationDiagnostic(
  value: unknown,
  input: CorporateActionAnalyzerInput,
  failureReason: string,
): StockSplitMaterializationDiagnostic | null {
  const root = record(value);
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

  const sourceRef = text(root.source_ref);
  const evidence = text(root.evidence);
  const document = input.source_documents.find((item) => item.source_ref === sourceRef);
  const sourceSecurityTitle = text(affected.source_security_title);
  if (!document || !sourceRef || !boundedExactEvidence(evidence, document.text)
    || !sourceSecurityTitle || !evidence.toLowerCase().includes(sourceSecurityTitle.toLowerCase())
    || !evidenceSupportsSplitTuple(evidence, {
      actionKind,
      effectiveDate: String(date.value),
      oldShareUnits: String(ratio.old_shares),
      newShareUnits: String(ratio.new_shares),
    })) return null;

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
    sourceRef,
    evidence,
  });
}

export function buildPersistedStockSplitMaterializationDiagnostic(
  facts: CorporateActionCanonicalFacts,
  failureReason: string,
): StockSplitMaterializationDiagnostic | null {
  const issuer = facts.applicability?.issuer;
  const affected = facts.applicability?.affected_security;
  const ratio = facts.ratio.exact_source_components;
  if (issuer?.availability !== "available" || affected?.availability !== "available"
    || facts.effective_date.availability !== "available"
    || ratio?.availability !== "available"
    || facts.evidence.availability !== "available"
    || !validCik(issuer.issuer_cik) || !validAccession(issuer.accession_number)
    || !validTimestamp(issuer.accepted_at)
    || !canonicalClassId(affected.canonical_security_class_id, issuer.issuer_cik)
    || !validDate(facts.effective_date.value)
    || !positiveDecimal(ratio.old_share_units) || !positiveDecimal(ratio.new_share_units)
    || !boundedText(facts.source_ref, 240)
    || !boundedText(facts.evidence.value, 800)) return null;
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
    sourceRef: facts.source_ref,
    evidence: facts.evidence.value,
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
    || !boundedText(row.sourceRef, 240) || !boundedText(row.evidence, 800)) return null;
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
  ])).digest("hex")}`;
}

function boundedExactEvidence(value: string, source: string) {
  return boundedText(value, 800) && source.includes(value);
}

function evidenceSupportsSplitTuple(
  evidence: string,
  input: {
    actionKind: CorporateActionEventKind;
    effectiveDate: string;
    oldShareUnits: string;
    newShareUnits: string;
  },
) {
  const normalized = evidence.replace(/[‐‑‒–—]/g, "-");
  const actionPattern = input.actionKind === "reverse_split"
    ? /\breverse(?:\s+stock)?\s+split\b/i
    : /\b(?:forward\s+)?stock\s+split\b/i;
  const ratioPattern = new RegExp(
    `\\b${escapeRegExp(input.newShareUnits)}\\s*-?\\s*for\\s*-?\\s*${escapeRegExp(input.oldShareUnits)}\\b`,
    "i",
  );
  return actionPattern.test(normalized)
    && ratioPattern.test(normalized)
    && evidenceContainsDate(normalized, input.effectiveDate);
}

function evidenceContainsDate(evidence: string, isoDate: string) {
  const [year, monthValue, dayValue] = isoDate.split("-");
  const monthIndex = Number(monthValue) - 1;
  const day = String(Number(dayValue));
  const months = [
    ["January", "Jan"], ["February", "Feb"], ["March", "Mar"], ["April", "Apr"],
    ["May", "May"], ["June", "Jun"], ["July", "Jul"], ["August", "Aug"],
    ["September", "Sep"], ["October", "Oct"], ["November", "Nov"], ["December", "Dec"],
  ] as const;
  const names = months[monthIndex];
  if (!year || !names) return false;
  const monthName = `(?:${names.map(escapeRegExp).join("|")})\\.?`;
  const namedDate = new RegExp(
    `(?:\\b${monthName}\\s+${day}(?:st|nd|rd|th)?(?:,)?\\s+${year}\\b|`
      + `\\b${day}(?:st|nd|rd|th)?\\s+${monthName}(?:,)?\\s+${year}\\b)`,
    "i",
  );
  const numericDate = new RegExp(
    `\\b(?:${escapeRegExp(isoDate)}|${Number(monthValue)}[/-]${Number(dayValue)}[/-]${year})\\b`,
  );
  return namedDate.test(evidence) || numericDate.test(evidence);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
