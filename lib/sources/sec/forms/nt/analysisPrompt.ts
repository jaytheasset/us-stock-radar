import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { secFilingAnalysisResponseSchema } from "@/lib/prompts/secFilingAnalysis";
import { buildSecSourceBlockPromptInput } from "../common/sourceBlockPromptInput";
import { NT_APPROVED_EVENT_TYPES, type NtParserOutput } from "./types";

export const SEC_NT_ANALYSIS_PROMPT_KEY = "sec_nt_analysis";
export const SEC_NT_ANALYSIS_PROMPT_VERSION = "v6-material-results-floor";

const ntAnalysisResponseSchema = {
  ...secFilingAnalysisResponseSchema,
  required: [
    ...secFilingAnalysisResponseSchema.required,
    "score_explanation",
    "nt_scoring_assessment",
  ],
  properties: {
    ...secFilingAnalysisResponseSchema.properties,
    event_title: { type: "string", maxLength: 100 },
    score_reason: { type: "string", maxLength: 220 },
    score_explanation: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["summary"],
      properties: {
        summary: { type: "string", maxLength: 220 },
      },
    },
    nt_scoring_assessment: {
      type: "object",
      additionalProperties: false,
      required: [
        "delay_status",
        "underlying_issue",
        "results_change",
        "financial_reliability_risk",
        "severity",
        "material_offset",
        "alert_driver",
      ],
      properties: {
        delay_status: { type: "string", maxLength: 40 },
        underlying_issue: { type: "string", maxLength: 64 },
        results_change: { type: "string", maxLength: 90 },
        financial_reliability_risk: { type: "string", maxLength: 80 },
        severity: { type: "string", maxLength: 24 },
        material_offset: { type: ["string", "null"], maxLength: 160 },
        alert_driver: { type: ["string", "null"], maxLength: 160 },
      },
    },
    quick_take: { type: "string", maxLength: 180 },
    summary: { type: "string", maxLength: 760 },
    why_it_matters: { type: "string", maxLength: 300 },
    bullish_points: {
      type: "array",
      maxItems: 3,
      items: { type: "string", maxLength: 160 },
    },
    bearish_points: {
      type: "array",
      maxItems: 3,
      items: { type: "string", maxLength: 160 },
    },
    key_evidence: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: { type: "string", maxLength: 140 },
    },
    what_to_watch_next: {
      type: "array",
      maxItems: 3,
      items: { type: "string", maxLength: 160 },
    },
    related_tickers: {
      ...secFilingAnalysisResponseSchema.properties.related_tickers,
      maxItems: 5,
    },
    calendar_items: {
      ...secFilingAnalysisResponseSchema.properties.calendar_items,
      maxItems: 3,
    },
  },
} as const;

export const secNtAnalysisSystemPrompt = [
  "Analyze one SEC NT 10-K, NT 10-Q, or NT 20-F late-filing notice for stock investors.",
  "Return only JSON matching the supplied schema.",
  "Use current_filing and current-filing original cleaned_source_blocks as factual evidence.",
  "A site_market_context block may be used only to size a disclosed event; it is not evidence about why the filing is late or what the delayed report will contain.",
  "A parent_filing_context block may be used only to understand a current amendment; do not present parent facts as new current-filing facts.",
  "Parser facts, extraction labels, warnings, route hints, and prior classifications are not evidence and are intentionally excluded.",
  "Do not call external APIs, browse other filings, or infer facts absent from the supplied original source blocks.",
  `Choose event_type from this approved list only: ${NT_APPROVED_EVENT_TYPES.join(", ")}.`,
  "Classify the underlying reason and investor consequence, not merely the NT form label.",
  "Use financial_risk for audit, accounting, restatement, internal-control, going-concern, or unresolved financial-statement problems.",
  "Use sales_performance for a material revenue, sales, customer-order, or margin change; use earnings for broader profit, EPS, or loss changes.",
  "Use listing_risk, legal_risk, leadership_governance, or strategic_transaction only when the original blocks directly support that underlying issue.",
  "Use other for a routine extension notice without a separate material investor event.",
  "Determine the underlying investor event before considering whether the delayed report is expected within the extension window.",
  "A substantive disclosed results change is a separate investor event. Do not classify it as other or routine merely because the report is expected within the extension window.",
  "When the filing discloses a broader profit, loss, or EPS change, use earnings even if revenue or sales also changed. Use sales_performance only when the material change is primarily revenue, sales, orders, or margin without a broader earnings change.",
  "Before writing investor-facing prose, complete nt_scoring_assessment in this order: delay status, underlying issue, disclosed results change, financial-reliability risk, severity, material offset, and alert driver.",
  "Use these assessment values exactly where applicable: delay_status within_extension/outside_extension/unclear; financial_reliability_risk none/possible/explicit; severity technical/routine/limited/meaningful/major/critical.",
  "results_change must briefly state positive, negative, mixed, none disclosed, or unclear and include a source-backed magnitude when the filing gives one.",
  "An NT filing is not automatically bearish, material, or alert-worthy. Score the underlying investor event, not the existence of the late-filing form.",
  "NT scoring guide: 10-24 for a technical amendment, electronic-filing correction, or portion-only filing with no material underlying change.",
  "NT scoring guide: 25-39 for a routine completion or review delay, expected filing within the Rule 12b-25 extension, and no significant results change.",
  "NT scoring guide: 40-49 for limited uncertainty, an unclear filing timetable, or a bounded operational delay without a disclosed material performance or financial-reliability problem.",
  "NT scoring guide: 50-59 for a significant results change that is acknowledged but not quantified, a filing not expected within the extension without a severe stated cause, or routine audit/consolidation work with some reporting uncertainty.",
  "NT scoring guide: 60-74 for a source-backed meaningful earnings, sales, margin, liquidity, audit, valuation, consolidation, or internal-control issue without an explicit major financial-reliability trigger.",
  "NT scoring guide: 75-84 requires a major quantified performance deterioration, likely material audit adjustment, material control problem, repeated filing failure, or explicit listing consequence supported by the current source blocks.",
  "NT scoring guide: 85-94 is reserved for explicit non-reliance/restatement risk, material weakness that undermines reported figures, going-concern distress, severe liquidity/default risk, or similarly serious financial-reporting uncertainty.",
  "NT scoring guide: 95-100 is reserved for bankruptcy, liquidation, or another explicitly disclosed existential event. Do not infer existential risk from lateness alone.",
  "A checked Yes answer to a significant-results-change question without a substantive explanation cannot by itself support a score above 59.",
  "An attached accountant statement, audit work, acquisition consolidation, or internal-control testing does not by itself support alert status. Escalate only when the original text states a material unresolved problem or consequence.",
  "Expected filing within the extension and no significant results change are mitigating facts, but they do not erase an explicit restatement, material weakness, going-concern, default, or listing issue.",
  "A substantive results change cannot receive a score below 50. A quantified profit-to-loss reversal, major loss expansion, or similarly material deterioration should be evaluated in the 60-74 band or above; expected filing within the extension is an offset, not a reason to return to the routine band.",
  "Do not assign points from one percentage alone. Use disclosed direction, breadth across the income statement, reliability risk, timing, and material offsets to choose a score within the applicable band.",
  "Missing or unclear information is uncertainty, not proof of a negative event. Do not fill gaps with bearish assumptions.",
  "For a disclosed positive results change, score materiality normally but account for the reporting delay as an offset; use volatile when positive performance and reporting uncertainty are both material.",
  "A large quantified positive earnings change is not a routine filing-delay event. Classify it as earnings, use at least meaningful severity, and treat within-extension filing as an offset rather than the primary classification.",
  "Score measures investor attention and urgency; signal measures direction. Neutral signal must have score below 75. A score of 75 or above requires a concise source-backed nt_scoring_assessment.alert_driver.",
  "If the filing is an amendment, analyze what the amendment changes and do not present the entire original late-filing event as new unless the source blocks show a material change.",
  "Use plain investor language and explain the practical consequence of the delay.",
  "event_title must identify the company-specific issue and remain under 100 characters.",
  "quick_take must be one self-contained sentence under 22 words.",
  "summary must be 2-4 sentences covering the cause, expected timing, disclosed financial change, and investor consequence when available.",
  "Keep nt_scoring_assessment.underlying_issue and results_change as compact snapshot values, not complete explanatory sentences.",
  "underlying_issue must state the actual work or problem causing the delay in at most 64 characters, for example 'Financial statement compilation delay'.",
  "results_change must fit within 90 characters and combine direction with only the most useful source-backed figures, for example 'Revenue +14-26%; net loss $134.7-$141.7M'.",
  "Prefer the expected current result and its magnitude. Include a prior-period comparison only when it is necessary to understand the direction; otherwise leave it to summary.",
  "Do not repeat the issuer, form name, reporting period, or full cause narrative in these two snapshot values; place explanation in summary instead.",
  "score_reason and score_explanation.summary must reflect nt_scoring_assessment, including the strongest driver and one material offset when it changes the conclusion.",
  "score_explanation.summary is the visible score rationale: write one concise analyst-style conclusion of 18-32 words explaining why the impact level is reasonable.",
  "Do not start score rationale with 'The score is', the issuer name, a ticker, a form label, or filing-action verbs such as filed or submitted.",
  "Do not explain scoring mechanics, quote score bands, or reuse the opening sentence of quick_take or summary.",
  "Write 2-3 key_evidence items. Each item must be a concise analyst paraphrase of one core source fact, no more than 140 characters; do not copy long filing sentences or legal boilerplate.",
  "Write at most 3 concrete what_to_watch_next items.",
  "All visible text must be English.",
].join("\n");

export function buildNtAnalysisPromptDraft({
  input,
  parserOutput,
}: {
  input: SecFilingAnalysisInput;
  parserOutput: NtParserOutput;
}) {
  const filingPackage = toRecord(input.filing_package);
  const sourceBundle = buildSecSourceBlockPromptInput({
    filingPackage,
    parserOutput: parserOutput as unknown as Record<string, unknown>,
    fallbackText: stringValue(filingPackage.llm_text),
    parentFilingContext: toNullableRecord(filingPackage.parent_filing_context),
    marketContext: toNullableRecord(filingPackage.market_context),
    maxBlocks: 12,
    maxBlockChars: 4_000,
  });
  const cleanedSourceBlocks = sourceBundle.cleaned_source_blocks.filter((block) =>
    isNtAnalysisSourceBlock(block.block_type),
  );

  return {
    key: SEC_NT_ANALYSIS_PROMPT_KEY,
    version: SEC_NT_ANALYSIS_PROMPT_VERSION,
    system: secNtAnalysisSystemPrompt,
    user: JSON.stringify(
      {
        task: "Write the final investor analysis for this late-filing notice.",
        current_filing: sourceBundle.current_filing,
        cleaned_source_blocks: cleanedSourceBlocks,
      },
      null,
      2,
    ),
    responseFormat: {
      type: "json_schema",
      json_schema: {
        name: "sec_nt_analysis",
        strict: true,
        schema: ntAnalysisResponseSchema,
      },
    },
  };
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toNullableRecord(value: unknown): Record<string, unknown> | null {
  const record = toRecord(value);
  return Object.keys(record).length ? record : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isNtAnalysisSourceBlock(blockType: string) {
  return [
    "nt_filing_header",
    "nt_part_i",
    "nt_part_ii",
    "nt_part_iii",
    "nt_part_iv",
    "nt_accountant_statement",
    "nt_filing_body",
    "parent_filing_context",
    "site_market_context",
  ].includes(blockType);
}
