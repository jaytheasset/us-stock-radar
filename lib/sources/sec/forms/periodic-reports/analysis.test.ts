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
import { collectSecPeriodicReportsScoringWarnings } from "../../../../ai/secPeriodicReportsAnalysisAdapter";
import { buildSecPeriodicReportsDisplayPayload } from "./displayPayload";
import { parseSecPeriodicReport } from "./parser";
import {
  clipPeriodicDisplayText,
  normalizePeriodicChartNumber,
  normalizePeriodicComparisonBasis,
} from "./uiNormalization";
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

assert.deepEqual(secPeriodicReportsAnalysisResponseSchema.properties.event_type.enum, APPROVED_SEC_EVENT_TYPES);
assert.ok(secPeriodicReportsAnalysisResponseSchema.properties.event_type.enum.includes("ipo_listing"), "analysis schema includes ipo_listing");
assert.equal(secPeriodicReportsAnalysisResponseSchema.properties.parser_output, undefined, "analysis schema omits parser output");
assert.equal(secPeriodicReportsAnalysisResponseSchema.properties.display_payload, undefined, "analysis schema omits display payload");
assert.equal(secPeriodicReportsAnalysisResponseSchema.properties.fixture_expected, undefined, "analysis schema omits fixture expectations");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /below 50 is archive/i, "analysis prompt archive band");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /50 to 59 is routine or limited change/i, "analysis prompt routine band");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /75 to 84 requires a major inflection/i, "analysis prompt alert band");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /Score measures investor attention and urgency/i, "analysis separates impact from direction");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /micro below \$100M/i, "analysis defines market-cap tiers");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /micro 25% \/ 50% \/ 100%/i, "analysis defines revenue thresholds by market cap");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /Neutral signal must have score below 75/i, "analysis prevents neutral alerts");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /explicit total market capitalization stated in current-filing original source blocks; otherwise site-provided market_context\.market_cap/i, "analysis uses filing-first market cap priority");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /aggregate market value held by non-affiliates is public float value, not total market capitalization/i, "analysis distinguishes public float from market cap");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /Use market context only when supplied in the site_market_context source block and only after checking current-filing/i, "analysis uses supplied market context only as fallback");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /Choose event_type directly/i, "analysis chooses representative event type");
assert.match(secPeriodicReportsAnalysisSystemPrompt, /Do not return parser_output, display_payload, fixture_expected/i, "analysis omits integration-owned output");
assert.equal(secPeriodicReportsAnalysisResponseSchema.properties.key_evidence.maxItems, 3, "analysis limits key evidence");
assert.ok(secPeriodicReportsAnalysisResponseSchema.required.includes("scoring_assessment"), "analysis requires scoring assessment");
assert.equal(secPeriodicReportsAnalysisResponseSchema.properties.scoring_assessment.properties.material_offsets.maxItems, 3, "analysis bounds material offsets");
assert.equal(secPeriodicReportsAnalysisResponseSchema.properties.calendar_items.maxItems, 4, "analysis limits calendar items");
assert.equal(secPeriodicReportsAnalysisResponseSchema.properties.report_ui.properties.snapshot_metrics.maxItems, 4, "analysis limits snapshot metrics");
assert.equal(secPeriodicReportsAnalysisResponseSchema.properties.report_ui.properties.performance_comparisons.maxItems, 3, "analysis limits comparison charts");
assert.equal(secPeriodicReportsAnalysisResponseSchema.properties.report_ui.properties.key_business_updates.maxItems, 3, "analysis limits business updates");
assert.equal(normalizePeriodicComparisonBasis("Q1 2026", "Q1 2025", "other"), "yoy", "same quarter derives YoY");
assert.equal(normalizePeriodicComparisonBasis("Q1 2026", "Q4 2025", "yoy"), "qoq", "consecutive quarters override an invalid YoY label");
assert.equal(normalizePeriodicComparisonBasis("FY2026", "FY2025", "other"), "yoy", "annual periods derive prior-year comparison");
assert.equal(normalizePeriodicChartNumber("($90 million)", 90), -90_000_000, "display value preserves negative sign and magnitude");
assert.equal(normalizePeriodicChartNumber("$1.01B", 1.01), 1_010_000_000, "display value normalizes billion units");
assert.ok(clipPeriodicDisplayText("A long narrative sentence that must fit a compact interface.", 32).length <= 32, "display text is bounded");

const scoringWarnings = collectSecPeriodicReportsScoringWarnings(
  {
    score: 78,
    signal: "neutral",
    scoring_assessment: {
      market_cap_tier: "small",
      primary_change_severity: "meaningful",
      operating_direction: "positive",
      cash_flow_direction: "negative",
      guidance_direction: "mixed",
      earnings_quality: "low",
      material_offsets: ["Free cash flow deteriorated."],
      alert_driver: null,
    },
    report_ui: {
      performance_comparisons: [
        {
          label: "Total Revenue",
          current_numeric: 120,
          comparison_numeric: 100,
        },
      ],
    },
  },
  { filing_package: { market_context: { market_cap: 12_000_000_000 } } },
);
assert.ok(scoringWarnings.some((warning) => warning.code === "market_cap_tier_mismatch"), "validator checks market-cap tier");
assert.ok(scoringWarnings.some((warning) => warning.code === "neutral_alert_score_conflict"), "validator checks neutral alert conflict");
assert.ok(scoringWarnings.some((warning) => warning.code === "missing_alert_driver"), "validator requires alert driver");
assert.ok(scoringWarnings.some((warning) => warning.code === "score_severity_mismatch"), "validator checks severity band");
assert.ok(scoringWarnings.some((warning) => warning.code === "performance_threshold_understated"), "validator applies market-cap performance thresholds");

const filingMarketCapParserOutput = parseSecPeriodicReport({
  rawItemId: "periodic-filing-market-cap-priority",
  sourceUniqueId: "0000000000-26-000004",
  title: "Filing Market Cap Priority Corp. Form 10-K",
  bodyText: `
    <html><body>
      <p>FORM 10-K</p>
      <p>Filing Market Cap Priority Corp.</p>
      <p>As of December 31, 2025, our total market capitalization was approximately $350 million.</p>
      <p>The aggregate market value of common stock held by non-affiliates was approximately $140 million.</p>
      <h1>ITEM 7. MANAGEMENT'S DISCUSSION AND ANALYSIS</h1>
      <p>Revenue increased 20% year over year.</p>
    </body></html>
  `,
  rawPayload: {
    form_type: "10-K",
    accession_number: "0000000000-26-000004",
    company_name: "Filing Market Cap Priority Corp.",
  },
});
const filingFirstWarnings = collectSecPeriodicReportsScoringWarnings(
  {
    score: 65,
    signal: "bullish",
    scoring_assessment: {
      market_cap_tier: "small",
      primary_change_severity: "strong",
      operating_direction: "positive",
      cash_flow_direction: "neutral",
      guidance_direction: "absent",
      earnings_quality: "high",
      material_offsets: [],
      alert_driver: null,
    },
    report_ui: { performance_comparisons: [] },
  },
  {
    filing_package: {
      hard_parsers: { "periodic-reports": filingMarketCapParserOutput },
      market_context: { market_cap: 12_000_000_000 },
    },
  },
);
assert.equal(filingFirstWarnings.some((warning) => warning.code === "market_cap_tier_mismatch"), false, "validator prefers explicit filing market cap over site market cap");

const wrongFilingTierWarnings = collectSecPeriodicReportsScoringWarnings(
  {
    score: 65,
    signal: "bullish",
    scoring_assessment: {
      market_cap_tier: "mega",
      primary_change_severity: "strong",
      operating_direction: "positive",
      cash_flow_direction: "neutral",
      guidance_direction: "absent",
      earnings_quality: "high",
      material_offsets: [],
      alert_driver: null,
    },
    report_ui: { performance_comparisons: [] },
  },
  {
    filing_package: {
      hard_parsers: { "periodic-reports": filingMarketCapParserOutput },
      market_context: { market_cap: 12_000_000_000 },
    },
  },
);
assert.ok(wrongFilingTierWarnings.some((warning) => warning.code === "market_cap_tier_mismatch" && /Current-filing explicit market capitalization maps to small/.test(warning.warning)), "validator explains filing-first tier mismatch");

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
  const displayPayload = buildSecPeriodicReportsDisplayPayload({
    parser_output: parserOutput,
  });
  assert.equal(displayPayload.data.version, "periodic_report_display_v2", `${fixtureName}: parser-only display payload version`);
  assert.equal(displayPayload.display_type, expected.display_payload.display_type, `${fixtureName}: builder display type`);
  assert.equal(displayPayload.data.ipo_kind, null, `${fixtureName}: non-IPO display payload kind`);

  if (fixtureName === "routine-10q-earnings") {
    const reportDisplayPayload = buildSecPeriodicReportsDisplayPayload({
      parser_output: parserOutput,
      analysis_output: {
        report_ui: {
          snapshot_intro: "Quarterly revenue and profit improved from the prior-year period.",
          snapshot_metrics: [
            { label: "Period", value: "Q1 2026", note: null },
            { label: "Revenue", value: "$120.4M", note: null },
          ],
          performance_comparisons: [
            {
              label: "Revenue",
              current_label: "Q1 2026",
              current_value: "$120.4M",
              current_numeric: 120.4,
              comparison_label: "Q1 2025",
              comparison_value: "$112.0M",
              comparison_numeric: 112,
              comparison_basis: "yoy",
              change_note: "Up 8% YoY",
              change_tone: "improvement",
            },
          ],
          guidance_metrics: [],
          key_business_updates: [
            { title: "Cash position", value: "$220.0M", summary: "Cash remains available for operations." },
          ],
        },
      },
    });
    assert.equal(reportDisplayPayload.display_type, "periodic_report", "analysis UI selects periodic report display");
    assert.equal(reportDisplayPayload.data.version, "periodic_report_display_v2", "analysis UI uses display v2");
    assert.equal((reportDisplayPayload.data.snapshot_metrics as unknown[]).length, 2, "analysis UI keeps snapshot metrics");
    assert.equal((reportDisplayPayload.data.performance_comparisons as unknown[]).length, 1, "analysis UI keeps comparison charts");
  }

  const analysisPrompt = buildSecPeriodicReportsAnalysisPromptDraft({
    parser_output: parserOutput,
    filing_excerpt: fixture.filing.bodyText,
    market_context: fixture.market_context || null,
  });

  assert.equal(analysisPrompt.key, SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_KEY, `${fixtureName}: analysis prompt key`);
  assert.equal(analysisPrompt.version, SEC_PERIODIC_REPORTS_ANALYSIS_PROMPT_VERSION, `${fixtureName}: analysis prompt version`);
  assert.equal(analysisPrompt.responseFormat.json_schema.schema, secPeriodicReportsAnalysisResponseSchema, `${fixtureName}: analysis schema`);
  assert.ok(analysisPrompt.user.includes(String(parserOutput.formType)), `${fixtureName}: analysis prompt carries filing identity`);
  assert.equal(analysisPrompt.user.includes("periodic_report_display_v2"), false, `${fixtureName}: analysis prompt omits display payload`);
  assertSourceBlockOnlyPayload(analysisPrompt.user, `${fixtureName}: analysis`);
}

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
    source_bundle?: {
      selection_method?: unknown;
      selected_block_count?: unknown;
      selected_text_chars?: unknown;
      omitted_block_count?: unknown;
    };
    parser_output?: unknown;
    facts?: unknown;
    signals?: unknown;
    display_payload?: unknown;
    fixture_expected?: unknown;
  };
  assert.equal(payload.parser_output, undefined, `${label}: prompt omits parser_output`);
  assert.equal(payload.facts, undefined, `${label}: prompt omits top-level facts`);
  assert.equal(payload.signals, undefined, `${label}: prompt omits top-level signals`);
  assert.equal(payload.display_payload, undefined, `${label}: prompt omits display payload`);
  assert.equal(payload.fixture_expected, undefined, `${label}: prompt omits fixture expectations`);
  assert.ok(Array.isArray(payload.cleaned_source_blocks), `${label}: prompt has cleaned_source_blocks`);
  assert.equal(payload.source_bundle?.selection_method, "periodic_report_structure", `${label}: structural source selection`);
  assert.equal(payload.source_bundle?.selected_block_count, payload.cleaned_source_blocks.length, `${label}: selected block count`);
  assert.ok(payload.cleaned_source_blocks.length <= 24, `${label}: bounded source block count`);
  const sourceBlocks = payload.cleaned_source_blocks as Array<Record<string, unknown>>;
  const totalChars = sourceBlocks.reduce((total, block) => total + String(block.text || "").length, 0);
  assert.ok(totalChars <= 48_000, `${label}: bounded source text size`);
  assert.equal(payload.source_bundle?.selected_text_chars, totalChars, `${label}: selected text size`);
  assert.ok(sourceBlocks.some((block) => ["periodic_report_section", "financial_table", "xbrl_statement_facts", "amendment_scope", "source_excerpt"].includes(String(block.block_type))), `${label}: includes substantive filing source`);
  assert.equal(sourceBlocks.some((block) => ["document_inventory", "attachment_inventory", "parser_warnings"].includes(String(block.block_type))), false, `${label}: excludes debug inventory and warnings`);
  assert.equal(new Set(sourceBlocks.map((block) => String(block.block_id))).size, sourceBlocks.length, `${label}: stable unique block ids`);
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
