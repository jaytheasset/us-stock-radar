import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import { buildS4F4AnalysisPrompt } from "@/lib/sources/sec/forms/s4-f4/analysisPrompt";
import type { ParserOutput } from "@/lib/sources/sec/forms/s4-f4/types";

export const SEC_S4_F4_ANALYSIS_PROMPT_KEY = "sec_s4_f4_analysis";
export const SEC_S4_F4_ANALYSIS_PROMPT_VERSION = "v1";

export type SecS4F4AnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isS4F4FilingInput(input: SecFilingAnalysisInput) {
  return Boolean(readS4F4ParserOutput(input));
}

export function buildSecS4F4AnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = readS4F4ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC S-4/F-4 parser output is missing from filing package");
  }

  const parentFilingContext = readParentFilingContext(input);

  return {
    key: SEC_S4_F4_ANALYSIS_PROMPT_KEY,
    version: SEC_S4_F4_ANALYSIS_PROMPT_VERSION,
    system: [
      "Analyze one SEC S-4/F-4 filing from cleaned source blocks.",
      "Return the full Required Output JSON shape.",
      "Use display_payload.display_type=generic for the common filing detail page.",
      "Do not use spac_transaction_status for S-4/F-4 runtime output.",
      "Score means investor attention and urgency. Delivery is derived later from score only.",
    ].join("\n"),
    user: buildS4F4AnalysisPrompt(parserOutput, undefined, readMarketContext(input), null, parentFilingContext),
    responseFormat: {
      json_schema: {
        name: "sec_s4_f4_required_output",
        strict: false,
        schema: s4F4RequiredOutputSchema,
      },
    },
  };
}

export function adaptSecS4F4AnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecS4F4AnalysisAdapterResult {
  const parserOutput = readS4F4ParserOutput(input);
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = readRecord(root?.display_payload);
  if (!parserOutput || !analysisOutput || !displayPayload) {
    return {
      ok: false,
      error: "SEC S-4/F-4 result did not contain parser_output, analysis_output, and LLM display_payload",
    };
  }

  const requiredOutput = {
    parser_output: parserOutput,
    analysis_output: normalizeS4F4AnalysisOutput(analysisOutput, input),
    display_payload: displayPayload,
  };
  const adapted = adaptSecFormRoomOutputForIngest(requiredOutput);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC S-4/F-4 Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: s4F4AdapterOutputToAnalysis(adapted.value),
  };
}

function s4F4AdapterOutputToAnalysis(value: SecFormRoomAdapterOutput) {
  const score = clampScore(numberValue(value.analysis_output.score) ?? 0);
  const archiveSummary =
    nullableString(value.analysis_output.archive_summary) ||
    (score < 50 ? nullableString(value.analysis_output.summary) : null);

  return {
    ...value.analysis_output,
    score,
    archive_summary: archiveSummary,
    display_payload: value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
    sec_s4_f4_analysis_mode: "analysis_only",
  };
}

function normalizeS4F4AnalysisOutput(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const primaryTicker = normalizePrimaryTicker(readRecord(value.primary_ticker), filingPackage);

  return {
    ...value,
    source_group: stringValue(value.source_group) || "filings",
    market_scope: stringValue(value.market_scope) || "company",
    primary_ticker: primaryTicker,
    tickers: normalizeTickerRows(value.tickers, primaryTicker, "primary"),
    related_tickers: normalizeTickerRows(value.related_tickers, primaryTicker, "related"),
    bullish_points: readStringArray(value.bullish_points),
    bearish_points: readStringArray(value.bearish_points),
    key_evidence: readStringArray(value.key_evidence),
    what_to_watch_next: readStringArray(value.what_to_watch_next),
    calendar_items: Array.isArray(value.calendar_items) ? value.calendar_items : [],
    confidence: normalizeConfidence(stringValue(value.confidence)),
    needs_human_review: value.needs_human_review === true,
  };
}

function normalizeTickerRows(value: unknown, primaryTicker: { ticker: string | null; exchange: string | null }, role: string) {
  const rows = Array.isArray(value) ? value : [];
  const normalized: Array<Record<string, unknown>> = [];
  for (const item of rows) {
    const record = readRecord(item);
    const ticker = stringValue(record?.ticker) || stringValue(item);
    if (!ticker) continue;
    normalized.push({
      ticker,
      exchange: stringValue(record?.exchange) || (ticker === primaryTicker.ticker ? primaryTicker.exchange : null),
      role: stringValue(record?.role) || role,
      reason: stringValue(record?.reason) || null,
    });
  }

  if (role === "primary" && primaryTicker.ticker && !normalized.some((item) => item.ticker === primaryTicker.ticker)) {
    normalized.unshift({
      ticker: primaryTicker.ticker,
      exchange: primaryTicker.exchange,
      role: "primary",
      reason: "Primary SEC filing ticker",
    });
  }

  return normalized;
}

function normalizePrimaryTicker(record: Record<string, unknown> | null, filingPackage: Record<string, unknown>) {
  const packagePrimary = readRecord(filingPackage.primary_ticker);
  const ticker = nullableString(record?.ticker) || nullableString(packagePrimary?.ticker) || nullableString(filingPackage.ticker);
  const exchange = nullableString(record?.exchange) || nullableString(packagePrimary?.exchange);
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    exchange,
  };
}

function readS4F4ParserOutput(input: SecFilingAnalysisInput): ParserOutput | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return (readRecord(hardParsers?.s4_f4) || readRecord(hardParsers?.["s4-f4"])) as ParserOutput | null;
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function readMarketContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.market_context);
}

function readParentFilingContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.parent_filing_context);
}

function normalizeConfidence(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "medium";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
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

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const s4F4RequiredOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["analysis_output", "display_payload"],
  properties: {
    parser_output: { type: "object", additionalProperties: true },
    analysis_output: { type: "object", additionalProperties: true },
    display_payload: { type: "object", additionalProperties: true },
  },
};
