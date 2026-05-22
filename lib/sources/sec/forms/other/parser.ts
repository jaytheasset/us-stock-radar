import { findSecFormParserGroup, normalizeSecFormType, type SecFormParserInput, type SecFormParserOutput } from "../common";
import {
  SEC_OTHER_PARSER_VERSION,
  type SecOtherDateCandidate,
  type SecOtherDateRole,
  type SecOtherDocumentSummary,
  type SecOtherEventTypeHint,
  type SecOtherFilingFacts,
  type SecOtherKeywordSignal,
  type SecOtherNamedParty,
  type SecOtherTextStats,
  type SecOtherValueCandidate,
  type SecOtherValueKind,
} from "./types";

type KeywordRule = {
  keyword: string;
  pattern: RegExp;
  eventTypeHint: SecOtherEventTypeHint;
  confidence: SecOtherKeywordSignal["confidence"];
};

type MatchSpan = {
  start: number;
  end: number;
};

const KEYWORD_RULES: KeywordRule[] = [
  keywordRule("Nasdaq notice", /\bNasdaq\b.{0,120}\b(?:deficiency|non-compliance|delisting|minimum bid|listing rule)\b/i, "listing_risk", "high"),
  keywordRule("NYSE notice", /\bNYSE\b.{0,120}\b(?:deficiency|non-compliance|delisting|continued listing)\b/i, "listing_risk", "high"),
  keywordRule("minimum bid", /\bminimum bid\b|\bbid price\b.{0,80}\b(?:deficiency|requirement|compliance)\b/i, "listing_risk", "high"),
  keywordRule("offering", /\b(?:registered direct|public offering|private placement|securities purchase agreement|at-the-market|ATM program)\b/i, "dilution_risk", "high"),
  keywordRule("resale", /\b(?:resale registration|selling stockholders?|selling shareholders?|resale shares)\b/i, "dilution_risk", "high"),
  keywordRule("warrant or convertible", /\b(?:warrants?|convertible notes?|conversion price|exercise price|pre-funded warrant)\b/i, "dilution_risk", "medium"),
  keywordRule("financial results", /\b(?:financial results|quarterly results|annual results|earnings release|guidance)\b/i, "earnings", "high"),
  keywordRule("sales metric", /\b(?:revenue|net sales|bookings|backlog|orders)\b.{0,80}\b(?:increase|decrease|growth|decline|guidance|update)\b/i, "sales_performance", "medium"),
  keywordRule("product milestone", /\b(?:product launch|commercial launch|production milestone|platform launch|rollout|manufacturing update)\b/i, "product_update", "medium"),
  keywordRule("leadership change", /\b(?:resigned|resignation|appointed|appointment|terminated|retired)\b.{0,120}\b(?:CEO|CFO|president|director|board|officer|auditor)\b/i, "leadership_governance", "high"),
  keywordRule("governance", /\b(?:material weakness|internal control|auditor change|board of directors|corporate governance)\b/i, "leadership_governance", "medium"),
  keywordRule("beneficial ownership", /\b(?:beneficial ownership|Schedule 13D|Schedule 13G|insider transaction|Rule 144)\b/i, "insider_ownership", "medium"),
  keywordRule("shareholder vote", /\b(?:shareholder meeting|stockholder meeting|special meeting|annual meeting|proxy|vote|proposal|record date)\b/i, "shareholder_vote", "medium"),
  keywordRule("strategic transaction", /\b(?:merger|acquisition|tender offer|asset sale|joint venture|license agreement|material definitive agreement)\b/i, "strategic_transaction", "high"),
  keywordRule("financial risk", /\b(?:going concern|liquidity|default|covenant|bankruptcy|restructuring|credit facility|debt maturity)\b/i, "financial_risk", "high"),
  keywordRule("legal risk", /\b(?:lawsuit|litigation|subpoena|investigation|settlement|enforcement action|regulatory proceeding)\b/i, "legal_risk", "high"),
  keywordRule("dividend", /\b(?:dividend|distribution|record date|ex-dividend|payable date)\b/i, "dividends", "medium"),
  keywordRule("buyback", /\b(?:share repurchase|stock repurchase|buyback|repurchase authorization)\b/i, "capital_return", "medium"),
  keywordRule("FDA clinical", /\b(?:FDA|clinical trial|PDUFA|complete response letter|510\(k\)|premarket approval|Phase [123])\b/i, "fda_clinical", "medium"),
];

const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12",
};

export function parseSecOtherFiling(input: SecFormParserInput): SecFormParserOutput<SecOtherFilingFacts> {
  const metadata = readRecord(input.metadata) || {};
  const rawPayload = readRecord(input.rawPayload) || {};
  const formType = firstString(input.formType, rawPayload.form_type, metadata.form_type) || "Other SEC Filing";
  const accessionNumber = firstString(input.accessionNumber, rawPayload.accession_number, rawPayload.accessionNumber, metadata.accession_number);
  const issuerName = firstString(input.companyName, rawPayload.company_name, rawPayload.issuer, metadata.company_name, metadata.issuer);
  const ticker = firstString(input.ticker, rawPayload.ticker, rawPayload.primary_ticker, metadata.ticker);
  const cik = firstString(input.cik, rawPayload.cik, metadata.cik);
  const filedAt = firstString(input.filedAt, rawPayload.filed_at, rawPayload.published_at, metadata.filed_at);
  const documentTitle = firstString(input.title, rawPayload.title, metadata.title);
  const sourceUrl = firstString(input.sourceUrl, rawPayload.source_url, rawPayload.detail_url, rawPayload.filing_detail_url, metadata.source_url);
  const primaryDocumentText = compactText(input.primaryDocumentText);
  const attachmentTexts = (input.attachments || [])
    .map((attachment) => compactText(attachment.text))
    .filter(Boolean);
  const combinedText = compactText([documentTitle, primaryDocumentText, ...attachmentTexts].filter(Boolean).join("\n\n"));
  const parserGroup = findSecFormParserGroup(formType);
  const recognizedKeywords = findKeywordSignals(combinedText);
  const dateCandidates = findDateCandidates(combinedText);
  const valueCandidates = findValueCandidates(combinedText);
  const namedParties = findNamedParties(combinedText, issuerName);
  const reviewReasons = buildReviewReasons({
    combinedText,
    parserGroup,
    recognizedKeywords,
  });
  const facts: SecOtherFilingFacts = {
    parser_version: SEC_OTHER_PARSER_VERSION,
    raw_item_id: firstString(input.rawItemId, rawPayload.raw_item_id, metadata.raw_item_id),
    form_type: formType,
    accession_number: accessionNumber,
    issuer: {
      name: issuerName,
      ticker,
      cik,
    },
    filed_at: filedAt,
    document_title: documentTitle,
    source_url: sourceUrl,
    reason_not_dedicated: buildFallbackReason(formType, parserGroup),
    primary_document_text_stats: buildTextStats(primaryDocumentText),
    combined_text_stats: buildTextStats(combinedText),
    documents: summarizeDocuments(input),
    recognized_keywords: recognizedKeywords,
    date_candidates: dateCandidates,
    value_candidates: valueCandidates,
    named_parties: namedParties,
    text_excerpt: combinedText ? truncate(combinedText, 1_200) : null,
    extracted_field_count:
      [formType, accessionNumber, issuerName, ticker, cik, filedAt, documentTitle, sourceUrl].filter(Boolean).length +
      recognizedKeywords.length +
      dateCandidates.length +
      valueCandidates.length +
      namedParties.length,
    needs_human_review: reviewReasons.length > 0,
    review_reasons: reviewReasons,
  };
  const eventHints = unique(recognizedKeywords.map((signal) => signal.event_type_hint).filter((hint) => hint !== "other"));

  return {
    parserVersion: SEC_OTHER_PARSER_VERSION,
    parserGroup: "other",
    formType,
    accessionNumber,
    isSupported: true,
    summary: buildSummary(facts),
    facts,
    signals: ["fallback_other", ...eventHints.map((hint) => `candidate_event_type:${hint}`)],
    calendarItems: [],
    warnings: reviewReasons,
    raw: {
      keyword_count: recognizedKeywords.length,
      date_candidate_count: dateCandidates.length,
      value_candidate_count: valueCandidates.length,
      named_party_count: namedParties.length,
    },
  };
}

export const secOtherParser = parseSecOtherFiling;

function keywordRule(
  keyword: string,
  pattern: RegExp,
  eventTypeHint: SecOtherEventTypeHint,
  confidence: SecOtherKeywordSignal["confidence"],
): KeywordRule {
  return { keyword, pattern, eventTypeHint, confidence };
}

function findKeywordSignals(text: string): SecOtherKeywordSignal[] {
  if (!text) return [];
  const signals: SecOtherKeywordSignal[] = [];
  const seen = new Set<string>();

  for (const rule of KEYWORD_RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    const evidence = pickEvidenceSentence(text, match.index || 0);
    const key = `${rule.keyword}:${evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.push({
      keyword: rule.keyword,
      event_type_hint: rule.eventTypeHint,
      evidence,
      confidence: rule.confidence,
    });
  }

  return signals.slice(0, 16);
}

function findDateCandidates(text: string): SecOtherDateCandidate[] {
  if (!text) return [];
  const matches = [
    ...findPatternMatches(text, /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s+\d{4}\b/gi),
    ...findPatternMatches(text, /\b\d{4}-\d{2}-\d{2}\b/g),
    ...findPatternMatches(text, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g),
  ].sort((left, right) => left.index - right.index);
  const candidates: SecOtherDateCandidate[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const dateText = match.value.trim();
    const key = dateText.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const evidence = pickEvidenceSentence(text, match.index);
    candidates.push({
      date_text: dateText,
      normalized_date: normalizeDateText(dateText),
      role: classifyDateRole(evidence),
      evidence,
      confidence: "medium",
    });
    if (candidates.length >= 12) break;
  }

  return candidates;
}

function findValueCandidates(text: string): SecOtherValueCandidate[] {
  if (!text) return [];
  const candidates: SecOtherValueCandidate[] = [];
  const spans: MatchSpan[] = [];
  const seen = new Set<string>();

  collectValueCandidates({
    candidates,
    confidence: "medium",
    kind: "price",
    pattern: /\$\s*\d[\d,]*(?:\.\d+)?\s*(?:per share|\/share|per unit|per ADS|per warrant)\b/gi,
    seen,
    spans,
    text,
  });
  collectValueCandidates({
    candidates,
    confidence: "medium",
    kind: "shares",
    pattern: /\b\d[\d,]*(?:\.\d+)?\s*(?:thousand|million|billion|m|bn)?\s+(?:shares?|common shares?|ordinary shares?|ADSs?|warrants?|units?)\b/gi,
    seen,
    spans,
    text,
  });
  collectValueCandidates({
    candidates,
    confidence: "low",
    kind: "money",
    pattern: /\$\s*\d[\d,]*(?:\.\d+)?\s*(?:thousand|million|billion|m|bn)?\b/gi,
    seen,
    spans,
    text,
  });
  collectValueCandidates({
    candidates,
    confidence: "low",
    kind: "percent",
    pattern: /\b\d+(?:\.\d+)?%\b/g,
    seen,
    spans,
    text,
  });

  return candidates.slice(0, 16);
}

function collectValueCandidates({
  candidates,
  confidence,
  kind,
  pattern,
  seen,
  spans,
  text,
}: {
  candidates: SecOtherValueCandidate[];
  confidence: SecOtherValueCandidate["confidence"];
  kind: SecOtherValueKind;
  pattern: RegExp;
  seen: Set<string>;
  spans: MatchSpan[];
  text: string;
}) {
  for (const match of text.matchAll(pattern)) {
    const valueText = match[0].trim();
    const start = match.index || 0;
    const end = start + valueText.length;
    if (spans.some((span) => start >= span.start && end <= span.end)) continue;
    const evidence = pickEvidenceSentence(text, start);
    const key = `${kind}:${valueText}:${evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    spans.push({ start, end });
    candidates.push(buildValueCandidate(kind, valueText, evidence, confidence));
    if (candidates.length >= 16) break;
  }
}

function buildValueCandidate(
  kind: SecOtherValueKind,
  text: string,
  evidence: string,
  confidence: SecOtherValueCandidate["confidence"],
): SecOtherValueCandidate {
  const numeric = normalizeNumberWithScale(text);
  const isUsd = text.includes("$");
  const unit =
    kind === "price"
      ? "usd_per_share"
      : kind === "money"
        ? "usd"
        : kind === "shares"
          ? "shares"
          : kind === "percent"
            ? "percent"
            : "number";

  return {
    kind,
    text,
    numeric_value: numeric.value,
    currency: isUsd ? "USD" : null,
    unit,
    scale: numeric.scale,
    evidence,
    confidence,
  };
}

function findNamedParties(text: string, issuerName: string | null): SecOtherNamedParty[] {
  const parties: SecOtherNamedParty[] = [];
  const seen = new Set<string>();

  if (issuerName) {
    parties.push({
      value: issuerName,
      evidence: "Issuer name supplied by SEC filing metadata.",
      confidence: "high",
      role: "issuer",
    });
    seen.add(issuerName.toLowerCase());
  }

  if (!text) return parties;
  const partyPattern =
    /\b([A-Z][A-Za-z0-9&.'-]*(?:\s+[A-Z][A-Za-z0-9&.'-]*){0,7}\s+(?:Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Ltd\.?|Limited|plc|PLC|LLC|L\.L\.C\.|LP|L\.P\.|LLP|N\.A\.|Bank|Securities|Capital|Partners|Advisors|Advisory|Holdings|Group|Trust|Fund))\b/g;

  for (const match of text.matchAll(partyPattern)) {
    const value = compactText(match[1]);
    if (!value || seen.has(value.toLowerCase())) continue;
    const evidence = pickEvidenceSentence(text, match.index || 0);
    seen.add(value.toLowerCase());
    parties.push({
      value,
      evidence,
      confidence: "low",
      role: classifyPartyRole(evidence),
    });
    if (parties.length >= 12) break;
  }

  return parties;
}

function classifyPartyRole(evidence: string): SecOtherNamedParty["role"] {
  if (/\b(?:placement agent|sales agent|underwriter|advisor|adviser)\b/i.test(evidence)) return "agent_candidate";
  if (/\b(?:agreement with|entered into with|between|counterparty|purchaser|seller|acquiror|target)\b/i.test(evidence)) {
    return "counterparty_candidate";
  }
  return "mentioned_party";
}

function summarizeDocuments(input: SecFormParserInput): SecOtherDocumentSummary[] {
  return (input.attachments || []).slice(0, 20).map((attachment) => ({
    type: nullableString(attachment.type),
    description: nullableString(attachment.description),
    filename: nullableString(attachment.filename),
    url_present: Boolean(nullableString(attachment.url)),
    text_char_count: stringValue(attachment.text).length,
  }));
}

function buildFallbackReason(
  formType: string,
  parserGroup: ReturnType<typeof findSecFormParserGroup>,
): SecOtherFilingFacts["reason_not_dedicated"] {
  if (parserGroup === "other") {
    return {
      value: "explicit_other_sec_filing_fallback",
      evidence: `Form type "${formType}" maps to the other fallback parser group.`,
      confidence: "high",
    };
  }
  if (parserGroup) {
    return {
      value: `dedicated_group_detected:${parserGroup}`,
      evidence: `Form type "${formType}" normally maps to parser group "${parserGroup}", so integration should verify why this fallback was used.`,
      confidence: "medium",
    };
  }
  return {
    value: "form_type_not_registered_to_dedicated_parser",
    evidence: `Form type "${formType}" is not currently mapped to a dedicated parser group.`,
    confidence: normalizeSecFormType(formType) ? "high" : "low",
  };
}

function buildReviewReasons({
  combinedText,
  parserGroup,
  recognizedKeywords,
}: {
  combinedText: string;
  parserGroup: ReturnType<typeof findSecFormParserGroup>;
  recognizedKeywords: SecOtherKeywordSignal[];
}) {
  const reasons: string[] = [];
  if (!combinedText) reasons.push("no_text_available");
  if (parserGroup && parserGroup !== "other") reasons.push(`dedicated_parser_group_detected:${parserGroup}`);
  const eventHints = unique(recognizedKeywords.map((signal) => signal.event_type_hint).filter((hint) => hint !== "other"));
  if (eventHints.length > 1) reasons.push("multiple_event_type_hints");
  return reasons;
}

function buildSummary(facts: SecOtherFilingFacts) {
  const issuer = facts.issuer.name || facts.issuer.ticker || "SEC filing";
  const hints = unique(facts.recognized_keywords.map((signal) => signal.event_type_hint).filter((hint) => hint !== "other"));
  if (!facts.combined_text_stats.has_text) return `${issuer} fallback parser found no filing text to extract.`;
  if (hints.length) return `${issuer} fallback parser found candidate ${hints.join(", ")} evidence.`;
  return `${issuer} fallback parser extracted generic SEC filing facts with no strong canonical event signal.`;
}

function buildTextStats(text: string): SecOtherTextStats {
  return {
    char_count: text.length,
    word_count: text ? text.split(/\s+/).filter(Boolean).length : 0,
    line_count: text ? text.split("\n").length : 0,
    has_text: Boolean(text),
    text_truncated: /\[TRUNCATED\]|\.\.\.$/.test(text),
  };
}

function classifyDateRole(evidence: string): SecOtherDateRole {
  if (/\b(?:deadline|expires?|expiration|redemption|rights deadline|tender deadline|must|until|by no later than)\b/i.test(evidence)) {
    return "deadline";
  }
  if (/\b(?:effective date|becomes effective|became effective|effectiveness)\b/i.test(evidence)) return "effective_date";
  if (/\b(?:annual meeting|special meeting|shareholder meeting|stockholder meeting)\b/i.test(evidence)) return "meeting_date";
  if (/\brecord date\b/i.test(evidence)) return "record_date";
  if (/\b(?:closing date|expected to close|closed on|closing is expected)\b/i.test(evidence)) return "closing_date";
  if (/\b(?:filed on|filing date|filed with)\b/i.test(evidence)) return "filed_date";
  return "event_date";
}

function normalizeDateText(value: string) {
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return validDateParts(iso[1], iso[2], iso[3]);

  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
    return validDateParts(year, slash[1], slash[2]);
  }

  const monthName = text.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4})$/);
  if (monthName) {
    const month = MONTHS[monthName[1].toLowerCase()];
    if (!month) return null;
    return validDateParts(monthName[3], month, monthName[2]);
  }

  return null;
}

function validDateParts(yearText: string, monthText: string, dayText: string) {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeNumberWithScale(value: string): { value: number | null; scale: SecOtherValueCandidate["scale"] } {
  const match = value.match(/(\d[\d,]*(?:\.\d+)?)/);
  if (!match) return { value: null, scale: null };
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return { value: null, scale: null };
  const scale = readScale(value);
  const multiplier = scale === "billion" ? 1_000_000_000 : scale === "million" ? 1_000_000 : scale === "thousand" ? 1_000 : 1;
  return { value: base * multiplier, scale };
}

function readScale(value: string): SecOtherValueCandidate["scale"] {
  if (/\bb(?:illion|n)?\b/i.test(value)) return "billion";
  if (/\bm(?:illion)?\b/i.test(value)) return "million";
  if (/\b(?:thousand|k)\b/i.test(value)) return "thousand";
  return "raw";
}

function findPatternMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].map((match) => ({
    value: match[0],
    index: match.index || 0,
  }));
}

function pickEvidenceSentence(text: string, index: number) {
  const start = Math.max(0, text.lastIndexOf(".", index - 1), text.lastIndexOf("\n", index - 1));
  let end = text.indexOf(".", index + 1);
  if (end >= 0 && end - index < 80) {
    const nextEnd = text.indexOf(".", end + 1);
    if (nextEnd >= 0) end = nextEnd;
  }
  if (end < 0) end = Math.min(text.length, index + 360);
  else end += 1;
  return truncate(compactText(text.slice(start > 0 ? start + 1 : start, end)), 420);
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = nullableString(value);
    if (text) return text;
  }
  return null;
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function compactText(value: unknown) {
  return stringValue(value)
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function truncate(value: string, max: number) {
  const text = compactText(value);
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
