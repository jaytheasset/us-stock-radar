import {
  SEC_FORM25_APPROVED_EVENT_TYPES,
  SEC_FORM25_DISPLAY_PAYLOAD_VERSION,
  SEC_FORM25_DISPLAY_TYPE_VALUES,
  SEC_FORM25_PARSER_VERSION,
  type SecForm25ParserOutput,
} from "./parser";
import { buildSecSourceBlockPromptInput } from "../common/sourceBlockPromptInput";

export const SEC_FORM25_ROUTER_PROMPT_KEY = "sec_form25_router_draft";
export const SEC_FORM25_ROUTER_PROMPT_VERSION = "v1";

export const SEC_FORM25_ROUTER_CONFIDENCE_VALUES = ["high", "medium", "low"] as const;
export const SEC_FORM25_ROUTER_CASE_VALUES = [
  "common_equity_delisting_risk",
  "merger_completion_removal",
  "matured_redeemed_retired_non_common",
  "voluntary_withdrawal_continued_listing_or_transfer",
  "ambiguous_units_or_ads",
  "missing_or_unclear_reason",
  "other_form25",
] as const;

export type SecForm25RouterPromptInput = {
  parser_output: SecForm25ParserOutput;
  fixture_context?: Record<string, unknown> | null;
};

export const secForm25RouterSystemPrompt = [
  "Classify one SEC Form 25 / 25-NSE filing only when the parser marks routing as required.",
  "Return only strict JSON matching the provided schema.",
  "Use current_filing.form_type exactly when naming the SEC form. Do not substitute another Form 25 variant.",
  "Do not ask for or rely on full raw filing text. The user payload intentionally contains only cleaned_source_blocks.",
  "Do not use parser-generated facts, signals, route hints, routing flags, extraction summaries, event labels, display labels, or investment labels as classification authority.",
  "Choose exactly one approved SEC event_type only when security type, removal reason, or investor impact is ambiguous.",
  "Choose one approved display_type and display_version for the detail UI. Do not create display types.",
  "Do not score the event and do not choose delivery level. Delivery is derived later from the analysis score only.",
  "Likely Form 25 event_type candidates are listing_risk, strategic_transaction, financial_risk, legal_risk, and other.",
  "ipo_listing is approved globally, but use it only when the main event is a traditional IPO, SPAC IPO, direct listing, IPO pricing, first trading/listing date, or registration effectiveness tied to a new public listing.",
  "Do not use ipo_listing for ordinary resale registration, shelf offering, ATM/offering dilution, already-listed issuer resale, post-closing business update, SPAC redemption, liquidation, or de-SPAC follow-up unless the main event is the IPO/listing itself.",
  "Route common stock, ordinary share, or unresolved ADS delisting risk to listing_risk unless a clear merger-completion or continued-listing transfer explains the removal.",
  "Route clear completed-merger removals to strategic_transaction unless the facts show only an administrative cleanup that should be archived.",
  "Route matured, redeemed, retired, or paid-at-maturity non-common securities to other when common equity is not affected and no source evidence shows credit or legal stress.",
  "Use financial_risk or listing_risk for matured, redeemed, retired, or paid-at-maturity non-common securities only when source evidence mentions unresolved credit stress, default, bankruptcy, non-compliance, or legal proceedings.",
  "Use financial_risk or legal_risk only when source evidence mentions bankruptcy, insolvency, litigation, receivership, default, or legal proceedings.",
  "If security class, removal reason, common equity effect, or continued venue is unclear, choose low confidence, needs_human_review true, and set analysis_llm_needed true.",
].join("\n");

export const secForm25RouterResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "source_form_type",
    "analysis_family",
    "event_type",
    "display_type",
    "display_version",
    "confidence",
    "route_case",
    "routing_reason",
    "analysis_llm_needed",
    "evidence",
    "source_blocks_used",
    "needs_human_review",
    "debug",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    source_form_type: { type: "string" },
    analysis_family: { type: "string", enum: ["sec_form25_listing_removal"] },
    event_type: { type: "string", enum: SEC_FORM25_APPROVED_EVENT_TYPES },
    display_type: { type: "string", enum: SEC_FORM25_DISPLAY_TYPE_VALUES },
    display_version: { type: "string", enum: [SEC_FORM25_DISPLAY_PAYLOAD_VERSION] },
    confidence: { type: "string", enum: SEC_FORM25_ROUTER_CONFIDENCE_VALUES },
    route_case: { type: "string", enum: SEC_FORM25_ROUTER_CASE_VALUES },
    routing_reason: { type: "string" },
    analysis_llm_needed: { type: "boolean" },
    evidence: { type: "array", items: { type: "string" } },
    source_blocks_used: { type: "array", items: { type: "string" } },
    needs_human_review: { type: "boolean" },
    debug: {
      type: "object",
      additionalProperties: false,
      required: ["parser_version", "router_prompt_key", "router_prompt_version"],
      properties: {
        parser_version: { type: "string", enum: [SEC_FORM25_PARSER_VERSION] },
        router_prompt_key: { type: "string", enum: [SEC_FORM25_ROUTER_PROMPT_KEY] },
        router_prompt_version: { type: "string", enum: [SEC_FORM25_ROUTER_PROMPT_VERSION] },
      },
    },
  },
} as const;

export function buildSecForm25RouterPromptDraft(input: SecForm25RouterPromptInput) {
  return {
    key: SEC_FORM25_ROUTER_PROMPT_KEY,
    version: SEC_FORM25_ROUTER_PROMPT_VERSION,
    system: secForm25RouterSystemPrompt,
    user: JSON.stringify(buildSecForm25RouterInput(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_form25_router",
        strict: true,
        schema: secForm25RouterResponseSchema,
      },
    },
  };
}

export function buildSecForm25RouterInput(input: SecForm25RouterPromptInput) {
  return buildSecSourceBlockPromptInput({
    parserOutput: input.parser_output as unknown as Record<string, unknown>,
    marketContext: input.fixture_context,
  });
}

function compactField<T>(field: { value: T; evidence: string; source: string; confidence: string } | null) {
  if (!field) return null;
  return {
    value: field.value,
    evidence: truncate(field.evidence, 360),
    source: field.source,
    confidence: field.confidence,
  };
}

function summarizeSourceInventory(parserOutput: SecForm25ParserOutput) {
  const inventory = parserOutput.raw.sourceInventory;
  return {
    document_count: inventory.documents.length,
    documents: inventory.documents.map((document) => ({
      type: document.type,
      description: document.description,
      url_present: document.url_present,
      is_primary: document.is_primary,
      text_char_count: document.text_char_count,
      text_truncated: document.text_truncated,
      fetch_status: document.fetch_status,
      fetch_error: document.fetch_error,
    })),
    attachment_count: inventory.attachments.length,
    attachments: inventory.attachments.map((attachment) => ({
      type: attachment.type,
      description: attachment.description,
      source: attachment.source,
      text_char_count: attachment.text_char_count,
      text_truncated: attachment.text_truncated,
      table_count: attachment.table_count,
    })),
    table_counts: inventory.table_counts,
    truncation_notes: inventory.truncation_notes,
  };
}

function truncate(value: string, max: number) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}
