import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  buildNtAnalysisPromptDraft,
  SEC_NT_ANALYSIS_PROMPT_KEY,
  SEC_NT_ANALYSIS_PROMPT_VERSION,
} from "@/lib/sources/sec/forms/nt/analysisPrompt";
import { buildNtDisplayPayload } from "@/lib/sources/sec/forms/nt/displayPayload";
import {
  isNtApprovedEventType,
  type NtAnalysisOutput,
  type NtParserOutput,
} from "@/lib/sources/sec/forms/nt/types";

export {
  SEC_NT_ANALYSIS_PROMPT_KEY,
  SEC_NT_ANALYSIS_PROMPT_VERSION,
};

export type SecNtAnalysisAdapterResult =
  | { ok: true; analysis: Record<string, unknown> }
  | { ok: false; error: string };

export type SecNtScoringWarning = {
  code: string;
  warning: string;
};

export function isSecNtFilingInput(input: SecFilingAnalysisInput) {
  const filingPackage = readRecord(input.filing_package);
  const parserOutput = readSecNtParserOutput(input);
  const formType = stringValue(filingPackage?.form_type).toUpperCase();
  return Boolean(
    (parserOutput && parserOutput.isSupported !== false) ||
      /^(?:NT 10-K|NT 10-Q|NT 20-F)(?:\/A)?$/.test(formType),
  );
}

export function buildSecNtAnalysisPromptForInput(input: SecFilingAnalysisInput) {
  const parserOutput = readSecNtParserOutput(input);
  if (!parserOutput) {
    throw new Error("SEC NT parser output is missing from filing package");
  }
  return buildNtAnalysisPromptDraft({ input, parserOutput });
}

export function adaptSecNtAnalysisPromptResultForAnalysis(
  value: unknown,
  input: SecFilingAnalysisInput,
): SecNtAnalysisAdapterResult {
  const root = readRecord(value);
  if (!root) {
    return { ok: false, error: "SEC NT analysis response did not contain a JSON object" };
  }
  const parserOutput = readSecNtParserOutput(input);
  if (!parserOutput) {
    return { ok: false, error: "SEC NT parser output is missing from filing package" };
  }

  const parserTicker = parserOutput.facts.ticker;
  const parserExchange = parserOutput.facts.exchange;
  const suppliedPrimaryTicker = readRecord(root.primary_ticker);
  const primaryTicker = {
    ticker: nullableString(suppliedPrimaryTicker?.ticker) || parserTicker || null,
    exchange: nullableString(suppliedPrimaryTicker?.exchange) || parserExchange || null,
  };
  const score = clampScore(root.score);
  const eventType = normalizeEventType(root.event_type);
  const signal = normalizeSignal(root.signal);
  const scoringAssessment = normalizeNtScoringAssessment(root.nt_scoring_assessment);
  const scoringWarnings = collectSecNtScoringWarnings({
    ...root,
    score,
    signal,
    nt_scoring_assessment: scoringAssessment,
  });
  const displayPayload = buildNtDisplayPayload({
    parserOutput,
    analysisOutput: { ...root, event_type: eventType } as Partial<NtAnalysisOutput>,
  });

  return {
    ok: true,
    analysis: {
      ...root,
      source_group: "filings",
      market_scope: normalizeMarketScope(root.market_scope),
      event_type: eventType,
      primary_ticker: primaryTicker,
      tickers: normalizeTickerRows(root.tickers, primaryTicker),
      score,
      signal,
      nt_scoring_assessment: scoringAssessment,
      bullish_points: stringArray(root.bullish_points).slice(0, 3),
      bearish_points: stringArray(root.bearish_points).slice(0, 3),
      key_evidence: stringArray(root.key_evidence),
      what_to_watch_next: stringArray(root.what_to_watch_next).slice(0, 3),
      related_tickers: normalizeRelatedTickerRows(root.related_tickers).slice(0, 5),
      calendar_items: recordArray(root.calendar_items).slice(0, 3),
      confidence: normalizeConfidence(root.confidence),
      needs_human_review: root.needs_human_review === true,
      archive_summary:
        score < 50
          ? nullableString(root.summary) || nullableString(root.quick_take)
          : null,
      display_payload: displayPayload,
      nt_source_bundle: summarizeNtSourceBundle(input),
      nt_validation_warnings: scoringWarnings,
    },
  };
}

export function collectSecNtScoringWarnings(
  analysisResult: Record<string, unknown>,
): SecNtScoringWarning[] {
  const score = clampScore(analysisResult.score);
  const signal = normalizeSignal(analysisResult.signal);
  const assessment = normalizeNtScoringAssessment(analysisResult.nt_scoring_assessment);
  const warnings: SecNtScoringWarning[] = [];
  const band = ntSeverityScoreBand(assessment.severity);

  if (signal === "neutral" && score >= 75) {
    warnings.push({
      code: "neutral_alert_score_conflict",
      warning: "Neutral NT analysis cannot carry an alert-band score of 75 or above.",
    });
  }
  if (score >= 75 && !assessment.alert_driver) {
    warnings.push({
      code: "missing_alert_driver",
      warning: "Alert-band NT analysis requires one explicit source-backed alert driver.",
    });
  }
  if (band && (score < band.minimum || score > band.maximum)) {
    warnings.push({
      code: "score_severity_mismatch",
      warning: `${assessment.severity} NT severity does not align with score ${score}.`,
    });
  }
  if (
    assessment.delay_status === "within_extension" &&
    ["technical", "routine"].includes(assessment.severity) &&
    assessment.financial_reliability_risk === "none" &&
    /none disclosed|no significant|unchanged/i.test(assessment.results_change) &&
    score >= 50
  ) {
    warnings.push({
      code: "routine_delay_overstated",
      warning: "A routine within-extension delay with no disclosed results change should remain below the feed threshold.",
    });
  }
  if (
    assessment.financial_reliability_risk === "explicit" &&
    !["major", "critical"].includes(assessment.severity)
  ) {
    warnings.push({
      code: "explicit_financial_risk_understated",
      warning: "Explicit financial-reliability risk requires major or critical severity unless the source states a clear resolution.",
    });
  }
  return warnings;
}

export function readSecNtParserOutput(input: SecFilingAnalysisInput): NtParserOutput | null {
  const filingPackage = readRecord(input.filing_package);
  const hardParsers = readRecord(filingPackage?.hard_parsers);
  return readRecord(hardParsers?.nt) as NtParserOutput | null;
}

function summarizeNtSourceBundle(input: SecFilingAnalysisInput) {
  try {
    const prompt = buildSecNtAnalysisPromptForInput(input);
    const payload = JSON.parse(prompt.user) as Record<string, unknown>;
    const blocks = recordArray(payload.cleaned_source_blocks);
    return {
      block_count: blocks.length,
      text_chars: blocks.reduce((sum, block) => sum + stringValue(block.text).length, 0),
      block_types: uniqueStrings(blocks.map((block) => stringValue(block.block_type))),
    };
  } catch {
    return { block_count: 0, text_chars: 0, block_types: [] };
  }
}

function normalizeTickerRows(
  value: unknown,
  primaryTicker: { ticker: string | null; exchange: string | null },
) {
  const rows = recordArray(value)
    .map((row) => ({
      ticker: nullableString(row.ticker),
      exchange: nullableString(row.exchange),
      role: normalizeTickerRole(row.role),
    }))
    .filter((row) => row.ticker);
  if (primaryTicker.ticker && !rows.some((row) => row.ticker === primaryTicker.ticker)) {
    rows.unshift({ ...primaryTicker, role: "primary" });
  }
  return rows;
}

function normalizeRelatedTickerRows(value: unknown) {
  return recordArray(value)
    .map((row) => ({
      ticker: nullableString(row.ticker),
      exchange: nullableString(row.exchange),
      reason: nullableString(row.reason),
    }))
    .filter((row) => row.ticker && row.reason);
}

function normalizeTickerRole(value: unknown) {
  const role = stringValue(value).toLowerCase();
  return ["primary", "issuer", "acquirer", "target", "competitor", "peer", "related"].includes(role)
    ? role
    : "related";
}

function normalizeEventType(value: unknown) {
  const eventType = stringValue(value);
  return isNtApprovedEventType(eventType) ? eventType : "other";
}

function normalizeMarketScope(value: unknown) {
  const scope = stringValue(value).toLowerCase();
  return ["company", "sector", "theme", "macro"].includes(scope) ? scope : "company";
}

function normalizeSignal(value: unknown) {
  const signal = stringValue(value).toLowerCase();
  return ["bullish", "bearish", "volatile", "neutral"].includes(signal) ? signal : "neutral";
}

function normalizeConfidence(value: unknown) {
  const confidence = stringValue(value).toLowerCase();
  return ["high", "medium", "low"].includes(confidence) ? confidence : "medium";
}

function normalizeNtScoringAssessment(value: unknown) {
  const assessment = readRecord(value) || {};
  return {
    delay_status: normalizeAssessmentValue(
      assessment.delay_status,
      ["within_extension", "outside_extension", "unclear"],
      "unclear",
    ),
    underlying_issue: nullableString(assessment.underlying_issue) || "Not established",
    results_change: nullableString(assessment.results_change) || "unclear",
    financial_reliability_risk: normalizeAssessmentValue(
      assessment.financial_reliability_risk,
      ["none", "possible", "explicit"],
      "possible",
    ),
    severity: normalizeAssessmentValue(
      assessment.severity,
      ["technical", "routine", "limited", "meaningful", "major", "critical"],
      "limited",
    ),
    material_offset: nullableString(assessment.material_offset),
    alert_driver: nullableString(assessment.alert_driver),
  };
}

function normalizeAssessmentValue(
  value: unknown,
  allowed: string[],
  fallback: string,
) {
  const normalized = stringValue(value).toLowerCase().replace(/[\s-]+/g, "_");
  return allowed.includes(normalized) ? normalized : fallback;
}

function ntSeverityScoreBand(severity: string) {
  if (severity === "technical") return { minimum: 0, maximum: 24 };
  if (severity === "routine") return { minimum: 25, maximum: 39 };
  if (severity === "limited") return { minimum: 40, maximum: 59 };
  if (severity === "meaningful") return { minimum: 50, maximum: 74 };
  if (severity === "major") return { minimum: 75, maximum: 84 };
  if (severity === "critical") return { minimum: 85, maximum: 100 };
  return null;
}

function clampScore(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function recordArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(readRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function nullableString(value: unknown) {
  return stringValue(value) || null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
