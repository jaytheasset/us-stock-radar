import {
  SEC_FORM25_APPROVED_EVENT_TYPES,
  SEC_FORM25_DISPLAY_PAYLOAD_VERSION,
  SEC_FORM25_DISPLAY_TYPE_VALUES,
  SEC_FORM25_PARSER_VERSION,
  type SecForm25ParserOutput,
} from "./parser";
import {
  buildSecForm25DisplayPayload,
  resolveSecForm25SelectedClassification,
  type SecForm25DisplayPayload,
  type SecForm25SelectedClassification,
} from "./displayPayload";
import {
  SEC_FORM25_ROUTER_PROMPT_KEY,
  SEC_FORM25_ROUTER_PROMPT_VERSION,
  buildSecForm25RouterInput,
  type SecForm25RouterPromptInput,
} from "./routerPrompt";

export const SEC_FORM25_ANALYSIS_PROMPT_KEY = "sec_form25_analysis_draft";
export const SEC_FORM25_ANALYSIS_PROMPT_VERSION = "v1";

export const SEC_FORM25_MARKET_SCOPE_VALUES = ["company", "sector", "theme", "macro"] as const;
export const SEC_FORM25_SIGNAL_VALUES = ["bullish", "bearish", "volatile", "neutral"] as const;
export const SEC_FORM25_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;

export type SecForm25AnalysisPromptInput = SecForm25RouterPromptInput & {
  router_result: Record<string, unknown>;
  market_context?: Record<string, unknown> | null;
};

export {
  buildSecForm25DisplayPayload,
  resolveSecForm25SelectedClassification,
  summarizeForm25ForDisplay,
} from "./displayPayload";
export type { SecForm25DisplayPayload, SecForm25SelectedClassification } from "./displayPayload";

export const secForm25AnalysisSystemPrompt = [
  "Analyze one SEC Form 25 / 25-NSE filing and return only strict JSON matching the Required Output JSON schema.",
  "The required top-level shape is exactly parser_output, analysis_output, display_payload, and fixture_expected.",
  "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another Form 25 variant.",
  "Write investor-facing copy only. Do not choose the event type, display template, or display version.",
  "Use selected_classification.event_type for analysis_output.event_type exactly.",
  "Return prebuilt_display_payload as display_payload exactly; do not invent UI fields or a new display type.",
  "Use cleaned_source_blocks and selected classification as the evidence base. Do not invent facts, dates, tickers, exchanges, security classes, merger parties, or listing venues.",
  "Do not use parser-generated facts, signals, route hints, routing flags, extraction summaries, event labels, display labels, or investment labels as analysis authority.",
  "If the parser did not provide a source-backed primary ticker, keep primary_ticker.ticker null and do not treat the filing as archive-ready.",
  "Do not request or rely on full raw filing text. The user payload intentionally excludes it.",
  "The parser or router/classifier has already selected event_type and display_type. You choose only signal, score, confidence, human-review status, and concise investor-facing wording.",
  "Clear matured, redeemed, retired, or paid-at-maturity non-common securities should usually be neutral, score 0-39, and low-impact archive when common equity is not affected and no source evidence shows credit or legal stress.",
  "Do not describe a routine maturity, redemption, retirement, or paid-at-maturity non-common removal as listing_risk merely because Form 25 removes the class from an exchange.",
  "Use listing_risk, financial_risk, or legal_risk for a non-common removal only when source evidence mentions listing-standard failure, bankruptcy, insolvency, receivership, default, litigation, or other legal stress.",
  "Use financial_risk or legal_risk only when source evidence mentions bankruptcy, insolvency, receivership, default, litigation, or other legal stress.",
  "ipo_listing is approved globally, but use it only if selected_classification.event_type is ipo_listing; then preserve prebuilt_display_payload.data.ipo_kind as traditional or spac.",
  "Do not treat SPAC redemption, liquidation, de-SPAC follow-up, resale registration, shelf offering, or ATM/offering dilution as ipo_listing unless the selected main event is IPO/listing itself.",
  "Form 25 scoring guide:",
  "- Exchange-forced common stock, ordinary share, or ADS delisting for listing-standard failure is bearish and usually alert-level, score 80-95 when removal or trading suspension is active or near-term.",
  "- Voluntary common-equity delisting, going-dark, or deregistration that reduces exchange liquidity is usually bearish or volatile, score 70-85, and can be alert-level when no clear continued trading venue is disclosed.",
  "- Completed merger, acquisition, share exchange, cash-out, or de-SPAC cleanup removal is usually strategic_transaction, not bearish by default. Score 45-70 unless the filing newly changes holder economics, consideration, closing certainty, or trading status.",
  "- SPAC/de-SPAC ticker transition or old SPAC security removal after a successor listing is usually neutral or volatile, score 55-74 unless there is source-backed listing failure, redemption/liquidity stress, or deal-break risk.",
  "- Matured, redeemed, retired, paid-at-maturity, or expired non-common securities are usually neutral, score 0-39, unless source evidence shows default, bankruptcy, legal stress, or common-equity impact.",
  "Score-derived delivery only: score below 50 maps to archive, 50-74 maps to feed, and 75 or above maps to alert. Do not create any other delivery decision.",
  "Always include score_explanation.summary. It is visible on the detail page.",
  "score_explanation.summary should read like a concise analyst bottom-line for stock investors, 18-32 words.",
  "Do not mention the score, score level, form type, filing mechanics, parser, or internal classification in score_explanation.summary.",
  "score_explanation.summary must start from the score driver, such as delisting immediacy, liquidity loss, continued trading uncertainty, merger-completion mechanics, voluntary delisting, ticker transition, or non-common security cleanup.",
  "score_explanation.summary is invalid if it starts with the issuer name, ticker, exchange, form type, or filing-action verbs such as filed, submitted, notified, removed, delisted, deregistered, became, or announced.",
  "Do not reuse the opening structure or sentence from analysis_output.summary, quick_take, why_it_matters, or display_payload.data fields in score_explanation.summary.",
  "Write score_explanation.summary in plain investor language. Avoid SEC/legal terms when a simpler phrase is accurate.",
  "Do not provide market taxonomy from the filing. Use site-provided market_context when present; otherwise keep sector, industry_group, theme_group, and sub_theme null.",
  "Keep output short: event_title under 90 characters; quick_take one sentence under 22 words; summary 2-4 sentences under 100 words total; why_it_matters one sentence under 35 words.",
  "Keep score_reason under 18 words.",
  "Keep bullish_points, bearish_points, key_evidence, and what_to_watch_next to at most 3 items each, and each item under 16 words.",
  "Do not copy raw parser, formatter, schema, or structured-field wording into user-facing analysis. Rewrite source facts in natural investor language.",
].join("\n");

export const secForm25RequiredOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["parser_output", "analysis_output", "display_payload", "fixture_expected"],
  properties: {
    parser_output: {
      type: "object",
      additionalProperties: false,
      required: [
        "parserVersion",
        "parserGroup",
        "formType",
        "accessionNumber",
        "isSupported",
        "summary",
        "facts",
        "signals",
        "calendarItems",
        "warnings",
        "raw",
      ],
      properties: {
        parserVersion: { type: "string", enum: [SEC_FORM25_PARSER_VERSION] },
        parserGroup: { type: "string", enum: ["form25"] },
        formType: { type: "string", enum: ["Form 25 / 25-NSE"] },
        accessionNumber: { type: ["string", "null"] },
        isSupported: { type: "boolean" },
        summary: { type: ["string", "null"] },
        facts: { type: "object", additionalProperties: true },
        signals: { type: "array", items: { type: "string" } },
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
        "score_explanation",
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
        market_scope: { type: "string", enum: SEC_FORM25_MARKET_SCOPE_VALUES },
        event_type: { type: "string", enum: SEC_FORM25_APPROVED_EVENT_TYPES },
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
        tickers: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ticker", "exchange", "role"],
            properties: {
              ticker: { type: "string" },
              exchange: { type: "string" },
              role: { type: "string" },
            },
          },
        },
        sector: { type: ["string", "null"] },
        industry_group: { type: ["string", "null"] },
        theme_group: { type: ["string", "null"] },
        sub_theme: { type: ["string", "null"] },
        score: { type: "integer", minimum: 0, maximum: 100 },
        score_reason: { type: "string" },
        score_explanation: {
          type: "object",
          additionalProperties: false,
          required: ["summary"],
          properties: {
            summary: { type: "string" },
          },
        },
        signal: { type: "string", enum: SEC_FORM25_SIGNAL_VALUES },
        quick_take: { type: "string" },
        summary: { type: "string" },
        why_it_matters: { type: "string" },
        bullish_points: { type: "array", items: { type: "string" } },
        bearish_points: { type: "array", items: { type: "string" } },
        key_evidence: { type: "array", items: { type: "string" } },
        what_to_watch_next: { type: "array", items: { type: "string" } },
        related_tickers: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ticker", "exchange", "reason"],
            properties: {
              ticker: { type: "string" },
              exchange: { type: ["string", "null"] },
              reason: { type: "string" },
            },
          },
        },
        calendar_items: { type: "array", items: { type: "object", additionalProperties: true } },
        confidence: { type: "string", enum: SEC_FORM25_CONFIDENCE_VALUES },
        needs_human_review: { type: "boolean" },
      },
    },
    display_payload: {
      type: "object",
      additionalProperties: false,
      required: ["display_type", "display_version", "data", "evidence", "notes"],
      properties: {
        display_type: { type: "string", enum: SEC_FORM25_DISPLAY_TYPE_VALUES },
        display_version: { type: "string", enum: [SEC_FORM25_DISPLAY_PAYLOAD_VERSION] },
        data: {
          type: "object",
          additionalProperties: false,
          required: [
            "accession_number",
            "source_url",
            "source_form_type",
            "filing_date",
            "effectiveness_date",
            "issuer_name",
            "subject_company_cik",
            "filed_by_name",
            "filed_by_cik",
            "primary_ticker",
            "primary_ticker_exchange",
            "removed_security",
            "security_category",
            "exchange",
            "rule_provision",
            "removal_reason",
            "removal_reason_text",
            "common_equity_affected",
            "delisting_or_removal_date",
            "trading_suspension_date",
            "continued_listing_or_trading_venue",
            "successor_or_acquirer",
            "consideration_summary",
            "ipo_kind",
            "deterministic_case",
            "router_required",
          ],
          properties: {
            accession_number: { type: ["string", "null"] },
            source_url: { type: ["string", "null"] },
            source_form_type: { type: ["string", "null"] },
            filing_date: { type: ["string", "null"] },
            effectiveness_date: { type: ["string", "null"] },
            issuer_name: { type: ["string", "null"] },
            subject_company_cik: { type: ["string", "null"] },
            filed_by_name: { type: ["string", "null"] },
            filed_by_cik: { type: ["string", "null"] },
            primary_ticker: { type: ["string", "null"] },
            primary_ticker_exchange: { type: ["string", "null"] },
            removed_security: { type: ["string", "null"] },
            security_category: { type: "string" },
            exchange: { type: ["string", "null"] },
            rule_provision: { type: ["string", "null"] },
            removal_reason: { type: ["string", "null"] },
            removal_reason_text: { type: ["string", "null"] },
            common_equity_affected: { type: ["boolean", "null"] },
            delisting_or_removal_date: { type: ["string", "null"] },
            trading_suspension_date: { type: ["string", "null"] },
            continued_listing_or_trading_venue: { type: ["string", "null"] },
            successor_or_acquirer: { type: ["string", "null"] },
            consideration_summary: { type: ["string", "null"] },
            ipo_kind: { enum: ["traditional", "spac", null] },
            deterministic_case: { type: ["string", "null"] },
            router_required: { type: "boolean" },
          },
        },
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
        expected_delivery_level: { type: "string", enum: ["archive", "feed", "alert"] },
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

export function buildSecForm25AnalysisPromptDraft(input: SecForm25AnalysisPromptInput) {
  return {
    key: SEC_FORM25_ANALYSIS_PROMPT_KEY,
    version: SEC_FORM25_ANALYSIS_PROMPT_VERSION,
    system: secForm25AnalysisSystemPrompt,
    user: JSON.stringify(buildSecForm25AnalysisInput(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_form25_required_output",
        strict: true,
        schema: secForm25RequiredOutputSchema,
      },
    },
  };
}

export function buildSecForm25AnalysisInput(input: SecForm25AnalysisPromptInput) {
  const selectedClassification = resolveSecForm25SelectedClassification(input.parser_output, input.router_result);
  const prebuiltDisplayPayload = buildSecForm25DisplayPayload(input.parser_output, selectedClassification);

  return {
    cleaned_source_blocks_input: buildSecForm25RouterInput({
      parser_output: input.parser_output,
      fixture_context: input.fixture_context || null,
    }),
    selected_classification: selectedClassification,
    prebuilt_display_payload: prebuiltDisplayPayload,
    router_result: input.router_result,
    market_context: input.market_context || null,
    output_shape: {
      required_top_level_keys: ["parser_output", "analysis_output", "display_payload", "fixture_expected"],
      event_type_policy: "Use selected_classification.event_type exactly; do not choose a different event_type.",
      display_payload_policy: "Return prebuilt_display_payload exactly; do not add, remove, or rename UI fields.",
      score_delivery_policy: {
        archive: "score below 50",
        feed: "score 50 to 74",
        alert: "score 75 or above",
      },
      form25_case_policies: {
        matured_redeemed_retired_non_common:
          "If common_equity_affected is false and no credit/legal stress evidence exists, use neutral signal, score 0-39, and archive.",
        completed_merger_removal:
          "Keep score below 50 when the filing is an administrative cleanup after a completed merger.",
        common_equity_or_ads_unclear:
          "Use human review when common equity, ADS, units, or removal reason ambiguity could affect listed equity holders.",
      },
    },
  };
}
