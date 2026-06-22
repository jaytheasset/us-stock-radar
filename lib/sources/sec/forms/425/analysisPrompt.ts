import {
  SEC_425_APPROVED_EVENT_TYPES,
  SEC_425_CONFIDENCE_VALUES,
  SEC_425_DELIVERY_LEVEL_VALUES,
  SEC_425_DISPLAY_TYPE_VALUES,
  SEC_425_MARKET_SCOPE_VALUES,
  SEC_425_SIGNAL_VALUES,
  deliveryLevelFromScore,
  isSec425ApprovedEventType,
  type Sec425Confidence,
  type Sec425DisplayPayload,
  type Sec425DisplayType,
  type Sec425MarketScope,
  type Sec425ParserOutput,
  type Sec425RoomResult,
  type Sec425Signal,
} from "./types";
import {
  SEC_425_ROUTER_PROMPT_KEY,
  SEC_425_ROUTER_PROMPT_VERSION,
  type Sec425RouterDecision,
  type Sec425RouterPromptInput,
} from "./routerPrompt";
import { buildSec425DisplayPayload } from "./displayPayload";
import { buildSecSourceBlockPromptInput } from "../common/sourceBlockPromptInput";

export const SEC_425_ANALYSIS_PROMPT_KEY = "sec_425_analysis_draft";
export const SEC_425_ANALYSIS_PROMPT_VERSION = "v1";

export const SEC_425_ANALYSIS_CASE_VALUES = [
  "strategic_transaction_terms",
  "spac_business_combination",
  "tender_or_exchange_offer",
  "agreement_amendment",
  "shareholder_vote",
  "shareholder_vote_results",
  "shareholder_meeting_adjournment",
  "legal_or_regulatory_deal_risk",
  "financing_or_liquidity_risk",
  "investor_day_notice",
  "routine_archive",
  "other_425",
] as const;

export type Sec425AnalysisCase = (typeof SEC_425_ANALYSIS_CASE_VALUES)[number];

export type Sec425AnalysisPromptInput = Sec425RouterPromptInput & {
  router_result: Sec425RouterDecision;
  display_payload: Sec425DisplayPayload;
};

export const sec425AnalysisSystemPrompt = [
  "Write investor-facing analysis for one SEC Form 425 transaction communication and return only strict JSON matching the Required Output JSON shape.",
  "Use only cleaned_source_blocks, router result, and fixture-provided market_context source blocks. Do not call, request, or assume live market data.",
  "Do not use parser-generated facts, signals, route hints, extraction summaries, event labels, display labels, or investment labels as analysis authority.",
  `Use only these approved event types: ${SEC_425_APPROVED_EVENT_TYPES.join(", ")}.`,
  "Do not choose the event_type. Copy analysis_output.event_type exactly from router_result.event_type.",
  "Do not choose, create, or tune the detail UI. Copy display_payload exactly from the supplied display_payload object.",
  "Do not create new display types. The router/classifier and UI payload builder already selected display_type, display_version, and display data.",
  "Use router_result.routing_reason and cleaned_source_blocks as the evidence base.",
  "Do not ask for full raw filing text. If filing_excerpt is supplied, treat it as selected source snippets only.",
  "Do not add delivery_level as a model field. The fixture expected delivery level is derived from analysis_output.score: below 50 archive, 50 to 74 feed, 75 or above alert.",
  "Prioritize investor impact: deal economics, consideration changes, vote deadlines, litigation or regulatory risk, financing risk, and whether the communication changes previously known terms.",
  "For routine Form 425 materials that explicitly contain no new material information and no changed terms, keep event_type other, score below 50, neutral signal, high confidence, and needs_human_review false.",
  "For strategic transaction terms, explain consideration, transaction value, parties, closing timeline, and what to watch next.",
  "For SPAC business-combination terms, focus on target, valuation, PIPE, trust cash, redemptions, earnout shares, warrants, lock-up, support, and expected ticker only when source-backed.",
  "For tender or exchange offers, separate offer mechanics from advocacy, hostile language, and boilerplate tender-offer disclaimers.",
  "For shareholder vote cases, focus on meeting date, record date, adjournment, vote results, board recommendation, vote consequence, and next calendar item.",
  "For amendment cases, analyze only what the amendment changed; do not restate the parent agreement as a new event unless changed terms are evident.",
  "For legal_risk and financial_risk cases, explain how the issue could affect closing certainty, funding, dilution, or downside risk without overstating facts.",
  "For ipo_listing cases, explain only source-backed IPO/listing facts already selected by the router/classifier; keep ipo_kind in display_payload.data as traditional or spac and do not reclassify SPAC redemption, liquidation, or de-SPAC updates as IPO listings.",
  "Analysis is responsible for investor-facing copy: event_title, score_reason, signal, quick_take, summary, why_it_matters, points, evidence, watch items, confidence, and human-review flag.",
].join("\n");

export const sec425RequiredOutputResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["parser_output", "analysis_output", "display_payload", "fixture_expected"],
  properties: {
    parser_output: {
      type: "object",
      additionalProperties: true,
      required: ["parserVersion", "parserGroup", "formType", "accessionNumber", "isSupported", "summary", "facts", "signals", "calendarItems", "warnings", "raw"],
      properties: {
        parserVersion: { type: "string" },
        parserGroup: { type: "string", enum: ["425"] },
        formType: { type: "string", enum: ["425"] },
        accessionNumber: { type: ["string", "null"] },
        isSupported: { type: "boolean", enum: [true] },
        summary: { type: ["string", "null"] },
        facts: { type: "object", additionalProperties: true },
        signals: { type: "array", items: { type: "object", additionalProperties: true } },
        calendarItems: { type: "array", items: { type: "object", additionalProperties: true } },
        warnings: { type: "array", items: { type: "string" } },
        raw: { type: "object", additionalProperties: true },
      },
    },
    analysis_output: {
      type: "object",
      additionalProperties: false,
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
        market_scope: { type: "string", enum: SEC_425_MARKET_SCOPE_VALUES },
        event_type: { type: "string", enum: SEC_425_APPROVED_EVENT_TYPES },
        event_title: { type: "string" },
        primary_ticker: {
          type: "object",
          additionalProperties: false,
          required: ["ticker", "exchange"],
          properties: {
            ticker: { type: ["string", "null"] },
            exchange: { type: ["string", "null"] },
          },
        },
        tickers: { type: "array", items: { type: "object", additionalProperties: true } },
        sector: { type: ["string", "null"] },
        industry_group: { type: ["string", "null"] },
        theme_group: { type: ["string", "null"] },
        sub_theme: { type: ["string", "null"] },
        score: { type: "integer", minimum: 0, maximum: 100 },
        score_reason: { type: "string" },
        signal: { type: "string", enum: SEC_425_SIGNAL_VALUES },
        quick_take: { type: "string" },
        summary: { type: "string" },
        why_it_matters: { type: "string" },
        bullish_points: { type: "array", items: { type: "string" } },
        bearish_points: { type: "array", items: { type: "string" } },
        key_evidence: { type: "array", items: { type: "string" } },
        what_to_watch_next: { type: "array", items: { type: "string" } },
        related_tickers: { type: "array", items: { type: "object", additionalProperties: true } },
        calendar_items: { type: "array", items: { type: "object", additionalProperties: true } },
        confidence: { type: "string", enum: SEC_425_CONFIDENCE_VALUES },
        needs_human_review: { type: "boolean" },
      },
    },
    display_payload: {
      type: "object",
      additionalProperties: false,
      required: ["display_type", "data", "evidence", "notes"],
      properties: {
        display_type: { type: "string", enum: SEC_425_DISPLAY_TYPE_VALUES },
        data: { type: "object", additionalProperties: true },
        evidence: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
      },
    },
    fixture_expected: {
      type: "object",
      additionalProperties: false,
      required: [
        "expected_delivery_level",
        "expected_impact",
        "market_context_needed",
        "market_context_reason",
        "market_context_fields",
        "special_ui_needed",
        "special_ui_reason",
        "integration_notes",
      ],
      properties: {
        expected_delivery_level: { type: "string", enum: SEC_425_DELIVERY_LEVEL_VALUES },
        expected_impact: { type: "string", enum: ["low", "medium", "high"] },
        market_context_needed: { type: "boolean" },
        market_context_reason: { type: ["string", "null"] },
        market_context_fields: { type: "array", items: { type: "string" } },
        special_ui_needed: { type: "boolean" },
        special_ui_reason: { type: ["string", "null"] },
        integration_notes: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

export function buildSec425AnalysisPromptDraft(input: Sec425AnalysisPromptInput) {
  return {
    key: SEC_425_ANALYSIS_PROMPT_KEY,
    version: SEC_425_ANALYSIS_PROMPT_VERSION,
    system: sec425AnalysisSystemPrompt,
    user: JSON.stringify({
      ...buildSecSourceBlockPromptInput({
        filingPackage: input.filing_package,
        parserOutput: input.parser_output as unknown as Record<string, unknown>,
        fallbackText: input.filing_excerpt,
        marketContext: input.market_context,
      }),
      router_result: input.router_result,
      display_payload: input.display_payload,
      market_context: input.market_context || null,
    }),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_425_required_output",
        strict: true,
        schema: sec425RequiredOutputResponseSchema,
      },
    },
  };
}

export function buildSec425DeterministicRoomResult(
  parserOutput: Sec425ParserOutput,
  routerDecision: Sec425RouterDecision,
): Sec425RoomResult | null {
  if (routerDecision.deterministic_stage !== "parser" || routerDecision.needs_analysis_llm) return null;
  const displayPayload = buildSec425DisplayPayload(parserOutput, routerDecision);
  const ticker = {
    ticker: parserOutput.facts.primary_ticker,
    exchange: parserOutput.facts.exchange,
  };
  return {
    parser_output: parserOutput,
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "other",
      event_title: "Routine Form 425 communication with no new material terms",
      primary_ticker: ticker,
      tickers: ticker.ticker ? [ticker] : [],
      sector: null,
      industry_group: null,
      theme_group: "M&A communications",
      sub_theme: "Routine deal communication",
      score: routerDecision.score,
      score_reason: "Archived because the parser found explicit no-new-material-information and no-change-to-terms language.",
      signal: "neutral",
      quick_take: "Routine transaction communication; no new deal terms were identified.",
      summary: parserOutput.facts.deterministic_archive_reason || "The Form 425 communication repeats prior deal information without changed material terms.",
      why_it_matters: "Routine Form 425 communications can create noise around pending transactions; this case does not add a new investor-relevant event.",
      bullish_points: [],
      bearish_points: [],
      key_evidence: routerDecision.evidence,
      what_to_watch_next: ["Watch for future Form 425, proxy, 8-K, or merger filings that change consideration, timing, vote dates, or closing conditions."],
      related_tickers: [],
      calendar_items: parserOutput.calendarItems,
      confidence: "high",
      needs_human_review: false,
    },
    display_payload: displayPayload,
    fixture_expected: {
      expected_delivery_level: deliveryLevelFromScore(routerDecision.score),
      expected_impact: "low",
      market_context_needed: false,
      market_context_reason: null,
      market_context_fields: [],
      special_ui_needed: false,
      special_ui_reason: null,
      integration_notes: ["Deterministic parser archive can be saved to company filing history without router or analysis LLM."],
    },
  };
}

export function validateSec425RoomResult(result: Sec425RoomResult): string[] {
  const errors: string[] = [];
  const analysis = result.analysis_output;
  const fixtureExpected = result.fixture_expected;

  if (result.parser_output.parserGroup !== "425") errors.push("parser_output.parserGroup must be 425");
  if (result.parser_output.formType !== "425") errors.push("parser_output.formType must be 425");
  if (!result.parser_output.isSupported) errors.push("parser_output.isSupported must be true");
  if (!isSec425ApprovedEventType(analysis.event_type)) errors.push(`analysis_output.event_type is not approved: ${String(analysis.event_type)}`);
  if (!SEC_425_MARKET_SCOPE_VALUES.includes(analysis.market_scope as Sec425MarketScope)) errors.push("analysis_output.market_scope is invalid");
  if (!SEC_425_SIGNAL_VALUES.includes(analysis.signal as Sec425Signal)) errors.push("analysis_output.signal is invalid");
  if (!SEC_425_CONFIDENCE_VALUES.includes(analysis.confidence as Sec425Confidence)) errors.push("analysis_output.confidence is invalid");
  if (!SEC_425_DISPLAY_TYPE_VALUES.includes(result.display_payload.display_type as Sec425DisplayType)) errors.push("display_payload.display_type is invalid");
  if (!Number.isInteger(analysis.score) || analysis.score < 0 || analysis.score > 100) errors.push("analysis_output.score must be an integer from 0 to 100");

  const derivedDeliveryLevel = deliveryLevelFromScore(analysis.score);
  if (derivedDeliveryLevel !== fixtureExpected.expected_delivery_level) {
    errors.push(`fixture_expected.expected_delivery_level must be derived from score; expected ${derivedDeliveryLevel} for score ${analysis.score}`);
  }
  if (result.display_payload.display_type === "candidate_special" && !fixtureExpected.special_ui_needed) {
    errors.push("candidate_special display payload must set fixture_expected.special_ui_needed true");
  }
  if (fixtureExpected.special_ui_needed && !fixtureExpected.special_ui_reason) {
    errors.push("special_ui_needed requires special_ui_reason");
  }
  if (fixtureExpected.market_context_needed && fixtureExpected.market_context_fields.length === 0) {
    errors.push("market_context_needed requires market_context_fields");
  }
  return errors;
}

export const sec425AnalysisDebugFields = {
  router_prompt_key: SEC_425_ROUTER_PROMPT_KEY,
  router_prompt_version: SEC_425_ROUTER_PROMPT_VERSION,
  analysis_prompt_key: SEC_425_ANALYSIS_PROMPT_KEY,
  analysis_prompt_version: SEC_425_ANALYSIS_PROMPT_VERSION,
} as const;
