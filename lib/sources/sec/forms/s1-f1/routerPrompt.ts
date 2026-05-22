import type { SecS1F1Facts } from "./types";

export const SEC_S1_F1_ROUTER_PROMPT_KEY = "sec_s1_f1_router";
export const SEC_S1_F1_ROUTER_PROMPT_VERSION = "draft_v1";

export const SEC_S1_F1_ROUTER_ACTION_VALUES = ["skip_analysis", "routine_archive", "analyze_offering"] as const;
export const SEC_S1_F1_ROUTER_CASE_VALUES = [
  "ipo_new_listing",
  "resale_registration",
  "primary_offering",
  "mixed_primary_resale",
  "routine_amendment",
  "other_s1_f1",
] as const;
export const SEC_S1_F1_ROUTER_EVENT_TYPE_VALUES = [
  "dilution_risk",
  "financial_risk",
  "strategic_transaction",
  "other",
] as const;
export const SEC_S1_F1_ROUTER_ACTION_HINT_VALUES = ["archive", "feed", "feed_alert"] as const;
export const SEC_S1_F1_ROUTER_CONFIDENCE_VALUES = ["high", "medium", "low", "unknown"] as const;

export type SecS1F1RouterPromptInput = {
  filing_package: Record<string, unknown>;
  parser_facts?: SecS1F1Facts | null;
};

export const secS1F1RouterSystemPrompt = [
  "Route one SEC S-1/F-1 family filing and return only strict JSON matching the provided schema.",
  "This router is a draft for S-1, S-1/A, F-1, and F-1/A only. Do not route unrelated SEC forms here.",
  "Classify by filing economics and registration purpose, not by form label alone.",
  "Distinguish IPO/new listing, resale registration, primary offering, mixed primary/resale, and routine amendment.",
  "Use parser_facts as candidate evidence only. The filing text and source-backed excerpts override parser labels when they conflict.",
  "Choose ipo_new_listing when the filing says initial public offering, no prior public market, new exchange listing, expected pricing, or expected first trading.",
  "Choose resale_registration when selling stockholders/shareholders register shares for resale or the issuer states it receives no proceeds from selling-holder sales.",
  "Choose primary_offering when the issuer registers new shares/securities for sale by the company, including follow-on S-1/F-1 primary offerings.",
  "Choose mixed_primary_resale when both issuer-sale and selling-holder resale mechanics are active in the same filing.",
  "Choose routine_amendment only for exhibit-only, consent-only, signature-only, unchanged-remainder, or administrative S-1/A/F-1/A filings with no changed offering economics, price range, share count, underwriters, selling holders, lock-up, fee table, risk, or calendar signal.",
  "Choose analyze_offering for IPOs, primary offerings, resale overhang, mixed registrations, new price range/share count, underwriter terms, lock-up terms, warrants, convertibles, or material amendments.",
  "Choose routine_archive only for low-priority amendments worth storing but not feed-worthy. Choose skip_analysis when no event should be created.",
  "For analyze_offering, event_type should normally be dilution_risk. Use financial_risk only when liquidity/going-concern risk is the dominant investor event, strategic_transaction only when the S-1/F-1 is primarily tied to a merger or restructuring, and other only as a documented fallback.",
  "Apply common action semantics: score below 50 means archive, 50-74 means feed, and 75+ means feed_alert.",
  "IPO/new listing S-1/F-1 filings are usually feed-level or alert-level when pricing/listing timing is concrete.",
  "Resale registrations start as feed-level dilution risk when share count or selling-holder table is present, and can be alert-level when parser or market context later shows large overhang.",
  "Primary offerings and mixed registrations should be feed-level when share count, amount, price range, warrants, convertibles, or underwriter terms are disclosed.",
  "Do not calculate dilution percentages, discounts, market-cap ratios, or share-float ratios. Code or a later analysis step handles calculations.",
  "Do not add calendar items for vague from-time-to-time sale language, intended use of proceeds, filing date alone, or boilerplate legal dates.",
  "Calendar candidates are only exact or explicit investor-relevant dates: IPO pricing, first trading/listing, offering closing, registration effectiveness, warrant deadline, lock-up expiration, or financing-linked shareholder approval deadline.",
].join("\n");

export const secS1F1RouterResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "source_form_type",
    "analysis_family",
    "router_action",
    "s1_f1_case",
    "event_type",
    "display_model_type",
    "score_hint",
    "action_hint",
    "summary",
    "key_signals",
    "parser_facts_used",
    "calendar_items",
    "confidence",
    "needs_human_review",
    "debug",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    source_form_type: { type: "string", enum: ["S-1", "S-1/A", "F-1", "F-1/A"] },
    analysis_family: { type: "string", enum: ["sec_s1_f1"] },
    router_action: { type: "string", enum: SEC_S1_F1_ROUTER_ACTION_VALUES },
    s1_f1_case: { type: "string", enum: SEC_S1_F1_ROUTER_CASE_VALUES },
    event_type: { type: "string", enum: SEC_S1_F1_ROUTER_EVENT_TYPE_VALUES },
    display_model_type: {
      type: "string",
      enum: ["offering_terms", "ipo_registration", "share_overhang", "routine_filing", "unknown"],
    },
    score_hint: { type: "integer", minimum: 0, maximum: 100 },
    action_hint: { type: "string", enum: SEC_S1_F1_ROUTER_ACTION_HINT_VALUES },
    summary: { type: "string" },
    key_signals: { type: "array", items: { type: "string" } },
    parser_facts_used: { type: "array", items: { type: "string" } },
    calendar_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["calendar_event_type", "event_date", "date_precision", "evidence", "confidence"],
        properties: {
          calendar_event_type: { type: "string" },
          event_date: { type: ["string", "null"] },
          date_precision: { type: "string", enum: ["exact", "estimated", "range", "unknown"] },
          evidence: { type: ["string", "null"] },
          confidence: { type: "string", enum: SEC_S1_F1_ROUTER_CONFIDENCE_VALUES },
        },
      },
    },
    confidence: { type: "string", enum: SEC_S1_F1_ROUTER_CONFIDENCE_VALUES },
    needs_human_review: { type: "boolean" },
    debug: {
      type: "object",
      additionalProperties: false,
      required: ["parser_version", "router_prompt_key", "router_prompt_version"],
      properties: {
        parser_version: { type: ["string", "null"] },
        router_prompt_key: { type: "string" },
        router_prompt_version: { type: "string" },
      },
    },
  },
} as const;

export function buildSecS1F1RouterPrompt(input: SecS1F1RouterPromptInput) {
  return {
    key: SEC_S1_F1_ROUTER_PROMPT_KEY,
    version: SEC_S1_F1_ROUTER_PROMPT_VERSION,
    system: secS1F1RouterSystemPrompt,
    user: JSON.stringify(buildSecS1F1RouterPromptInput(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_s1_f1_router",
        strict: true,
        schema: secS1F1RouterResponseSchema,
      },
    },
  };
}

function buildSecS1F1RouterPromptInput(input: SecS1F1RouterPromptInput) {
  const filingPackage = input.filing_package || {};
  const parserFacts = input.parser_facts || readRecord(readRecord(filingPackage.hard_parsers)?.s1_f1) || null;

  return {
    filing_package: {
      source_group: filingPackage.source_group || "filings",
      source_code: filingPackage.source_code || null,
      raw_item_id: filingPackage.raw_item_id || null,
      accession_number: filingPackage.accession_number || null,
      cik: filingPackage.cik || null,
      company_name: filingPackage.company_name || null,
      primary_ticker: filingPackage.primary_ticker || null,
      form_type: filingPackage.form_type || null,
      filed_at: filingPackage.filed_at || null,
      filing_detail_url: filingPackage.filing_detail_url || null,
      primary_document_url: filingPackage.primary_document_url || null,
      documents: Array.isArray(filingPackage.documents) ? filingPackage.documents : [],
      parser_facts: parserFacts,
      llm_text: trimForPrompt(stringValue(filingPackage.llm_text), 14_000),
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
