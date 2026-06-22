import {
  SEC_CONFIDENCE_LEVELS,
  SEC_DISPLAY_PAYLOAD_TYPES,
  SEC_INTEGRATION_EVENT_TYPES,
  SEC_MARKET_SCOPES,
  SEC_SIGNALS,
} from "@/lib/sources/sec/forms/common/secIntegrationContract";

type SecRequiredOutputSchemaOptions = {
  displayTypes?: readonly string[];
  displayDataProperties?: Record<string, unknown>;
  displayDataRequired?: readonly string[];
};

const nullableStringSchema = { type: ["string", "null"] } as const;

export function buildSecRequiredOutputSchema(options: SecRequiredOutputSchemaOptions = {}) {
  return {
    type: "object",
    additionalProperties: true,
    required: ["analysis_output", "display_payload"],
    properties: {
      parser_output: { type: "object", additionalProperties: true },
      analysis_output: buildSecAnalysisOutputSchema(),
      display_payload: buildSecDisplayPayloadSchema(options),
    },
  } as const;
}

function buildSecAnalysisOutputSchema() {
  return {
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
      market_scope: { type: "string", enum: SEC_MARKET_SCOPES },
      event_type: { type: "string", enum: SEC_INTEGRATION_EVENT_TYPES },
      event_title: { type: "string" },
      primary_ticker: {
        type: ["object", "null"],
        additionalProperties: true,
        properties: {
          ticker: nullableStringSchema,
          exchange: nullableStringSchema,
        },
      },
      tickers: { type: "array", items: { type: "object", additionalProperties: true } },
      sector: nullableStringSchema,
      industry_group: nullableStringSchema,
      theme_group: nullableStringSchema,
      sub_theme: nullableStringSchema,
      score: { type: "number" },
      score_reason: { type: "string" },
      signal: { type: "string", enum: SEC_SIGNALS },
      quick_take: { type: "string" },
      summary: { type: "string" },
      why_it_matters: { type: "string" },
      bullish_points: { type: "array", items: { type: "string" } },
      bearish_points: { type: "array", items: { type: "string" } },
      key_evidence: { type: "array", items: { type: "string" } },
      what_to_watch_next: { type: "array", items: { type: "string" } },
      related_tickers: { type: "array", items: { type: "object", additionalProperties: true } },
      calendar_items: { type: "array", items: { type: "object", additionalProperties: true } },
      confidence: { type: "string", enum: SEC_CONFIDENCE_LEVELS },
      needs_human_review: { type: "boolean" },
    },
  } as const;
}

function buildSecDisplayPayloadSchema(options: SecRequiredOutputSchemaOptions = {}) {
  const displayTypes = options.displayTypes || SEC_DISPLAY_PAYLOAD_TYPES;
  const dataSchema = {
    type: "object",
    additionalProperties: true,
    ...(options.displayDataRequired?.length ? { required: options.displayDataRequired } : {}),
    ...(options.displayDataProperties ? { properties: options.displayDataProperties } : {}),
  };

  return {
    type: "object",
    additionalProperties: true,
    required: ["display_type", "data", "evidence", "notes"],
    properties: {
      display_type: { type: "string", enum: displayTypes },
      display_version: { type: "string" },
      data: dataSchema,
      evidence: { type: "array", items: { type: ["string", "object"], additionalProperties: true } },
      notes: { type: "array", items: { type: ["string", "object"], additionalProperties: true } },
    },
  } as const;
}
