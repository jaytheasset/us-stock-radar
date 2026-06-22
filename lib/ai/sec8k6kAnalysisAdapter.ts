import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  buildSec8k6kAnalysisPromptDraft,
  buildSec8k6kDisplayPayload,
  buildSec8k6kRouterPromptDraft,
} from "@/lib/sources/sec/forms/8k-6k/adapter";
import {
  SEC_8K_6K_ANALYSIS_PROMPT_KEY,
  SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
} from "@/lib/sources/sec/forms/8k-6k/analysisPrompt";
import {
  SEC_8K_6K_ROUTER_PROMPT_KEY,
  SEC_8K_6K_ROUTER_PROMPT_VERSION,
} from "@/lib/sources/sec/forms/8k-6k/routerPrompt";

export {
  SEC_8K_6K_ANALYSIS_PROMPT_KEY,
  SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
  SEC_8K_6K_ROUTER_PROMPT_KEY,
  SEC_8K_6K_ROUTER_PROMPT_VERSION,
};

export type Sec8k6kAnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isSec8k6kFilingInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSec8k6kParserOutput(input);
  return Boolean(parserOutput && parserOutput.isSupported !== false);
}

export function buildSec8k6kRouterPromptForInput(input: SecFilingAnalysisInput) {
  const promptInput = buildSec8k6kPromptInput(input);
  return buildSec8k6kRouterPromptDraft(promptInput);
}

export function buildSec8k6kAnalysisPromptForInput(
  input: SecFilingAnalysisInput,
  routerResult: Record<string, unknown>,
) {
  const promptInput = buildSec8k6kPromptInput(input);
  const prompt = buildSec8k6kAnalysisPromptDraft({
    ...promptInput,
    router_result: routerResult,
    market_context: readMarketContext(input),
  });
  return {
    ...prompt,
    system: [
      prompt.system,
      "Runtime integration note: display_payload is supplied in the analysis input and rebuilt by integration for persistence. Return only the runtime response schema fields; do not include display_payload unless the schema explicitly asks for it.",
      "Runtime scoring note: when router_result.analysis_needed is true, router_result.score is only an archive-gate placeholder. Assign analysis_output.score from cleaned_source_blocks, score policy, urgency, and evidence instead of copying the router placeholder.",
    ].join("\n"),
    responseFormat: {
      json_schema: {
        name: "sec_8k_6k_runtime_analysis",
        strict: true,
        schema: sec8k6kRuntimeAnalysisResponseSchema,
      },
    },
  };
}

export function shouldRunSec8k6kAnalysis(routerResult: Record<string, unknown>) {
  if (routerResult.analysis_needed === true) return true;
  const score = numberValue(routerResult.score);
  return score !== null && score >= 50;
}

export function normalizeSec8k6kRouterResult(value: Record<string, unknown>) {
  const score = numberValue(value.score);
  const analysisNeeded = value.analysis_needed === true || (score !== null && score >= 50);
  const normalizedScore = analysisNeeded ? 50 : Math.min(49, Math.max(0, Math.round(score ?? 0)));

  return {
    ...value,
    score: normalizedScore,
    delivery_level: analysisNeeded ? "feed" : "archive",
    analysis_needed: analysisNeeded,
    display_type: normalizeRouterDisplayType(value.display_type),
    display_version: normalizeRouterDisplayVersion(value.display_version, normalizeRouterDisplayType(value.display_type)),
    router_score_normalized_by_integration: score !== normalizedScore || value.delivery_level === "alert",
  };
}

export function buildSec8k6kArchiveAnalysis(
  input: SecFilingAnalysisInput,
  routerResult: Record<string, unknown>,
): Sec8k6kAnalysisAdapterResult {
  const parserOutput = readSec8k6kParserOutput(input);
  if (!parserOutput) {
    return {
      ok: false,
      error: "SEC 8-K/6-K parser output is missing from filing package",
    };
  }

  const filingPackage = readFilingPackage(input);
  const facts = readRecord(parserOutput.facts) || {};
  const primaryTicker = readPrimaryTicker(filingPackage, facts);
  const score = clampScore(numberValue(routerResult.score) ?? 0);
  const displayPayload = buildDisplayPayload(parserOutput, routerResult, readMarketContext(input));
  const archiveSummary =
    stringValue(readRecord(displayPayload.data)?.archive_summary) ||
    stringValue(routerResult.routing_reason) ||
    stringValue(parserOutput.summary) ||
    "Low-signal 8-K/6-K filing with limited market impact.";
  const evidence = readStringArray(routerResult.evidence).length
    ? readStringArray(routerResult.evidence).slice(0, 8)
    : readStringArray(displayPayload.evidence).slice(0, 8);
  const eventType = normalizeEventType(stringValue(routerResult.event_type));

  return {
    ok: true,
    analysis: normalize8k6kAnalysisForPersistence(
      {
        source_group: "filings",
        market_scope: "company",
        event_type: eventType,
        event_title: buildArchiveEventTitle(filingPackage, facts, eventType),
        primary_ticker: primaryTicker,
        tickers: primaryTicker.ticker ? [primaryTicker.ticker] : [],
        sector: null,
        industry_group: null,
        theme_group: null,
        sub_theme: null,
        score,
        score_reason: stringValue(routerResult.routing_reason) || archiveSummary,
        signal: "neutral",
        quick_take: archiveSummary,
        summary: archiveSummary,
        why_it_matters: "Limited market impact detected from the current filing.",
        bullish_points: [],
        bearish_points: [],
        key_evidence: evidence,
        what_to_watch_next: [],
        related_tickers: [],
        calendar_items: [],
        confidence: normalizeConfidence(stringValue(routerResult.confidence)),
        needs_human_review: routerResult.needs_parent_context === true,
        archive_summary: archiveSummary,
        display_payload: displayPayload,
        sec_8k_6k_router_result: routerResult,
        sec_8k_6k_analysis_case: stringValue(routerResult.route_case) || null,
        source_blocks_used: readStringArray(routerResult.source_blocks_used),
      },
      input,
    ),
  };
}

export function adaptSec8k6kAnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
  routerResult: Record<string, unknown>,
): Sec8k6kAnalysisAdapterResult {
  const root = readRecord(value);
  if (!root) {
    return {
      ok: false,
      error: "SEC 8-K/6-K analysis response did not contain a JSON object",
    };
  }

  const analysisOutput = readRecord(root.analysis_output);
  if (!analysisOutput) {
    return {
      ok: false,
      error: "SEC 8-K/6-K analysis response did not contain analysis_output",
    };
  }

  const parserOutput = readSec8k6kParserOutput(input);
  if (!parserOutput) {
    return {
      ok: false,
      error: "SEC 8-K/6-K parser output is missing from filing package",
    };
  }

  const displayPayload = buildDisplayPayload(parserOutput, routerResult, readMarketContext(input));
  const score = clampScore(numberValue(analysisOutput.score) ?? numberValue(routerResult.score) ?? 0);
  const archiveSummary =
    nullableString(analysisOutput.archive_summary) ||
    (score < 50 ? nullableString(readRecord(displayPayload.data)?.archive_summary) || nullableString(analysisOutput.summary) : null);

  return {
    ok: true,
    analysis: normalize8k6kAnalysisForPersistence(
      {
        ...analysisOutput,
        event_type: normalizeEventType(stringValue(analysisOutput.event_type) || stringValue(routerResult.event_type)),
        score,
        archive_summary: archiveSummary,
        display_payload: displayPayload,
        sec_8k_6k_router_result: routerResult,
        sec_8k_6k_analysis_case: stringValue(root.analysis_case) || null,
        source_blocks_used: readStringArray(root.source_blocks_used),
      },
      input,
    ),
  };
}

function buildSec8k6kPromptInput(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const parserOutput = readSec8k6kParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC 8-K/6-K parser output is missing from filing package");
  }

  return {
    filing_package: filingPackage,
    parser_output: parserOutput,
    filing_excerpt: stringValue(filingPackage.llm_text) || null,
    parent_filing_context: readRecord(filingPackage.parent_filing_context) || null,
  };
}

function normalize8k6kAnalysisForPersistence(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const primaryTicker = normalizePrimaryTicker(readRecord(value.primary_ticker), filingPackage);

  return {
    ...value,
    source_group: stringValue(value.source_group) || "filings",
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
      reason: "Primary ticker from SEC filing package",
    });
  }

  return normalized;
}

function buildDisplayPayload(
  parserOutput: Record<string, unknown>,
  routerResult: Record<string, unknown>,
  marketContext: Record<string, unknown> | null,
) {
  return buildSec8k6kDisplayPayload({
    parser_output: parserOutput,
    router_result: routerResult,
    market_context: marketContext,
  });
}

function readSec8k6kParserOutput(input: SecFilingAnalysisInput): Record<string, unknown> | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return readRecord(hardParsers?.["8k-6k"]);
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function readMarketContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.market_context) || readRecord(filingPackage.marketContext) || null;
}

function readPrimaryTicker(filingPackage: Record<string, unknown>, facts: Record<string, unknown>) {
  const packageTicker = readRecord(filingPackage.primary_ticker);
  const ticker = stringValue(packageTicker?.ticker) || stringValue(facts.ticker);
  const exchange = stringValue(packageTicker?.exchange);
  return {
    ticker: ticker || null,
    exchange: exchange || null,
  };
}

function normalizePrimaryTicker(value: Record<string, unknown> | null, filingPackage: Record<string, unknown>) {
  const fallback = readRecord(filingPackage.primary_ticker);
  return {
    ticker: stringValue(value?.ticker) || stringValue(fallback?.ticker) || null,
    exchange: stringValue(value?.exchange) || stringValue(fallback?.exchange) || null,
  };
}

function buildArchiveEventTitle(filingPackage: Record<string, unknown>, facts: Record<string, unknown>, eventType: string) {
  const ticker = stringValue(readRecord(filingPackage.primary_ticker)?.ticker) || stringValue(facts.ticker);
  const formType = stringValue(filingPackage.form_type) || stringValue(facts.secFormType) || "8-K/6-K";
  const company = stringValue(filingPackage.company_name) || stringValue(facts.companyName) || ticker || "Issuer";
  const label = eventType === "other" ? "current report" : eventType.replace(/_/g, " ");
  return `${ticker || company} ${formType} ${label}`;
}

function normalizeEventType(value: string) {
  const allowed = new Set([
    "listing_risk",
    "dilution_risk",
    "ipo_listing",
    "earnings",
    "sales_performance",
    "product_update",
    "leadership_governance",
    "insider_ownership",
    "shareholder_vote",
    "strategic_transaction",
    "financial_risk",
    "legal_risk",
    "dividends",
    "capital_return",
    "fda_clinical",
    "other",
  ]);
  return allowed.has(value) ? value : "other";
}

function normalizeRouterDisplayType(value: unknown) {
  const displayType = stringValue(value);
  if (displayType === "offering_terms" || displayType === "spac_transaction_status" || displayType === "candidate_special") {
    return displayType;
  }
  return "generic";
}

function normalizeRouterDisplayVersion(value: unknown, displayType: string) {
  const version = stringValue(value);
  if (
    version === "sec_8k_6k_generic_v1" ||
    version === "sec_8k_6k_offering_terms_v1" ||
    version === "sec_8k_6k_spac_transaction_status_v1" ||
    version === "sec_8k_6k_candidate_special_v1"
  ) {
    return version;
  }
  if (displayType === "offering_terms") return "sec_8k_6k_offering_terms_v1";
  if (displayType === "spac_transaction_status") return "sec_8k_6k_spac_transaction_status_v1";
  if (displayType === "candidate_special") return "sec_8k_6k_candidate_special_v1";
  return "sec_8k_6k_generic_v1";
}

function normalizeConfidence(value: string) {
  return value === "high" || value === "low" ? value : "medium";
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

const sec8k6kRuntimeAnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["analysis_output", "analysis_case", "source_blocks_used", "debug"],
  properties: {
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
        market_scope: { type: "string", enum: ["company", "sector", "theme", "macro"] },
        event_type: {
          type: "string",
          enum: [
            "listing_risk",
            "dilution_risk",
            "ipo_listing",
            "earnings",
            "sales_performance",
            "product_update",
            "leadership_governance",
            "insider_ownership",
            "shareholder_vote",
            "strategic_transaction",
            "financial_risk",
            "legal_risk",
            "dividends",
            "capital_return",
            "fda_clinical",
            "other",
          ],
        },
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
        tickers: { type: "array", items: { type: "string" } },
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
        related_tickers: { type: "array", items: { type: "string" } },
        calendar_items: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "dateText", "evidence"],
            properties: {
              label: { type: "string" },
              dateText: { type: "string" },
              evidence: { type: "string" },
            },
          },
        },
        confidence: { type: "string", enum: ["high", "medium", "low"] },
        needs_human_review: { type: "boolean" },
      },
    },
    analysis_case: {
      type: "string",
      enum: [
        "listing_risk",
        "dilution_or_offering",
        "ipo_listing",
        "earnings_or_results",
        "sales_or_operating_update",
        "product_or_commercial_update",
        "leadership_or_governance",
        "insider_or_control_update",
        "shareholder_vote",
        "strategic_transaction",
        "financial_distress_or_default",
        "legal_or_regulatory_risk",
        "dividend",
        "capital_return",
        "fda_or_clinical",
        "routine_amendment",
        "material_amendment",
        "other_8k_6k",
      ],
    },
    source_blocks_used: { type: "array", items: { type: "string" } },
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
