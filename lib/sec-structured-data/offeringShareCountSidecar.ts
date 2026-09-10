import { createHash } from "node:crypto";
import type {
  OfferingMonitorJobIdentity,
  OfferingMonitorParentAuthority,
} from "../offeringMonitorJobFoundation.ts";
import { decodeSecHtmlEntities } from "../sources/sec/htmlEntities.ts";
import {
  LEVEL2_SHARE_COUNT_OBSERVATION_TYPE,
  type Level2ShareCountValidatedCandidate,
} from "./level2ShareCountObservation.ts";

export const OFFERING_SHARE_COUNT_SIDECAR_ANALYZER_KEY =
  "offering_os_deterministic_v1" as const;
export const OFFERING_SHARE_COUNT_SIDECAR_VERSION =
  "offering-share-count-sidecar-v1" as const;

export type OfferingShareCountIneligibleReason =
  | "FORM_NOT_SUPPORTED"
  | "RAW_ITEM_IDENTITY_INCOMPLETE"
  | "PRIMARY_DOCUMENT_INCOMPLETE"
  | "PRIMARY_DOCUMENT_IDENTITY_INCOMPLETE"
  | "SECURITY_CLASS_AMBIGUOUS"
  | "CURRENT_OS_NOT_EXPLICIT"
  | "AS_OF_DATE_INVALID"
  | "CONFLICTING_CURRENT_OS_EVIDENCE";

export type OfferingShareCountExtraction =
  | {
      status: "eligible";
      version: typeof OFFERING_SHARE_COUNT_SIDECAR_VERSION;
      issuerCik: string;
      form: string;
      filedDate: string;
      candidate: Level2ShareCountValidatedCandidate;
      rejectedCandidateCount: number;
    }
  | {
      status: "ineligible";
      version: typeof OFFERING_SHARE_COUNT_SIDECAR_VERSION;
      reason: OfferingShareCountIneligibleReason;
      evidence: string[];
    };

export type OfferingShareCountSidecarDependencies = {
  readParentAuthority(identity: OfferingMonitorJobIdentity): Promise<OfferingMonitorParentAuthority>;
  loadRawItem(identity: OfferingMonitorJobIdentity): Promise<Record<string, unknown>>;
  persist(input: {
    identity: OfferingMonitorJobIdentity;
    rawItem: Record<string, unknown>;
    candidate: Level2ShareCountValidatedCandidate;
  }): Promise<{ inserted: number; deduped: number }>;
};

export type OfferingShareCountSidecarResult =
  | { status: "stale"; latestPrimaryAiRunId: string | null; providerCalled: false }
  | { status: "ineligible"; reason: OfferingShareCountIneligibleReason; providerCalled: false }
  | {
      status: "completed";
      sharesOutstanding: string;
      asOf: string;
      inserted: number;
      deduped: number;
      providerCalled: false;
    };

export async function processOfferingShareCountSidecar(
  identity: OfferingMonitorJobIdentity,
  dependencies: OfferingShareCountSidecarDependencies,
): Promise<OfferingShareCountSidecarResult> {
  const before = await dependencies.readParentAuthority(identity);
  if (before.status !== "current") {
    return { status: "stale", latestPrimaryAiRunId: before.latestPrimaryAiRunId, providerCalled: false };
  }

  const rawItem = await dependencies.loadRawItem(identity);
  const extraction = extractOfferingShareCountFromSecRawItem(rawItem);
  if (extraction.status === "ineligible") {
    return { status: "ineligible", reason: extraction.reason, providerCalled: false };
  }
  if (extraction.candidate.accessionNumber !== identity.sourceIdentity
    || extraction.form !== normalizeForm(identity.formType)) {
    return { status: "ineligible", reason: "RAW_ITEM_IDENTITY_INCOMPLETE", providerCalled: false };
  }

  const after = await dependencies.readParentAuthority(identity);
  if (after.status !== "current") {
    return { status: "stale", latestPrimaryAiRunId: after.latestPrimaryAiRunId, providerCalled: false };
  }
  const persisted = await dependencies.persist({
    identity,
    rawItem,
    candidate: extraction.candidate,
  });
  return {
    status: "completed",
    sharesOutstanding: extraction.candidate.sharesOutstanding,
    asOf: extraction.candidate.asOf,
    inserted: persisted.inserted,
    deduped: persisted.deduped,
    providerCalled: false,
  };
}

export function extractOfferingShareCountFromSecRawItem(
  rawItem: Record<string, unknown>,
): OfferingShareCountExtraction {
  const rawPayload = record(rawItem.raw_payload);
  const metadata = record(rawItem.metadata);
  const form = normalizeForm(text(rawPayload?.form_type) || text(metadata?.form_type));
  if (!supportedForm(form)) return ineligible("FORM_NOT_SUPPORTED");

  const rawItemId = text(rawItem.id);
  const accession = text(rawPayload?.accession_number);
  const outerAccession = text(rawItem.source_unique_id);
  const issuerCik = exactRawIssuerCik(rawPayload);
  const metadataIssuerCik = canonicalCik(metadata?.cik);
  const filedDate = normalizeDate(rawPayload?.filing_date ?? rawPayload?.filed_at ?? metadata?.filing_date);
  if (!UUID_PATTERN.test(rawItemId)
    || !ACCESSION_PATTERN.test(accession)
    || outerAccession !== accession
    || !CIK_PATTERN.test(issuerCik)
    || issuerCik === "0000000000"
    || !validDate(filedDate)) {
    return ineligible("RAW_ITEM_IDENTITY_INCOMPLETE");
  }

  const primaryHtml = rawText(rawPayload?.primary_document_html);
  const primaryCharCount = integer(rawPayload?.primary_document_html_char_count);
  if (!primaryHtml
    || rawPayload?.primary_document_html_truncated !== false
    || primaryCharCount === null
    || primaryCharCount !== primaryHtml.length) {
    return ineligible("PRIMARY_DOCUMENT_INCOMPLETE");
  }

  const sourceDocumentUrl = text(rawPayload?.primary_document_url);
  const archiveIssuerCik = secArchiveIssuerCik(sourceDocumentUrl);
  const sourceDocument = secDocumentName(sourceDocumentUrl);
  const sourceRef = `offering-os:${accession}:${sourceDocument}`;
  const primaryDocuments = records(rawPayload?.documents).filter((document) => document.isPrimary === true);
  const inventoryDocument = primaryDocuments.length === 1 ? primaryDocuments[0]! : null;
  if (!metadataIssuerCik
    || !archiveIssuerCik
    || issuerCik !== metadataIssuerCik
    || issuerCik !== archiveIssuerCik) {
    return ineligible("RAW_ITEM_IDENTITY_INCOMPLETE");
  }
  if (!sourceDocument
    || sourceDocument.length > 500
    || sourceRef.length > 240
    || !SEC_ARCHIVE_URL_PATTERN.test(sourceDocumentUrl)
    || !sourceDocumentUrl.includes(`/${accession.replace(/-/g, "")}/`)
    || !inventoryDocument
    || text(inventoryDocument.url) !== sourceDocumentUrl
    || text(inventoryDocument.document) !== sourceDocument
    || inventoryDocument.rawHtmlPreserved !== true
    || inventoryDocument.rawHtmlTruncated !== false
    || integer(inventoryDocument.rawHtmlCharCount) !== primaryHtml.length) {
    return ineligible("PRIMARY_DOCUMENT_IDENTITY_INCOMPLETE");
  }

  const documentText = normalizePrimaryDocument(primaryHtml);
  const ambiguity = securityClassAmbiguity(documentText);
  if (ambiguity.length) return ineligible("SECURITY_CLASS_AMBIGUOUS", ambiguity);

  const extracted = extractCurrentCandidates(documentText);
  if (!extracted.current.length) {
    return ineligible("CURRENT_OS_NOT_EXPLICIT", extracted.rejected);
  }
  const eligibleByDate = extracted.current.filter((candidate) => candidate.asOf <= filedDate);
  if (!eligibleByDate.length) {
    return ineligible("AS_OF_DATE_INVALID", extracted.current.map((candidate) => candidate.evidence));
  }
  const latestAsOf = eligibleByDate.reduce(
    (latest, candidate) => candidate.asOf > latest ? candidate.asOf : latest,
    eligibleByDate[0]!.asOf,
  );
  const latest = dedupeCandidates(eligibleByDate.filter((candidate) => candidate.asOf === latestAsOf));
  if (new Set(latest.map((candidate) => candidate.sharesOutstanding)).size !== 1) {
    return ineligible(
      "CONFLICTING_CURRENT_OS_EVIDENCE",
      latest.map((candidate) => candidate.evidence),
    );
  }

  const selected = latest[0]!;
  return {
    status: "eligible",
    version: OFFERING_SHARE_COUNT_SIDECAR_VERSION,
    issuerCik,
    form,
    filedDate,
    rejectedCandidateCount: extracted.rejected.length,
    candidate: {
      observationType: LEVEL2_SHARE_COUNT_OBSERVATION_TYPE,
      sharesOutstanding: selected.sharesOutstanding,
      asOf: selected.asOf,
      securityClassKind: "common_stock",
      securityClassTitle: selected.securityClassTitle,
      basis: null,
      accessionNumber: accession,
      sourceDocument,
      sourceDocumentUrl,
      sourceRef,
      evidence: selected.evidence,
      sourceContentHash: sha256(primaryHtml),
    },
  };
}

type ExtractedCandidate = {
  sharesOutstanding: string;
  asOf: string;
  securityClassTitle: string;
  evidence: string;
};

function extractCurrentCandidates(value: string) {
  const current: ExtractedCandidate[] = [];
  const rejected: string[] = [];
  const patterns: Array<{ pattern: RegExp; shares: number; date: number; securityClass: number }> = [
    {
      pattern: new RegExp(`(?:\\bbased (?:on|upon) (?:the )?)?\\b([0-9][0-9,]*)\\s+(?:shares?\\s+of\\s+(?:our\\s+|the\\s+)?|)(common stock|common shares)\\s+(?:were\\s+|are\\s+|was\\s+|is\\s+)?(?:issued and )?outstanding\\s+as of\\s+(${CALENDAR_DATE_PATTERN})`, "gi"),
      shares: 1,
      securityClass: 2,
      date: 3,
    },
    {
      pattern: new RegExp(`\\bAs of\\s+(${CALENDAR_DATE_PATTERN}),?\\s+(?:we\\s+(?:had|have)|there\\s+(?:were|are))\\s+([0-9][0-9,]*)\\s+shares?\\s+of\\s+(?:(?:[A-Z][A-Za-z0-9&'.-]*\\s+){0,4})?(common stock|common shares)\\s+(?:were\\s+|are\\s+)?(?:issued and )?outstanding`, "g"),
      shares: 2,
      securityClass: 3,
      date: 1,
    },
    {
      pattern: new RegExp(`\\b(common stock|common shares)\\s+outstanding\\s+as of\\s+(${CALENDAR_DATE_PATTERN})\\s*[:—-]\\s*([0-9][0-9,]*)\\b`, "gi"),
      shares: 3,
      securityClass: 1,
      date: 2,
    },
  ];

  for (const { pattern, shares, date, securityClass } of patterns) {
    for (const match of value.matchAll(pattern)) {
      const evidence = compactEvidence(match[0]);
      const localPrefix = value.slice(Math.max(0, match.index! - 48), match.index!);
      const localSuffix = value.slice(match.index! + match[0].length, match.index! + match[0].length + 64);
      const sharesOutstanding = normalizedPositiveInteger(match[shares]);
      const asOf = parseCalendarDate(match[date]);
      const title = compactEvidence(match[securityClass]);
      if (!sharesOutstanding || !asOf || !validSecurityClassTitle(title)
        || hasImmediateDisallowedQualifier(localPrefix)
        || hasImmediateDisallowedSuffix(localSuffix)
        || DISALLOWED_CANDIDATE_PATTERN.test(evidence)) {
        if (evidence) rejected.push(evidence);
        continue;
      }
      current.push({ sharesOutstanding, asOf, securityClassTitle: title, evidence });
    }
  }
  return { current: dedupeCandidates(current), rejected: [...new Set(rejected)].sort() };
}

function securityClassAmbiguity(value: string) {
  const patterns = [
    /[^.]{0,100}\b(?:ADSs?|American Depositary (?:Shares?|Receipts?)|ADRs?)\b[^.]{0,140}[.]/gi,
    /[^.]{0,100}\bordinary shares?\b[^.]{0,140}[.]/gi,
    /[^.]{0,100}\b(?:non[- ]?voting|voting)\s+common (?:stock|shares)\b[^.]{0,140}[.]/gi,
    /[^.]{0,100}\b(?:two|multiple)\s+classes\s+of\s+(?:common stock|common shares)\b[^.]{0,140}[.]/gi,
    /[^.]{0,100}\bClass\s+[A-Z0-9]+\s+(?:common stock|common shares|ordinary shares)\b[^.]{0,140}[.]/g,
  ];
  return [...new Set(patterns.flatMap((pattern) =>
    [...value.matchAll(pattern)].slice(0, 3).map((match) => compactEvidence(match[0])),
  ).filter(Boolean))].sort();
}

function normalizePrimaryDocument(value: string) {
  return decodeSecHtmlEntities(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<ix:exclude\b[^>]*>[\s\S]*?<\/ix:exclude>/gi, " ")
    .replace(/<\/(?:p|div|tr|table|li|br|hr|h[1-6])>/gi, ". ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/(?:\.\s*){2,}/g, ". ")
    .trim();
}

function dedupeCandidates(rows: ExtractedCandidate[]) {
  const unique = new Map<string, ExtractedCandidate>();
  for (const row of rows) unique.set(
    `${row.asOf}|${row.sharesOutstanding}|${row.securityClassTitle.toLowerCase()}|${row.evidence}`,
    row,
  );
  return [...unique.values()].sort((left, right) =>
    `${left.asOf}|${left.sharesOutstanding}|${left.evidence}`.localeCompare(
      `${right.asOf}|${right.sharesOutstanding}|${right.evidence}`,
    ));
}

function supportedForm(value: string) {
  return /^(?:S-1(?:\/A)?|S-3(?:\/A|ASR|MEF)?|F-3(?:\/A|ASR|MEF)?|424B(?:1|2|3|4|5|7|8)?)$/.test(value);
}

function hasImmediateDisallowedQualifier(value: string) {
  return /\b(?:approximately|approximate|about|estimated|estimate|weighted average|authorized|public float|non-affiliate|issuable|reserved|offered|registered|will be|would be|expected)\b[^,;:.]{0,24}$/i.test(value)
    || /\b(?:pro forma|as adjusted|assuming)\b[^.;:]{0,32}$/i.test(value);
}

function hasImmediateDisallowedSuffix(value: string) {
  return /^\s*[,;:]?\s*(?:on an?\s+)?(?:pro forma|as adjusted|assuming|estimated|approximate)\b/i.test(value);
}

function validSecurityClassTitle(value: string) {
  return /^(?:common stock|common shares)$/i.test(value);
}

function normalizedPositiveInteger(value: unknown) {
  const compact = text(value).replace(/,/g, "");
  return POSITIVE_INTEGER_PATTERN.test(compact) ? compact : null;
}

function parseCalendarDate(value: unknown) {
  const match = text(value).match(/^([A-Za-z]+)\s+([0-9]{1,2}),?\s+([0-9]{4})$/);
  if (!match) return null;
  const month = MONTHS[match[1]!.toLowerCase()];
  if (!month) return null;
  const day = Number(match[2]);
  const year = Number(match[3]);
  const result = `${String(year).padStart(4, "0")}-${month}-${String(day).padStart(2, "0")}`;
  return validDate(result) ? result : null;
}

function exactRawIssuerCik(rawPayload: Record<string, unknown> | null) {
  const supplied = [rawPayload?.cik_padded, rawPayload?.cik]
    .filter((value) => value !== null && value !== undefined && text(value) !== "");
  if (!supplied.length) return "";
  const canonical = supplied.map(canonicalCik);
  if (canonical.some((value) => !value) || new Set(canonical).size !== 1) return "";
  return canonical[0]!;
}

function canonicalCik(value: unknown) {
  const digits = text(value);
  if (!/^\d{1,10}$/.test(digits)) return "";
  const canonical = digits.replace(/^0+/, "").padStart(10, "0");
  return canonical === "0000000000" ? "" : canonical;
}

function secArchiveIssuerCik(value: string) {
  if (!SEC_ARCHIVE_URL_PATTERN.test(value)) return "";
  try {
    const match = new URL(value).pathname.match(/^\/Archives\/edgar\/data\/(\d{1,10})\//i);
    return canonicalCik(match?.[1]);
  } catch {
    return "";
  }
}

function normalizeDate(value: unknown) {
  return text(value).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || "";
}

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function secDocumentName(value: string) {
  if (!SEC_ARCHIVE_URL_PATTERN.test(value)) return "";
  try {
    return decodeURIComponent(new URL(value).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

function ineligible(
  reason: OfferingShareCountIneligibleReason,
  evidence: string[] = [],
): OfferingShareCountExtraction {
  return {
    status: "ineligible",
    version: OFFERING_SHARE_COUNT_SIDECAR_VERSION,
    reason,
    evidence: [...new Set(evidence.filter(Boolean))].sort(),
  };
}

function compactEvidence(value: unknown) {
  return text(value).replace(/\s+/g, " ").trim().slice(0, 600);
}

function normalizeForm(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function rawText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record).filter((row): row is Record<string, unknown> => row !== null) : [];
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const CALENDAR_DATE_PATTERN =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+[0-9]{1,2},?\\s+[0-9]{4}";
const DISALLOWED_CANDIDATE_PATTERN =
  /\b(?:approximately|approximate|estimated|estimate|weighted average|authorized|public float|non-affiliate|pro forma|as adjusted|assuming|issuable|reserved|offered|registered)\b/i;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const CIK_PATTERN = /^\d{10}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEC_ARCHIVE_URL_PATTERN = /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//i;
const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};
