import type { SecS1F1Facts } from "./types";

export const SEC_S1_F1_ANALYSIS_PROMPT_KEY = "sec_s1_f1_analysis";
export const SEC_S1_F1_ANALYSIS_PROMPT_VERSION = "draft_v1";

export const SEC_S1_F1_ANALYSIS_EVENT_TYPE_VALUES = [
  "dilution_risk",
  "financial_risk",
  "strategic_transaction",
  "other",
] as const;
export const SEC_S1_F1_ANALYSIS_ACTION_VALUES = ["archive", "feed", "feed_alert"] as const;
export const SEC_S1_F1_ANALYSIS_SEVERITY_VALUES = ["low", "moderate", "elevated", "high", "severe", "unknown"] as const;
export const SEC_S1_F1_ANALYSIS_CONFIDENCE_VALUES = ["high", "medium", "low", "unknown"] as const;

export type SecS1F1AnalysisPromptInput = {
  filing_package: Record<string, unknown>;
  parser_facts?: SecS1F1Facts | null;
  router?: Record<string, unknown> | null;
  market_context?: Record<string, unknown> | null;
  dilution_metrics?: Record<string, unknown> | null;
};

export const secS1F1AnalysisSystemPrompt = [
  "Analyze one SEC S-1/F-1 family filing and return only strict JSON matching the provided schema.",
  "This prompt is a draft for S-1, S-1/A, F-1, and F-1/A offering, resale, IPO, and material amendment analysis.",
  "Use the filing text, parser_facts, router output, market_context, and dilution_metrics supplied by code. Filing text is the source of truth for filing facts.",
  "Treat parser_facts and router output as candidate evidence only. Ignore any candidate not supported by source text or supplied tables.",
  "Do not fetch market data. Do not invent offering prices, share counts, underwriters, closing dates, lock-up dates, warrants, convertibles, selling holders, or dilution percentages.",
  "Do not calculate dilution percent, float overhang, market-cap ratio, discount to market, or share multiples. Code-supplied dilution_metrics may be used for scoring calibration but not as filing-source evidence.",
  "Classify event_type as dilution_risk for IPOs, primary offerings, resale registrations, mixed primary/resale registrations, warrant/convertible overhang, or material offering amendments unless another supported filing event is clearly dominant.",
  "Use financial_risk only when liquidity, going concern, debt default, or financing distress is more important than the registration mechanics.",
  "Use strategic_transaction only when the registration is primarily tied to a merger, restructuring, de-SPAC, acquisition, or business combination.",
  "Use other only for administrative or ambiguous filings and explain the fallback in summary or risks.",
  "Apply common score/action semantics: score below 50 means action archive; 50-74 means action feed; 75 or higher means action feed_alert.",
  "For routine amendments with no changed economics, score below 50 and action archive. If there is truly no event to store, the upstream router should have skipped analysis.",
  "IPO/new listing filings are normally feed-level when a real registration is underway. Concrete pricing range, expected pricing/listing dates, underwriters, or large risk disclosures can support alert-level scoring.",
  "Resale registrations should score as dilution_risk/overhang. Start feed-level when selling-holder shares are disclosed; raise severity when market_context or dilution_metrics show large registered supply versus shares outstanding or float.",
  "Primary offerings should score by immediacy, specificity, and size. Concrete share count, price range, underwriters, closing timing, warrants, convertibles, or use-of-proceeds pressure increase score.",
  "Mixed primary/resale filings should separate company-issued shares from selling-holder resale shares and never describe resale proceeds as issuer cash.",
  "Fee table amounts are SEC registration math, not company proceeds, unless the prospectus separately says the issuer receives those proceeds.",
  "Warrants, pre-funded warrants, convertibles, and conversion shares are overhang components. Distinguish near-immediate exposure from conditional future exercise or conversion.",
  "Authorized shares and generic capital-stock descriptions are not offered shares or current dilution supply.",
  "Use calendar_items only for explicit IPO pricing, first trading/listing, offering closing, registration effectiveness, warrant redemption/expiration, lock-up expiration, rights deadline, or financing-related shareholder approval deadlines.",
  "Do not calendar from-time-to-time sale language, use-of-proceeds plans, filing date alone, SEC legend dates, or boilerplate legal dates.",
  "Keep summary to 1-3 concise sentences. Keep key_points and risks to at most 4 items each.",
].join("\n");

const factSchema = {
  type: "object",
  additionalProperties: false,
  required: ["label", "value_text", "numeric_value", "unit", "evidence", "confidence"],
  properties: {
    label: { type: "string" },
    value_text: { type: ["string", "null"] },
    numeric_value: { type: ["number", "null"] },
    unit: { type: ["string", "null"], enum: ["shares", "usd", "usd_per_share", "percent", "date", "text", null] },
    evidence: { type: ["string", "null"] },
    confidence: { type: "string", enum: SEC_S1_F1_ANALYSIS_CONFIDENCE_VALUES },
  },
} as const;

export const secS1F1AnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "source_form_type",
    "analysis_family",
    "event_type",
    "display_model_type",
    "score",
    "severity",
    "confidence",
    "action",
    "summary",
    "why_it_matters",
    "key_points",
    "risks",
    "parser_facts",
    "router",
    "market_context",
    "display_model",
    "calendar_items",
    "debug",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    source_form_type: { type: "string", enum: ["S-1", "S-1/A", "F-1", "F-1/A"] },
    analysis_family: { type: "string", enum: ["sec_s1_f1"] },
    event_type: { type: "string", enum: SEC_S1_F1_ANALYSIS_EVENT_TYPE_VALUES },
    display_model_type: {
      type: "string",
      enum: ["offering_terms", "ipo_registration", "share_overhang", "routine_filing", "unknown"],
    },
    score: { type: "integer", minimum: 0, maximum: 100 },
    severity: { type: "string", enum: SEC_S1_F1_ANALYSIS_SEVERITY_VALUES },
    confidence: { type: "string", enum: SEC_S1_F1_ANALYSIS_CONFIDENCE_VALUES },
    action: { type: "string", enum: SEC_S1_F1_ANALYSIS_ACTION_VALUES },
    summary: { type: "string" },
    why_it_matters: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    parser_facts: {
      type: "object",
      additionalProperties: false,
      required: [
        "offering_kind",
        "registration_status",
        "primary_or_resale",
        "shares_offered",
        "resale_share_count",
        "offering_amount",
        "price_range",
        "calendar_candidate_count",
      ],
      properties: {
        offering_kind: { type: ["string", "null"] },
        registration_status: { type: ["string", "null"] },
        primary_or_resale: { type: ["string", "null"] },
        shares_offered: { type: ["string", "null"] },
        resale_share_count: { type: ["string", "null"] },
        offering_amount: { type: ["string", "null"] },
        price_range: { type: ["string", "null"] },
        calendar_candidate_count: { type: "integer", minimum: 0 },
      },
    },
    router: {
      type: "object",
      additionalProperties: false,
      required: ["router_action", "s1_f1_case", "score_hint", "action_hint", "confidence"],
      properties: {
        router_action: { type: ["string", "null"] },
        s1_f1_case: { type: ["string", "null"] },
        score_hint: { type: ["integer", "null"], minimum: 0, maximum: 100 },
        action_hint: { type: ["string", "null"] },
        confidence: { type: ["string", "null"] },
      },
    },
    market_context: {
      type: "object",
      additionalProperties: true,
      required: ["available", "used_for_scoring"],
      properties: {
        available: { type: "boolean" },
        used_for_scoring: { type: "boolean" },
      },
    },
    display_model: {
      type: "object",
      additionalProperties: false,
      required: [
        "offering_case",
        "headline",
        "primary_or_resale",
        "key_terms",
        "share_overhang_notes",
        "cash_proceeds_notes",
        "watch_items",
        "needs_human_review",
        "review_reasons",
      ],
      properties: {
        offering_case: { type: "string" },
        headline: { type: "string" },
        primary_or_resale: { type: ["string", "null"] },
        key_terms: { type: "array", items: factSchema },
        share_overhang_notes: { type: "array", items: { type: "string" } },
        cash_proceeds_notes: { type: "array", items: { type: "string" } },
        watch_items: { type: "array", items: { type: "string" } },
        needs_human_review: { type: "boolean" },
        review_reasons: { type: "array", items: { type: "string" } },
      },
    },
    calendar_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["calendar_event_type", "calendar_title", "event_date", "date_precision", "confidence", "evidence"],
        properties: {
          calendar_event_type: { type: "string" },
          calendar_title: { type: "string" },
          event_date: { type: ["string", "null"] },
          date_precision: { type: "string", enum: ["exact", "estimated", "range", "unknown"] },
          confidence: { type: "string", enum: SEC_S1_F1_ANALYSIS_CONFIDENCE_VALUES },
          evidence: { type: ["string", "null"] },
        },
      },
    },
    debug: {
      type: "object",
      additionalProperties: false,
      required: ["parser_version", "router_prompt_key", "router_prompt_version", "analysis_prompt_key", "analysis_prompt_version"],
      properties: {
        parser_version: { type: ["string", "null"] },
        router_prompt_key: { type: ["string", "null"] },
        router_prompt_version: { type: ["string", "null"] },
        analysis_prompt_key: { type: "string" },
        analysis_prompt_version: { type: "string" },
      },
    },
  },
} as const;

export function buildSecS1F1AnalysisPrompt(input: SecS1F1AnalysisPromptInput) {
  return {
    key: SEC_S1_F1_ANALYSIS_PROMPT_KEY,
    version: SEC_S1_F1_ANALYSIS_PROMPT_VERSION,
    system: secS1F1AnalysisSystemPrompt,
    user: JSON.stringify(buildSecS1F1AnalysisPromptInput(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_s1_f1_analysis",
        strict: true,
        schema: secS1F1AnalysisResponseSchema,
      },
    },
  };
}

function buildSecS1F1AnalysisPromptInput(input: SecS1F1AnalysisPromptInput) {
  const filingPackage = input.filing_package || {};
  const parserFacts = input.parser_facts || readRecord(readRecord(filingPackage.hard_parsers)?.s1_f1) || null;
  const router = input.router || readRecord(filingPackage.s1_f1_router) || null;

  return {
    filing_package: {
      source_group: filingPackage.source_group || "filings",
      source_code: filingPackage.source_code || null,
      raw_item_id: filingPackage.raw_item_id || null,
      accession_number: filingPackage.accession_number || null,
      cik: filingPackage.cik || null,
      company_name: filingPackage.company_name || null,
      primary_ticker: filingPackage.primary_ticker || null,
      tickers: Array.isArray(filingPackage.tickers) ? filingPackage.tickers : [],
      form_type: filingPackage.form_type || null,
      filed_at: filingPackage.filed_at || null,
      filing_detail_url: filingPackage.filing_detail_url || null,
      primary_document_url: filingPackage.primary_document_url || null,
      documents: Array.isArray(filingPackage.documents) ? filingPackage.documents : [],
      parser_facts: parserFacts,
      router,
      market_context: input.market_context || filingPackage.market_context || null,
      dilution_metrics: input.dilution_metrics || filingPackage.dilution_metrics || null,
      llm_text: trimForPrompt(stringValue(filingPackage.llm_text), 18_000),
    },
  };
}

function trimForPrompt(value: string, max: number) {
  const normalized = value.replace(/\s+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 12).trim()}\n[TRUNCATED]` : normalized;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
