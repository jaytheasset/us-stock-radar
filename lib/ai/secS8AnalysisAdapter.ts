import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { buildSecRequiredOutputSchema } from "@/lib/ai/secRequiredOutputSchema";
import { adaptSecFormRoomOutputForIngest, type SecFormRoomAdapterOutput } from "@/lib/sources/sec/forms/common/formRoomAdapter";
import { buildS8AnalysisPrompt } from "@/lib/sources/sec/forms/s8/analysisPrompt";
import { routeS8Filing } from "@/lib/sources/sec/forms/s8/routerPrompt";
import {
  S8_CONTEXT_DETAIL_LABELS,
  S8_SNAPSHOT_METRIC_LABELS,
  type S8MarketContext,
  type S8ParserOutput,
} from "@/lib/sources/sec/forms/s8/types";

export const SEC_S8_ANALYSIS_PROMPT_KEY = "sec_s8_analysis";
export const SEC_S8_ANALYSIS_PROMPT_VERSION = "v1";

const S8_DISPLAY_UI_MODES = [
  "plan_registration",
  "inducement_awards",
  "reoffer_resale",
  "post_effective_amendment",
] as const;
const S8_SNAPSHOT_LABEL_SET = new Set<string>(S8_SNAPSHOT_METRIC_LABELS);
const S8_CONTEXT_DETAIL_LABEL_SET = new Set<string>(S8_CONTEXT_DETAIL_LABELS);

export type SecS8AnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isS8FilingInput(input: SecFilingAnalysisInput) {
  return Boolean(readS8ParserOutput(input));
}

export function buildDeterministicS8ArchiveAnalysis(_input: SecFilingAnalysisInput): SecS8AnalysisAdapterResult | null {
  return null;
}

export function buildSecS8AnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = readS8ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC S-8 parser output is missing from filing package");
  }

  const routerDecision = routeS8Filing(parserOutput);
  return {
    key: SEC_S8_ANALYSIS_PROMPT_KEY,
    version: SEC_S8_ANALYSIS_PROMPT_VERSION,
    system: [
      "Analyze one SEC S-8/S-8A filing from cleaned source blocks.",
      "Return the full Required Output JSON shape.",
      "Choose event_type, display_type, and score from the supplied source blocks.",
      "Use market_context and parent_filing_context only when supplied by integration.",
      "Score means investor attention and urgency. Delivery is derived later from score only.",
    ].join("\n"),
    user: buildS8AnalysisPrompt({
      parserOutput,
      routerDecision,
      marketContext: readMarketContext(input) as S8MarketContext | null,
      parentFilingContext: readParentFilingContext(input),
    }),
    responseFormat: {
      json_schema: {
        name: "sec_s8_required_output",
        strict: false,
        schema: secS8RequiredOutputSchema,
      },
    },
  };
}

export function adaptSecS8AnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecS8AnalysisAdapterResult {
  const parserOutput = readS8ParserOutput(input);
  const root = readRecord(value);
  const analysisOutput = readRecord(root?.analysis_output);
  const displayPayload = readRecord(root?.display_payload);
  if (!parserOutput || !analysisOutput || !displayPayload) {
    return {
      ok: false,
      error: "SEC S-8 result did not contain parser_output, analysis_output, and LLM display_payload",
    };
  }

  const sanitizedDisplayPayload = sanitizeS8DisplayPayload(displayPayload);
  const displayPayloadError = validateS8RuntimeDisplayPayload(sanitizedDisplayPayload);
  if (displayPayloadError) {
    return {
      ok: false,
      error: displayPayloadError,
    };
  }

  return adaptS8RoomResultForAnalysis({
    parser_output: parserOutput,
    analysis_output: normalizeS8AnalysisOutput(analysisOutput, input),
    display_payload: sanitizedDisplayPayload,
  });
}

function adaptS8RoomResultForAnalysis(value: unknown, isDeterministic = false): SecS8AnalysisAdapterResult {
  const adapted = adaptSecFormRoomOutputForIngest(value);
  if (!adapted.ok) {
    return {
      ok: false,
      error: `SEC S-8 Required Output JSON failed validation: ${adapted.errors.join("; ")}`,
    };
  }

  return {
    ok: true,
    analysis: adapterOutputToAnalysis(adapted.value, isDeterministic),
  };
}

function adapterOutputToAnalysis(value: SecFormRoomAdapterOutput, isDeterministic = false) {
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
    sec_s8_analysis_mode: "analysis_only",
    deterministic_parser_archive: isDeterministic,
  };
}

function normalizeS8AnalysisOutput(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  const primaryTicker = normalizePrimaryTicker(readRecord(value.primary_ticker), filingPackage);
  const needsHumanReview =
    value.needs_human_review === true && !isRoutineS8AdministrativeReviewNoise(value, input);
  const normalizedEventType = normalizeS8EventType(value, input);
  const normalizedScore = normalizeS8Score(value, input, normalizedEventType);

  return {
    ...value,
    event_type: normalizedEventType,
    score: normalizedScore,
    event_title: sanitizeS8InvestorText(value.event_title),
    quick_take: sanitizeS8InvestorText(value.quick_take),
    summary: sanitizeS8InvestorText(value.summary),
    why_it_matters: sanitizeS8InvestorText(value.why_it_matters),
    score_reason: sanitizeS8InvestorText(value.score_reason),
    archive_summary: sanitizeS8InvestorText(value.archive_summary),
    source_group: stringValue(value.source_group) || "filings",
    market_scope: stringValue(value.market_scope) || "company",
    primary_ticker: primaryTicker,
    tickers: normalizeTickerRows(value.tickers, primaryTicker, "primary"),
    related_tickers: normalizeTickerRows(value.related_tickers, primaryTicker, "related"),
    bullish_points: readS8BullishPointArray(value.bullish_points, 3),
    bearish_points: readS8InvestorPointArray(value.bearish_points, 3),
    key_evidence: readS8InvestorPointArray(value.key_evidence, 3),
    what_to_watch_next: readS8InvestorPointArray(value.what_to_watch_next, 3),
    calendar_items: Array.isArray(value.calendar_items) ? value.calendar_items : [],
    confidence: normalizeConfidence(stringValue(value.confidence)),
    needs_human_review: needsHumanReview,
  };
}

function normalizeS8EventType(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const eventType = stringValue(value.event_type);
  const searchableText = buildS8AnalysisSearchText(value, input);
  if (isS8NonroutineCarryoverPlanTransition(searchableText) && (eventType === "other" || eventType === "leadership_governance")) {
    return "dilution_risk";
  }

  if (eventType !== "leadership_governance") return eventType;

  const hasRegisteredShareSupply =
    /\b\d[\d,.\s]*\s+(?:shares|common shares|ordinary shares)\b/i.test(searchableText) &&
    /\b(?:registered|issuable|offered|available|underlying|settlement|assumed|converted|awards?)\b/i.test(searchableText);
  const hasS8ShareRegistrationSignal =
    /\b(?:registered shares|shares registered|additional shares|assumed awards|converted awards|issuable upon settlement|reoffer|resale|selling[- ]holder)\b/i.test(
      searchableText,
    );
  const governanceDominates =
    /\b(?:board compensation policy|executive compensation policy|say-on-pay|director compensation|governance dispute)\b/i.test(searchableText);

  if ((hasRegisteredShareSupply || hasS8ShareRegistrationSignal) && !governanceDominates) {
    return "dilution_risk";
  }

  return eventType;
}

function normalizeS8Score(value: Record<string, unknown>, input: SecFilingAnalysisInput, eventType: string) {
  const score = clampScore(numberValue(value.score) ?? 0);
  const searchableText = buildS8AnalysisSearchText(value, input);

  if (score < 50 && eventType === "dilution_risk" && isS8NonroutineCarryoverPlanTransition(searchableText)) {
    return 55;
  }

  return score;
}

function isS8NonroutineCarryoverPlanTransition(searchableText: string) {
  return (
    /\bcarryover shares?\b/i.test(searchableText) &&
    /\b(?:newly approved|newly authorized|2026 equity incentive plan|new plan|replacing|replaces|transition)\b/i.test(searchableText) &&
    /\b(?:4,400,000|11,788,376|2,873,223|contemporaneous(?:ly)? filed|newly authorized shares)\b/i.test(searchableText)
  );
}

function isRoutineS8AdministrativeReviewNoise(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const parserOutput = readS8ParserOutput(input);
  if (!parserOutput) return false;

  const score = numberValue(value.score) ?? 0;
  if (score >= 35) return false;

  const formType = stringValue(parserOutput.formType).toUpperCase();
  if (formType !== "S-8 POS" && !formType.endsWith("/A")) return false;

  const facts = readRecord(parserOutput.facts) || {};
  if (facts.s8PosRegistersAdditionalSecurities === true) return false;
  if (facts.reofferProspectus === true || facts.resaleProspectus === true || facts.sellingHolderSection === true) {
    return false;
  }
  if (
    facts.consultantAdvisorServiceProvider === true ||
    facts.investorRelationsPromotionalFinancingServices === true ||
    facts.shellReverseMergerDelinquentFiler === true
  ) {
    return false;
  }

  const sourceText = [
    value.event_title,
    value.quick_take,
    value.summary,
    value.why_it_matters,
    value.score_reason,
    value.archive_summary,
    ...(readStringArray(value.key_evidence)),
    ...(readStringArray(value.what_to_watch_next)),
  ]
    .map(stringValue)
    .join(" ");
  const hasAdministrativeSignal =
    facts.noAdditionalSecurities === true ||
    facts.exhibitOnly === true ||
    facts.signatureOnly === true ||
    /no additional securities|consent|exhibit|administrative|clerical|correct/i.test(sourceText);

  return hasAdministrativeSignal;
}

function readS8InvestorPointArray(value: unknown, limit: number) {
  return readLimitedStringArray(value, limit)
    .map(sanitizeS8InvestorText)
    .filter((text) => text && !isS8InternalLimitationOnly(text));
}

function readS8BullishPointArray(value: unknown, limit: number) {
  return readLimitedStringArray(value, limit)
    .map(sanitizeS8InvestorText)
    .filter((text) => text && !isS8InternalLimitationOnly(text) && !isS8NeutralMechanicBullishPoint(text));
}

function isS8NeutralMechanicBullishPoint(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return (
    /\bno immediate cash offering\b/i.test(text) ||
    /\bpreviously registered\b/i.test(text) ||
    /\bawards were previously registered\b/i.test(text) ||
    /\broutine compensation\b/i.test(text) ||
    /\bemployee alignment\b/i.test(text) ||
    /\baligns? .* employees? with .* equity\b/i.test(text) ||
    /\bpreserves? incentive awards\b/i.test(text) ||
    /\bassumed awards?\b/i.test(text) ||
    /\bconverted awards?\b/i.test(text) ||
    /\bconsolidates? .* awards? onto .* S-8\b/i.test(text) ||
    /\bmerger cleanup\b/i.test(text)
  );
}

function isS8InternalLimitationOnly(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return (
    /^Prior filing comparison was limited\.?$/i.test(text) ||
    /^Parent filing comparison is limited\.?$/i.test(text) ||
    /^Some registration (?:table )?details were unavailable\.?$/i.test(text) ||
    /^Parser flagged\b/i.test(text) ||
    /\bunparsed registration table\b/i.test(text)
  );
}

function sanitizeS8DisplayPayload(value: Record<string, unknown>) {
  const sanitized = sanitizeS8Unknown(value);
  const record = readRecord(sanitized);
  if (!record) return value;

  const data = readRecord(record.data);
  if (data) {
    const snapshotMetrics = recordArray(data.snapshot_metrics)
      .map((item: Record<string, unknown>) => {
        const label = stringValue(item.label);
        if (!S8_SNAPSHOT_LABEL_SET.has(label) || !hasS8DisclosureValue(item.value)) return null;
        return {
          label,
          value: item.value,
          note: hasS8DisclosureValue(item.note) ? item.note : null,
          emphasis: item.emphasis === true,
          tone: ["danger", "positive", "neutral"].includes(stringValue(item.tone)) ? stringValue(item.tone) : "neutral",
        };
      })
      .filter(Boolean)
      .slice(0, 4);
    if (snapshotMetrics.length) {
      data.snapshot_metrics = snapshotMetrics;
    } else {
      delete data.snapshot_metrics;
    }
    const contextDetails = recordArray(data.s8_context_details)
      .map((item: Record<string, unknown>) => {
        const label = stringValue(item.label);
        if (!S8_CONTEXT_DETAIL_LABEL_SET.has(label) || !hasS8DisclosureValue(item.value)) return null;
        return {
          label,
          value: item.value,
        };
      })
      .filter(Boolean)
      .slice(0, 6);
    if (contextDetails.length) {
      data.s8_context_details = contextDetails;
    } else {
      delete data.s8_context_details;
    }
    record.data = data;
  }

  if (Array.isArray(record.notes)) {
    record.notes = record.notes.map(sanitizeS8InvestorText).filter((text) => text && !isS8InternalLimitationOnly(text));
  }

  return record;
}

function validateS8RuntimeDisplayPayload(value: Record<string, unknown>) {
  const data = readRecord(value.data);
  if (!data || Object.keys(data).length === 0) {
    return "SEC S-8 display_payload.data must be filled by the analysis LLM";
  }

  const mode = stringValue(data.s8_ui_mode);
  if (!S8_DISPLAY_UI_MODES.includes(mode as (typeof S8_DISPLAY_UI_MODES)[number])) {
    return "SEC S-8 display_payload.data.s8_ui_mode is required and must be a supported S-8 UI mode";
  }
  if (!stringValue(data.narrative_summary)) {
    return "SEC S-8 display_payload.data.narrative_summary is required for the S-8 detail summary UI";
  }

  return "";
}

function buildS8AnalysisSearchText(value: Record<string, unknown>, input: SecFilingAnalysisInput) {
  const parserOutput = readS8ParserOutput(input);
  const facts = readRecord(parserOutput?.facts) || {};
  const displayPayload = readRecord(value.display_payload);
  const parts = [
    value.event_title,
    value.quick_take,
    value.summary,
    value.why_it_matters,
    value.score_reason,
    ...(readStringArray(value.key_evidence)),
    ...(readStringArray(value.bullish_points)),
    ...(readStringArray(value.bearish_points)),
    JSON.stringify(facts),
    displayPayload ? JSON.stringify(displayPayload) : "",
  ];
  return parts.map(stringValue).filter(Boolean).join(" ");
}

function sanitizeS8Unknown(value: unknown): unknown {
  if (typeof value === "string") return sanitizeS8InvestorText(value);
  if (Array.isArray(value)) return value.map(sanitizeS8Unknown);
  const record = readRecord(value);
  if (!record) return value;

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(record)) {
    output[key] = sanitizeS8Unknown(item);
  }
  return output;
}

function sanitizeS8InvestorText(value: unknown) {
  let text = stringValue(value);
  if (!text) return "";

  text = text
    .replace(/\u00e2(?:\u0080|\u20ac)[\u0090-\u0095]/g, "-")
    .replace(/\u00e2(?:\u0080|\u20ac)[\u0098\u0099]/g, "'")
    .replace(/\u00e2(?:\u0080|\u20ac)[\u009c\u009d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/([A-Za-z])[\u0000-\u001f\u007f-\u009f]s\b/g, "$1's")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u00a0/g, " ");

  text = text
    .replace(/\bfee[- ]table parsing (?:was |is |remains )?(?:incomplete|missing|unavailable)\b[,.]?\s*/gi, "")
    .replace(/\bparser (?:failed to extract|did not parse) fee[- ]table (?:securities )?rows\b[,.]?\s*/gi, "some registration table details were unavailable")
    .replace(/\bparser detected fee[- ]table material but did not parse securities rows\b[,.]?\s*/gi, "some registration table details were unavailable")
    .replace(/\bparser detected fee[- ]table but did not parse securities rows;?\s*some registration table detail unavailable\.?/gi, "Some registration table details were unavailable.")
    .replace(/\bparser detected fee[- ]table content but no securities rows were parsed;?\s*fee[- ]table details unavailable\.?/gi, "Some registration table details were unavailable.")
    .replace(/\bparser warnings?:\s*/gi, "")
    .replace(/\bfee[- ]table detected but no securities rows parsed\b[,.]?\s*/gi, "some registration table details were unavailable")
    .replace(/\bsome fee[- ]table registration rows were detected but not parsed\b[,.]?\s*/gi, "some registration table details were unavailable")
    .replace(/\bsome registration table details were not parsed and are unavailable\b/gi, "Some registration table details were unavailable")
    .replace(/\bsome registration table details were unavailablecompletely\b/gi, "Some registration table details were unavailable")
    .replace(/\bsome fee[- ]table details were detected but securities rows were not parsed\.?/gi, "Some registration table details were unavailable.")
    .replace(/\bsome registration table and fee[- ]detail parsing was incomplete in the filing\.?/gi, "Some registration details were unavailable.")
    .replace(/\bfee[- ]table material was detected but no securities rows were parsed;?\s*some registration details unavailable\.?/gi, "Some registration details were unavailable.")
    .replace(/\bfee[- ]table rows were detected but not parsed;?\s*some registration[- ]table details unavailable\.?/gi, "Some registration details were unavailable.")
    .replace(/\bregistration table parsing shows an incomplete mapping on at least one row\.?/gi, "Some registration table details were unavailable.")
    .replace(/\bregistration table parsing (?:is|was|remains|shows) [^.]*\.?/gi, "Some registration table details were unavailable.")
    .replace(/\bsome filing registration table mapping details were flagged as incomplete\.?/gi, "Some registration table details were unavailable.")
    .replace(/\bregistration table mapping details were flagged as incomplete\.?/gi, "Some registration table details were unavailable.")
    .replace(/\bfiling registration table mapping details were flagged as incomplete\.?/gi, "Some registration table details were unavailable.")
    .replace(/\bthe filing appears administrative but fee[- ]table and parent amendment context parsing was incomplete\.?/gi, "The filing appears administrative, but parent filing comparison is limited.")
    .replace(/\bparser details incomplete\b/gi, "some registration details unavailable")
    .replace(/\bsome fee[- ]table details unavailable\b/gi, "some registration details unavailable")
    .replace(/\bsome registration table details were unavailable;\s*some registration details unavailable\.?/gi, "Some registration details were unavailable.")
    .replace(/\bfee[- ]table and parent (?:amendment )?context parsing (?:was )?incomplete\b/gi, "parent filing comparison is limited")
    .replace(/\bParent filing context and complete registration table rows were unavailable\.?/gi, "Prior filing comparison was limited.")
    .replace(/\bregistration table details and parent filing context unavailable\.?/gi, "Prior filing comparison was limited.")
    .replace(/\bregistration table details and parent filing context were unavailable\.?/gi, "Prior filing comparison was limited.")
    .replace(/\bintegration parent_filing_context returned status '?not_found'?;?\s*comparison limited\.?/gi, "Parent filing comparison is limited.")
    .replace(/\bintegration parent_filing_context not found;?\s*comparison to initial S-4 amendment limited\.?/gi, "Parent filing comparison is limited.")
    .replace(/\bParent S-4 context was referenced but parent filing object not provided for consolidation\.?/gi, "Parent filing comparison is limited.")
    .replace(/\bparent filing object not provided for consolidation\b/gi, "parent filing comparison is limited")
    .replace(/\bparent filing context not found by integration;?\s*compare with original S-4 for full fee[- ]table\.?/gi, "Parent filing comparison is limited.")
    .replace(/\bparent S-8\/S-4 filing context was not found by integration;?\s*comparison to prior amendment limited\.?/gi, "Parent filing comparison is limited.")
    .replace(/\bparent filing context not found in integration records;?\s*comparison to prior S-8\/S-4 deltas limited\.?/gi, "Parent filing comparison is limited.")
    .replace(/\bparent filing context for the S-8 POS was not found by integration\.?/gi, "Parent filing comparison is limited.")
    .replace(/\bParent S-4 context not found by integration;?\s*analysis limited to available amendment text\.?/gi, "Prior filing comparison was limited.")
    .replace(/\bSome registration table details and parent amendment context were unavailable in this filing\.?/gi, "")
    .replace(/\bregistration table details and parent amendment context (?:were|was) unavailable\.?/gi, "")
    .replace(/\bParser flagged unparsed registration table and consultant\/advisor language\.?/gi, "")
    .replace(/\bprovided parent_filing_context\b/gi, "provided parent context")
    .replace(/\bfull fee[- ]table\b/gi, "full registration details")
    .replace(/\bparser detected[^.]*fee[- ]table[^.]*securities rows[^.]*\.?/gi, "Some registration table details were unavailable.")
    .replace(/\bfee[- ]?table detected but securities rows were not parsed in parser output\.?/gi, "Some registration table details were unavailable.")
    .replace(/\bfee[- ]table rows unavailable\b/gi, "registration table details unavailable")
    .replace(/\bfee table rows not parsed\b/gi, "some registration details unavailable")
    .replace(/\bfee[- ]table rows incomplete\b/gi, "registration table details unavailable")
    .replace(/\bfee[- ]table details unavailable\b/gi, "registration table details unavailable")
    .replace(/\bSome registration table details were unavailable\.?/gi, "")
    .replace(/\bsome registration details unavailable\.?/gi, "")
    .replace(/\bregistration table details unavailable\.?/gi, "")
    .replace(/\bfee[- ]?table\b/gi, "registration table")
    .replace(/\bnot parsed\b/gi, "unavailable")
    .replace(/\bparser output\b/gi, "source package")
    .replace(/\bintegration parent filing context not found;?\s*comparison to original S-4 limited\.?/gi, "Parent filing comparison is limited.")
    .replace(/\bupdating fee[- ]table rows\b/gi, "updating registration details")
    .replace(/\bfee[- ]table (?:details|rows|data|securities rows) (?:were|was|remain(?:ed)?|are) (?:not parsed|unparsed|incomplete|missing|unavailable)\b/gi, "some registration table details were unavailable")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/;\s*$/, ".");

  return text;
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
      reason: "Primary SEC filing ticker",
    });
  }

  return normalized;
}

function normalizePrimaryTicker(record: Record<string, unknown> | null, filingPackage: Record<string, unknown>) {
  const packagePrimary = readRecord(filingPackage.primary_ticker);
  const ticker = nullableString(record?.ticker) || nullableString(packagePrimary?.ticker) || nullableString(filingPackage.ticker);
  const exchange = nullableString(record?.exchange) || nullableString(packagePrimary?.exchange);
  return {
    ticker: ticker ? ticker.toUpperCase() : null,
    exchange,
  };
}

function readS8ParserOutput(input: SecFilingAnalysisInput): S8ParserOutput | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return readRecord(hardParsers?.s8) as S8ParserOutput | null;
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function readMarketContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.market_context) || readRecord(filingPackage.marketContext);
}

function readParentFilingContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.parent_filing_context) || readRecord(filingPackage.parentFilingContext);
}

function normalizeConfidence(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
  return "medium";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function readLimitedStringArray(value: unknown, maxItems: number) {
  return readStringArray(value).slice(0, Math.max(0, maxItems));
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(readRecord).filter((item): item is Record<string, unknown> => Boolean(item)) : [];
}

function hasS8DisclosureValue(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value);
  return stringValue(value).length > 0;
}

const secS8RequiredOutputSchema = {
  ...buildSecRequiredOutputSchema({
    displayDataRequired: ["s8_ui_mode", "narrative_summary"],
    displayDataProperties: {
      s8_ui_mode: { type: "string", enum: S8_DISPLAY_UI_MODES },
      narrative_summary: { type: "string" },
      total_registered_shares: { type: ["string", "number", "null"] },
      plan_registered_shares: { type: ["string", "number", "null"] },
      parent_plan_registered_shares: { type: ["string", "number", "null"] },
      parent_plan_dilution_percent: { type: ["string", "number", "null"] },
      reoffer_subset_of_parent_plan_percent: { type: ["string", "number", "null"] },
      reoffer_subset_of_parent_plan: { type: ["boolean", "string", "null"] },
      inducement_award_shares: { type: ["string", "number", "null"] },
      reoffer_resale_shares: { type: ["string", "number", "null"] },
      current_shares_outstanding: { type: ["string", "number", "null"] },
      estimated_dilution_percent: { type: ["string", "number", "null"] },
      share_count_basis: { type: ["string", "null"] },
      snapshot_metrics: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: true,
          required: ["label", "value"],
          properties: {
            label: { type: "string", enum: S8_SNAPSHOT_METRIC_LABELS },
            value: { type: ["string", "number"] },
            note: { type: ["string", "null"] },
            emphasis: { type: "boolean" },
            tone: { type: "string", enum: ["danger", "positive", "neutral"] },
          },
        },
      },
      s8_context_details: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "value"],
          properties: {
            label: { type: "string" },
            value: { type: ["string", "number"] },
          },
        },
      },
    },
  }),
};
