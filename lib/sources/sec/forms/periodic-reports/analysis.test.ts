import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SecPeriodicReportParseInput } from "./parser";
import type { PeriodicRoomResult } from "./types";
import { extractPeriodicReportIngestEvidence } from "./ingestSourceExtract";
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
assert.equal(normalizePeriodicComparisonBasis("FY2025", "FY2023", "yoy"), "other", "non-adjacent annual periods are not YoY");
assert.equal(normalizePeriodicChartNumber("($90 million)", 90), -90_000_000, "display value preserves negative sign and magnitude");
assert.equal(normalizePeriodicChartNumber("$1.01B", 1.01), 1_010_000_000, "display value normalizes billion units");
assert.ok(clipPeriodicDisplayText("A long narrative sentence that must fit a compact interface.", 32).length <= 32, "display text is bounded");
assert.equal(
  clipPeriodicDisplayText("Annual performance improved\u00e2\u20ac\u00a6", 80),
  "Annual performance improved...",
  "display text repairs UTF-8 punctuation decoded as Windows-1252",
);
assert.equal(
  clipPeriodicDisplayText("A long narrative sentence that must fit a compact interface.", 32).endsWith("..."),
  true,
  "clipped display text uses an ASCII ellipsis",
);

const fullAnnualHtml = `${"<!-- filing padding -->".repeat(100_000)}
  <xbrli:context id="FY2026"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period></xbrli:context>
  <xbrli:context id="FY2025"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate></xbrli:period></xbrli:context>
  <ix:nonFraction name="ifrs-full:Revenue" contextRef="FY2026" unitRef="USD" decimals="-6">1,024</ix:nonFraction>
  <ix:nonFraction name="ifrs-full:Revenue" contextRef="FY2025" unitRef="USD" decimals="-6">996</ix:nonFraction>
  <ix:nonNumeric name="ifrs-full:RevenuePracticalExpedientFinancingComponent" contextRef="FY2026">true</ix:nonNumeric>`;
const annualIngestEvidence = extractPeriodicReportIngestEvidence({
  cleanedText: "During fiscal year 2026, total revenue increased 3% from fiscal year 2025, while net income decreased 19% compared with the prior year.",
  formType: "20-F",
  html: fullAnnualHtml,
  isPrimary: true,
  sourceDocument: "annual-20f.htm",
});
assert.ok(annualIngestEvidence, "annual periodic filings preserve compact evidence before general source truncation");
assert.equal(annualIngestEvidence?.xbrlFacts.filter((fact) => /:Revenue$/i.test(fact.name)).length, 2, "full-document extraction retains adjacent annual revenue facts beyond the generic HTML cap");
assert.equal(annualIngestEvidence?.xbrlFacts.some((fact) => /PracticalExpedient/i.test(fact.name)), false, "disclosure booleans are not retained as core performance facts");
assert.match(annualIngestEvidence?.sourceBlocks[0]?.text || "", /net income decreased 19%/i, "annual core performance paragraph is preserved with its comparison context");

const foreignAnnualReportAttachmentEvidence = extractPeriodicReportIngestEvidence({
  cleanedText: "For the year ended December 31, 2025, total sales increased 6% from 2024 and operating profit decreased 1% compared with the prior year.",
  formType: "20-F",
  html: fullAnnualHtml,
  isPrimary: false,
  isAnnualReportAttachment: true,
  sourceDocument: "annual-report-exhibit-15-1.htm",
});
assert.ok(foreignAnnualReportAttachmentEvidence, "20-F annual report exhibits preserve financial evidence even when the primary filing is a wrapper");
assert.equal(foreignAnnualReportAttachmentEvidence?.xbrlFacts.filter((fact) => /:Revenue$/i.test(fact.name)).length, 2, "annual report exhibit XBRL facts are preserved");

const segmentHeadingEvidence = extractPeriodicReportIngestEvidence({
  cleanedText: [
    "Results by business",
    "International Wealth and Premier Banking",
    "Financial performance Revenue of $14.5bn was $0.7bn or 5% higher than in 2024. Net income increased compared with 2024, while operating expenses of $9.3bn were $0.4bn or 4% higher.",
  ].join("\n\n"),
  formType: "20-F",
  html: "",
  isPrimary: true,
  sourceDocument: "bank-annual-report.htm",
});
assert.match(
  segmentHeadingEvidence?.sourceBlocks[0]?.text || "",
  /Results by business\nInternational Wealth and Premier Banking\nFinancial performance/i,
  "annual performance blocks retain nearby original section headings so segment metrics are not mistaken for consolidated totals",
);
assert.equal(
  segmentHeadingEvidence?.sourceBlocks[0]?.scope,
  "segment_or_subset",
  "annual segment performance paragraphs carry explicit subset scope metadata",
);

const distantSegmentHeadingEvidence = extractPeriodicReportIngestEvidence({
  cleanedText: [
    "Business segments",
    "International Wealth and",
    "Premier Banking",
    "Our IWPB business comprises Premier banking outside Hong Kong and the UK, our Private Bank, Asset Management and Insurance businesses.",
    ...Array.from({ length: 230 }, (_, index) => `| table row ${index} | ${index + 1} |`),
    "Financial performance Revenue of $14.5bn was $0.7bn or 5% higher than in 2024. Net income increased compared with 2024, while operating expenses of $9.3bn were $0.4bn or 4% higher. For business segment financial performance commentary, see the annual report.",
  ].join("\n\n"),
  formType: "20-F",
  html: "",
  isPrimary: true,
  sourceDocument: "bank-annual-report-long-table.htm",
});
assert.match(
  distantSegmentHeadingEvidence?.sourceBlocks[0]?.text || "",
  /^International Wealth and Premier Banking\nFinancial performance/i,
  "segment definition headings survive long intervening tables without treating table rows as headings",
);

const standardXbrlInstanceEvidence = extractPeriodicReportIngestEvidence({
  cleanedText: "",
  formType: "20-F",
  html: `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:ifrs-full="https://xbrl.ifrs.org/taxonomy/2025-03-27/ifrs-full">
    <xbrli:context id="FY2025"><xbrli:entity><xbrli:identifier scheme="test">1</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>2025-12-31</xbrli:endDate></xbrli:period></xbrli:context>
    <ifrs-full:Revenue contextRef="FY2025" unitRef="DKK" decimals="-6">309064000000</ifrs-full:Revenue>
  </xbrli:xbrl>`,
  isPrimary: false,
  isMachineReadableXbrl: true,
  sourceDocument: "annual_htm.xml",
});
assert.equal(standardXbrlInstanceEvidence?.xbrlFacts[0]?.period, "2025-01-01/2025-12-31", "machine-readable XBRL instance supplies the annual fact period");
assert.equal(standardXbrlInstanceEvidence?.xbrlFacts[0]?.value, 309064000000, "machine-readable XBRL instance supplies the annual fact value");

const preservedAnnualParserOutput = parseSecPeriodicReport({
  rawItemId: "periodic-preserved-annual-core",
  sourceUniqueId: "0000000000-26-000006",
  title: "Preserved Annual Core Ltd. Form 20-F",
  bodyText: "FORM 20-F For the fiscal year ended March 31, 2026.",
  rawPayload: {
    form_type: "20-F",
    company_name: "Preserved Annual Core Ltd.",
    periodic_report_core_xbrl_facts: annualIngestEvidence?.xbrlFacts,
    periodic_report_core_source_blocks: annualIngestEvidence?.sourceBlocks,
  },
});
const preservedAnnualPromptPayload = JSON.parse(buildSecPeriodicReportsAnalysisPromptDraft({
  parser_output: preservedAnnualParserOutput,
}).user) as Record<string, unknown>;
const preservedAnnualBlocks = Array.isArray(preservedAnnualPromptPayload.cleaned_source_blocks)
  ? preservedAnnualPromptPayload.cleaned_source_blocks as Array<Record<string, unknown>>
  : [];
assert.ok(preservedAnnualBlocks.some((block) => block.block_type === "annual_core_performance_facts"), "preserved full-document XBRL reaches the annual analysis bundle");
assert.ok(preservedAnnualBlocks.some((block) => block.block_type === "context_preserving_snippet" && /net income decreased 19%/i.test(String(block.text))), "preserved annual performance context reaches the analysis bundle");

const segmentScopedParserOutput = parseSecPeriodicReport({
  rawItemId: "periodic-segment-scoped-annual",
  sourceUniqueId: "0000000000-26-000008",
  title: "Segment Scoped Annual Ltd. Form 20-F",
  bodyText: "FORM 20-F For the fiscal year ended December 31, 2025.",
  xbrl_facts: [
    { name: "dei:DocumentFiscalYearFocus", value: "2025", contextRef: "Document", period: "2025-12-31" },
    { name: "ifrs-full:ProfitLoss", value: 23131, unitRef: "USD", contextRef: "FY2025", period: "2025-01-01/2025-12-31", statement: "Income statement", hasDimensions: false },
    { name: "ifrs-full:ProfitLoss", value: 24999, unitRef: "USD", contextRef: "FY2024", period: "2024-01-01/2024-12-31", statement: "Income statement", hasDimensions: false },
  ],
  rawPayload: {
    form_type: "20-F",
    company_name: "Segment Scoped Annual Ltd.",
    periodic_report_core_source_blocks: segmentHeadingEvidence?.sourceBlocks,
  },
});
const segmentScopedPromptPayload = JSON.parse(buildSecPeriodicReportsAnalysisPromptDraft({
  parser_output: segmentScopedParserOutput,
}).user) as Record<string, unknown>;
const segmentScopedBlocks = Array.isArray(segmentScopedPromptPayload.cleaned_source_blocks)
  ? segmentScopedPromptPayload.cleaned_source_blocks as Array<Record<string, unknown>>
  : [];
assert.ok(
  segmentScopedBlocks.some((block) => block.source_scope === "segment_or_subset"),
  "analysis input preserves segment-or-subset scope metadata",
);
const segmentScopeWarnings = collectSecPeriodicReportsScoringWarnings(
  {
    event_type: "earnings",
    score: 75,
    signal: "volatile",
    quick_take: "Revenue reached $14.5 billion while consolidated profit declined.",
    summary: "Revenue reached $14.5 billion in FY2025.",
    score_reason: "Profitability weakened despite $14.5 billion of revenue.",
    scoring_assessment: {
      market_cap_tier: "mega",
      primary_change_severity: "major",
      operating_direction: "mixed",
      cash_flow_direction: "negative",
      guidance_direction: "neutral",
      earnings_quality: "mixed",
      material_offsets: [],
      alert_driver: "Operating cash flow declined materially.",
    },
    report_ui: {
      performance_comparisons: [
        {
          label: "Revenue",
          current_label: "FY2025",
          current_value: "$14.5B",
          current_numeric: 14_500_000_000,
          comparison_label: "FY2024",
          comparison_value: "$13.8B",
          comparison_numeric: 13_800_000_000,
          comparison_basis: "yoy",
          change_note: "Up 5% YoY",
          change_tone: "improvement",
        },
      ],
      key_business_updates: [
        { title: "Revenue", value: "$14.5bn", summary: "Revenue increased 5%." },
      ],
    },
  },
  { filing_package: { hard_parsers: { "periodic-reports": segmentScopedParserOutput } } },
);
const segmentScopeWarning = segmentScopeWarnings.find((warning) => warning.code === "annual_consolidated_metric_scope_mismatch");
assert.ok(segmentScopeWarning, "validator catches segment metrics presented as consolidated annual totals");
assert.ok(segmentScopeWarning.allowed_patch_paths.includes("/summary"), "validator can repair an unscoped segment metric in summary");
assert.ok(segmentScopeWarning.allowed_patch_paths.includes("/report_ui/key_business_updates/0/value"), "validator can repair an unscoped segment metric in business updates");

const annualCoreParserOutput = parseSecPeriodicReport({
  rawItemId: "periodic-annual-core-performance",
  sourceUniqueId: "0000000000-26-000005",
  title: "Annual Core Performance Ltd. Form 20-F",
  bodyText: "FORM 20-F For the fiscal year ended December 31, 2025. Revenue and net income are presented in the audited financial statements.",
  xbrl_facts: [
    { name: "dei:DocumentFiscalPeriodFocus", value: "FY", contextRef: "Document", period: "2025-12-31" },
    { name: "dei:DocumentFiscalYearFocus", value: "2025", contextRef: "Document", period: "2025-12-31" },
    { name: "dei:DocumentPeriodEndDate", value: "2025-12-31", contextRef: "Document", period: "2025-12-31" },
    { name: "ifrs-full:Revenue", value: 2200, unitRef: "USD", contextRef: "FY2025", period: "2025-01-01/2025-12-31", statement: "Income statement" },
    { name: "ifrs-full:Revenue", value: 1800, unitRef: "USD", contextRef: "FY2024", period: "2024-01-01/2024-12-31", statement: "Income statement" },
    { name: "ifrs-full:Revenue", value: 1200, unitRef: "USD", contextRef: "FY2023", period: "2023-01-01/2023-12-31", statement: "Income statement" },
    { name: "ifrs-full:ProfitLoss", value: 160, unitRef: "USD", contextRef: "FY2025", period: "2025-01-01/2025-12-31", statement: "Income statement" },
    { name: "ifrs-full:ProfitLoss", value: 45, unitRef: "USD", contextRef: "FY2024", period: "2024-01-01/2024-12-31", statement: "Income statement" },
  ],
  rawPayload: { form_type: "20-F", company_name: "Annual Core Performance Ltd." },
});
const annualCorePromptPayload = JSON.parse(buildSecPeriodicReportsAnalysisPromptDraft({
  parser_output: annualCoreParserOutput,
}).user) as Record<string, unknown>;
const annualCoreBlocks = Array.isArray(annualCorePromptPayload.cleaned_source_blocks)
  ? annualCorePromptPayload.cleaned_source_blocks as Array<Record<string, unknown>>
  : [];
const annualCoreBlock = annualCoreBlocks.find((block) => block.block_type === "annual_core_performance_facts");
assert.ok(annualCoreBlock, "annual reports include a dedicated current/prior-year core performance block");
assert.match(String(annualCoreBlock?.text), /2025-01-01\/2025-12-31/, "annual core block includes current fiscal year");
assert.match(String(annualCoreBlock?.text), /2024-01-01\/2024-12-31/, "annual core block includes immediately preceding fiscal year");
assert.doesNotMatch(String(annualCoreBlock?.text), /2023-01-01\/2023-12-31/, "annual core block excludes older annual periods when adjacent years exist");

const dimensionalAnnualParserOutput = parseSecPeriodicReport({
  rawItemId: "periodic-dimensional-annual-core",
  sourceUniqueId: "0000000000-26-000007",
  title: "Dimensional Annual Ltd. Form 20-F",
  bodyText: "FORM 20-F For the fiscal year ended December 31, 2025.",
  xbrl_facts: [
    { name: "dei:DocumentFiscalYearFocus", value: "2025", contextRef: "Document", period: "2025-12-31" },
    { name: "ifrs-full:Revenue", value: 5336, unitRef: "USD", contextRef: "SegmentFY2025", period: "2025-01-01/2025-12-31", statement: "Income statement", hasDimensions: true },
    { name: "ifrs-full:ProfitLoss", value: 23131, unitRef: "USD", contextRef: "FY2025", period: "2025-01-01/2025-12-31", statement: "Income statement", hasDimensions: false },
    { name: "ifrs-full:ProfitLoss", value: 24999, unitRef: "USD", contextRef: "FY2024", period: "2024-01-01/2024-12-31", statement: "Income statement", hasDimensions: false },
  ],
  rawPayload: { form_type: "20-F", company_name: "Dimensional Annual Ltd." },
});
const dimensionalAnnualPromptPayload = JSON.parse(buildSecPeriodicReportsAnalysisPromptDraft({
  parser_output: dimensionalAnnualParserOutput,
}).user) as Record<string, unknown>;
const dimensionalAnnualBlocks = Array.isArray(dimensionalAnnualPromptPayload.cleaned_source_blocks)
  ? dimensionalAnnualPromptPayload.cleaned_source_blocks as Array<Record<string, unknown>>
  : [];
const dimensionalCoreBlock = dimensionalAnnualBlocks.find((block) => block.block_type === "annual_core_performance_facts");
assert.doesNotMatch(String(dimensionalCoreBlock?.text || ""), /5336/, "dimensional revenue is excluded from consolidated annual core performance");
const dimensionalXbrlBlock = dimensionalAnnualBlocks.find((block) => block.block_type === "xbrl_dimensional_facts");
assert.match(String(dimensionalXbrlBlock?.text || ""), /\"has_dimensions\":\s*true/, "dimensional XBRL evidence is explicitly marked for the analysis LLM");

const nonAdjacentAnnualWarnings = collectSecPeriodicReportsScoringWarnings(
  {
    event_type: "earnings",
    score: 75,
    signal: "bullish",
    scoring_assessment: {
      market_cap_tier: "large",
      primary_change_severity: "major",
      operating_direction: "positive",
      cash_flow_direction: "positive",
      guidance_direction: "absent",
      earnings_quality: "high",
      material_offsets: [],
      alert_driver: "Material annual growth",
    },
    report_ui: {
      performance_comparisons: [
        {
          label: "Revenue",
          current_label: "FY2025",
          current_value: "$2.2B",
          current_numeric: 2200,
          comparison_label: "FY2023",
          comparison_value: "$1.2B",
          comparison_numeric: 1200,
          comparison_basis: "yoy",
          change_note: "Up 83% YoY",
          change_tone: "improvement",
        },
        {
          label: "Net Income",
          current_label: "FY2025",
          current_value: "$160M",
          current_numeric: 160,
          comparison_label: "FY2024",
          comparison_value: "$45M",
          comparison_numeric: 45,
          comparison_basis: "yoy",
          change_note: "Up 256% YoY",
          change_tone: "improvement",
        },
      ],
    },
  },
  { filing_package: { hard_parsers: { "periodic-reports": annualCoreParserOutput } } },
);
const nonAdjacentAnnualWarning = nonAdjacentAnnualWarnings.find((warning) => warning.code === "annual_prior_year_comparison_mismatch");
assert.ok(nonAdjacentAnnualWarning, "validator catches non-adjacent annual comparisons");
assert.ok(nonAdjacentAnnualWarning.allowed_patch_paths.includes("/report_ui/performance_comparisons/0/comparison_value"), "validator can repair the incorrect prior-year value");

const displacedAnnualWarnings = collectSecPeriodicReportsScoringWarnings(
  {
    event_type: "dividends",
    score: 55,
    signal: "neutral",
    scoring_assessment: {
      market_cap_tier: "large",
      primary_change_severity: "routine",
      operating_direction: "neutral",
      cash_flow_direction: "neutral",
      guidance_direction: "absent",
      earnings_quality: "unknown",
      material_offsets: [],
      alert_driver: null,
    },
    report_ui: {
      snapshot_intro: "Annual dividend update",
      snapshot_metrics: [
        { label: "Dividend", value: "$1.05", note: null },
        { label: "Reporting Period", value: "FY2025", note: null },
      ],
      performance_comparisons: [
        {
          label: "Dividend per ADS",
          current_label: "FY2025",
          current_value: "$1.05",
          current_numeric: 1.05,
          comparison_label: "FY2024",
          comparison_value: "$2.00",
          comparison_numeric: 2,
          comparison_basis: "yoy",
          change_note: "Down 48% YoY",
          change_tone: "deterioration",
        },
      ],
    },
  },
  { filing_package: { hard_parsers: { "periodic-reports": annualCoreParserOutput } } },
);
const displacedAnnualWarning = displacedAnnualWarnings.find((warning) => warning.code === "annual_core_performance_missing");
assert.ok(displacedAnnualWarning, "validator catches annual results displaced by dividend analysis");
assert.ok(displacedAnnualWarning.allowed_patch_paths.includes("/event_type"), "validator can repair the representative annual event");
assert.ok(displacedAnnualWarning.allowed_patch_paths.includes("/report_ui/performance_comparisons/0/label"), "validator can repurpose an existing comparison row for annual core performance");

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

const fiscalPeriodParserOutput = parseSecPeriodicReport({
  rawItemId: "periodic-fiscal-period-validator",
  sourceUniqueId: "0000000000-26-000003",
  title: "Fiscal Period Validator Corp. Form 10-Q",
  bodyText: "FORM 10-Q For the quarterly period ended March 31, 2026. PART I ITEM 1. Financial Statements.",
  xbrl_facts: [
    { name: "dei:DocumentFiscalPeriodFocus", value: "Q3", contextRef: "Document", period: "2026-03-31" },
    { name: "dei:DocumentFiscalYearFocus", value: "2026", contextRef: "Document", period: "2026-03-31" },
    { name: "dei:DocumentPeriodEndDate", value: "2026-03-31", contextRef: "Document", period: "2026-03-31" },
  ],
  rawPayload: { form_type: "10-Q", company_name: "Fiscal Period Validator Corp." },
});
const fiscalPeriodWarnings = collectSecPeriodicReportsScoringWarnings(
  {
    event_title: "Fiscal Period Validator reports first quarter fiscal year 2026 results",
    quick_take: "Q1 FY2026 revenue increased.",
    summary: "The company reported first quarter fiscal year 2026 performance.",
    score_reason: "Operating changes were meaningful.",
    score: 60,
    signal: "bullish",
    scoring_assessment: {
      market_cap_tier: "mid",
      primary_change_severity: "meaningful",
      operating_direction: "positive",
      cash_flow_direction: "neutral",
      guidance_direction: "absent",
      earnings_quality: "high",
      material_offsets: [],
      alert_driver: null,
    },
    report_ui: {
      snapshot_metrics: [{ label: "Fiscal Quarter", value: "Q1 FY2026", note: null }],
      performance_comparisons: [{ current_label: "Q1 2026", comparison_label: "Q1 2025" }],
    },
  },
  { filing_package: { hard_parsers: { "periodic-reports": fiscalPeriodParserOutput } } },
);
const fiscalPeriodWarning = fiscalPeriodWarnings.find((warning) => warning.code === "fiscal_period_label_mismatch");
assert.ok(fiscalPeriodWarning, "validator catches analysis labels that conflict with XBRL fiscal metadata");
assert.ok(fiscalPeriodWarning.allowed_patch_paths.includes("/event_title"), "validator can repair event-title fiscal period");
assert.ok(fiscalPeriodWarning.allowed_patch_paths.includes("/report_ui/snapshot_metrics/0/value"), "validator can repair snapshot fiscal period");
assert.ok(fiscalPeriodWarning.allowed_patch_paths.includes("/report_ui/performance_comparisons/0/current_label"), "validator can repair comparison fiscal period");

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
