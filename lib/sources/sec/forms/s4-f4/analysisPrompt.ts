export const SEC_S4_F4_ANALYSIS_PROMPT_KEY = "sec_s4_f4_analysis_draft";
export const SEC_S4_F4_ANALYSIS_PROMPT_VERSION = "v1";

export type SecS4F4AnalysisPromptInput = {
  filing_package: Record<string, unknown>;
};

export const secS4F4AnalysisSystemPrompt = [
  "Analyze one SEC S-4/F-4 family filing package and return only strict JSON matching the provided response schema.",
  "This is a form-room draft. Do not assume runtime registry, DB, alert, or detail UI wiring exists.",
  "Use the filing text as source of truth. Parser facts, router output, and market context are aids, not authority.",
  "Classify by investor-relevant content. S-4/F-4 forms can be strategic transactions, shareholder votes, dilution/ownership-impact events, financial risk, or routine administrative filings.",
  "For merger registrations, business combinations, exchange offers, and acquisition registrations, use event_type strategic_transaction unless the vote schedule or dilution impact is clearly the primary event.",
  "For meeting notices, merger votes, vote deadlines, record dates, and approval requirements, use event_type shareholder_vote when that schedule is the actionable item.",
  "For stock consideration, registered shares to be issued, exchange ratios, ownership transfer, warrants, convertibles, or share issuance approvals, evaluate dilution_risk using the S-3 offering baseline where issuance impact matters.",
  "Do not calculate dilution percentages, ownership percentages, premium, spread, exchange value, market-cap ratios, or discount to market unless code-supplied market_context or dilution_metrics already provides them.",
  "If code-supplied dilution_metrics are present, use them for score calibration but do not describe calculated values as filing facts unless the filing supports the underlying share or dollar inputs.",
  "Separate deal structure from shareholder impact: consideration tells what holders receive, while ownership_after_transaction and shares_to_be_issued describe dilution or control transfer.",
  "Separate cash consideration from stock consideration. Do not treat resale or registered shares as issuer cash proceeds.",
  "Do not call a registration statement effective unless the filing says it is effective or code/router context supplies effectiveness.",
  "For amendments, analyze only what changed. Exhibit-only, consent-only, signature-only, typo-only, or unchanged-remainder amendments should be archived with event_type other and score below 20.",
  "Material S-4/A or F-4/A changes include consideration, exchange ratio, meeting date, record date, vote threshold, termination fee, outside date, regulatory condition, risk factors, or pro forma financials.",
  "Score routine administrative amendments 0-19 and action archive.",
  "Score real but low-urgency transaction registration or vote context 50-74 and action feed.",
  "Score 75-89 when the filing has a near-term vote/deadline, material stock issuance/ownership impact, changed economics, high closing risk, meaningful termination fees, or active exchange-offer timing.",
  "Score 90-100 only for urgent or severe cases: imminent vote/expiration plus large ownership impact, coercive exchange offer, failing financing condition, severe closing risk, or code-supplied severe dilution metrics.",
  "Apply common SEC action thresholds exactly: score below 50 action archive, 50-74 action feed, 75+ action feed_alert.",
  "Calendar items must come only from explicit dates or deadlines: merger vote, shareholder meeting, record date, vote deadline, exchange offer expiration, expected merger closing, outside date, or financing-related shareholder approval deadline.",
  "Do not calendar filing dates, proxy mailing mechanics, generic future plans, boilerplate dates, or expected synergies.",
  "Keep summary 1-3 sentences under 75 words total. Keep why_it_matters one sentence under 35 words.",
  "Keep key_points and risks to at most 4 items each, each under 18 words.",
  "The display_model should be compact and structured for a future detail UI, but do not invent fields that are not supported by the source.",
].join("\n");

export const secS4F4AnalysisResponseSchema = {
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
    source_form_type: { type: "string", enum: ["S-4", "S-4/A", "F-4", "F-4/A"] },
    analysis_family: { type: "string", enum: ["sec_s4_f4"] },
    event_type: {
      type: "string",
      enum: ["strategic_transaction", "shareholder_vote", "dilution_risk", "financial_risk", "other"],
    },
    display_model_type: {
      type: "string",
      enum: ["strategic_transaction", "shareholder_vote", "offering_terms", "generic_filing", "none"],
    },
    score: { type: "integer", minimum: 0, maximum: 100 },
    severity: { type: "string", enum: ["low", "moderate", "high", "severe", "unknown"] },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    action: { type: "string", enum: ["archive", "feed", "feed_alert"] },
    summary: { type: "string" },
    why_it_matters: { type: "string" },
    key_points: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    parser_facts: { type: "object", additionalProperties: true },
    router: { type: "object", additionalProperties: true },
    market_context: { type: ["object", "null"], additionalProperties: true },
    display_model: {
      type: "object",
      additionalProperties: false,
      required: [
        "headline",
        "deal_type",
        "parties",
        "consideration",
        "stock_issuance",
        "ownership_impact",
        "vote",
        "conditions",
        "fees",
        "financial_references",
        "review_reasons",
      ],
      properties: {
        headline: { type: "string" },
        deal_type: { type: ["string", "null"] },
        parties: { type: "array", items: { type: "string" } },
        consideration: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "cash_component", "stock_component", "exchange_ratio", "evidence"],
          properties: {
            summary: { type: ["string", "null"] },
            cash_component: { type: ["string", "null"] },
            stock_component: { type: ["string", "null"] },
            exchange_ratio: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        stock_issuance: {
          type: "object",
          additionalProperties: false,
          required: ["securities_registered", "shares_to_be_issued", "dilution_note", "evidence"],
          properties: {
            securities_registered: { type: "array", items: { type: "string" } },
            shares_to_be_issued: { type: ["string", "number", "null"] },
            dilution_note: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        ownership_impact: {
          type: "object",
          additionalProperties: false,
          required: ["summary", "post_transaction_ownership", "control_or_vote_shift", "evidence"],
          properties: {
            summary: { type: ["string", "null"] },
            post_transaction_ownership: { type: "array", items: { type: "string" } },
            control_or_vote_shift: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        vote: {
          type: "object",
          additionalProperties: false,
          required: ["meeting_date", "record_date", "vote_deadline", "vote_requirement", "evidence"],
          properties: {
            meeting_date: { type: ["string", "null"] },
            record_date: { type: ["string", "null"] },
            vote_deadline: { type: ["string", "null"] },
            vote_requirement: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        conditions: { type: "array", items: { type: "string" } },
        fees: {
          type: "object",
          additionalProperties: false,
          required: ["termination_fee", "outside_date", "evidence"],
          properties: {
            termination_fee: { type: ["string", "null"] },
            outside_date: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        financial_references: {
          type: "object",
          additionalProperties: false,
          required: ["risk_factors", "financial_statements", "pro_forma", "evidence"],
          properties: {
            risk_factors: { type: ["string", "null"] },
            financial_statements: { type: ["string", "null"] },
            pro_forma: { type: ["string", "null"] },
            evidence: { type: ["string", "null"] },
          },
        },
        review_reasons: { type: "array", items: { type: "string" } },
      },
    },
    calendar_items: { type: "array", items: { type: "object", additionalProperties: true } },
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

export function buildSecS4F4AnalysisPrompt(input: SecS4F4AnalysisPromptInput) {
  return {
    key: SEC_S4_F4_ANALYSIS_PROMPT_KEY,
    version: SEC_S4_F4_ANALYSIS_PROMPT_VERSION,
    system: secS4F4AnalysisSystemPrompt,
    user: JSON.stringify(buildAnalysisPromptInput(input)),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_s4_f4_analysis",
        strict: true,
        schema: secS4F4AnalysisResponseSchema,
      },
    },
  };
}

function buildAnalysisPromptInput(input: SecS4F4AnalysisPromptInput) {
  const filingPackage = readRecord(input.filing_package) || {};
  const hardParsers = readRecord(filingPackage.hard_parsers) || {};
  const parserFacts = readRecord(hardParsers.s4_f4) || readRecord(filingPackage.parser_facts) || null;
  const router = readRecord(filingPackage.router) || readRecord(filingPackage.s4_f4_router) || null;

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
        warning: "Candidate extraction only. Analysis must verify against source text.",
        s4_f4: parserFacts,
      },
      router,
      market_context: filingPackage.market_context || null,
      dilution_metrics: filingPackage.dilution_metrics || null,
      llm_text: trimForPrompt(stringValue(filingPackage.llm_text), 22_000),
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
