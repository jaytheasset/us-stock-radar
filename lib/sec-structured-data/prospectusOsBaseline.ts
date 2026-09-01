import { createHash } from "node:crypto";
import {
  PostgresIssuerCommonClassUniverseRepository,
  readLatestUsablePeriodicOsBaseline,
  type IssuerCommonClassUniverseSnapshot,
} from "./issuerCommonClassUniverse.ts";
import {
  PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_REASON,
  PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION,
  PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE,
  PostgresShareCountHistoryRepository,
  type ProspectusTextAuthoritativeShareCountHistoryObservation,
  type ShareCountHistorySqlClient,
} from "./shareCountHistory.ts";

export const PROSPECTUS_TEXT_UNIVERSE_VERSION =
  "issuer-common-class-universe-prospectus-text-v1" as const;

export type StoredSecProspectusRawItem = {
  id: string;
  sourceUrl: string;
  bodyText: string;
  rawPayload: Record<string, unknown>;
};

export type ProspectusOsReviewReason =
  | "ADS_OR_ADR_BASIS"
  | "ORDINARY_SHARE_BASIS_AMBIGUOUS"
  | "MULTIPLE_COMMON_CLASSES"
  | "COMMON_CLASS_BASIS_INCOMPLETE"
  | "CONFLICTING_CURRENT_OS_EVIDENCE";

export type ProspectusOsRejectReason =
  | "NOT_FINAL_424B4"
  | "PRIMARY_DOCUMENT_INCOMPLETE"
  | "FILING_IDENTITY_INCOMPLETE"
  | "FINAL_US_LISTING_BASIS_MISSING"
  | "CURRENT_OS_NOT_EXPLICIT"
  | "ONLY_FUTURE_OR_DERIVED_OS"
  | "AS_OF_DATE_INVALID";

export type ProspectusOsAcceptedDecision = {
  status: "AUTO_ACCEPT";
  decisionVersion: typeof PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION;
  reason: typeof PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_REASON;
  rawItemId: string;
  issuerCik: string;
  accession: string;
  form: "424B4";
  filedDate: string;
  acceptedAt: string;
  filingDocument: string;
  sourceDocumentUrl: string;
  sourceContentHash: string;
  sharesOutstanding: string;
  asOf: string;
  evidence: string;
  listingBasis: {
    status: "FINALIZED_US_EXCHANGE_TICKER";
    exchange: string;
    ticker: string;
    evidence: string;
  };
  classEvidence: {
    status: "COMPLETE_SINGLE";
    title: "Common Stock";
    evidence: string;
  };
  rejectedFutureEvidence: string[];
};

export type ProspectusOsDecision =
  | ProspectusOsAcceptedDecision
  | {
      status: "REVIEW";
      reason: ProspectusOsReviewReason;
      rawItemId: string;
      evidence: string[];
    }
  | {
      status: "NOT_VERIFIED";
      reason: ProspectusOsRejectReason;
      rawItemId: string;
      evidence: string[];
    };

type FilingLedgerIdentity = {
  accessionNumber: string;
  issuerCik: string;
  form: string;
  filedDate: string;
  acceptedAt: string;
  primaryDocument: string;
  sourceRawId: string;
};

export function evaluateFinal424B4NewListingOs(
  rawItem: StoredSecProspectusRawItem,
): ProspectusOsDecision {
  const payload = rawItem.rawPayload;
  if (text(payload.form_type).toUpperCase() !== "424B4") {
    return notVerified(rawItem.id, "NOT_FINAL_424B4");
  }
  const primaryHtml = rawText(payload.primary_document_html);
  if (primaryHtml) {
    const ambiguity = classAmbiguity(normalizePrimaryDocument(primaryHtml));
    if (ambiguity) return review(rawItem.id, ambiguity.reason, ambiguity.evidence);
  }
  const primaryCharCount = integer(payload.primary_document_html_char_count);
  if (!primaryHtml
    || payload.primary_document_html_truncated !== false
    || primaryCharCount === null
    || primaryCharCount !== primaryHtml.length) {
    return notVerified(rawItem.id, "PRIMARY_DOCUMENT_INCOMPLETE");
  }

  const issuerCik = normalizeCik(payload.cik_padded ?? payload.cik);
  const accession = text(payload.accession_number);
  const filedDate = text(payload.filing_date);
  const acceptedAt = normalizedTimestamp(payload.accepted_at);
  const sourceDocumentUrl = text(payload.primary_document_url);
  const filingDocument = secDocumentName(sourceDocumentUrl);
  if (!issuerCik || !ACCESSION_PATTERN.test(accession) || !validDate(filedDate)
    || !acceptedAt || !filingDocument || !SEC_ARCHIVE_URL_PATTERN.test(sourceDocumentUrl)) {
    return notVerified(rawItem.id, "FILING_IDENTITY_INCOMPLETE");
  }

  const documentText = normalizePrimaryDocument(primaryHtml);
  const listingBasis = extractFinalUsListingBasis(documentText);
  if (!listingBasis) {
    return notVerified(rawItem.id, "FINAL_US_LISTING_BASIS_MISSING");
  }
  const classEvidence = extractSingleCommonClassEvidence(documentText);
  if (!classEvidence) {
    return review(rawItem.id, "COMMON_CLASS_BASIS_INCOMPLETE", [listingBasis.evidence]);
  }

  const extracted = extractCurrentOsCandidates(documentText);
  if (extracted.current.length === 0) {
    return notVerified(
      rawItem.id,
      extracted.rejectedFuture.length > 0 ? "ONLY_FUTURE_OR_DERIVED_OS" : "CURRENT_OS_NOT_EXPLICIT",
      extracted.rejectedFuture,
    );
  }
  const eligible = extracted.current.filter((candidate) => candidate.asOf <= filedDate);
  if (eligible.length === 0) {
    return notVerified(rawItem.id, "AS_OF_DATE_INVALID", extracted.current.map((candidate) => candidate.evidence));
  }
  const latestAsOf = eligible.reduce(
    (latest, candidate) => candidate.asOf > latest ? candidate.asOf : latest,
    eligible[0]!.asOf,
  );
  const latest = dedupeCandidates(eligible.filter((candidate) => candidate.asOf === latestAsOf));
  const values = [...new Set(latest.map((candidate) => candidate.sharesOutstanding))];
  if (values.length !== 1) {
    return review(rawItem.id, "CONFLICTING_CURRENT_OS_EVIDENCE", latest.map((candidate) => candidate.evidence));
  }
  const selected = latest[0]!;
  return {
    status: "AUTO_ACCEPT",
    decisionVersion: PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION,
    reason: PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_REASON,
    rawItemId: rawItem.id,
    issuerCik,
    accession,
    form: "424B4",
    filedDate,
    acceptedAt,
    filingDocument,
    sourceDocumentUrl,
    sourceContentHash: sha256(primaryHtml),
    sharesOutstanding: selected.sharesOutstanding,
    asOf: selected.asOf,
    evidence: selected.evidence,
    listingBasis,
    classEvidence,
    rejectedFutureEvidence: [...new Set(extracted.rejectedFuture)].sort(),
  };
}

export async function persistFinal424B4NewListingOsAtomic(input: {
  client: ShareCountHistorySqlClient;
  decision: ProspectusOsAcceptedDecision;
  filingLedger: FilingLedgerIdentity;
  ingestedAt: string;
}) {
  validateLedgerIdentity(input.decision, input.filingLedger);
  const historyRepository = new PostgresShareCountHistoryRepository(input.client);
  const universeRepository = new PostgresIssuerCommonClassUniverseRepository(input.client);
  await input.client.query("begin");
  try {
    await input.client.query("set local statement_timeout = '30s'");
    const periodic = await readLatestUsablePeriodicOsBaseline({
      repository: universeRepository,
      shareCountHistoryRepository: historyRepository,
      cik: input.decision.issuerCik,
      targetAt: input.ingestedAt,
    });
    if (periodic.status === "READ_FAILED") {
      throw new Error(`periodic baseline guard failed: ${periodic.reason}`);
    }
    if (periodic.status === "AVAILABLE") {
      await input.client.query("commit");
      return {
        status: "PERIODIC_BASELINE_EXISTS" as const,
        historyInserted: 0,
        snapshotInserted: 0,
        periodicBaseline: periodic,
      };
    }

    const materialized = materializeAcceptedProspectusDecision(input);
    const historyInserted = await historyRepository.insertObservation(materialized.observation);
    const snapshotInserted = await universeRepository.insertSnapshot(materialized.snapshot);
    if (historyInserted !== snapshotInserted) {
      throw new Error("prospectus history and universe replay state diverged");
    }
    await input.client.query("commit");
    return {
      status: historyInserted ? "INSERTED" as const : "DUPLICATE" as const,
      historyInserted: historyInserted ? 1 : 0,
      snapshotInserted: snapshotInserted ? 1 : 0,
      periodicBaseline: null,
    };
  } catch (error) {
    await input.client.query("rollback");
    throw error;
  }
}

function materializeAcceptedProspectusDecision(input: {
  decision: ProspectusOsAcceptedDecision;
  filingLedger: FilingLedgerIdentity;
  ingestedAt: string;
}) {
  const { decision, filingLedger } = input;
  const canonicalSecurityClassId = `sc:v1:${decision.issuerCik}:common_stock:single`;
  const sourceFactKey = sha256(stableJson({
    contract: PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION,
    accession: decision.accession,
    document: decision.filingDocument,
    asOf: decision.asOf,
    sharesOutstanding: decision.sharesOutstanding,
    evidence: decision.evidence,
  }));
  const sourceContextRef = `prospectus-current-os:${sourceFactKey.slice(0, 32)}`;
  const classCanonicalKey = `SOURCE_STATED_SECURITY_CLASS|${sha256("Common Stock")}`;
  const sourceFact = {
    factKey: sourceFactKey,
    contextRef: sourceContextRef,
    sharesOutstanding: decision.sharesOutstanding,
    documentName: decision.filingDocument,
    sourceUrl: decision.sourceDocumentUrl,
    contentHash: decision.sourceContentHash,
    artifactId: decision.rawItemId,
    dimensions: [],
  };
  const classUniverse = {
    snapshotVersion: PROSPECTUS_TEXT_UNIVERSE_VERSION,
    status: "COMPLETE_SINGLE",
    reason: "COMPLETE_SINGLE_COMMON_STOCK",
    canonicalSecurityClassId,
    universeAsOf: decision.asOf,
    futureSnapshotUsed: false,
  };
  const observation: ProspectusTextAuthoritativeShareCountHistoryObservation = {
    observationType: "source_stated",
    issuerCik: decision.issuerCik,
    sharesOutstanding: decision.sharesOutstanding,
    asOf: decision.asOf,
    securityClassBasis: "SOURCE_STATED_SECURITY_CLASS",
    securityClassIdentity: {
      canonicalKey: classCanonicalKey,
      identity: { title: "Common Stock" },
    },
    securityClassMetadata: {
      sourceRef: sourceContextRef,
      evidence: decision.evidence,
      sourceDeclaredClassKind: "common_stock",
      canonicalSecurityClassId,
    },
    canonicalSecurityClassId,
    canonicalSecurityClassKind: "common_stock",
    canonicalSecurityClassStatus: "mapped",
    canonicalSecurityClassProvenance: {
      version: "share-count-security-class-v1",
      derivation: "prospectus_text_complete_single_common_stock",
      issuerCik: decision.issuerCik,
      sourceFactKey,
      sourceContextRef,
      titleSimilarityUsed: false,
      rule: "complete_final_424b4_single_common_stock_basis",
    },
    shareBasisIdentity: "shares_outstanding:source_stated",
    shareBasisMetadata: {
      measurement: "shares_outstanding",
      unit: { kind: "shares", representation: "positive_integer" },
    },
    accessionNumber: decision.accession,
    form: "424B4",
    filingDocument: decision.filingDocument,
    filedDate: decision.filedDate,
    acceptedAt: decision.acceptedAt,
    acceptedAtSource: "sec_filing_ledger",
    acceptedAtProvenance: {
      source: "sec_filing_ledger.accepted_at",
      filingLedgerRawSourceId: filingLedger.sourceRawId,
    },
    ingestedAt: input.ingestedAt,
    sourceConceptNamespaceUri: null,
    sourceConceptLocalName: null,
    sourceFactKey,
    sourceContextRef,
    sourceArtifactId: decision.rawItemId,
    filingLedgerRawSourceId: filingLedger.sourceRawId,
    sourceFactIdentity: {
      factKey: sourceFactKey,
      sourceRef: sourceContextRef,
      accession: decision.accession,
      documentName: decision.filingDocument,
      artifactId: decision.rawItemId,
      observationType: "source_stated",
    },
    sourceContext: {
      sourceRef: sourceContextRef,
      asOf: decision.asOf,
      issuerCik: decision.issuerCik,
      temporalRole: "current_outstanding_as_of_explicit_calendar_date",
    },
    sourceDimensions: [],
    sourceProvenance: {
      filingLedgerRawSourceId: filingLedger.sourceRawId,
      secArtifact: {
        artifactId: decision.rawItemId,
        documentName: decision.filingDocument,
        sourceUrl: decision.sourceDocumentUrl,
        contentHash: decision.sourceContentHash,
        completePrimaryDocument: true,
      },
      verifier: {
        status: "AutomaticallyVerified",
        version: PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION,
        sourceCheck: "deterministic_final_424b4_current_os_v1",
      },
      listingBasis: structuredClone(decision.listingBasis),
      classUniverse,
      rejectedFutureEvidence: [...decision.rejectedFutureEvidence],
    },
    sourceType: PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE,
    authoritativeStatus: "ELIGIBLE",
    authoritativeDecisionVersion: PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION,
    authoritativeDecisionReason: PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_REASON,
    authoritativeDecisionLineage: {
      status: "ELIGIBLE",
      decisionVersion: PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION,
      reason: PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_REASON,
      issuerCik: decision.issuerCik,
      sharesOutstanding: decision.sharesOutstanding,
      asOf: decision.asOf,
      accession: decision.accession,
      form: "424B4",
      filedDate: decision.filedDate,
      acceptedAt: decision.acceptedAt,
      sourceFactKey,
    },
    sourceDocumentUrl: decision.sourceDocumentUrl,
    sourceContentHash: decision.sourceContentHash,
    sourceEvidence: decision.evidence,
    sourceAnalyzer: null,
  };
  const snapshotWithoutHash = {
    snapshotVersion: PROSPECTUS_TEXT_UNIVERSE_VERSION,
    issuerCik: decision.issuerCik,
    universeAsOf: decision.asOf,
    acceptedAt: decision.acceptedAt,
    sourceAccession: decision.accession,
    sourceForm: "424B4",
    sourceFiledDate: decision.filedDate,
    sourceDocuments: [decision.filingDocument],
    status: "COMPLETE_SINGLE" as const,
    reason: "COMPLETE_SINGLE_COMMON_STOCK" as const,
    requiredCanonicalSecurityClassIds: [canonicalSecurityClassId],
    classEvidence: [{
      canonicalSecurityClassId,
      sharesOutstanding: decision.sharesOutstanding,
      sourceFacts: [sourceFact],
    }],
    aggregateEvidence: [],
    excludedEvidence: [],
    completenessProvenance: {
      historicalClassUnionUsed: false,
      sourceContract: PROSPECTUS_TEXT_AUTHORITATIVE_OS_DECISION_VERSION,
      sourceType: PROSPECTUS_TEXT_AUTHORITATIVE_OS_SOURCE_TYPE,
      evidenceBasis: "complete_primary_prospectus_text",
      finalForm: "424B4",
      automaticVerifierStatus: "AutomaticallyVerified",
      listingBasis: structuredClone(decision.listingBasis),
      classBasisEvidence: structuredClone(decision.classEvidence),
    },
  };
  const snapshot: IssuerCommonClassUniverseSnapshot = {
    id: null,
    ...snapshotWithoutHash,
    sourceIdentityHash: sha256(stableJson(snapshotWithoutHash)),
    createdAt: null,
  };
  return { observation, snapshot };
}

function extractCurrentOsCandidates(value: string) {
  const current: Array<{ sharesOutstanding: string; asOf: string; evidence: string }> = [];
  const rejectedFuture: string[] = [];
  const patterns = [
    new RegExp(`\\bAs of (${CALENDAR_DATE_PATTERN}),?[^.]{0,180}?\\b(?:had|have|there (?:were|are))\\s+([0-9][0-9,]*)\\s+(?:shares?\\s+of\\s+)?(?:our\\s+)?(?:common stock|common shares)[^.]{0,100}?\\b(?:issued and outstanding|outstanding)\\b[^.]*[.]`, "gi"),
    new RegExp(`\\b([0-9][0-9,]*)\\s+shares?\\s+of\\s+(?:our\\s+)?(?:common stock|common shares)\\s+(?:were|are|was|is)?\\s*(?:issued and outstanding|outstanding)\\s+as of\\s+(${CALENDAR_DATE_PATTERN})[^.]*[.]`, "gi"),
    new RegExp(`\\b(?:common stock|common shares)[^.]{0,120}?([0-9][0-9,]*)\\s+shares?\\s+(?:were|are|was|is)?\\s*(?:issued and outstanding|outstanding)\\s+as of\\s+(${CALENDAR_DATE_PATTERN})[^.]*[.]`, "gi"),
  ];
  for (const [patternIndex, pattern] of patterns.entries()) {
    for (const match of value.matchAll(pattern)) {
      const dateText = patternIndex === 0 ? match[1] : match[2];
      const shareText = patternIndex === 0 ? match[2] : match[1];
      const evidence = compactEvidence(match[0]);
      const sharesOutstanding = normalizedPositiveInteger(shareText);
      const asOf = parseCalendarDate(dateText);
      if (!sharesOutstanding || !asOf) continue;
      if (FORWARD_OR_DERIVED_PATTERN.test(evidence)) rejectedFuture.push(evidence);
      else current.push({ sharesOutstanding, asOf, evidence });
    }
  }
  for (const match of value.matchAll(FUTURE_OS_PATTERN)) {
    rejectedFuture.push(compactEvidence(match[0]));
  }
  return { current: dedupeCandidates(current), rejectedFuture: [...new Set(rejectedFuture)].sort() };
}

function classAmbiguity(value: string): { reason: ProspectusOsReviewReason; evidence: string[] } | null {
  const ads = evidenceMatches(value, /[^.]{0,120}\b(?:ADSs?|American Depositary (?:Shares?|Receipts?)|ADR)\b[^.]{0,180}[.]/gi);
  if (ads.length > 0) return { reason: "ADS_OR_ADR_BASIS", evidence: ads };
  const ordinary = evidenceMatches(value, /[^.]{0,120}\bordinary shares?\b[^.]{0,180}[.]/gi);
  if (ordinary.length > 0) return { reason: "ORDINARY_SHARE_BASIS_AMBIGUOUS", evidence: ordinary };
  const namedCommonClasses = evidenceMatches(
    value,
    /[^.]{0,120}\b(?:non[- ]?voting|voting)\s+common stock\b[^.]{0,180}[.]/gi,
  );
  if (namedCommonClasses.length > 0) {
    return { reason: "MULTIPLE_COMMON_CLASSES", evidence: namedCommonClasses };
  }
  const classes = evidenceMatches(
    value,
    /[^.]{0,120}\b(?:two|multiple)\s+classes\s+of\s+(?:common stock|common shares)\b[^.]{0,180}[.]|[^.]{0,120}\bClass\s+[A-Z0-9]+\s+(?:common stock|common shares|ordinary shares)\b[^.]{0,180}[.]/gi,
  );
  if (classes.length > 0) return { reason: "MULTIPLE_COMMON_CLASSES", evidence: classes };
  return null;
}

function extractFinalUsListingBasis(value: string) {
  const patterns = [
    /[^.]{0,80}\b(?:common stock|common shares)\s+(?:was|has been|is)\s+approved for listing\s+(?:on|the)\s+(?:the\s+)?(Nasdaq(?: Capital| Global Select| Global)? Market|New York Stock Exchange|NYSE American|NYSE)[^.]{0,120}?\b(?:under|with)\s+the\s+(?:trading\s+)?symbol\s+[“"']?([A-Z][A-Z0-9.-]{0,11})[”"']?[^.]*[.]/i,
    /[^.]{0,80}\b(?:approved for listing|listed)\s+on\s+(?:the\s+)?(Nasdaq(?: Capital| Global Select| Global)? Market|New York Stock Exchange|NYSE American|NYSE)[^.]{0,120}?\bsymbol\s+[“"']?([A-Z][A-Z0-9.-]{0,11})[”"']?[^.]*[.]/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    return {
      status: "FINALIZED_US_EXCHANGE_TICKER" as const,
      exchange: match[1]!.replace(/\s+/g, " ").trim(),
      ticker: match[2]!.toUpperCase().replace(/\.$/, ""),
      evidence: compactEvidence(match[0]),
    };
  }
  return null;
}

function extractSingleCommonClassEvidence(value: string) {
  const patterns = [
    /\b(?:the\s+)?(?:company|corporation|we)\s+(?:is|are)\s+authorized\s+to\s+issue\s+(?:exactly\s+)?two\s+classes\s+of\s+stock\b.{0,900}?\bconsist(?:s|ing)\s+of\b.{0,400}?\bshares?\s+of\s+common stock\b.{0,400}?\bshares?\s+of\s+preferred stock\b/i,
    /\b(?:our|the company(?:'s)?)\s+authorized\s+capital stock\s+consists\s+of\b.{0,500}?\bshares?\s+of\s+common stock\b.{0,500}?\bshares?\s+of\s+preferred stock\b/i,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;
    const evidence = compactEvidence(match[0]);
    if (evidence) {
      return { status: "COMPLETE_SINGLE" as const, title: "Common Stock" as const, evidence };
    }
  }
  return null;
}

function normalizePrimaryDocument(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(?:p|div|tr|table|li|br|hr|h[1-6])>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/gi, '"')
    .replace(/&lsquo;|&rsquo;|&#8216;|&#8217;/gi, "'")
    .replace(/\s+/g, " ")
    .replace(/(?:\.\s*){2,}/g, ". ")
    .trim();
}

function validateLedgerIdentity(decision: ProspectusOsAcceptedDecision, ledger: FilingLedgerIdentity) {
  if (ledger.accessionNumber !== decision.accession || ledger.issuerCik !== decision.issuerCik
    || ledger.form !== "424B4" || ledger.filedDate !== decision.filedDate
    || new Date(ledger.acceptedAt).toISOString() !== decision.acceptedAt
    || ledger.primaryDocument !== decision.filingDocument
    || !UUID_PATTERN.test(ledger.sourceRawId)) {
    throw new Error("prospectus filing-ledger identity mismatch");
  }
}

function evidenceMatches(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].slice(0, 5).map((match) => compactEvidence(match[0]));
}

function dedupeCandidates<T extends { sharesOutstanding: string; asOf: string; evidence: string }>(rows: T[]) {
  const unique = new Map<string, T>();
  for (const row of rows) unique.set(`${row.asOf}|${row.sharesOutstanding}|${row.evidence}`, row);
  return [...unique.values()].sort((left, right) =>
    `${left.asOf}|${left.sharesOutstanding}|${left.evidence}`.localeCompare(
      `${right.asOf}|${right.sharesOutstanding}|${right.evidence}`,
    ));
}

function review(rawItemId: string, reason: ProspectusOsReviewReason, evidence: string[]): ProspectusOsDecision {
  return { status: "REVIEW", reason, rawItemId, evidence: [...new Set(evidence)].sort() };
}

function notVerified(
  rawItemId: string,
  reason: ProspectusOsRejectReason,
  evidence: string[] = [],
): ProspectusOsDecision {
  return { status: "NOT_VERIFIED", reason, rawItemId, evidence: [...new Set(evidence)].sort() };
}

function secDocumentName(value: string) {
  try {
    return new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    return "";
  }
}

function normalizedTimestamp(value: unknown) {
  const raw = text(value);
  if (!TIMESTAMP_PATTERN.test(raw) || Number.isNaN(new Date(raw).valueOf())) return "";
  return new Date(raw).toISOString();
}

function normalizedPositiveInteger(value: unknown) {
  const raw = text(value).replace(/,/g, "");
  return POSITIVE_INTEGER_PATTERN.test(raw) ? BigInt(raw).toString() : "";
}

function normalizeCik(value: unknown) {
  const raw = text(value);
  return /^\d{1,10}$/.test(raw) && !/^0+$/.test(raw) ? raw.padStart(10, "0") : "";
}

function parseCalendarDate(value: unknown) {
  const raw = text(value).replace(/\s+/g, " ");
  const match = raw.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return "";
  const month = MONTHS[match[1]!.toLowerCase()];
  if (!month) return "";
  const result = `${match[3]}-${month}-${match[2]!.padStart(2, "0")}`;
  return validDate(result) ? result : "";
}

function validDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function compactEvidence(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 600);
}

function integer(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function rawText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
};
const CALENDAR_DATE_PATTERN =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},\\s+\\d{4}";
const FORWARD_OR_DERIVED_PATTERN =
  /\b(?:following|after|immediately after|expected|will be|would be|pro forma|assuming|projected|estimated|offered|registered|resale|potential|may be issued|to be outstanding|as adjusted)\b/i;
const FUTURE_OS_PATTERN =
  /[^.]{0,80}\b(?:following|after|immediately after|expected|will be|would be|pro forma|assuming|projected|estimated)[^.]{0,160}?\b[0-9][0-9,]*\s+shares?[^.]*[.]/gi;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const POSITIVE_INTEGER_PATTERN = /^[1-9]\d*$/;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEC_ARCHIVE_URL_PATTERN = /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//i;
