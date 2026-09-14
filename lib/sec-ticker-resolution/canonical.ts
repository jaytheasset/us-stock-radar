import { createHash } from "node:crypto";

type Row = Record<string, unknown>;

export const SEC_TICKER_RESOLUTION_METHOD = "deterministic-sec-ticker-resolution";
export const SEC_TICKER_RESOLUTION_VERSION = "sec-ticker-resolution-v1";
export const SEC_TICKER_EVIDENCE_VERSION = "sec-ticker-change-evidence-v1";
export const SEC_TICKER_IDENTITY_VERSION = "sec-ticker-security-identity-v1";

export type SecTickerResolutionState = "AUTO" | "REVIEW" | "UNRESOLVED";

export type VerifiedSecCoverObservation = Readonly<{
  resultId: string;
  observationKey: string;
  accessionNumber: string;
  issuerCik: string;
  acceptedAt: string | null;
  sourceRawId: string | null;
  sourceUrl: string | null;
  sourceDocument: string | null;
  sourceSha256: string | null;
  contextRef: string;
  dimensions: readonly Row[];
  securityTitleStatus: string;
  securityTitle: string | null;
  tradingSymbolStatus: string;
  tradingSymbol: string | null;
  exchangeStatus: string;
  exchange: string | null;
}>;

export type VerifiedSecResolutionSource = Readonly<{
  resultId: string;
  accessionNumber: string;
  issuerCik: string;
  rawSourceId: string;
  url: string;
  documentName: string;
  sha256: string;
  rawContent: string;
}>;

export type SecTickerResolutionEvaluationInput = Readonly<{
  issuerCik: string;
  evidenceAccessionNumber: string;
  beforeAccessionNumber: string;
  beforeSourceSha256?: string;
  afterAccessionNumber: string;
  afterSourceSha256?: string;
  source: VerifiedSecResolutionSource;
  beforeObservations: readonly VerifiedSecCoverObservation[];
  afterObservations: readonly VerifiedSecCoverObservation[];
}>;

export type SecTickerResolutionEvaluation = Readonly<{
  resolutionState: SecTickerResolutionState;
  reasons: readonly string[];
  identity: Row | null;
  evidence: Row | null;
  decision: Row;
  summary: Readonly<{
    oldTicker: string | null;
    newTicker: string | null;
    effectiveDate: string | null;
    effectivePrecision: string | null;
    securityType: string | null;
    securityClass: string | null;
    continuityBasis: string | null;
    sourceTextSpanSha256: string | null;
  }>;
}>;

type ClassifiedSecurity = Readonly<{
  type: "common_stock" | "ordinary_shares" | "adr";
  securityClass: string | null;
  normalizedTitle: string;
}>;

type ExtractedChange = Readonly<{
  oldTicker: string | null;
  newTicker: string;
  effectiveDate: string;
  effectivePrecision: "date" | "market_open";
  effectiveText: string;
  continuityBasis: "unchanged_terms" | "unchanged_cusip_and_rights";
  spanStart: number;
  spanEnd: number;
  span: string;
}>;

export function evaluateSecTickerResolution(
  input: SecTickerResolutionEvaluationInput,
): SecTickerResolutionEvaluation {
  const issuerCik = normalizeCik(input.issuerCik);
  const preliminaryReasons: string[] = [];
  if (!issuerCik || issuerCik !== input.source.issuerCik
    || input.evidenceAccessionNumber !== input.source.accessionNumber) {
    preliminaryReasons.push("SOURCE_IDENTITY_CONFLICT");
  }
  if (sha256(input.source.rawContent) !== input.source.sha256) {
    preliminaryReasons.push("SOURCE_HASH_MISMATCH");
  }

  const beforeSecurityCandidates = coverSecurityCandidates(input.beforeObservations, issuerCik);
  const afterSecurityCandidates = coverSecurityCandidates(input.afterObservations, issuerCik);
  const beforeCandidates = usableCoverObservations(beforeSecurityCandidates);
  const afterCandidates = usableCoverObservations(afterSecurityCandidates);
  if (beforeCandidates.length === 0) preliminaryReasons.push("BEFORE_COVER_OBSERVATION_MISSING");
  if (afterCandidates.length === 0) preliminaryReasons.push("AFTER_COVER_OBSERVATION_MISSING");
  if (beforeSecurityCandidates.length > 1) preliminaryReasons.push("BEFORE_COVER_MULTIPLE_SECURITY_CANDIDATES");
  if (afterSecurityCandidates.length > 1) preliminaryReasons.push("AFTER_COVER_MULTIPLE_SECURITY_CANDIDATES");

  const before = beforeCandidates.length === 1 ? beforeCandidates[0]! : null;
  const after = afterCandidates.length === 1 ? afterCandidates[0]! : null;
  if (before && before.accessionNumber !== input.beforeAccessionNumber) preliminaryReasons.push("BEFORE_ACCESSION_CONFLICT");
  if (after && after.accessionNumber !== input.afterAccessionNumber) preliminaryReasons.push("AFTER_ACCESSION_CONFLICT");
  if (before && after && input.source.resultId !== before.resultId && input.source.resultId !== after.resultId) {
    preliminaryReasons.push("SOURCE_RESULT_OUTSIDE_OBSERVATION_PAIR");
  }
  const beforeSecurity = before ? classifySecurity(before.securityTitle!) : null;
  const afterSecurity = after ? classifySecurity(after.securityTitle!) : null;
  if (before && !beforeSecurity) preliminaryReasons.push("BEFORE_SECURITY_TYPE_UNSUPPORTED");
  if (after && !afterSecurity) preliminaryReasons.push("AFTER_SECURITY_TYPE_UNSUPPORTED");
  if (beforeSecurity && afterSecurity && !sameSecurityClassification(beforeSecurity, afterSecurity)) {
    preliminaryReasons.push("SECURITY_CLASS_CONFLICT");
  }
  if (beforeSecurity && afterSecurity && (beforeSecurity.type !== "common_stock" || afterSecurity.type !== "common_stock")) {
    preliminaryReasons.push("SECURITY_SCOPE_UNSUPPORTED");
  }
  if (before && after && stableStringify(before.dimensions) !== stableStringify(after.dimensions)) {
    preliminaryReasons.push("SECURITY_DIMENSIONS_CONFLICT");
  }
  if (before && after && canonicalExchange(before.exchange) !== canonicalExchange(after.exchange)) {
    preliminaryReasons.push("EXCHANGE_CONFLICT");
  }

  const visibleText = secVisibleText(input.source.rawContent);
  const extractedCandidates = extractTickerChanges(visibleText, before?.tradingSymbol ?? null);
  if (extractedCandidates.length === 0) preliminaryReasons.push("SUPPORTED_CHANGE_EVIDENCE_MISSING");
  if (extractedCandidates.length > 1) preliminaryReasons.push("MULTIPLE_CHANGE_EVIDENCE_CANDIDATES");
  const extracted = extractedCandidates.length === 1 ? extractedCandidates[0]! : null;

  if (extracted && before && extracted.oldTicker && extracted.oldTicker !== before.tradingSymbol) {
    preliminaryReasons.push("OLD_TICKER_CONFLICT");
  }
  if (extracted && after && extracted.newTicker !== after.tradingSymbol) {
    preliminaryReasons.push("NEW_TICKER_CONFLICT");
  }
  if (extracted && before && after && before.tradingSymbol === after.tradingSymbol) {
    preliminaryReasons.push("TICKER_DID_NOT_CHANGE");
  }
  if (extracted && before && extracted.oldTicker === extracted.newTicker) {
    preliminaryReasons.push("TICKER_DID_NOT_CHANGE");
  }
  if (extracted && hasTargetTransactionComplexity(connectedClaimContext(visibleText, extracted))) {
    preliminaryReasons.push("COMPLEX_TARGET_TRANSACTION");
  }
  if (extracted && hasTargetEvidenceConflict(visibleText, extracted)) {
    preliminaryReasons.push("TARGET_EVIDENCE_CONFLICT");
  }
  if (extracted && before && after && !effectiveDateFitsObservationSequence(extracted.effectiveDate, before, after)) {
    preliminaryReasons.push("EFFECTIVE_DATE_CONFLICT");
  }

  const oldTicker = extracted?.oldTicker ?? before?.tradingSymbol ?? null;
  const newTicker = extracted?.newTicker ?? after?.tradingSymbol ?? null;
  const reasons = [...new Set(preliminaryReasons)].sort();
  const conflict = reasons.some(isConflictReason);
  const resolutionState: SecTickerResolutionState = reasons.length === 0
    ? "AUTO"
    : conflict ? "REVIEW" : "UNRESOLVED";

  const identity = issuerCik && before && after && beforeSecurity && afterSecurity
    && beforeSecurity.type === "common_stock"
    && sameSecurityClassification(beforeSecurity, afterSecurity)
    && stableStringify(before.dimensions) === stableStringify(after.dimensions)
    ? buildIdentity(issuerCik, before, after, beforeSecurity)
    : null;
  const evidence = identity && extracted && oldTicker && newTicker
    ? buildEvidence(input, identity, extracted, oldTicker, newTicker)
    : null;
  const decisionPayload = {
    storageVersion: SEC_TICKER_RESOLUTION_VERSION,
    resolutionType: "same_security_ticker_change",
    resolutionState,
    method: SEC_TICKER_RESOLUTION_METHOD,
    methodVersion: SEC_TICKER_RESOLUTION_VERSION,
    issuerCik,
    input: {
      evidenceAccessionNumber: input.evidenceAccessionNumber,
      beforeAccessionNumber: input.beforeAccessionNumber,
      afterAccessionNumber: input.afterAccessionNumber,
      sourceResultId: input.source.resultId,
      sourceRawId: input.source.rawSourceId,
      sourceSha256: input.source.sha256,
      beforeSourceSha256: input.beforeSourceSha256 ?? before?.sourceSha256 ?? null,
      afterSourceSha256: input.afterSourceSha256 ?? after?.sourceSha256 ?? null,
      beforeResultId: before?.resultId ?? null,
      beforeObservationKey: before?.observationKey ?? null,
      afterResultId: after?.resultId ?? null,
      afterObservationKey: after?.observationKey ?? null,
    },
    relationship: {
      identityId: identity ? stringValue(identity.id) : null,
      evidenceId: evidence ? stringValue(evidence.id) : null,
      oldTicker,
      newTicker,
      effectiveDate: extracted?.effectiveDate ?? null,
      effectivePrecision: extracted?.effectivePrecision ?? null,
      continuityBasis: extracted?.continuityBasis ?? null,
    },
    ruleReasons: reasons.length > 0 ? reasons : ["AUTO_EXACT_SEC_EVIDENCE_RULES_SATISFIED"],
  };
  const decisionSha256 = sha256(stableStringify(decisionPayload));
  const decisionId = deterministicUuid(`sec_ticker_resolution:${decisionSha256}`);
  const decision: Row = {
    id: decisionId,
    issuer_cik: issuerCik,
    evidence_accession_number: input.evidenceAccessionNumber,
    before_accession_number: input.beforeAccessionNumber,
    after_accession_number: input.afterAccessionNumber,
    source_result_id: input.source.resultId,
    security_identity_id: identity ? identity.id : null,
    evidence_id: evidence ? evidence.id : null,
    resolution_type: "same_security_ticker_change",
    resolution_state: resolutionState,
    method: SEC_TICKER_RESOLUTION_METHOD,
    method_version: SEC_TICKER_RESOLUTION_VERSION,
    rule_reasons: decisionPayload.ruleReasons,
    decision_payload: decisionPayload,
    decision_sha256: decisionSha256,
  };
  return {
    resolutionState,
    reasons: decisionPayload.ruleReasons,
    identity,
    evidence,
    decision,
    summary: {
      oldTicker,
      newTicker,
      effectiveDate: extracted?.effectiveDate ?? null,
      effectivePrecision: extracted?.effectivePrecision ?? null,
      securityType: beforeSecurity?.type ?? null,
      securityClass: beforeSecurity?.securityClass ?? null,
      continuityBasis: extracted?.continuityBasis ?? null,
      sourceTextSpanSha256: extracted ? sha256(extracted.span) : null,
    },
  };
}

export function validateStoredSecTickerResolution(input: {
  evaluation: SecTickerResolutionEvaluation;
  storedDecision: Row;
  storedIdentity: Row | null;
  storedEvidence: Row | null;
}): { ok: true } | { ok: false; reason: string } {
  const decision = normalizeStoredRow(input.storedDecision);
  if (stableStringify(decision) !== stableStringify(normalizeStoredRow(input.evaluation.decision))) {
    return { ok: false, reason: "decision_replay_mismatch" };
  }
  if (input.evaluation.identity) {
    if (!input.storedIdentity
      || stableStringify(normalizeStoredRow(input.storedIdentity)) !== stableStringify(normalizeStoredRow(input.evaluation.identity))) {
      return { ok: false, reason: "identity_replay_mismatch" };
    }
  } else if (input.storedIdentity) {
    return { ok: false, reason: "unexpected_stored_identity" };
  }
  if (input.evaluation.evidence) {
    if (!input.storedEvidence
      || stableStringify(normalizeStoredRow(input.storedEvidence)) !== stableStringify(normalizeStoredRow(input.evaluation.evidence))) {
      return { ok: false, reason: "evidence_replay_mismatch" };
    }
  } else if (input.storedEvidence) {
    return { ok: false, reason: "unexpected_stored_evidence" };
  }
  return { ok: true };
}

export function secVisibleText(source: string): string {
  return decodeEntities(source
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<ix:hidden\b[\s\S]*?<\/ix:hidden>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTickerChanges(text: string, coverOldTicker: string | null): ExtractedChange[] {
  const candidates: ExtractedChange[] = [];
  const explicit = /\bEffective\s+([A-Z][a-z]+\s+\d{1,2},\s+20\d{2}),\s+we changed our ticker symbol\b[\s\S]{0,260}?\bfrom\s+["']?([A-Z0-9][A-Z0-9.-]{0,11})["']?\s+to\s+["']?([A-Z0-9][A-Z0-9.-]{0,11})["']?\s*\./g;
  for (const match of text.matchAll(explicit)) {
    const date = parseEnglishDate(match[1]!);
    const oldTicker = normalizeTicker(match[2]);
    const newTicker = normalizeTicker(match[3]);
    if (!date || !oldTicker || !newTicker || match.index === undefined || unsupportedClaimContext(text, match.index)) continue;
    const continuation = text.slice(match.index + match[0].length, match.index + match[0].length + 500);
    const continuity = continuation.match(/\bThe change did not alter\b[\s\S]{0,220}?\b(?:other\s+)?terms of our common stock\s*\./i);
    if (!continuity || continuity.index === undefined) continue;
    const spanEnd = match.index + match[0].length + continuity.index + continuity[0].length;
    candidates.push({
      oldTicker,
      newTicker,
      effectiveDate: date,
      effectivePrecision: "date",
      effectiveText: match[1]!,
      continuityBasis: "unchanged_terms",
      spanStart: match.index,
      spanEnd,
      span: text.slice(match.index, spanEnd),
    });
  }

  const market = /\bBeginning with the opening of trading on\s+([A-Z][a-z]+\s+\d{1,2},\s+20\d{2}),\s+trading will be done under\b[\s\S]{0,180}?\bsymbol\s+["']([A-Z0-9][A-Z0-9.-]{0,11})["']/g;
  for (const match of text.matchAll(market)) {
    const date = parseEnglishDate(match[1]!);
    const newTicker = normalizeTicker(match[2]);
    if (!date || !newTicker || !coverOldTicker || match.index === undefined || unsupportedClaimContext(text, match.index)) continue;
    const before = text.slice(Math.max(0, match.index - 650), match.index);
    const rights = before.match(/\bThe Name Change Amendment will not in any way affect\b[\s\S]{0,350}?\b(?:rights|validity|transferability)\b[\s\S]{0,220}?\bCommon Stock\b[^.]*\./i);
    const quoted = before.match(/\bThe Company's shares of Common Stock continue to be quoted on\b[^.]*\./i);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 450);
    const cusip = after.match(/[^.]*\bThere will be no change to the Common Stock's CUSIP\b[\s\S]{0,180}?\bSymbol Change\b[^.]*\./i);
    if (!rights || rights.index === undefined || !quoted || !cusip || cusip.index === undefined) continue;
    const rightsStart = Math.max(0, match.index - 650) + rights.index;
    const spanEnd = match.index + match[0].length + cusip.index + cusip[0].length;
    candidates.push({
      oldTicker: normalizeTicker(coverOldTicker),
      newTicker,
      effectiveDate: date,
      effectivePrecision: "market_open",
      effectiveText: `opening of trading on ${match[1]}`,
      continuityBasis: "unchanged_cusip_and_rights",
      spanStart: rightsStart,
      spanEnd,
      span: text.slice(rightsStart, spanEnd),
    });
  }
  return dedupeExtracted(candidates);
}

function buildIdentity(
  issuerCik: string,
  before: VerifiedSecCoverObservation,
  after: VerifiedSecCoverObservation,
  security: ClassifiedSecurity,
): Row {
  const payload = {
    storageVersion: SEC_TICKER_IDENTITY_VERSION,
    issuerCik,
    securityType: security.type,
    securityClass: security.securityClass,
    before: observationIdentity(before),
    after: observationIdentity(after),
  };
  const identitySha256 = sha256(stableStringify(payload));
  return {
    id: deterministicUuid(`sec_ticker_security_identity:${identitySha256}`),
    issuer_cik: issuerCik,
    security_type: security.type,
    security_class: security.securityClass,
    before_result_id: before.resultId,
    before_observation_key: before.observationKey,
    after_result_id: after.resultId,
    after_observation_key: after.observationKey,
    before_security_title: before.securityTitle,
    after_security_title: after.securityTitle,
    identity_method: "sec-cover-security-continuity",
    identity_version: SEC_TICKER_IDENTITY_VERSION,
    identity_payload: payload,
    identity_sha256: identitySha256,
  };
}

function buildEvidence(
  input: SecTickerResolutionEvaluationInput,
  identity: Row,
  extracted: ExtractedChange,
  oldTicker: string,
  newTicker: string,
): Row {
  const payload = {
    storageVersion: SEC_TICKER_EVIDENCE_VERSION,
    issuerCik: normalizeCik(input.issuerCik),
    securityIdentityId: identity.id,
    source: {
      resultId: input.source.resultId,
      rawSourceId: input.source.rawSourceId,
      accessionNumber: input.source.accessionNumber,
      url: input.source.url,
      documentName: input.source.documentName,
      sha256: input.source.sha256,
      textMethod: "sec-visible-text-exact-span",
      textVersion: "sec-visible-text-v1",
      spanStart: extracted.spanStart,
      spanEnd: extracted.spanEnd,
      spanSha256: sha256(extracted.span),
    },
    change: {
      oldTicker,
      newTicker,
      effectiveDate: extracted.effectiveDate,
      effectiveAt: null,
      effectivePrecision: extracted.effectivePrecision,
      effectiveText: extracted.effectiveText,
      continuityBasis: extracted.continuityBasis,
    },
  };
  const evidenceSha256 = sha256(stableStringify(payload));
  return {
    id: deterministicUuid(`sec_ticker_change_evidence:${evidenceSha256}`),
    security_identity_id: identity.id,
    issuer_cik: normalizeCik(input.issuerCik),
    source_result_id: input.source.resultId,
    source_raw_id: input.source.rawSourceId,
    source_kind: "filing_xbrl",
    source_accession_number: input.source.accessionNumber,
    source_url: input.source.url,
    source_document: input.source.documentName,
    source_sha256: input.source.sha256,
    source_text_method: "sec-visible-text-exact-span",
    source_text_version: "sec-visible-text-v1",
    source_text_span_start: extracted.spanStart,
    source_text_span_end: extracted.spanEnd,
    source_text_span: extracted.span,
    source_text_span_sha256: sha256(extracted.span),
    old_ticker: oldTicker,
    new_ticker: newTicker,
    effective_date: extracted.effectiveDate,
    effective_at: null,
    effective_precision: extracted.effectivePrecision,
    effective_text: extracted.effectiveText,
    continuity_basis: extracted.continuityBasis,
    extraction_method: "sec-primary-document-ticker-change",
    extraction_version: SEC_TICKER_EVIDENCE_VERSION,
    evidence_payload: payload,
    evidence_sha256: evidenceSha256,
  };
}

function coverSecurityCandidates(rows: readonly VerifiedSecCoverObservation[], issuerCik: string | null) {
  return rows.filter((row) => row.issuerCik === issuerCik);
}

function usableCoverObservations(rows: readonly VerifiedSecCoverObservation[]) {
  return rows.filter((row) => observedStatus(row.securityTitleStatus)
    && observedStatus(row.tradingSymbolStatus)
    && observedStatus(row.exchangeStatus)
    && Boolean(row.securityTitle?.trim())
    && Boolean(normalizeTicker(row.tradingSymbol))
    && Boolean(row.exchange?.trim()));
}

export function classifySecurity(title: string): ClassifiedSecurity | null {
  const normalizedTitle = normalizeSecurityTitle(title);
  if (/\bwarrants?\b/.test(normalizedTitle) || /\bpreferred\b/.test(normalizedTitle)) return null;
  const classMatch = normalizedTitle.match(/\bclass\s+([a-z0-9-]+)\b/);
  const securityClass = classMatch?.[1]?.toUpperCase() ?? null;
  if (/\bcommon stock\b/.test(normalizedTitle)) return { type: "common_stock", securityClass, normalizedTitle };
  if (/\bordinary shares?\b/.test(normalizedTitle)) return { type: "ordinary_shares", securityClass, normalizedTitle };
  if (/\bamerican depositary (?:shares?|receipts?)\b|\badr\b/.test(normalizedTitle)) {
    return { type: "adr", securityClass, normalizedTitle };
  }
  return null;
}

function sameSecurityClassification(left: ClassifiedSecurity, right: ClassifiedSecurity) {
  return left.type === right.type
    && left.securityClass === right.securityClass
    && left.normalizedTitle === right.normalizedTitle;
}

function effectiveDateFitsObservationSequence(
  effectiveDate: string,
  before: VerifiedSecCoverObservation,
  after: VerifiedSecCoverObservation,
) {
  const beforeDate = isoDate(before.acceptedAt);
  const afterDate = isoDate(after.acceptedAt);
  return Boolean(beforeDate && afterDate && beforeDate <= effectiveDate && effectiveDate <= afterDate);
}

function observationIdentity(row: VerifiedSecCoverObservation) {
  return {
    resultId: row.resultId,
    observationKey: row.observationKey,
    accessionNumber: row.accessionNumber,
    contextRef: row.contextRef,
    securityTitle: row.securityTitle,
    tradingSymbol: row.tradingSymbol,
    exchange: row.exchange,
    dimensions: row.dimensions,
  };
}

function hasTargetTransactionComplexity(span: string) {
  return /\b(?:reverse\s+merger|merger|business combination|successor|predecessor)\b/i.test(span)
    && (/\bticker(?: symbol)? change\b[^.]{0,180}\b(?:results? from|is (?:a )?part of|as part of|in connection with)\b[^.]{0,180}\b(?:reverse\s+merger|merger|business combination|successor|predecessor)\b/i.test(span)
      || /\b(?:merger|business combination|successor|predecessor)\b[^.]{0,180}\b(?:changed our ticker symbol|opening of trading)\b/i.test(span));
}

function hasTargetEvidenceConflict(text: string, extracted: ExtractedChange) {
  const local = connectedClaimContext(text, extracted);
  const escapedDate = extracted.effectiveText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedTicker = extracted.newTicker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /\b(?:ticker|trading) symbol (?:will|would|did) not change\b/i.test(local)
    || /\b(?:CUSIP|voting rights?|transferability|terms of (?:the|our) common stock)\b[^.]{0,100}?\b(?:(?:will|would|did) change|(?:has|have|had|is|was|were) changed|changed|changes|changing)\b/i.test(local)
    || /\beffective date of this ticker symbol change is\s+[A-Z][a-z]+\s+\d{1,2},\s+20\d{2},\s+not\s+/i.test(local)
    || new RegExp(`\\bnew ticker symbol for this change is\\s+(?!${escapedTicker}\\b)[A-Z0-9][A-Z0-9.-]{0,11}\\b`, "i").test(local)
    || new RegExp(`\\bnot\\s+${escapedDate}\\b`, "i").test(local);
}

function unsupportedClaimContext(text: string, start: number) {
  const prefix = text.slice(Math.max(0, start - 360), start);
  return /\b(?:hypothetical example|not an actual issuer change|another issuer|third party|does not describe (?:the company|our) securities|according to|quoted from)\b/i.test(prefix)
    || /\b(?:if approved|if consummated|if completed|would|may|might|could|proposed)\b[^.]{0,180}$/i.test(prefix);
}

function connectedClaimContext(text: string, extracted: ExtractedChange) {
  return text.slice(Math.max(0, extracted.spanStart - 360), Math.min(text.length, extracted.spanEnd + 650));
}

function isConflictReason(reason: string) {
  return /(?:CONFLICT|MULTIPLE|INACTIVE|COMPLEX|HASH_MISMATCH|DID_NOT_CHANGE)/.test(reason);
}

function observedStatus(value: string) {
  return value === "observed" || value === "duplicate_equal";
}

function canonicalExchange(value: string | null) {
  const normalized = stringValue(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (/\bnasdaq\b/.test(normalized)) return "nasdaq";
  if (/\bnew york stock exchange\b|\bnyse\b/.test(normalized)) return "nyse";
  return normalized;
}

function normalizeSecurityTitle(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[.,]/g, "").trim();
}

function parseEnglishDate(value: string) {
  const match = value.match(/^([A-Z][a-z]+)\s+(\d{1,2}),\s+(20\d{2})$/);
  if (!match) return null;
  const month = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]
    .indexOf(match[1]!.toLowerCase());
  if (month < 0) return null;
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return `${year.toString().padStart(4, "0")}-${(month + 1).toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function isoDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function dedupeExtracted(rows: readonly ExtractedChange[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = [row.oldTicker, row.newTicker, row.effectiveDate, row.spanStart, row.spanEnd].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&rsquo;|&#8217;|&#x2019;/gi, "'")
    .replace(/&lsquo;|&#8216;|&#x2018;/gi, "'")
    .replace(/&ldquo;|&#8220;|&#x201c;/gi, '"')
    .replace(/&rdquo;|&#8221;|&#x201d;/gi, '"')
    .replace(/&mdash;|&#8212;|&#x2014;/gi, "-")
    .replace(/&ndash;|&#8211;|&#x2013;/gi, "-")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeStoredRow(value: Row) {
  const ignored = new Set(["created_at"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !ignored.has(key)));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const row = value as Row;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(row[key])}`).join(",")}}`;
}

function deterministicUuid(input: string) {
  const hex = sha256(input).slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizeTicker(value: unknown) {
  const ticker = stringValue(value).toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker) ? ticker : null;
}

function normalizeCik(value: unknown) {
  const cik = stringValue(value);
  return /^\d{1,10}$/.test(cik) && !/^0+$/.test(cik) ? cik.padStart(10, "0") : null;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
