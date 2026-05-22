export const SEC_S4_F4_ROUTER_PROMPT_KEY = "sec_s4_f4_router_draft";
export const SEC_S4_F4_ROUTER_PROMPT_VERSION = "v1";

export const SEC_S4_F4_ROUTER_ACTION_VALUES = [
  "skip_analysis",
  "routine_archive",
  "analyze_transaction",
  "analyze_vote",
  "analyze_dilution_or_transaction",
] as const;

export const SEC_S4_F4_ROUTER_CASE_VALUES = [
  "merger_registration",
  "business_combination",
  "exchange_offer",
  "shareholder_vote",
  "stock_issuance_or_ownership_impact",
  "amendment_limited_scope",
  "amendment_material_change",
  "other_s4_f4",
] as const;

export type SecS4F4RouterPromptInput = {
  filing_package: Record<string, unknown>;
};

export const secS4F4RouterSystemPrompt = [
  "Route one SEC S-4/F-4 family filing package. Return only strict JSON matching the response schema.",
  "This is a form-room draft. Do not assume runtime registry, database, alert, or UI wiring exists.",
  "Use filing text as source of truth. Parser facts are candidate evidence only and may be incomplete or wrong.",
  "Classify by the filing's investor-relevant content, not by form label alone.",
  "The router must distinguish merger registration, business combination, exchange offer, shareholder vote, material amendment, and routine amendment/noise.",
  "Use event_type strategic_transaction for merger registrations, exchange offers, business combinations, acquisition registrations, and deal amendments where deal economics or closing risk is primary.",
  "Use event_type shareholder_vote when the meeting/vote schedule or approval mechanics are the primary actionable event.",
  "Use event_type dilution_risk when registered stock issuance, exchange ratio, post-transaction ownership shift, convertible/warrant stack, or share issuance approval creates a direct dilution/overhang event that should be scored like the S-3 dilution baseline.",
  "For stock consideration in a strategic transaction, preserve strategic_transaction as primary unless the issuance size/ownership impact is the dominant investor risk.",
  "Use event_type financial_risk only when the filing highlights solvency, going concern, debt default, or financing failure risk beyond ordinary deal financing conditions.",
  "Use event_type other only for unsupported or administrative S-4/F-4 filings with a clear reason.",
  "For S-4/A or F-4/A, focus on what changed. Do not repeat the parent transaction as new unless the amendment changes economics, parties, consideration, exchange ratio, meeting/vote dates, regulatory conditions, termination fee, risk factors, or pro forma financials.",
  "Choose skip_analysis for exhibit-only, consent-only, signature-only, typo-only, or unchanged-remainder amendments with no investor-relevant changes.",
  "Choose routine_archive for low-priority administrative amendments worth preserving but not worth feed placement.",
  "Choose analyze_transaction for merger, acquisition, exchange offer, business combination, or material deal-term changes.",
  "Choose analyze_vote for a clear shareholder meeting, merger vote, record date, vote deadline, or approval requirement.",
  "Choose analyze_dilution_or_transaction when stock issuance or ownership transfer should be evaluated for dilution/overhang impact before final analysis.",
  "Apply common SEC action thresholds: score below 50 archive, 50-74 feed, 75+ feed_alert.",
  "Base scoring on specificity, deal materiality, consideration mix, ownership impact, vote/closing timing, termination fees, regulatory risk, and source strength.",
  "Do not calculate dilution percentages, exchange-value economics, premium, spread, or market-cap ratios. Code or a later audit layer handles calculations.",
  "Calendar candidates should include only explicit investor-relevant dates: merger vote, shareholder record date, vote deadline, expected merger closing, outside date, exchange offer expiration, or shareholder approval deadline.",
  "Do not calendar filing dates, proxy mailing mechanics, boilerplate legal dates, or vague future plans.",
  "Keep route_summary under 35 words and router_notes to at most 4 short items.",
].join("\n");

export const secS4F4RouterResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "source_group",
    "source_form_type",
    "analysis_family",
    "router_action",
    "s4_f4_case",
    "event_type",
    "display_model_type",
    "score",
    "action",
    "route_summary",
    "primary_reasons",
    "facts_to_pass",
    "calendar_items",
    "needs_human_review",
    "review_reasons",
  ],
  properties: {
    source_group: { type: "string", enum: ["filings"] },
    source_form_type: { type: "string", enum: ["S-4", "S-4/A", "F-4", "F-4/A"] },
    analysis_family: { type: "string", enum: ["sec_s4_f4"] },
    router_action: { type: "string", enum: SEC_S4_F4_ROUTER_ACTION_VALUES },
    s4_f4_case: { type: "string", enum: SEC_S4_F4_ROUTER_CASE_VALUES },
    event_type: {
      type: "string",
      enum: ["strategic_transaction", "shareholder_vote", "dilution_risk", "financial_risk", "other"],
    },
    display_model_type: {
      type: "string",
      enum: ["strategic_transaction", "shareholder_vote", "offering_terms", "generic_filing", "none"],
    },
    score: { type: "integer", minimum: 0, maximum: 100 },
    action: { type: "string", enum: ["archive", "feed", "feed_alert"] },
    route_summary: { type: "string" },
    primary_reasons: { type: "array", items: { type: "string" } },
    facts_to_pass: {
      type: "object",
      additionalProperties: true,
      required: [
        "deal_type",
        "parties",
        "consideration",
        "exchange_ratio",
        "shares_to_be_issued",
        "ownership_after_transaction",
        "meeting_date",
        "record_date",
        "termination_fee",
      ],
      properties: {
        deal_type: { type: ["string", "null"] },
        parties: { type: "array", items: { type: "string" } },
        consideration: { type: ["string", "null"] },
        exchange_ratio: { type: ["string", "null"] },
        shares_to_be_issued: { type: ["string", "number", "null"] },
        ownership_after_transaction: { type: "array", items: { type: "string" } },
        meeting_date: { type: ["string", "null"] },
        record_date: { type: ["string", "null"] },
        termination_fee: { type: ["string", "null"] },
      },
    },
    calendar_items: { type: "array", items: { type: "object", additionalProperties: true } },
    needs_human_review: { type: "boolean" },
    review_reasons: { type: "array", items: { type: "string" } },
  },
} as const;

export function buildSecS4F4RouterPrompt(input: SecS4F4RouterPromptInput) {
  return {
    key: SEC_S4_F4_ROUTER_PROMPT_KEY,
    version: SEC_S4_F4_ROUTER_PROMPT_VERSION,
    system: secS4F4RouterSystemPrompt,
    user: JSON.stringify(buildRouterPromptInput(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_s4_f4_router",
        strict: true,
        schema: secS4F4RouterResponseSchema,
      },
    },
  };
}

function buildRouterPromptInput(input: SecS4F4RouterPromptInput) {
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const parserFacts = readRecord(hardParsers.s4_f4) || readRecord(filingPackage.parser_facts) || null;
  return {
    filing_package: {
      package_version: filingPackage.package_version || null,
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
      title: filingPackage.title || null,
      filing_detail_url: filingPackage.filing_detail_url || null,
      primary_document_url: filingPackage.primary_document_url || null,
      documents: Array.isArray(filingPackage.documents) ? filingPackage.documents : [],
      parser_candidates: {
        warning: "Candidate extraction only. Router must verify against source text.",
        s4_f4: parserFacts,
      },
      llm_text: trimForPrompt(stringValue(filingPackage.llm_text), 18_000),
      package_stats: filingPackage.package_stats || null,
    },
  };
}

function trimForPrompt(value: string, max: number) {
  const normalized = value.replace(/\s+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 12).trim()}\n[TRUNCATED]` : normalized;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
