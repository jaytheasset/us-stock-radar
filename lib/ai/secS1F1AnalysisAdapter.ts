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
  "routine_amendment",
  "resale_registration",
  "atm",
  "primary_offering",
  "registered_direct",
  "warrant_convertible",
  "rights_offering",
  "shelf_capacity",
  "mixed_offering",
  "mixed_registration",
  "spac_ipo",
  "rule_462b_mef",
  "post_effective_amendment",
  "generic",
]);

const ALLOWED_S1_F1_SNAPSHOT_LABELS = [
  "Filing stage",
  "Terms status",
  "Proposed exchange / ticker",
  "Underwriters",
  "Shares / ADS offered",
  "Shares offered",
  "Price range",
  "Gross proceeds",
  "Offering size",
  "Exchange / ticker",
  "Proposed exchange",
  "Updated shares / ADS",
  "Updated price range",
  "Updated offering size",
  "Key change",
  "Resale shares",
  "Overhang vs outstanding",
  "Company proceeds",
  "Selling holders",
  "Program size",
  "Market cap",
  "Size vs market cap",
  "Sale method",
  "New shares",
  "Offer price",
  "Dilution vs current shares",
  "Underlying shares",
  "Exercise / conversion price",
  "Rights offered",
  "Subscription price",
  "Record date",
  "Subscription period",
  "Shelf capacity",
  "Capacity vs market cap",
  "Sale status",
  "Source instrument",
  "Primary component",
  "Resale component",
  "Warrant/convertible component",
  "Main risk",
  "Units offered",
  "Unit price",
  "Trust amount",
  "Warrant / right terms",
  "Additional shares / ADS",
  "Total registered pool",
  "Additional offering value",
  "Rule 462(b) limit",
  "Amendment type",
  "Securities affected",
  "Registration status",
  "New sale / proceeds",
] as const;

export type SecS1F1AnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isS1F1FilingInput(input: SecFilingAnalysisInput) {
  return Boolean(readS1F1ParserOutput(input));
}

export function buildSecS1F1AnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = withRuntimeMarketContext(readS1F1ParserOutput(input), input);
  if (!parserOutput) {
    throw new Error("SEC S-1/F-1 parser output is missing from filing package");
  }

  return {
    key: SEC_S1_F1_ANALYSIS_PROMPT_KEY,
    version: SEC_S1_F1_ANALYSIS_PROMPT_VERSION,
    system: [
      "Analyze one SEC S-1/F-1 registration filing from cleaned source blocks.",
      "Return the Required Output JSON shape with one primary display_payload.data.display_mode.",
      "There is no S-1/F-1 router LLM and no parser-completed display payload. Choose event_type, display_type, score, and display_payload from the source blocks.",
      "For offering_terms, generic analysis fields are storage/list compatibility only and must match the selected display payload.",
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

function withRuntimeMarketContext(parserOutput: S1F1ParserOutput | null, input: SecFilingAnalysisInput) {
  if (!parserOutput) return null;
  const filingPackage = readFilingPackage(input);
  const marketContext = readRecord(filingPackage.market_context);
  if (!marketContext || !Object.keys(marketContext).length) return parserOutput;
  return {
    ...parserOutput,
    raw: {
      ...parserOutput.raw,
      marketContext,
    },
  };
}

export function adaptSecS1F1AnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecS1F1AnalysisAdapterResult {
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = normalizeS1F1DisplayPayload(readRecord(root?.display_payload));
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
    analysis_output: alignS1F1AnalysisOutputToDisplayPayload(
      normalizeS1F1AnalysisOutput(analysisOutput, input),
      displayPayload,
    ),
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
  const amendmentSummaryMode = displayMode === "post_effective_amendment" || displayMode === "routine_amendment";
  const snapshotMetricsMayBeEmpty = amendmentSummaryMode;
  if (!Array.isArray(data.snapshot_metrics) || (!snapshotMetricsMayBeEmpty && !data.snapshot_metrics.length)) {
    return "SEC S-1/F-1 offering_terms display_payload.data.snapshot_metrics must be written by the analysis LLM";
  }
  const offeringDetailsMayBeEmpty = displayMode === "ipo_registration" || amendmentSummaryMode;
  if (!Array.isArray(data.offering_details) || (!offeringDetailsMayBeEmpty && !data.offering_details.length)) {
    return "SEC S-1/F-1 offering_terms display_payload.data.offering_details must be written by the analysis LLM";
  }
  if (!stringValue(data.investor_takeaway)) {
    return "SEC S-1/F-1 offering_terms display_payload.data.investor_takeaway must be written by the analysis LLM";
  }
  if (!stringValue(data.narrative_summary)) {
    return "SEC S-1/F-1 offering_terms display_payload.data.narrative_summary must be written by the analysis LLM";
  }
  appendS1F1DisplayWarnings(
    data,
    collectLabelValueRowWarnings(data.offering_details, "offering_details", {
      maxValueLength: 90,
      maxNoteLength: 80,
    }),
  );
  const rowError =
    validateLabelValueRows(data.snapshot_metrics, "snapshot_metrics", {
      allowEmpty: snapshotMetricsMayBeEmpty,
    }) ||
    validateLabelValueRows(data.offering_details, "offering_details", {
      allowEmpty: offeringDetailsMayBeEmpty,
    }) ||
    validateLabelValueRows(data.amendment_changes, "amendment_changes", { allowEmpty: true });
  if (rowError) return rowError;
  const structuredOverhangError = validateS1F1OverhangFacts(data);
  if (structuredOverhangError) return structuredOverhangError;
  return "";
}

function validateLabelValueRows(
  value: unknown,
  fieldName: string,
  options?: { allowEmpty?: boolean },
) {
  if (value === undefined || value === null) return "";
  if (!Array.isArray(value)) return `SEC S-1/F-1 display_payload.data.${fieldName} must be an array`;
  if (!options?.allowEmpty && !value.length) {
    return `SEC S-1/F-1 display_payload.data.${fieldName} must be written by the analysis LLM`;
  }
  for (const [index, row] of value.entries()) {
    const record = readRecord(row);
    if (!record || !Object.keys(record).length) {
      return `SEC S-1/F-1 display_payload.data.${fieldName}[${index}] cannot be an empty object`;
    }
    const label = stringValue(record.label);
    const rowValue = stringValue(record.value);
    const note = stringValue(record.note);
    if (!label || !rowValue) {
      return `SEC S-1/F-1 display_payload.data.${fieldName}[${index}] must include label and value`;
    }
  }
  return "";
}

function collectLabelValueRowWarnings(
  value: unknown,
  fieldName: string,
  options: { maxValueLength?: number; maxNoteLength?: number },
) {
  if (!Array.isArray(value)) return [];
  const warnings: string[] = [];
  for (const [index, row] of value.entries()) {
    const record = readRecord(row);
    if (!record) continue;
    const rowValue = stringValue(record.value);
    const note = stringValue(record.note);
    if (options.maxValueLength && rowValue.length > options.maxValueLength) {
      warnings.push(
        `S-1/F-1 display_payload.data.${fieldName}[${index}].value exceeded ${options.maxValueLength} characters`,
      );
    }
    if (options.maxNoteLength && note.length > options.maxNoteLength) {
      warnings.push(
        `S-1/F-1 display_payload.data.${fieldName}[${index}].note exceeded ${options.maxNoteLength} characters`,
      );
    }
  }
  return warnings;
}

function appendS1F1DisplayWarnings(data: Record<string, unknown>, warnings: string[]) {
  if (!warnings.length) return;
  const existing = Array.isArray(data.display_warnings)
    ? data.display_warnings.map((item) => stringValue(item)).filter(Boolean)
    : [];
  data.display_warnings = [...existing, ...warnings];
}

function validateS1F1OverhangFacts(data: Record<string, unknown>) {
  const displayMode = stringValue(data.display_mode);
  if (!["resale_registration", "mixed_offering", "mixed_registration"].includes(displayMode)) return "";
  const hasSupplyNumerator = hasNumericDisplayFactValue(readRecord(data.total_potential_supply));
  const snapshotText = Array.isArray(data.snapshot_metrics)
    ? data.snapshot_metrics
        .map((row) => {
          const record = readRecord(row);
          return `${stringValue(record?.label)} ${stringValue(record?.value)} ${stringValue(record?.note)}`;
        })
        .join(" ")
    : "";
  const mentionsOverhang = /\b(?:overhang|dilution|outstanding)\b/i.test(snapshotText);
  if (!hasSupplyNumerator && !mentionsOverhang) return "";
  if (hasSupplyNumerator && !/\boverhang\s+vs\.?\s+outstanding\b/i.test(snapshotText)) {
    return "SEC S-1/F-1 resale/mixed display must include snapshot_metrics row labeled Overhang vs outstanding when total_potential_supply is available";
  }
  if (!hasNumericDisplayFactValue(readRecord(data.current_shares))) {
    return "SEC S-1/F-1 overhang snapshot must include numeric display_payload.data.current_shares from filing data when available, otherwise latest market_context shares_outstanding";
  }
  if (!hasSupplyNumerator) {
    return "SEC S-1/F-1 overhang snapshot must include numeric display_payload.data.total_potential_supply from the same registered/offered share numerator";
  }
  if (!hasNumericDisplayFactValue(readRecord(data.estimated_dilution_percent))) {
    return "SEC S-1/F-1 overhang snapshot must include numeric display_payload.data.estimated_dilution_percent when current_shares and total_potential_supply are available";
  }
  return "";
}

function hasNumericDisplayFactValue(fact: Record<string, unknown> | null) {
  const value = numberValue(fact?.numeric_value) ?? numberValue(fact?.numericValue);
  return typeof value === "number" && Number.isFinite(value) && value > 0;
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

function normalizeS1F1DisplayPayload(displayPayload: Record<string, unknown> | null) {
  if (!displayPayload) return null;
  const data = readRecord(displayPayload.data);
  if (!data) return displayPayload;
  const displayMode = stringValue(data.display_mode);
  if (displayMode !== "mixed_registration") return displayPayload;
  return {
    ...displayPayload,
    data: {
      ...data,
      display_mode: "mixed_offering",
    },
  };
}

function normalizeS1F1ParserOutput(value: unknown, input: SecFilingAnalysisInput) {
  const parser = readRecord(value) || {};
  const fallback = readS1F1ParserOutput(input);
  const filingPackage = readFilingPackage(input);
  const fallbackRaw = readRecord(fallback?.raw) || {};
  const raw = readRecord(parser.raw) || fallbackRaw;
  const runtimeMarketContext = readRecord(filingPackage.market_context);
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
    raw: {
      ...raw,
      ...(runtimeMarketContext && Object.keys(runtimeMarketContext).length ? { marketContext: runtimeMarketContext } : {}),
    },
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

function alignS1F1AnalysisOutputToDisplayPayload(
  analysis: Record<string, unknown>,
  displayPayload: Record<string, unknown>,
) {
  if (stringValue(displayPayload.display_type) !== "offering_terms") return analysis;
  const data = readRecord(displayPayload.data);
  if (!data) return analysis;
  const displayMode = stringValue(data.display_mode);
  const investorTakeaway = nullableString(data.investor_takeaway);
  const narrativeSummary = nullableString(data.narrative_summary);
  const aligned: Record<string, unknown> = {
    ...analysis,
    ...(investorTakeaway ? { quick_take: investorTakeaway } : {}),
    ...(narrativeSummary ? { summary: narrativeSummary } : {}),
  };
  if (displayMode && displayMode !== "generic") {
    aligned.bullish_points = [];
    aligned.bearish_points = [];
  }
  return aligned;
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
  const packageTicker = nullableString(packagePrimary?.ticker) || nullableString(filingPackage.ticker);
  const ticker = packageTicker || nullableString(record?.ticker);
  const exchange = nullableString(packagePrimary?.exchange) || nullableString(record?.exchange);
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    exchange,
  };
}

function normalizeTickerRows(value: unknown, primaryTicker: { ticker: string | null; exchange: string | null }, role: string) {
  if (role === "primary" && primaryTicker.ticker) {
    return [
      {
        ticker: primaryTicker.ticker,
        exchange: primaryTicker.exchange,
        role: "primary",
        reason: "Primary SEC filing ticker",
      },
    ];
  }
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

function displayFactSchema() {
  return {
    type: ["object", "null"],
    additionalProperties: true,
    required: ["value_text", "numeric_value", "unit", "evidence"],
    properties: {
      value_text: { type: ["string", "null"] },
      numeric_value: { type: ["number", "null"] },
      unit: { type: ["string", "null"] },
      evidence: { type: ["string", "null"] },
    },
  } as const;
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
            ticker: { type: ["string", "null"], maxLength: 12 },
            exchange: { type: ["string", "null"], maxLength: 40 },
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
          required: [
            "display_mode",
            "risk_label",
            "snapshot_metrics",
            "investor_takeaway",
            "narrative_summary",
            "offering_details",
          ],
          properties: {
            display_mode: { type: ["string", "null"], enum: [...ALLOWED_S1_F1_DISPLAY_MODES, null] },
            ipo_kind: { type: ["string", "null"] },
            risk_label: { type: ["string", "null"] },
            current_shares: displayFactSchema(),
            total_potential_supply: displayFactSchema(),
            estimated_dilution_percent: displayFactSchema(),
            supply_segments: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                properties: {
                  role: {
                    type: ["string", "null"],
                    enum: ["new_shares", "potential_warrants", "potential_instruments", "total_potential_supply", null],
                  },
                  label: { type: ["string", "null"] },
                  shares: displayFactSchema(),
                  price: displayFactSchema(),
                },
              },
            },
            snapshot_metrics: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["label", "value"],
                properties: {
                  label: { type: "string", enum: ALLOWED_S1_F1_SNAPSHOT_LABELS },
                  value: { type: "string" },
                  note: { type: ["string", "null"] },
                  tone: { type: ["string", "null"] },
                  emphasis: { type: ["boolean", "null"] },
                },
              },
            },
            investor_takeaway: { type: ["string", "null"] },
            narrative_summary: { type: ["string", "null"] },
            offering_details: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["label", "value"],
                properties: {
                  label: { type: "string", maxLength: 40 },
                  value: { type: "string", maxLength: 90 },
                  note: { type: ["string", "null"], maxLength: 80 },
                },
              },
            },
            amendment_changes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: true,
                required: ["label", "value"],
                properties: {
                  label: { type: "string" },
                  value: { type: "string" },
                  note: { type: ["string", "null"] },
                },
              },
            },
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
