import { normalizeCalendarEventType } from "@/lib/calendarEventRegistry";
import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  buildSecPeriodicReportsAnalysisPromptDraft,
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY,
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION,
} from "@/lib/sources/sec/forms/periodic-reports/analysisPrompt";
import { buildSecPeriodicReportsDisplayPayload } from "@/lib/sources/sec/forms/periodic-reports/displayPayload";
import {
  APPROVED_SEC_EVENT_TYPES,
  type PeriodicParserOutput,
} from "@/lib/sources/sec/forms/periodic-reports/types";

export {
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY,
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION,
};

export type SecPeriodicReportsAnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isSecPeriodicReportsFilingInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSecPeriodicReportsParserOutput(input);
  return Boolean(parserOutput && parserOutput.isSupported !== false);
}

export function buildSecPeriodicReportsAnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSecPeriodicReportsParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC periodic-reports parser output is missing from filing package");
  }

  const filingPackage = readRecord(input.filing_package) || {};
  return buildSecPeriodicReportsAnalysisPromptDraft({
    filing_package: filingPackage,
    parser_output: parserOutput,
    filing_excerpt: stringValue(filingPackage.llm_text) || null,
    market_context: readRecord(filingPackage.market_context),
    parent_filing_context: readRecord(filingPackage.parent_filing_context),
  });
}

export function adaptSecPeriodicReportsAnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecPeriodicReportsAnalysisAdapterResult {
  const root = readRecord(value);
  if (!root) {
    return { ok: false, error: "SEC periodic-reports analysis response did not contain a JSON object" };
  }

  const parserOutput = readSecPeriodicReportsParserOutput(input);
  if (!parserOutput) {
    return { ok: false, error: "SEC periodic-reports parser output is missing from filing package" };
  }

  const parserTicker = parserOutput.facts.primaryTicker;
  const parserExchange = parserOutput.facts.exchange;
  const suppliedPrimaryTicker = readRecord(root.primary_ticker);
  const primaryTicker = {
    ticker: nullableString(suppliedPrimaryTicker?.ticker) || parserTicker || null,
    exchange: nullableString(suppliedPrimaryTicker?.exchange) || parserExchange || null,
  };
  const score = clampScore(root.score);
  const eventType = normalizeEventType(root.event_type);
  const displayPayload = buildSecPeriodicReportsDisplayPayload({ parser_output: parserOutput });

  return {
    ok: true,
    analysis: {
      ...root,
      source_group: "filings",
      market_scope: normalizeMarketScope(root.market_scope),
      event_type: eventType,
      primary_ticker: primaryTicker,
      tickers: normalizeTickerRows(root.tickers, primaryTicker, "primary"),
      score,
      signal: normalizeSignal(root.signal),
      bullish_points: stringArray(root.bullish_points),
      bearish_points: stringArray(root.bearish_points),
      key_evidence: stringArray(root.key_evidence).slice(0, 3),
      what_to_watch_next: stringArray(root.what_to_watch_next).slice(0, 3),
      related_tickers: normalizeTickerRows(root.related_tickers, primaryTicker, "related"),
      calendar_items: normalizeCalendarItems(root.calendar_items),
      confidence: normalizeConfidence(root.confidence),
      needs_human_review: root.needs_human_review === true,
      archive_summary: score < 50 ? nullableString(root.summary) || nullableString(root.quick_take) : null,
      display_payload: displayPayload,
      periodic_reports_source_bundle: summarizePromptSourceBundle(input),
    },
  };
}

export function readSecPeriodicReportsParserOutput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  const parserOutput = readRecord(hardParsers?.["periodic-reports"]);
  return parserOutput as unknown as PeriodicParserOutput | null;
}

function normalizeTickerRows(
  value: unknown,
  primaryTicker: { ticker: string | null; exchange: string | null },
  role: "primary" | "related",
) {
  const rows = Array.isArray(value) ? value : [];
  const normalized: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();

  for (const item of rows) {
    const record = readRecord(item);
    const ticker = (nullableString(record?.ticker) || nullableString(item))?.toUpperCase() || null;
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    normalized.push({
      ticker,
      exchange: nullableString(record?.exchange) || (ticker === primaryTicker.ticker ? primaryTicker.exchange : null),
      role,
      reason: role === "related" ? nullableString(record?.reason) : null,
    });
  }

  if (role === "primary" && primaryTicker.ticker && !seen.has(primaryTicker.ticker)) {
    normalized.unshift({
      ticker: primaryTicker.ticker,
      exchange: primaryTicker.exchange,
      role: "primary",
      reason: null,
    });
  }

  return normalized;
}

function normalizeCalendarItems(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  return rows
    .map((item) => {
      const record = readRecord(item);
      if (!record) return null;
      if (record.calendar_event_type) return record;

      const date = normalizeIsoDate(record.date);
      if (!date) return null;
      const itemType = stringValue(record.item_type);
      return {
        calendar_event_type: normalizePeriodicCalendarEventType(itemType),
        calendar_title: nullableString(record.description) || itemType || "Periodic report event",
        event_date: date,
        event_time: null,
        event_timezone: null,
        date_precision: "exact",
        estimated_start_date: null,
        estimated_end_date: null,
        is_estimated: false,
        confidence: "high",
        evidence: nullableString(record.evidence),
      };
    })
    .filter((item): item is Record<string, unknown> => Boolean(item));
}

function normalizePeriodicCalendarEventType(value: string) {
  if (value === "dividend_payable_date") return "dividend_payment_date";
  return normalizeCalendarEventType(value);
}

function normalizeIsoDate(value: unknown) {
  const text = stringValue(value);
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function summarizePromptSourceBundle(input: SecFilingAnalysisInput) {
  try {
    const prompt = buildSecPeriodicReportsAnalysisPromptForInput(input);
    const payload = JSON.parse(prompt.user) as Record<string, unknown>;
    return readRecord(payload.source_bundle);
  } catch {
    return null;
  }
}

function normalizeEventType(value: unknown) {
  const eventType = stringValue(value).toLowerCase();
  return APPROVED_SEC_EVENT_TYPES.includes(eventType as (typeof APPROVED_SEC_EVENT_TYPES)[number])
    ? eventType
    : "other";
}

function normalizeMarketScope(value: unknown) {
  const marketScope = stringValue(value).toLowerCase();
  return ["company", "sector", "theme", "macro"].includes(marketScope) ? marketScope : "company";
}

function normalizeSignal(value: unknown) {
  const signal = stringValue(value).toLowerCase();
  return ["bullish", "bearish", "volatile", "neutral"].includes(signal) ? signal : "neutral";
}

function normalizeConfidence(value: unknown) {
  const confidence = stringValue(value).toLowerCase();
  return ["high", "medium", "low"].includes(confidence) ? confidence : "medium";
}

function clampScore(value: unknown) {
  const score = typeof value === "number" ? value : Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => stringValue(item)).filter(Boolean)
    : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  return stringValue(value) || null;
}
