import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SecPeriodicReportParseInput } from "./parser";
import type { PeriodicRoomResult } from "./types";
import {
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY,
  SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION,
  buildSecPeriodicReportsAnalysisPromptDraft,
  secPeriodicReportsAnalysisResponseSchema,
  secPeriodicReportsAnalysisSystemPrompt,
} from "./analysisPrompt";
import { buildSecPeriodicReportsDisplayPayload } from "./displayPayload";
import { parseSecPeriodicReport } from "./parser";
import { buildSecPeriodicReportsRouterPromptDraft } from "./routerPrompt";
import {
  APPROVED_SEC_EVENT_TYPES,
  PERIODIC_REPORT_DISPLAY_TYPES,
  deriveDeliveryLevel,
  isApprovedSecEventType,
} from "./types";

type Fixture = {
  filing: SecPeriodicReportParseInput;
  expected_event_type: string;
  deterministic_without_llm?: boolean;
  market_context?: Record<string, unknown> | null;
};

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "periodic-reports");
const fixtureNames = [
  "routine-10q-earnings",
  "going-concern-10k",
  "revenue-decline-10q",
  "legal-risk-20f",
  "dividend-buyback-10q",
  "foreign-issuer-20f",
  "routine-amendment-10qa",
];

assert.deepEqual(secPeriodicReportsAnalysisResponseSchema.properties.analysis_output.properties.event_type.enum, APPROVED_SEC_EVENT_TYPES);
assert.ok(secPeriodicReportsAnalysisResponseSchema.properties.analysis_output.properties.event_type.enum.includes("ipo_listing"), "analysis schema includes ipo_listing");
assert.deepEqual(secPeriodicReportsAnalysisResponseSchema.properties.display_payload.properties.display_type.enum, PERIODIC_REPORT_DISPLAY_TYPES);
assert.match(secPeriodicReportsAnalysisSystemPrompt, /score below 50 is archive/i, "analysis prompt archive band");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /50 to 74 is feed/i, "analysis prompt feed band");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /75 or above is alert/i, "analysis prompt alert band");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /Use market context only when supplied as fixture/i, "analysis fixture market context only");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /analysis LLM writes investor-facing copy only/i, "analysis only writes investor copy");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /Copy display_payload from the supplied display_payload/i, "analysis copies display payload");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /Do not choose the UI template/i, "analysis display type guardrail");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /event_type is ipo_listing/i, "analysis preserves IPO listing event type");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /display_payload\.data\.ipo_kind as traditional or spac/i, "analysis preserves IPO kind detail");

for (const fixtureName of fixtureNames) {
  const fixture = readJson<Fixture>(join(roomDir, "fixtures", `${fixtureName}.json`));
  const expected = readJson<PeriodicRoomResult>(join(roomDir, "expected", `${fixtureName}.expected.json`));
  assertRequiredRoomShape(expected, fixtureName);

  assert.equal(expected.parser_output.parserGroup, "periodic-reports", `${fixtureName}: parser group`);
  assert.equal(expected.analysis_output.source_group, "filings", `${fixtureName}: source group`);
  assert.equal(expected.analysis_output.event_type, fixture.expected_event_type, `${fixtureName}: expected event type`);
  assert.ok(isApprovedSecEventType(expected.analysis_output.event_type), `${fixtureName}: approved final event type`);
  assert.equal(deriveDeliveryLevel(expected.analysis_output.score), expected.fixture_expected.expected_delivery_level, `${fixtureName}: score band`);
  assert.ok(PERIODIC_REPORT_DISPLAY_TYPES.includes(expected.display_payload.display_type), `${fixtureName}: display type`);

  if (expected.fixture_expected.market_context_needed) {
    assert.ok(expected.fixture_expected.market_context_reason, `${fixtureName}: market context reason`);
    assert.ok(expected.fixture_expected.market_context_fields.length > 0, `${fixtureName}: market context fields`);
  } else {
    assert.equal(expected.fixture_expected.market_context_reason, null, `${fixtureName}: no market context reason`);
    assert.equal(expected.fixture_expected.market_context_fields.length, 0, `${fixtureName}: no market context fields`);
  }

  if (!expected.fixture_expected.special_ui_needed) {
    assert.equal(expected.fixture_expected.special_ui_reason, null, `${fixtureName}: no special UI reason`);
  }

  if (fixture.deterministic_without_llm) {
    assert.equal(expected.parser_output.raw.processing_path, "deterministic_parser_archive", `${fixtureName}: expected deterministic path`);
    assert.equal(expected.analysis_output.score < 50, true, `${fixtureName}: deterministic archive score`);
    assert.equal(expected.analysis_output.event_type, "other", `${fixtureName}: deterministic event type`);
    assert.equal(expected.analysis_output.needs_human_review, false, `${fixtureName}: deterministic no human review`);
  }

  const parserOutput = parseSecPeriodicReport(fixture.filing);
  const routerResult = {
    event_type: expected.analysis_output.event_type,
    display_type: expected.display_payload.display_type,
    display_version: "periodic_report_display_v1",
    ipo_kind: null,
    preliminary_score: expected.analysis_output.score,
    derived_delivery_level: expected.fixture_expected.expected_delivery_level,
    analysis_llm_needed: expected.parser_output.raw.processing_path !== "deterministic_parser_archive",
    route_case: expected.parser_output.raw.processing_path === "deterministic_parser_archive" ? "routine_amendment_no_llm" : "fixture_expected",
    confidence: expected.analysis_output.confidence,
  };
  const displayPayload = buildSecPeriodicReportsDisplayPayload({
    parser_output: parserOutput,
    router_result: routerResult,
  });
  assert.equal(displayPayload.data.version, "periodic_report_display_v1", `${fixtureName}: display payload version`);
  assert.equal(displayPayload.display_type, expected.display_payload.display_type, `${fixtureName}: builder display type`);
  assert.equal(displayPayload.data.ipo_kind, null, `${fixtureName}: non-IPO display payload kind`);

  const routerPrompt = buildSecPeriodicReportsRouterPromptDraft({
    parser_output: parserOutput,
    filing_excerpt: fixture.filing.bodyText,
    market_context: fixture.market_context || null,
  });
  const analysisPrompt = buildSecPeriodicReportsAnalysisPromptDraft({
    parser_output: parserOutput,
    router_result: routerResult,
    display_payload: displayPayload,
    filing_excerpt: fixture.filing.bodyText,
    market_context: fixture.market_context || null,
  });

  assert.equal(analysisPrompt.key, SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY, `${fixtureName}: analysis prompt key`);
  assert.equal(analysisPrompt.version, SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION, `${fixtureName}: analysis prompt version`);
  assert.equal(analysisPrompt.responseFormat.json_schema.schema, secPeriodicReportsAnalysisResponseSchema, `${fixtureName}: analysis schema`);
  assert.ok(routerPrompt.user.includes(String(parserOutput.formType)), `${fixtureName}: router prompt carries parser output`);
  assert.ok(analysisPrompt.user.includes(String(expected.analysis_output.event_type)), `${fixtureName}: analysis prompt carries router result`);
  assert.ok(analysisPrompt.user.includes("periodic_report_display_v1"), `${fixtureName}: analysis prompt carries built display payload`);
  assertSourceBlockOnlyPayload(routerPrompt.user, `${fixtureName}: router`);
  assertSourceBlockOnlyPayload(analysisPrompt.user, `${fixtureName}: analysis`);
}

const ipoFixture = readJson<Fixture>(join(roomDir, "fixtures", "routine-10q-earnings.json"));
const ipoParserOutput = parseSecPeriodicReport(ipoFixture.filing);
const ipoDisplayPayload = buildSecPeriodicReportsDisplayPayload({
  parser_output: ipoParserOutput,
  router_result: {
    event_type: "ipo_listing",
    display_type: "generic",
    display_version: "periodic_report_display_v1",
    ipo_kind: "spac",
    analysis_llm_needed: true,
  },
});
assert.equal(ipoDisplayPayload.data.event_type, "ipo_listing", "display payload carries IPO listing event type");
assert.equal(ipoDisplayPayload.data.ipo_kind, "spac", "display payload carries IPO kind");

console.log("sec periodic reports analysis fixtures passed");

function assertRequiredRoomShape(result: PeriodicRoomResult, label: string) {
  for (const key of ["parser_output", "analysis_output", "display_payload", "fixture_expected"] as const) {
    assert.ok(hasOwn(result, key), `${label}: required top-level ${key}`);
  }

  for (const key of [
    "parserVersion",
    "parserGroup",
    "formType",
    "accessionNumber",
    "isSupported",
    "summary",
    "facts",
    "signals",
    "calendarItems",
    "warnings",
    "raw",
  ] as const) {
    assert.ok(hasOwn(result.parser_output, key), `${label}: parser_output.${key}`);
  }

  for (const key of [
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
  ] as const) {
    assert.ok(hasOwn(result.analysis_output, key), `${label}: analysis_output.${key}`);
  }

  assert.ok(result.analysis_output.score >= 0 && result.analysis_output.score <= 100, `${label}: score range`);
  assert.ok(Array.isArray(result.analysis_output.key_evidence), `${label}: evidence array`);
  assert.ok(Array.isArray(result.display_payload.evidence), `${label}: display evidence array`);
}

function hasOwn(target: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function assertSourceBlockOnlyPayload(promptUser: string, label: string) {
  const payload = JSON.parse(promptUser) as {
    cleaned_source_blocks?: unknown;
    parser_output?: unknown;
    facts?: unknown;
    signals?: unknown;
  };
  assert.equal(payload.parser_output, undefined, `${label}: prompt omits parser_output`);
  assert.equal(payload.facts, undefined, `${label}: prompt omits top-level facts`);
  assert.equal(payload.signals, undefined, `${label}: prompt omits top-level signals`);
  assert.ok(Array.isArray(payload.cleaned_source_blocks), `${label}: prompt has cleaned_source_blocks`);
  assert.deepEqual(findForbiddenKeys(payload.cleaned_source_blocks), [], `${label}: source blocks omit parser judgment keys`);
}

function findForbiddenKeys(value: unknown, path = "cleaned_source_blocks"): string[] {
  const forbidden = new Set([
    "facts",
    "signals",
    "classification",
    "event_type",
    "display_type",
    "score",
    "topSignal",
    "extraction_summary",
    "selected_classification",
    "routingHints",
  ]);
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenKeys(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
    const nextPath = `${path}.${key}`;
    return [
      ...(forbidden.has(key) ? [nextPath] : []),
      ...findForbiddenKeys(item, nextPath),
    ];
  });
}
