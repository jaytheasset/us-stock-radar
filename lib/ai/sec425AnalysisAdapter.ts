import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  SEC_425_ANALYSIS_CASE_VALUES,
  SEC_425_IMPACT_LEVEL_VALUES,
  SEC_425_ANALYSIS_PROMPT_KEY,
  SEC_425_ANALYSIS_PROMPT_VERSION,
  buildSec425AnalysisPromptDraft,
  buildSec425DeterministicRoomResult,
  sec425RequiredOutputResponseSchema,
  validateSec425RoomResult,
} from "@/lib/sources/sec/forms/425/analysisPrompt";
import { buildSec425DisplayPayload } from "@/lib/sources/sec/forms/425/displayPayload";
import {
  buildSec425RouterPromptDraft,
  normalizeSec425RouterResult,
  SEC_425_ROUTER_PROMPT_KEY,
  SEC_425_ROUTER_PROMPT_VERSION,
  type Sec425RouterDecision,
} from "@/lib/sources/sec/forms/425/routerPrompt";
import {
  SEC_425_APPROVED_EVENT_TYPES,
  SEC_425_CONFIDENCE_VALUES,
  SEC_425_MARKET_SCOPE_VALUES,
  SEC_425_SIGNAL_VALUES,
  deliveryLevelFromScore,
  type Sec425AnalysisOutput,
  type Sec425ParserOutput,
  type Sec425RoomResult,
} from "@/lib/sources/sec/forms/425/types";

export {
  SEC_425_ANALYSIS_PROMPT_KEY,
  SEC_425_ANALYSIS_PROMPT_VERSION,
  SEC_425_ROUTER_PROMPT_KEY,
  SEC_425_ROUTER_PROMPT_VERSION,
};

export type Sec425AnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export function isSec425FilingInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSec425ParserOutput(input);
  return Boolean(parserOutput);
}

export function buildSec425RouterPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSec425ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC 425 parser output is missing from filing package");
  }

  return buildSec425RouterPromptDraft({
    filing_package: readFilingPackage(input),
    parser_output: parserOutput,
    filing_excerpt: null,
    market_context: null,
  });
}

export function normalizeSec425RouterResultForInput(
  value: Record<string, unknown>,
  input: SecFilingAnalysisInput,
) {
  const parserOutput = readSec425ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC 425 parser output is missing from filing package");
  }
  return normalizeSec425RouterResult(value, parserOutput);
}

export function shouldRunSec425Analysis(routerResult: Record<string, unknown>) {
  if (routerResult.needs_analysis_llm === true) return true;
  const score = numberValue(routerResult.score);
  return score !== null && score >= 50;
}

export function buildSec425AnalysisPromptForInput(
  input: SecFilingAnalysisInput,
  routerResult: Record<string, unknown>,
) {
  const parserOutput = readSec425ParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC 425 parser output is missing from filing package");
  }

  const prompt = buildSec425AnalysisPromptDraft({
    filing_package: readFilingPackage(input),
    parser_output: parserOutput,
    router_result: routerResult as unknown as Sec425RouterDecision,
    filing_excerpt: null,
    market_context: readMarketContext(input),
  });

  return {
    ...prompt,
    system: [
      prompt.system,
      "Runtime integration note: return only impact_level, analysis_output, analysis_case, and source_blocks_used. Parser output and display_payload are rebuilt by integration and must not be returned.",
      "Use source block IDs exactly as supplied when listing source_blocks_used.",
      "Router score is only an archive gate. Assign the final score from the explicit material event established by the current Form 425 source blocks alone.",
    ].join("\n"),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_425_runtime_analysis",
        strict: true,
        schema: sec425RuntimeAnalysisResponseSchema,
      },
    },
  };
}

export function buildSec425DeterministicAnalysisForInput(
  input: SecFilingAnalysisInput,
  routerResult: Record<string, unknown>,
): Sec425AnalysisAdapterResult | null {
  const parserOutput = readSec425ParserOutput(input);
  if (!parserOutput) {
    return { ok: false, error: "SEC 425 parser output is missing from filing package" };
  }
  const roomResult = buildSec425DeterministicRoomResult(
    parserOutput,
    routerResult as unknown as Sec425RouterDecision,
  );
  if (!roomResult) return null;
  return adaptSec425RoomResultForPersistence(roomResult, input, routerResult, "routine_archive", []);
}

export function adaptSec425AnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
  routerResult: Record<string, unknown>,
): Sec425AnalysisAdapterResult {
  const root = readRecord(value);
  if (!root) return { ok: false, error: "SEC 425 analysis response did not contain a JSON object" };
  const analysisOutput = readRecord(root.analysis_output);
  if (!analysisOutput) return { ok: false, error: "SEC 425 analysis response did not contain analysis_output" };
  const parserOutput = readSec425ParserOutput(input);
  if (!parserOutput) return { ok: false, error: "SEC 425 parser output is missing from filing package" };

  const routerEventType = normalizeEventType(stringValue(routerResult.event_type));
  const proposedScore = clampScore(numberValue(analysisOutput.score) ?? numberValue(routerResult.score) ?? 0);
  const modelImpactLevel = normalizeImpactLevel(stringValue(root.impact_level), proposedScore);
  const impactLevel = isProceduralVoteCommunication(parserOutput, analysisOutput)
    ? "procedural_update"
    : modelImpactLevel;
  const score = capScoreForImpactLevel(proposedScore, impactLevel);
  const primaryTicker = normalizePrimaryTicker(readRecord(analysisOutput.primary_ticker), input, parserOutput);
  const archiveScore = score < 50;
  const normalizedOutput: Sec425AnalysisOutput = {
    source_group: "filings",
    market_scope: normalizeMarketScope(stringValue(analysisOutput.market_scope)),
    event_type: routerEventType,
    event_title: stringValue(analysisOutput.event_title) || buildFallbackEventTitle(input, parserOutput, routerEventType),
    primary_ticker: primaryTicker,
    tickers: normalizeTickerRows(analysisOutput.tickers, primaryTicker),
    sector: nullableString(analysisOutput.sector),
    industry_group: nullableString(analysisOutput.industry_group),
    theme_group: nullableString(analysisOutput.theme_group),
    sub_theme: nullableString(analysisOutput.sub_theme),
    score,
    score_reason: stringValue(analysisOutput.score_reason),
    signal: normalizeSignal(stringValue(analysisOutput.signal)),
    quick_take: stringValue(analysisOutput.quick_take),
    summary: stringValue(analysisOutput.summary),
    why_it_matters: stringValue(analysisOutput.why_it_matters),
    snapshot_title: stringValue(analysisOutput.snapshot_title),
    snapshot_summary: stringValue(analysisOutput.snapshot_summary),
    snapshot_items: normalizeSnapshotItems(analysisOutput.snapshot_items),
    bullish_points: archiveScore ? [] : readStringArray(analysisOutput.bullish_points),
    bearish_points: archiveScore ? [] : readStringArray(analysisOutput.bearish_points),
    key_evidence: archiveScore ? [] : readStringArray(analysisOutput.key_evidence),
    what_to_watch_next: archiveScore ? [] : readStringArray(analysisOutput.what_to_watch_next),
    related_tickers: normalizeTickerRows(analysisOutput.related_tickers, { ticker: null, exchange: null }),
    calendar_items: Array.isArray(analysisOutput.calendar_items)
      ? (analysisOutput.calendar_items as Sec425AnalysisOutput["calendar_items"])
      : parserOutput.calendarItems,
    confidence: normalizeConfidence(stringValue(analysisOutput.confidence)),
    needs_human_review: analysisOutput.needs_human_review === true,
  };
  const baseDisplayPayload = buildSec425DisplayPayload(
    parserOutput,
    routerResult as unknown as Sec425RouterDecision,
  );
  const displayPayload = normalizedOutput.snapshot_items.length > 0
    ? {
        ...baseDisplayPayload,
        data: {
          ...baseDisplayPayload.data,
          analysis_snapshot: {
            title: normalizedOutput.snapshot_title,
            summary: normalizedOutput.snapshot_summary,
            items: normalizedOutput.snapshot_items,
          },
        },
      }
    : baseDisplayPayload;
  const roomResult: Sec425RoomResult = {
    parser_output: parserOutput,
    analysis_output: normalizedOutput,
    display_payload: displayPayload,
    fixture_expected: {
      expected_delivery_level: deliveryLevelFromScore(score),
      expected_impact: score >= 75 ? "high" : score >= 50 ? "medium" : "low",
      market_context_needed: false,
      market_context_reason: null,
      market_context_fields: [],
      special_ui_needed: displayPayload.display_type !== "generic",
      special_ui_reason: displayPayload.display_type !== "generic" ? `Display type ${displayPayload.display_type} selected by router.` : null,
      integration_notes: [],
    },
  };
  return adaptSec425RoomResultForPersistence(
    roomResult,
    input,
    routerResult,
    stringValue(root.analysis_case),
    readStringArray(root.source_blocks_used),
    { impactLevel, proposedScore },
  );
}

export function readSec425ParserOutput(input: SecFilingAnalysisInput): Sec425ParserOutput | null {
  const filingPackage = readFilingPackage(input);
  const hardParsers = readRecord(filingPackage.hard_parsers);
  return readRecord(hardParsers?.["425"]) as unknown as Sec425ParserOutput | null;
}

function readFilingPackage(input: SecFilingAnalysisInput) {
  return readRecord(input.filing_package) || {};
}

function readMarketContext(input: SecFilingAnalysisInput) {
  const filingPackage = readFilingPackage(input);
  return readRecord(filingPackage.market_context) || readRecord(filingPackage.marketContext) || null;
}

function adaptSec425RoomResultForPersistence(
  roomResult: Sec425RoomResult,
  input: SecFilingAnalysisInput,
  routerResult: Record<string, unknown>,
  analysisCase: string,
  sourceBlocksUsed: string[],
  scoring?: {
    impactLevel: (typeof SEC_425_IMPACT_LEVEL_VALUES)[number];
    proposedScore: number;
  },
): Sec425AnalysisAdapterResult {
  const validationWarnings = validateSec425RoomResult(roomResult);
  const analysis = roomResult.analysis_output;
  const archiveSummary = analysis.score < 50 ? analysis.summary || analysis.quick_take : null;
  const impactLevel = scoring?.impactLevel || normalizeImpactLevel("", analysis.score);
  const proposedScore = scoring?.proposedScore ?? analysis.score;
  return {
    ok: true,
    analysis: {
      ...analysis,
      archive_summary: archiveSummary,
      display_payload: roomResult.display_payload,
      sec_425_router_result: routerResult,
      sec_425_analysis_case: analysisCase || stringValue(routerResult.route_case) || null,
      sec_425_impact_level: impactLevel,
      sec_425_score_adjustment: proposedScore === analysis.score
        ? null
        : `Score capped from ${proposedScore} to ${analysis.score} by impact level ${impactLevel}.`,
      source_blocks_used: sourceBlocksUsed,
      sec_425_validation_warnings: validationWarnings,
      related_filings_status: stringValue(
        readRecord(readRecord(readFilingPackage(input).filing_context)?.related_transaction)?.status,
      ) || "not_found",
    },
  };
}

function normalizePrimaryTicker(
  value: Record<string, unknown> | null,
  input: SecFilingAnalysisInput,
  parserOutput: Sec425ParserOutput,
) {
  const fallback = readRecord(readFilingPackage(input).primary_ticker);
  return {
    ticker: stringValue(value?.ticker) || stringValue(fallback?.ticker) || parserOutput.facts.primary_ticker || null,
    exchange: stringValue(value?.exchange) || stringValue(fallback?.exchange) || parserOutput.facts.exchange || null,
  };
}

function normalizeTickerRows(value: unknown, primaryTicker: { ticker: string | null; exchange: string | null }) {
  const rows = Array.isArray(value) ? value : [];
  const normalized = rows
    .map((item) => {
      const record = readRecord(item);
      const ticker = stringValue(record?.ticker) || stringValue(item);
      if (!ticker) return null;
      return {
        ticker,
        exchange: stringValue(record?.exchange) || (ticker === primaryTicker.ticker ? primaryTicker.exchange : null),
      };
    })
    .filter((item): item is { ticker: string; exchange: string | null } => Boolean(item));
  if (primaryTicker.ticker && !normalized.some((item) => item.ticker === primaryTicker.ticker)) {
    normalized.unshift(primaryTicker as { ticker: string; exchange: string | null });
  }
  return normalized;
}

function normalizeSnapshotItems(value: unknown): Sec425AnalysisOutput["snapshot_items"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = readRecord(item);
      if (!record) return null;
      const label = stringValue(record.label);
      const itemValue = stringValue(record.value);
      if (!label || !itemValue) return null;
      return {
        label,
        value: itemValue,
        note: stringValue(record.note),
      };
    })
    .filter((item): item is Sec425AnalysisOutput["snapshot_items"][number] => Boolean(item))
    .slice(0, 4);
}

function buildFallbackEventTitle(input: SecFilingAnalysisInput, parserOutput: Sec425ParserOutput, eventType: string) {
  const filingPackage = readFilingPackage(input);
  const company = stringValue(filingPackage.company_name) || parserOutput.facts.company_name || "Issuer";
  return `${company} Form 425 ${eventType.replace(/_/g, " ")}`;
}

function normalizeEventType(value: string) {
  return SEC_425_APPROVED_EVENT_TYPES.includes(value as (typeof SEC_425_APPROVED_EVENT_TYPES)[number])
    ? (value as (typeof SEC_425_APPROVED_EVENT_TYPES)[number])
    : "other";
}

function normalizeMarketScope(value: string) {
  return SEC_425_MARKET_SCOPE_VALUES.includes(value as (typeof SEC_425_MARKET_SCOPE_VALUES)[number])
    ? (value as (typeof SEC_425_MARKET_SCOPE_VALUES)[number])
    : "company";
}

function normalizeSignal(value: string) {
  return SEC_425_SIGNAL_VALUES.includes(value as (typeof SEC_425_SIGNAL_VALUES)[number])
    ? (value as (typeof SEC_425_SIGNAL_VALUES)[number])
    : "neutral";
}

function normalizeConfidence(value: string) {
  return SEC_425_CONFIDENCE_VALUES.includes(value as (typeof SEC_425_CONFIDENCE_VALUES)[number])
    ? (value as (typeof SEC_425_CONFIDENCE_VALUES)[number])
    : "medium";
}

function normalizeImpactLevel(value: string, score: number) {
  if (SEC_425_IMPACT_LEVEL_VALUES.includes(value as (typeof SEC_425_IMPACT_LEVEL_VALUES)[number])) {
    return value as (typeof SEC_425_IMPACT_LEVEL_VALUES)[number];
  }
  if (score >= 75) return "decisive_outcome" as const;
  if (score >= 60) return "material_progression" as const;
  if (score >= 50) return "procedural_update" as const;
  return "repeated_information" as const;
}

function capScoreForImpactLevel(
  score: number,
  impactLevel: (typeof SEC_425_IMPACT_LEVEL_VALUES)[number],
) {
  if (impactLevel === "repeated_information") return Math.min(score, 49);
  if (impactLevel === "procedural_update") return Math.min(score, 49);
  if (impactLevel === "material_progression") return Math.min(score, 74);
  return score;
}

function isProceduralVoteCommunication(
  parserOutput: Sec425ParserOutput,
  analysisOutput: Record<string, unknown>,
) {
  if (normalizeEventType(stringValue(analysisOutput.event_type)) !== "shareholder_vote") return false;

  const facts = readRecord(parserOutput.facts);
  const vote = readRecord(facts?.vote);
  const voteResults = Array.isArray(vote?.vote_results) ? vote.vote_results : [];
  if (voteResults.length > 0) return false;

  const communicationTypes = Array.isArray(facts?.communication_types)
    ? facts.communication_types.map((value) => stringValue(value))
    : [];
  return vote?.adjourned === true || communicationTypes.some((value) =>
    value === "meeting_adjournment" || value === "proxy_solicitation"
  );
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(Number.isFinite(value) ? value : 0)));
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
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const sec425RuntimeAnalysisResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["impact_level", "analysis_output", "analysis_case", "source_blocks_used"],
  properties: {
    impact_level: { type: "string", enum: SEC_425_IMPACT_LEVEL_VALUES },
    analysis_output: sec425RequiredOutputResponseSchema.properties.analysis_output,
    analysis_case: { type: "string", enum: SEC_425_ANALYSIS_CASE_VALUES },
    source_blocks_used: {
      type: "array",
      maxItems: 12,
      items: { type: "string" },
    },
  },
} as const;
