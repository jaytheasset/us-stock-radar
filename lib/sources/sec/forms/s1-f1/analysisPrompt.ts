import {
  APPROVED_SEC_EVENT_TYPES,
  type S1F1ParserOutput,
  type S1F1RequiredOutputJson,
  type S1F1RouterDecision,
  deliveryLevelFromScore,
  isApprovedSecEventType,
} from "./types.ts";
import { buildS1F1DisplayPayload } from "./displayPayload.ts";
import { buildS1F1LlmSourceInput } from "./routerPrompt.ts";
import type { S1F1DisplayPayload } from "./types.ts";

export { buildS1F1DisplayPayload } from "./displayPayload.ts";

const REQUIRED_TOP_LEVEL_KEYS = ["parser_output", "analysis_output", "display_payload", "fixture_expected"] as const;

const REQUIRED_ANALYSIS_KEYS = [
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
] as const;

export function buildS1F1AnalysisPrompt(
  parserOutput: S1F1ParserOutput,
  routerDecision: S1F1RouterDecision,
  displayPayload: S1F1DisplayPayload = buildS1F1DisplayPayload(parserOutput, routerDecision),
): string {
  return [
    "You are the SEC S-1/F-1 analysis prompt for the S-1 / F-1, S-1/A / F-1/A form room.",
    "Use only the cleaned source input JSON and fixture market context if present.",
    "Do not call live FMP, live DB, ingest, alerts, common code, or UI code.",
    "Write investor-facing analysis, but keep every claim tied to cleaned source blocks or fixture market context.",
    "Do not write UI instructions or invent UI fields.",
    "Classify from the cleaned source blocks. Do not rely on parser-generated labels.",
    "Do not use parser-generated facts, signals, extraction summaries, offering kinds, risk flags, top signals, event types, display types, or scores as analysis evidence.",
    "Do not invent, correct, or substitute ticker symbols. If ticker or exchange is unclear from the cleaned source input, preserve null or state uncertainty.",
    "If the filing text appears to contain a conflicting proposed ticker, preserve the parser ticker, put the conflict in key_evidence or needs_human_review, and do not overwrite primary_ticker.",
    "Amendments are update filings. Explain whether a changed term is material; routine amendments should remain low-score archive items.",
    "POS AM and Rule 462(b) MEF filings are boundary variants. Do not analyze them as ordinary S-1/A or F-1/A filings unless the cleaned source blocks show ordinary registration content.",
    "For S-1/A and F-1/A, use only compact parent_filing_context when present. Do not assume access to full parent raw text.",
    "",
    "Approved event_type values, and no others:",
    APPROVED_SEC_EVENT_TYPES.map((eventType) => `- ${eventType}`).join("\n"),
    "",
    "Score bands are fixed:",
    "- score below 50 => fixture_expected.expected_delivery_level must be archive",
    "- score 50 to 74 => fixture_expected.expected_delivery_level must be feed",
    "- score 75 or above => fixture_expected.expected_delivery_level must be alert",
    "",
    "display_payload is already built by the UI payload builder. Its display_type must be one of:",
    "- generic",
    "- offering_terms",
    "- candidate_special",
    "- spac_transaction_status",
    "",
    "Return JSON only in the Required Output JSON shape:",
    JSON.stringify(
      {
        parser_output: {
          parserVersion: parserOutput.parserVersion,
          parserGroup: parserOutput.parserGroup,
          formType: parserOutput.formType,
          accessionNumber: parserOutput.accessionNumber,
          isSupported: parserOutput.isSupported,
        },
        analysis_output: {
          source_group: "filings",
          market_scope: "company",
          event_type: "approved event_type selected from cleaned source blocks",
          event_title: "string",
          primary_ticker: { ticker: "string | null", exchange: "string | null" },
          tickers: [],
          sector: null,
          industry_group: null,
          theme_group: null,
          sub_theme: null,
          score: 0,
          score_reason: "string",
          signal: "bullish | bearish | volatile | neutral",
          quick_take: "string",
          summary: "string",
          why_it_matters: "string",
          bullish_points: [],
          bearish_points: [],
          key_evidence: [],
          what_to_watch_next: [],
          related_tickers: [],
          calendar_items: [],
          confidence: "high | medium | low",
          needs_human_review: false,
        },
        display_payload: {
          display_type: "generic | offering_terms | candidate_special | spac_transaction_status",
          display_version: "s1-f1-display-v1",
          data: {},
          evidence: [],
          notes: [],
        },
        fixture_expected: {
          expected_delivery_level: "archive | feed | alert",
          expected_impact: "low | medium | high",
          market_context_needed: false,
          market_context_reason: null,
          market_context_fields: [],
          special_ui_needed: false,
          special_ui_reason: null,
          integration_notes: [],
        },
      },
      null,
      2,
    ),
    "",
    "Cleaned source input:",
    JSON.stringify(buildS1F1LlmSourceInput(parserOutput), null, 2),
  ].join("\n");
}

export function validateS1F1RequiredOutputShape(value: unknown): string[] {
  const errors: string[] = [];
  if (!value || typeof value !== "object") return ["Expected a JSON object."];
  const root = value as Partial<S1F1RequiredOutputJson> & Record<string, unknown>;

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in root)) errors.push(`Missing top-level key: ${key}`);
  }

  const analysis = root.analysis_output as Record<string, unknown> | undefined;
  if (!analysis || typeof analysis !== "object") {
    errors.push("analysis_output must be an object.");
  } else {
    for (const key of REQUIRED_ANALYSIS_KEYS) {
      if (!(key in analysis)) errors.push(`Missing analysis_output key: ${key}`);
    }
    if (analysis.source_group !== "filings") errors.push("analysis_output.source_group must be filings.");
    if (typeof analysis.event_type !== "string" || !isApprovedSecEventType(analysis.event_type)) {
      errors.push("analysis_output.event_type must be one of the approved SEC event types.");
    }
    if (typeof analysis.score !== "number") {
      errors.push("analysis_output.score must be a number.");
    }
    if ("delivery_level" in analysis) {
      errors.push("analysis_output must not include delivery_level; it is derived from score.");
    }
  }

  const parser = root.parser_output as Record<string, unknown> | undefined;
  const parserFacts = parser?.facts as Record<string, unknown> | undefined;
  if (!parser || typeof parser !== "object") {
    errors.push("parser_output must be an object.");
  } else {
    if (parser.parserGroup !== "s1-f1") errors.push("parser_output.parserGroup must be s1-f1.");
    if (parser.formType !== "S-1 / F-1, S-1/A / F-1/A") {
      errors.push("parser_output.formType must use the exact room scope label.");
    }
  }

  if (analysis && parserFacts && typeof parserFacts === "object") {
    const parserTicker = typeof parserFacts.ticker === "string" ? parserFacts.ticker.trim().toUpperCase() : "";
    const parserExchange = typeof parserFacts.exchange === "string" ? parserFacts.exchange.trim() : "";
    const primaryTicker = analysis.primary_ticker as Record<string, unknown> | undefined;
    const analysisTicker =
      typeof primaryTicker?.ticker === "string" ? primaryTicker.ticker.trim().toUpperCase() : "";
    const analysisExchange =
      typeof primaryTicker?.exchange === "string" ? primaryTicker.exchange.trim() : "";

    if (parserTicker && analysisTicker !== parserTicker) {
      errors.push("analysis_output.primary_ticker.ticker must match parser_output.facts.ticker.");
    }
    if (parserExchange && analysisExchange !== parserExchange) {
      errors.push("analysis_output.primary_ticker.exchange must match parser_output.facts.exchange.");
    }
    if (parserTicker && Array.isArray(analysis.tickers)) {
      const tickers = analysis.tickers.map((ticker) => String(ticker).trim().toUpperCase());
      if (!tickers.includes(parserTicker)) {
        errors.push("analysis_output.tickers must include parser_output.facts.ticker.");
      }
    }
  }

  const display = root.display_payload as Record<string, unknown> | undefined;
  if (!display || typeof display !== "object") {
    errors.push("display_payload must be an object.");
  } else {
    if (!["generic", "offering_terms", "candidate_special", "spac_transaction_status"].includes(String(display.display_type))) {
      errors.push("display_payload.display_type must be generic, offering_terms, candidate_special, or spac_transaction_status.");
    }
    if ("display_version" in display && typeof display.display_version !== "string") {
      errors.push("display_payload.display_version must be a string when present.");
    }
  }

  const fixtureExpected = root.fixture_expected as Record<string, unknown> | undefined;
  if (!fixtureExpected || typeof fixtureExpected !== "object") {
    errors.push("fixture_expected must be an object.");
  } else if (analysis && typeof analysis.score === "number") {
    const derivedDeliveryLevel = deliveryLevelFromScore(analysis.score);
    if (fixtureExpected.expected_delivery_level !== derivedDeliveryLevel) {
      errors.push(
        `fixture_expected.expected_delivery_level must be ${derivedDeliveryLevel} for score ${analysis.score}.`,
      );
    }
  }

  return errors;
}
