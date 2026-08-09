import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  adaptSec424bAnalysisPromptResultForAnalysis,
  applySec424bValidationRepairPatches,
  buildSec424bAnalysisPromptForInput,
  buildSec424bValidationRepairPlan,
  collect424bDisplayPayloadWarnings,
  normalize424bOfferingDisplayModel,
  synchronize424bAnalysisOverhangPercentages,
} from "@/lib/ai/sec424bAnalysisAdapter";
import { get424bAnalysisSourceBlockIds } from "@/lib/sources/sec/forms/424b/analysisPrompt";

describe("424B5 material events output contract", () => {
  it("requires a source-backed primary event and preserves it through the ingest adapter", () => {
    const input = build424b5MaterialEventsInput("424B5");
    const parserOutput = ((input.filing_package as Record<string, unknown>).hard_parsers as Record<string, unknown>)["424b"] as Parameters<typeof get424bAnalysisSourceBlockIds>[0];
    const sourceBlockIds = get424bAnalysisSourceBlockIds(parserOutput);
    const result = build424b5MaterialEventsResult(sourceBlockIds);
    const prompt = buildSec424bAnalysisPromptForInput(input);
    const schema = prompt.responseFormat.json_schema.schema as Record<string, any>;
    const analysisSchema = schema.properties.analysis_output as Record<string, any>;
    const adapted = adaptSec424bAnalysisPromptResultForAnalysis(result, input);

    assert.equal(prompt.version, "v42-material-events");
    assert.ok(prompt.user.includes("exactly one role=primary"));
    assert.ok(prompt.user.includes(`\"block_id\": \"${sourceBlockIds[0]}\"`));
    assert.ok(analysisSchema.required.includes("material_events"));
    assert.equal(analysisSchema.properties.material_events.items.additionalProperties, false);
    assert.equal(adapted.ok, true);
    if (!adapted.ok) return;
    assert.deepEqual(adapted.analysis.material_events, result.analysis_output.material_events);
  });

  it("retains a primary event for a routine analyzed 424B5 and rejects uncited source IDs", () => {
    const input = build424b5MaterialEventsInput("424B5");
    const parserOutput = ((input.filing_package as Record<string, unknown>).hard_parsers as Record<string, unknown>)["424b"] as Parameters<typeof get424bAnalysisSourceBlockIds>[0];
    const sourceBlockIds = get424bAnalysisSourceBlockIds(parserOutput);
    const routine = build424b5MaterialEventsResult(sourceBlockIds, 20);
    const invalid = build424b5MaterialEventsResult(sourceBlockIds, 20);
    invalid.analysis_output.material_events[0].source_block_ids = ["invented_source_block"];

    assert.equal(adaptSec424bAnalysisPromptResultForAnalysis(routine, input).ok, true);
    const rejected = adaptSec424bAnalysisPromptResultForAnalysis(invalid, input);
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.match(rejected.error, /analysis source bundle/);
  });

  it("does not impose the new output contract on 424B3", () => {
    const input = build424b5MaterialEventsInput("424B3");
    const prompt = buildSec424bAnalysisPromptForInput(input);
    const schema = prompt.responseFormat.json_schema.schema as Record<string, any>;
    const analysisSchema = schema.properties.analysis_output as Record<string, any>;
    const result = build424b5MaterialEventsResult([]);
    delete (result.analysis_output as Record<string, unknown>).material_events;

    assert.equal(prompt.version, "v41-news-style-taxonomy-schema");
    assert.ok(!prompt.user.includes("exactly one role=primary"));
    assert.ok(!analysisSchema.required.includes("material_events"));
    assert.equal(adaptSec424bAnalysisPromptResultForAnalysis(result, input).ok, true);
  });
});

describe("424B validation repair", () => {
  it("repairs an orphan pre-funded pool and lets normalization recalculate the full counted supply", () => {
    const analysisResult = buildOrphanPrefundedAnalysis();
    const plan = buildSec424bValidationRepairPlan({
      analysisResult,
      input: build424bRepairInput(),
    });

    assert.ok(plan);
    assert.ok(plan.issues.some((issue) => issue.code === "orphan_prefunded_alternative_pool"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/share_overhang/rows/0/row_role"));
    assert.ok(plan.allowedPatchPaths.includes("/analysis_output/summary"));
    assert.ok(!plan.issues.some((issue) => issue.code === "duplicate_prefunded_replacement_pool"));

    const repaired = applySec424bValidationRepairPatches({
      analysisResult,
      allowedPatchPaths: plan.allowedPatchPaths,
      repairResult: {
        patches: [
          {
            path: "/display_payload/data/share_overhang/rows/0/row_role",
            replacement: "orphan_prefunded_alternative_pool",
            reason: "The source describes one combined ordinary-or-pre-funded issuance pool.",
            source_block_ids: plan.sourceBlockIds,
          },
          {
            path: "/analysis_output/summary",
            replacement: "The counted ordinary-or-pre-funded pool and zero-exercise warrants create very large potential dilution.",
            reason: "Remove the stale percentage while preserving the source-backed dilution conclusion.",
            source_block_ids: plan.sourceBlockIds,
          },
        ],
        unresolved: [],
      },
    });

    const displayPayload = repaired.value.display_payload as Record<string, unknown>;
    const data = displayPayload.data as Record<string, unknown>;
    const shareOverhang = data.share_overhang as Record<string, unknown>;
    const rows = shareOverhang.rows as Array<Record<string, unknown>>;
    assert.equal(rows[0].row_role, "counted");

    const normalized = normalize424bOfferingDisplayModel(data);
    assert.ok(normalized);
    const normalizedOverhang = normalized.share_overhang as Record<string, unknown>;
    const totalNote = normalizedOverhang.total_note as Record<string, unknown>;
    assert.equal(totalNote.numerator, "369,408,369 shares");
    assert.equal(totalNote.denominator, "10,935,000 shares");
    assert.equal(totalNote.ratio, "3,378.2%");
    assert.equal(normalizedOverhang.ratio_value, "3,378.2%");
  });

  it("keeps one counted ordinary pool when a pre-funded row is its one-for-one replacement", () => {
    const analysisResult = buildDuplicatePrefundedAnalysis();
    const plan = buildSec424bValidationRepairPlan({
      analysisResult,
      input: build424bRepairInput(),
    });

    assert.ok(plan);
    assert.ok(plan.issues.some((issue) => issue.code === "duplicate_prefunded_replacement_pool"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/share_overhang/rows/1/row_role"));
    assert.ok(plan.allowedPatchPaths.includes("/analysis_output/summary"));

    const displayPayload = analysisResult.display_payload as Record<string, unknown>;
    const normalized = normalize424bOfferingDisplayModel(displayPayload.data as Record<string, unknown>);
    assert.ok(normalized);
    const normalizedOverhang = normalized.share_overhang as Record<string, unknown>;
    const rows = normalizedOverhang.rows as Array<Record<string, unknown>>;
    const totalNote = normalizedOverhang.total_note as Record<string, unknown>;
    assert.equal(rows[0].row_role, "counted");
    assert.equal(rows[1].row_role, "alternative");
    assert.equal(totalNote.numerator, "369,408,369 shares");
    assert.equal(totalNote.ratio, "3,378.2%");
  });

  it("does not mistake one combined ordinary-or-pre-funded row for two counted pools", () => {
    const analysisResult = buildOrphanPrefundedAnalysis();
    const displayPayload = analysisResult.display_payload as Record<string, unknown>;
    const data = displayPayload.data as Record<string, unknown>;
    const shareOverhang = data.share_overhang as Record<string, unknown>;
    const rows = shareOverhang.rows as Array<Record<string, unknown>>;
    rows[0].row_role = "counted";

    const normalizedData = normalize424bOfferingDisplayModel(data);
    assert.ok(normalizedData);
    const warnings = collect424bDisplayPayloadWarnings({
      display_type: "offering_terms",
      data: normalizedData,
      evidence: [],
      notes: [],
    });
    assert.ok(!warnings.some((warning) => /pre-funded replacement supply/i.test(warning)));
  });

  it("aligns stale dilution percentages without changing unrelated ownership limits", () => {
    const synchronized = synchronize424bAnalysisOverhangPercentages(
      {
        event_title: "Offering creates 3,200.0% potential dilution",
        quick_take: "Potential dilution is 3,200.0%, while a 4.99% ownership limit remains in place.",
        summary: "The supply represents 3,200.0% relative to current shares.",
        score_reason: "A 3,200.0% overhang drives the score.",
      },
      "3,378.2%",
    );

    assert.equal(synchronized.event_title, "Offering creates 3,378.2% potential dilution");
    assert.equal(
      synchronized.quick_take,
      "Potential dilution is 3,378.2%, while a 4.99% ownership limit remains in place.",
    );
    assert.equal(synchronized.summary, "The supply represents 3,378.2% relative to current shares.");
    assert.equal(synchronized.score_reason, "A 3,378.2% overhang drives the score.");
  });
});

function build424bRepairInput() {
  return {
    filing_package: {
      form_type: "424B5",
      hard_parsers: {
        "424b": {
          formType: "424B5",
          accessionNumber: "0000000000-26-000001",
          raw: {
            cleaned_source_blocks: [
              {
                source: "prospectus supplement",
                block_type: "offering_terms",
                label: "Securities offered",
                text: "The offering includes 23,088,023 ordinary shares or pre-funded warrants in lieu of ordinary shares, plus Series B warrants for 346,320,346 shares with a zero exercise option.",
              },
            ],
          },
        },
      },
    },
  } as unknown as SecFilingAnalysisInput;
}

function buildOrphanPrefundedAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      event_title: "Offering creates more than 3,200% potential dilution",
      quick_take: "The deal adds 369.4 million shares and more than 3,200% dilution.",
      summary: "The offering creates approximately 3,200% dilution versus current shares.",
      score_reason: "Potential dilution exceeds 3,200% of current shares.",
    },
    display_payload: {
      display_type: "offering_terms",
      data: {
        investor_takeaway: "The offering creates severe dilution risk.",
        snapshot_metrics: [{ label: "Total Potential Dilution", value: "3,167.1%" }],
        share_overhang: {
          basis: {
            label: "Current shares",
            value: "10,935,000 shares",
            numeric_value: 10_935_000,
          },
          rows: [
            {
              label: "Ordinary / Pre-Funded Units",
              value: "23,088,023 shares",
              numeric_value: 23_088_023,
              row_role: "alternative",
            },
            {
              label: "Series A warrants",
              value: "121,212,121 shares",
              numeric_value: 121_212_121,
              row_role: "conditional",
            },
            {
              label: "Series B warrants",
              value: "346,320,346 shares",
              numeric_value: 346_320_346,
              row_role: "counted",
            },
          ],
          total_note: {
            numerator: "346,320,346 shares",
            denominator: "10,935,000 shares",
            ratio: "3,167.1%",
          },
        },
      },
      evidence: [],
      notes: [],
    },
  };
}

function buildDuplicatePrefundedAnalysis(): Record<string, unknown> {
  const analysis = buildOrphanPrefundedAnalysis();
  const displayPayload = analysis.display_payload as Record<string, unknown>;
  const data = displayPayload.data as Record<string, unknown>;
  const shareOverhang = data.share_overhang as Record<string, unknown>;
  shareOverhang.rows = [
    {
      label: "Ordinary Units (Class A Shares)",
      value: "23,088,023 shares",
      numeric_value: 23_088_023,
      row_role: "counted",
    },
    {
      label: "Pre-Funded Warrants (Class A Shares)",
      value: "23,088,023 shares",
      numeric_value: 23_088_023,
      row_role: "counted",
    },
    {
      label: "Series A warrants",
      value: "121,212,121 shares",
      numeric_value: 121_212_121,
      row_role: "conditional",
    },
    {
      label: "Series B warrants",
      value: "346,320,346 shares",
      numeric_value: 346_320_346,
      row_role: "counted",
    },
  ];
  shareOverhang.total_note = {
    numerator: "392,496,392 shares",
    denominator: "10,935,000 shares",
    ratio: "3,589.4%",
  };
  return analysis;
}

function build424b5MaterialEventsInput(formType: string) {
  const parserOutput = {
    parserVersion: "424b-parser-v1",
    parserGroup: "424b",
    formType,
    accessionNumber: "0000000000-26-000425",
    isSupported: true,
    summary: null,
    facts: {},
    signals: [],
    calendarItems: [],
    warnings: [],
    raw: {
      cleaned_source_blocks: [
        {
          block_type: "offering_terms",
          label: "Prospectus supplement",
          source: "primary document",
          text: "The issuer may sell up to $75 million of common stock from time to time under the prospectus supplement.",
        },
      ],
    },
  };
  return {
    filing_package: {
      form_type: formType,
      company_name: "Example 424B Corp.",
      primary_ticker: { ticker: "B424", exchange: "NASDAQ" },
      hard_parsers: { "424b": parserOutput },
    },
  } as unknown as SecFilingAnalysisInput;
}

function build424b5MaterialEventsResult(sourceBlockIds: string[], score = 68) {
  return {
    parser_output: {
      parserVersion: "424b-parser-v1",
      parserGroup: "424b",
      formType: "424B5",
      accessionNumber: "0000000000-26-000425",
      isSupported: true,
      facts: {},
      signals: [],
      calendarItems: [],
      warnings: [],
      raw: {},
    },
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "dilution_risk",
      material_events: [
        {
          role: "primary",
          event_type: "dilution_risk",
          event_summary: "The prospectus supplement authorizes up to $75 million of common-stock sales over time.",
          key_terms: ["up to $75 million", "common stock", "sales over time"],
          source_block_ids: [sourceBlockIds[0]],
        },
      ],
      event_title: "Issuer opens a $75 million stock-sale program",
      primary_ticker: null,
      tickers: [],
      sector: null,
      industry_group: null,
      theme_group: null,
      sub_theme: null,
      score,
      score_reason: "The sale capacity is material, while timing and final share count remain variable.",
      score_explanation: { summary: "Material sale capacity is offset by uncertain timing and final issuance." },
      signal: "bearish",
      quick_take: "The prospectus opens up to $75 million of common-stock sale capacity.",
      summary: "The issuer may sell common stock over time under a prospectus supplement with a $75 million maximum.",
      why_it_matters: "Future sales can increase share supply and pressure existing holders.",
      bullish_points: [],
      bearish_points: [],
      key_evidence: [],
      what_to_watch_next: [],
      related_tickers: [],
      calendar_items: [],
      confidence: "high",
      needs_human_review: false,
    },
    display_payload: {
      display_type: "generic",
      display_version: "424b-display-payload-v1",
      data: {},
      evidence: [],
      notes: [],
    },
  };
}
