import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import { buildS1F1AnalysisPrompt } from "@/lib/sources/sec/forms/s1-f1/analysisPrompt";
import { APPROVED_SEC_EVENT_TYPES, type S1F1ParserOutput } from "@/lib/sources/sec/forms/s1-f1/types";
import { normalize424bOfferingDisplayModel } from "@/lib/ai/sec424bAnalysisAdapter";

export const SEC_S1_F1_ANALYSIS_PROMPT_KEY = "sec_s1_f1_analysis";
export const SEC_S1_F1_ANALYSIS_PROMPT_VERSION = "v1";

const ALLOWED_S1_F1_DISPLAY_MODES = new Set([
  "ipo_registration",
  "ipo_amendment",
  "resale_registration",
  "mixed_registration",
  "spac_ipo",
  "rule_462b_mef",
  "post_effective_amendment",
  "generic",
]);

export type SecS1F1AnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isS1F1FilingInput(input: SecFilingAnalysisInput) {
  return Boolean(readS1F1ParserOutput(input));
}

export function buildSecS1F1AnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = readS1F1ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC S-1/F-1 parser output is missing from filing package");
  }

  return {
    key: SEC_S1_F1_ANALYSIS_PROMPT_KEY,
    version: SEC_S1_F1_ANALYSIS_PROMPT_VERSION,
    system: [
      "Analyze one SEC S-1/F-1 registration filing from cleaned source blocks.",
      "Return the full Required Output JSON shape.",
      "There is no S-1/F-1 router LLM and no parser-completed display payload. Choose event_type, display_type, score, and display_payload from the source blocks.",
      "Use generic for the common filing detail page, offering_terms for IPO/offering/resale/MEF/POS AM registration terms, and spac_transaction_status only for source-backed de-SPAC status.",
      "Score means investor attention and urgency. Delivery is derived later from score only.",
    ].join("\n"),
    user: buildS1F1AnalysisPrompt(parserOutput),
    responseFormat: {
      json_schema: {
        name: "sec_s1_f1_required_output",
        strict: false,
        schema: secS1F1RequiredOutputSchema,
      },
    },
  };
}

export function adaptSecS1F1AnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecS1F1AnalysisAdapterResult {
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = readRecord(root?.display_payload);
  if (!analysisOutput || !displayPayload) {
    return {
      ok: false,
      error: "SEC S-1/F-1 result did not contain analysis_output and display_payload",
    };
  }

  const displayPayloadError = validateS1F1DisplayPayload(displayPayload);
  if (displayPayloadError) {
    return {
      ok: false,
      error: displayPayloadError,
    };
  }

  const normalizedValue = {
    ...root,
    parser_output: normalizeS1F1ParserOutput(root?.parser_output, input),
    analysis_output: normalizeS1F1AnalysisOutput(analysisOutput, input),
    display_payload: displayPayload,
  };
  const adapted = adaptSecFormRoomOutputForIngest(normalizedValue);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC S-1/F-1 Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: adapterOutputToAnalysis(adapted.value),
  };
}

function validateS1F1DisplayPayload(displayPayload: Record<string, unknown>) {
  const displayType = stringValue(displayPayload.display_type);
  if (!["generic", "offering_terms", "candidate_special", "spac_transaction_status"].includes(displayType)) {
    return `SEC S-1/F-1 display_payload.display_type is not allowed: ${displayType || "(empty)"}`;
  }
  if (displayType !== "offering_terms") return "";

  const data = readRecord(displayPayload.data);
  if (!data || !Object.keys(data).length) {
    return "SEC S-1/F-1 offering_terms display_payload.data must be filled by the analysis LLM";
  }
  const displayMode = stringValue(data.display_mode);
  if (displayMode && !ALLOWED_S1_F1_DISPLAY_MODES.has(displayMode)) {
    return `SEC S-1/F-1 offering_terms display_payload.data.display_mode is not allowed: ${displayMode}`;
  }
  if (!displayMode) {
    return "SEC S-1/F-1 offering_terms display_payload.data.display_mode must be written by the analysis LLM";
  }
  return "";
}

function adapterOutputToAnalysis(value: SecFormRoomAdapterOutput) {
  const score = clampScore(numberValue(value.analysis_output.score) ?? 0);
  const displayPayload = readRecord(value.metadata.display_payload);
  const displayPayloadData = readRecord(displayPayload?.data);
  const offeringDisplayModel =
    stringValue(displayPayload?.display_type) === "offering_terms"
      ? normalize424bOfferingDisplayModel(displayPayloadData)
      : readRecord(value.analysis_output.offering_display_model);

  return {
    ...value.analysis_output,
    score,
    archive_summary:
      nullableString(value.analysis_output.archive_summary) ||
      (score < 50 ? nullableString(value.analysis_output.summary) : null),
    display_payload: value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
    offering_display_model: offeringDisplayModel,
    sec_s1_f1_analysis_mode: "analysis_only",
    sec_offering_analysis_mode: "analysis_only",
  };
}

function normalizeS1F1ParserOutput(value: unknown, input: SecFilingAnalysisInput) {
  const parser = readRecord(value) || {};
  const fallback = readS1F1ParserOutput(input);
  const filingPackage = readFilingPackage(input);
  return {
    ...fallback,
    ...parser,
    parserVersion: stringValue(parser.parserVersion) || fallback?.parserVersion || "s1-f1-parser-v1",
    parserGroup: stringValue(parser.parserGroup) || fallback?.parserGroup || "s1-f1",
    formType: stringValue(parser.formType) || fallback?.formType || "S-1 / F-1, S-1/A / F-1/A",
    accessionNumber:
      stringValue(parser.accessionNumber) ||
      fallback?.accessionNumber ||
      stringValue(filingPackage.accession_number) ||
      null,
    isSupported: typeof parser.isSupported === "boolean" ? parser.isSupported : fallback?.isSupported !== false,
    facts: readRecord(parser.facts) || readRecord(fallback?.facts) || {},
    signals: Array.isArray(parser.signals) ? parser.signals : Array.isArray(fallback?.signals) ? fallback?.signals : [],
    calendarItems: Array.isArray(parser.calendarItems)
      ? parser.calendarItems
      : Array.isArray(fallback?.calendarItems)
        ? fallback?.calendarItems
        : [],
    warnings: Array.isArray(parser.warnings) ? parser.warnings : Array.isArray(fallback?.warnings) ? fallback?.warnings : [],
    raw: readRecord(parser.raw) || readRecord(fallback?.raw) || {},
  };
}

function normalizeS1F1AnalysisOutput(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const primaryTicker = normalizePrimaryTicker(readRecord(value.primary_ticker), filingPackage);
  return {
    ...value,
    source_group: "filings",
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

function readS1F1ParserOutput(input: SecFilingAnalysisInput): S1F1ParserOutput | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return (readRecord(hardParsers?.["s1-f1"]) || readRecord(hardParsers?.s1_f1)) as S1F1ParserOutput | null;
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
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

export const secS1F1RequiredOutputSchema = {
  type: "object",
  additionalProperties: true,
  required: ["analysis_output", "display_payload"],
  properties: {
    parser_output: { type: "object", additionalProperties: true },
    analysis_output: {
      type: "object",
      additionalProperties: true,
      required: [
        "source_group",
        "market_scope",
        "event_type",
        "event_title",
        "primary_ticker",
        "tickers",
        "sector",
        "industry_group",
        "theme_group",
        "sub_theme",
        "score",
        "score_reason",
        "signal",
        "quick_take",
        "summary",
        "why_it_matters",
        "bullish_points",
        "bearish_points",
        "key_evidence",
        "what_to_watch_next",
        "related_tickers",
        "calendar_items",
        "confidence",
        "needs_human_review",
      ],
      properties: {
        source_group: { type: "string", enum: ["filings"] },
        market_scope: { type: "string", enum: ["company", "sector", "theme", "macro"] },
        event_type: { type: "string", enum: APPROVED_SEC_EVENT_TYPES },
        event_title: { type: "string" },
        primary_ticker: {
          type: ["object", "null"],
          additionalProperties: true,
          properties: {
            ticker: { type: ["string", "null"] },
            exchange: { type: ["string", "null"] },
          },
        },
        tickers: { type: "array", items: { type: ["object", "string"], additionalProperties: true } },
        sector: { type: ["string", "null"] },
        industry_group: { type: ["string", "null"] },
        theme_group: { type: ["string", "null"] },
        sub_theme: { type: ["string", "null"] },
        score: { type: "integer", minimum: 0, maximum: 100 },
        score_reason: { type: "string" },
        signal: { type: "string", enum: ["bullish", "bearish", "volatile", "neutral"] },
        quick_take: { type: "string" },
        summary: { type: "string" },
        why_it_matters: { type: "string" },
        bullish_points: { type: "array", items: { type: "string" } },
        bearish_points: { type: "array", items: { type: "string" } },
        key_evidence: { type: "array", items: { type: "string" } },
        what_to_watch_next: { type: "array", items: { type: "string" } },
        related_tickers: { type: "array", items: { type: ["object", "string"], additionalProperties: true } },
        calendar_items: { type: "array", items: { type: "object", additionalProperties: true } },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        needs_human_review: { type: "boolean" },
        archive_summary: { type: ["string", "null"] },
      },
    },
    display_payload: {
      type: "object",
      additionalProperties: true,
      required: ["display_type", "display_version", "data", "evidence", "notes"],
      properties: {
        display_type: {
          type: "string",
          enum: ["generic", "offering_terms", "candidate_special", "spac_transaction_status"],
        },
        display_version: { type: "string" },
        data: {
          type: "object",
          additionalProperties: true,
          properties: {
            display_mode: { type: ["string", "null"], enum: [...ALLOWED_S1_F1_DISPLAY_MODES, null] },
            ipo_kind: { type: ["string", "null"] },
            snapshot_metrics: { type: "array", items: { type: "object", additionalProperties: true } },
            investor_takeaway: { type: ["string", "null"] },
            narrative_summary: { type: ["string", "null"] },
            offering_details: { type: "array", items: { type: "object", additionalProperties: true } },
            amendment_changes: { type: "array", items: { type: "object", additionalProperties: true } },
            source_notes: { type: "array", items: { type: "string" } },
            needs_human_review: { type: "boolean" },
            review_reasons: { type: "array", items: { type: "string" } },
          },
        },
        evidence: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;
