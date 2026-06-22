import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { buildSecRequiredOutputSchema } from "@/lib/ai/secRequiredOutputSchema";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import {
  buildSc13AnalysisPrompt,
  buildSc13DeterministicResult,
  SC13_ANALYSIS_PROMPT_VERSION,
} from "@/lib/sources/sec/forms/sc13/analysisPrompt";
import {
  buildSc13RouterPrompt,
  SC13_OWNERSHIP_DISPLAY_VERSION,
  SC13_ROUTER_PROMPT_VERSION,
} from "@/lib/sources/sec/forms/sc13/routerPrompt";
import type { Sc13ParserOutput, Sc13RouteDecision } from "@/lib/sources/sec/forms/sc13/types";

export const SEC_SC13_ROUTER_PROMPT_KEY = "sec_sc13_router";
export const SEC_SC13_ROUTER_PROMPT_VERSION = SC13_ROUTER_PROMPT_VERSION;
export const SEC_SC13_ANALYSIS_PROMPT_KEY = "sec_sc13_analysis";
export const SEC_SC13_ANALYSIS_PROMPT_VERSION = SC13_ANALYSIS_PROMPT_VERSION;

export type SecSc13AnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };
export type SecSc13RuntimeRouterResult = Sc13RouteDecision & Record<string, unknown>;

export function isSc13FilingInput(input: SecFilingAnalysisInput) {
  return Boolean(readSc13ParserOutput(input));
}

export function buildDeterministicSc13Analysis(input: SecFilingAnalysisInput): SecSc13AnalysisAdapterResult | null {
  const parserOutput = readSc13ParserOutput(input);
  if (!parserOutput) return null;

  const deterministicResult = buildSc13DeterministicResult(parserOutput);
  if (!deterministicResult) return null;

  return adaptSc13RoomResultForAnalysis(deterministicResult, input, null);
}

export function buildSecSc13RouterPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSc13ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC SC13 parser output is missing from filing package");
  }

  return {
    key: SEC_SC13_ROUTER_PROMPT_KEY,
    version: SEC_SC13_ROUTER_PROMPT_VERSION,
    system: [
      "Route one SEC Schedule 13D/13G filing from cleaned source blocks only.",
      "Return only JSON. Do not return final Required Output JSON.",
      "Router chooses event_type/display_type/display_version. Analysis later writes investor-facing copy and score.",
      "Do not use parser facts, signals, classification handoffs, route hints, extraction summaries, event labels, display labels, or investment labels as classification authority.",
      "Do not call live DB, market data, SEC, alerts, ingest, or UI code.",
    ].join("\n"),
    user: buildSc13RouterPrompt(parserOutput, {
      marketContext: readMarketContext(input),
    }),
    responseFormat: {
      json_schema: {
        name: "sec_sc13_runtime_router",
        strict: false,
        schema: sc13RouterResponseSchema,
      },
    },
  };
}

export function normalizeSecSc13RouterResult(value: unknown): SecSc13RuntimeRouterResult {
  const root = readRecord(value) || {};
  const eventType = normalizeEventType(stringValue(root.event_type));
  const displayType = normalizeDisplayType(stringValue(root.display_type));
  const preliminaryAction = normalizePreliminaryAction(stringValue(root.preliminary_action));
  const requiresAnalysis =
    root.requires_analysis_llm === true ||
    (root.requires_analysis_llm !== false && preliminaryAction !== "archive");

  return {
    event_type: eventType,
    preliminary_action: preliminaryAction,
    display_type: displayType,
    display_version: stringValue(root.display_version) || SC13_OWNERSHIP_DISPLAY_VERSION,
    requires_analysis_llm: requiresAnalysis,
    reason: stringValue(root.reason) || stringValue(root.routing_reason) || "SC13 router selected this route from source blocks.",
    confidence: normalizeConfidence(stringValue(root.confidence)),
    deterministic: root.deterministic === true,
  } as SecSc13RuntimeRouterResult;
}

export function shouldRunSecSc13Analysis(routerResult: SecSc13RuntimeRouterResult) {
  void routerResult;
  return true;
}

export function buildSecSc13AnalysisPromptForInput(
  input: SecFilingAnalysisInput,
  routerResult: SecSc13RuntimeRouterResult | null = null,
) {
  const parserOutput = readSc13ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC SC13 parser output is missing from filing package");
  }

  return {
    key: SEC_SC13_ANALYSIS_PROMPT_KEY,
    version: SEC_SC13_ANALYSIS_PROMPT_VERSION,
    system: [
      "Analyze one SEC Schedule 13D/13G filing from cleaned source blocks.",
      "Return the full Required Output JSON shape.",
      "There is no SC13 router LLM in the live flow. Choose event_type, display_type, score, signal, and investor-facing copy from the source blocks.",
      "Score means investor attention and urgency. Delivery is derived later from score only.",
      "Do not use parser facts/signals/classification handoffs as analysis authority.",
    ].join("\n"),
    user: buildSc13AnalysisPrompt(parserOutput, routerResult, {
      marketContext: readMarketContext(input),
      parentFilingContext: readParentFilingContext(input),
    }),
    responseFormat: {
      json_schema: {
        name: "sec_sc13_required_output",
        strict: false,
        schema: sc13RequiredOutputSchema,
      },
    },
  };
}

export function buildSecSc13ArchiveAnalysis(
  input: SecFilingAnalysisInput,
  routerResult: SecSc13RuntimeRouterResult,
): SecSc13AnalysisAdapterResult {
  void input;
  void routerResult;
  return {
    ok: false,
    error: "SEC SC13 parser/router archive short-circuit is disabled; run the analysis LLM so display_payload is LLM-authored.",
  };
}

export function adaptSecSc13AnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
  routerResult: SecSc13RuntimeRouterResult | null = null,
): SecSc13AnalysisAdapterResult {
  return adaptSc13RoomResultForAnalysis(value, input, routerResult);
}

function adaptSc13RoomResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
  routerResult: Sc13RouteDecision | null,
): SecSc13AnalysisAdapterResult {
  const parserOutput = readSc13ParserOutput(input);
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const llmDisplayPayload = readRecord(root?.display_payload);
  if (!parserOutput || !analysisOutput || !llmDisplayPayload) {
    return {
      ok: false,
      error: "SEC SC13 result did not contain parser_output, analysis_output, and LLM display_payload",
    };
  }

  const route = routerResult || normalizeSecSc13RouterResult({ event_type: analysisOutput.event_type });
  const displayPayload = normalizeSc13DisplayPayloadForValidation(
    llmDisplayPayload,
  );
  const displayPayloadError = validateSc13RuntimeDisplayPayload(displayPayload);
  if (displayPayloadError) {
    return {
      ok: false,
      error: displayPayloadError,
    };
  }

  const normalizedAnalysisOutput = normalizeSc13AnalysisOutput(
    {
      ...analysisOutput,
      event_type: route.event_type || stringValue(analysisOutput.event_type) || "other",
    },
    input,
  );
  const requiredOutput = {
    parser_output: parserOutput,
    analysis_output: normalizedAnalysisOutput,
    display_payload: displayPayload,
  };
  const adapted = adaptSecFormRoomOutputForIngest(requiredOutput);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC SC13 Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: sc13AdapterOutputToAnalysis(adapted.value, routerResult ? route : null),
  };
}

function normalizeSc13DisplayPayloadForValidation(value: Record<string, unknown>) {
  return {
    ...value,
    notes: normalizeDisplayPayloadNotes(value.notes),
  };
}

function validateSc13RuntimeDisplayPayload(value: Record<string, unknown>) {
  const data = readRecord(value.data);
  if (!data || Object.keys(data).length === 0) {
    return "SEC SC13 display_payload.data must be filled by the analysis LLM";
  }
  if (!Object.prototype.hasOwnProperty.call(data, "issuerName")) {
    return "SEC SC13 display_payload.data.issuerName is required";
  }
  if (!Array.isArray(data.reportingPersons)) {
    return "SEC SC13 display_payload.data.reportingPersons is required";
  }
  if (!Object.prototype.hasOwnProperty.call(data, "ownershipIntent")) {
    return "SEC SC13 display_payload.data.ownershipIntent is required";
  }
  return "";
}

function normalizeDisplayPayloadNotes(value: unknown) {
  if (Array.isArray(value)) return value.map(stringValue).filter(Boolean);
  const text = stringValue(value);
  return text ? [text] : [];
}

function sc13AdapterOutputToAnalysis(value: SecFormRoomAdapterOutput, routerResult: Sc13RouteDecision | null) {
  const score = clampScore(numberValue(value.analysis_output.score) ?? 0);
  const archiveSummary =
    nullableString(value.analysis_output.archive_summary) ||
    (score < 50 ? nullableString(value.analysis_output.summary) : null);

  return {
    ...value.analysis_output,
    score,
    archive_summary: archiveSummary,
    display_payload: value.metadata.display_payload,
    display_payload_storage_target: value.metadata.display_payload_storage_target,
    display_payload_storage_mode: value.metadata.display_payload_storage_mode,
    candidate_special_metadata_only: value.metadata.candidate_special_metadata_only,
    sec_sc13_analysis_mode: "analysis_only",
    sec_sc13_router_result: routerResult,
  };
}

function normalizeSc13AnalysisOutput(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const parserOutput = readSc13ParserOutput(input);
  const primaryTicker = normalizePrimaryTicker(readRecord(value.primary_ticker), filingPackage);
  const signal = normalizeSignal(stringValue(value.signal));
  const score = clampScore(numberValue(value.score) ?? 0);
  const passiveArchive = isPassiveSc13Archive(parserOutput, signal, score);
  const parentComparison = buildSc13ParentComparison(parserOutput, input);
  const bullishPoints = filterSc13BullishPoints(readStringArray(value.bullish_points)).slice(0, 3);
  const bearishPoints = readStringArray(value.bearish_points).slice(0, 3);
  const summary = applySc13ParentComparisonToSummary(stringValue(value.summary), parentComparison);
  const keyEvidence = applySc13ParentComparisonToEvidence(readStringArray(value.key_evidence), parentComparison);
  const whyItMatters = normalizeSc13WhyItMatters(stringValue(value.why_it_matters), parserOutput, parentComparison, passiveArchive);
  return {
    ...value,
    source_group: "filings",
    market_scope: normalizeMarketScope(stringValue(value.market_scope)),
    sector: nullableString(value.sector),
    industry_group: nullableString(value.industry_group),
    theme_group: nullableString(value.theme_group),
    sub_theme: nullableString(value.sub_theme),
    signal,
    primary_ticker: primaryTicker,
    tickers: normalizeTickerRows(value.tickers, primaryTicker, "primary"),
    related_tickers: normalizeTickerRows(value.related_tickers, primaryTicker, "related"),
    summary,
    why_it_matters: whyItMatters,
    bullish_points: passiveArchive ? filterPassiveArchiveBullishPoints(bullishPoints) : bullishPoints,
    bearish_points: passiveArchive ? filterPassiveArchiveBearishPoints(bearishPoints) : bearishPoints,
    key_evidence: keyEvidence,
    what_to_watch_next: readStringArray(value.what_to_watch_next).slice(0, 3),
    calendar_items: Array.isArray(value.calendar_items) ? value.calendar_items : [],
    confidence: normalizeConfidence(stringValue(value.confidence)),
    needs_human_review: value.needs_human_review === true,
  };
}

type Sc13ParentComparison = {
  evidence: string;
  summarySentence: string;
  currentShares: number;
  currentPercent: number;
  parentShares: number;
  parentPercent: number;
} | null;

function buildSc13ParentComparison(
  parserOutput: Sc13ParserOutput | null,
  input: SecFilingAnalysisInput,
): Sc13ParentComparison {
  const parentContext = readParentFilingContext(input);
  if (stringValue(parentContext?.status) !== "found") return null;
  const parent = readRecord(parentContext?.parent);
  const parentFacts = readRecord(parent?.sc13_facts);
  if (!parserOutput || !parentFacts) return null;

  const currentShares = numberValue(parserOutput.facts.sharesBeneficiallyOwned);
  const currentPercent = numberValue(parserOutput.facts.percentOwned);
  const parentShares = numberValue(parentFacts.shares_beneficially_owned);
  const parentPercent = numberValue(parentFacts.percent_owned);
  if (currentShares === null || currentPercent === null || parentShares === null || parentPercent === null) return null;

  const parentOwnership = `${formatCompactNumber(parentShares)} shares / ${formatCompactPercent(parentPercent)}`;
  const currentOwnership = `${formatCompactNumber(currentShares)} shares / ${formatCompactPercent(currentPercent)}`;
  return {
    evidence: `Parent comparison: ${parentOwnership} -> ${currentOwnership}.`,
    summarySentence: `Parent context shows prior ${parentOwnership} versus current ${currentOwnership}.`,
    currentShares,
    currentPercent,
    parentShares,
    parentPercent,
  };
}

function applySc13ParentComparisonToSummary(summary: string, comparison: Sc13ParentComparison) {
  if (!comparison) return summary;
  const normalizedSummary = summary || "";
  if (
    normalizedSummary.includes(formatCompactNumber(comparison.parentShares)) ||
    normalizedSummary.includes(formatCompactPercent(comparison.parentPercent))
  ) {
    return normalizedSummary;
  }
  return [normalizedSummary.replace(/\s+$/g, ""), comparison.summarySentence].filter(Boolean).join(" ");
}

function applySc13ParentComparisonToEvidence(evidence: string[], comparison: Sc13ParentComparison) {
  const items = evidence.filter(Boolean);
  if (!comparison) return items.slice(0, 3);
  const alreadyPresent = items.some(
    (item) =>
      item.includes(formatCompactNumber(comparison.parentShares)) ||
      item.includes(formatCompactPercent(comparison.parentPercent)),
  );
  return (alreadyPresent ? items : [comparison.evidence, ...items]).slice(0, 3);
}

function normalizeSc13WhyItMatters(
  whyItMatters: string,
  parserOutput: Sc13ParserOutput | null,
  comparison: Sc13ParentComparison,
  passiveArchive: boolean,
) {
  const scheduleType = stringValue(parserOutput?.facts.scheduleType);
  if (passiveArchive && scheduleType === "13G" && comparison?.currentShares === 0 && comparison.currentPercent === 0) {
    return "The amendment shows the reporting group no longer reports a beneficial ownership stake; no activist or transaction signal is disclosed.";
  }
  return whyItMatters;
}

function isPassiveSc13Archive(parserOutput: Sc13ParserOutput | null, signal: string, score: number) {
  const formType = stringValue(parserOutput?.formType).toUpperCase();
  return formType.includes("13G") && signal === "neutral" && score < 50;
}

function filterPassiveArchiveBullishPoints(points: string[]) {
  return points.filter((point) => {
    const text = point.toLowerCase();
    if (text.includes("stable") || text.includes("liquidity")) return false;
    if (text.includes("no sole voting") || text.includes("shared voting") || text.includes("unilateral control")) {
      return false;
    }
    return true;
  });
}

function filterSc13BullishPoints(points: string[]) {
  return points.filter((point) => {
    const text = point.toLowerCase();
    if (text.includes("no activist") || text.includes("not operational distress") || text.includes("not forced sale")) return false;
    if (text.includes("administrative") || text.includes("tax") || text.includes("estate")) return false;
    if (text.includes("lock-up") || text.includes("lock up") || text.includes("underwritten") || text.includes("underwriter")) return false;
    if (text.includes("public float") || text.includes("free float") || text.includes("investor float")) return false;
    if (text.includes("remain") && (text.includes("shareholder") || text.includes("ownership") || text.includes("stake"))) return false;
    if (text.includes("align") || text.includes("continued commitment")) return false;
    if (text.includes("director") || text.includes("executive") || text.includes("family stake")) return false;
    return true;
  });
}

function filterPassiveArchiveBearishPoints(points: string[]) {
  void points;
  return [];
}

function normalizeMarketScope(value: string) {
  const normalized = value.toLowerCase().trim();
  if (["company", "sector", "theme", "macro"].includes(normalized)) return normalized;
  return "company";
}

function normalizeSignal(value: string) {
  const normalized = value.toLowerCase().trim();
  if (["bullish", "bearish", "volatile", "neutral"].includes(normalized)) return normalized;
  return "neutral";
}

function buildSc13EventTitle(
  filingPackage: Record<string, unknown>,
  parserOutput: Sc13ParserOutput,
  eventType: string,
) {
  const ticker = stringValue(readRecord(filingPackage.primary_ticker)?.ticker);
  const issuer = stringValue(readRecord(parserOutput.facts)?.issuerName) || stringValue(filingPackage.company_name) || ticker || "issuer";
  return `${issuer} ${parserOutput.formType || "Schedule 13"} ${eventType.replace(/_/g, " ")}`;
}

function readSc13ParserOutput(input: SecFilingAnalysisInput): Sc13ParserOutput | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  const parserOutput = readRecord(hardParsers?.sc13);
  return parserOutput ? (parserOutput as unknown as Sc13ParserOutput) : null;
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function readMarketContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.market_context) || null;
}

function readParentFilingContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.parent_filing_context) || null;
}

function readPrimaryTicker(filingPackage: Record<string, unknown>) {
  const primary = readRecord(filingPackage.primary_ticker);
  return {
    ticker: stringValue(primary?.ticker) || null,
    exchange: stringValue(primary?.exchange) || null,
  };
}

function normalizePrimaryTicker(value: Record<string, unknown> | null, filingPackage: Record<string, unknown>) {
  const fallback = readPrimaryTicker(filingPackage);
  return {
    ticker: stringValue(value?.ticker) || fallback.ticker,
    exchange: stringValue(value?.exchange) || fallback.exchange,
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
  if (!normalized.length && primaryTicker.ticker) {
    normalized.push({
      ticker: primaryTicker.ticker,
      exchange: primaryTicker.exchange,
      role,
      reason: "Primary ticker from SEC filing package.",
    });
  }
  return normalized;
}

function normalizeEventType(value: string) {
  return APPROVED_EVENT_TYPES.has(value) ? value : "other";
}

function normalizeDisplayType(value: string) {
  return DISPLAY_TYPES.has(value) ? value : "generic";
}

function normalizePreliminaryAction(value: string) {
  return PRELIMINARY_ACTIONS.has(value) ? value : "needs_analysis";
}

function normalizeConfidence(value: string) {
  const normalized = value.toLowerCase();
  return normalized === "high" || normalized === "low" ? normalized : "medium";
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
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

function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatCompactPercent(value: number) {
  if (Number.isInteger(value)) return `${value}%`;
  return `${Number(value.toFixed(2))}%`;
}

const APPROVED_EVENT_TYPES = new Set([
  "listing_risk",
  "ipo_listing",
  "dilution_risk",
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
const DISPLAY_TYPES = new Set(["generic", "offering_terms", "candidate_special"]);
const PRELIMINARY_ACTIONS = new Set(["archive", "feed", "alert", "needs_analysis"]);

const sc13RouterResponseSchema = {
  type: "object",
  additionalProperties: true,
  required: ["event_type", "preliminary_action", "display_type", "display_version", "requires_analysis_llm", "reason", "confidence", "deterministic"],
  properties: {
    event_type: { type: "string" },
    preliminary_action: { type: "string" },
    display_type: { type: "string" },
    display_version: { type: "string" },
    requires_analysis_llm: { type: "boolean" },
    reason: { type: "string" },
    confidence: { type: "string" },
    deterministic: { type: "boolean" },
  },
} as const;

const sc13RequiredOutputSchema = {
  ...buildSecRequiredOutputSchema({
    displayDataRequired: ["issuerName", "reportingPersons", "ownershipIntent"],
    displayDataProperties: {
      version: { type: ["string", "null"] },
      issuerName: { type: ["string", "null"] },
      reportingPersons: { type: "array", items: { type: "string" } },
      percentOwned: { type: ["number", "string", "null"] },
      sharesBeneficiallyOwned: { type: ["number", "string", "null"] },
      ownershipIntent: { type: ["string", "null"] },
      isAmendment: { type: ["boolean", "null"] },
      isExitFiling: { type: ["boolean", "null"] },
      ownershipPercentChange: { type: ["number", "string", "null"] },
    },
  }),
} as const;
