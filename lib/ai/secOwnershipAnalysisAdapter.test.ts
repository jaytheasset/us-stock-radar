import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  adaptOwnershipPromptResultForAnalysis,
  applySecOwnershipValidationRepairPatches,
  buildSecOwnershipValidationRepairPlan,
  collectOwnershipRuntimeDisplayPayloadWarnings,
} from "@/lib/ai/secOwnershipAnalysisAdapter";

describe("Ownership validation repair", () => {
  it("uses only the original SEC excerpt and limits repair to existing scalar fields", () => {
    const input = buildOwnershipRepairInput();
    const analysisResult = buildOwnershipRepairAnalysis();
    const plan = buildSecOwnershipValidationRepairPlan({ analysisResult, input });

    assert.ok(plan);
    assert.deepEqual(plan.sourceBlockIds, ["ownership_original_source_excerpt_1"]);
    assert.ok(plan.issues.some((issue) => issue.code === "missing_filing_summary"));
    assert.ok(plan.issues.some((issue) => issue.code === "unresolved_visible_placeholder"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/filing_summary"));
    assert.ok(plan.allowedPatchPaths.includes("/analysis_output/summary"));
    assert.ok(!plan.allowedPatchPaths.includes("/analysis_output/score"));
    assert.ok(plan.prompt.system.includes("only repair attempt"));
    assert.ok(plan.prompt.system.includes("instead of using parser facts"));
  });

  it("ignores unauthorized score and structural edits", () => {
    const analysisResult = buildOwnershipRepairAnalysis();
    const result = applySecOwnershipValidationRepairPatches({
      analysisResult,
      allowedPatchPaths: ["/display_payload/data/filing_summary"],
      repairResult: {
        patches: [
          {
            path: "/display_payload/data/filing_summary",
            replacement: "The CEO reported an open-market purchase of 10,000 shares at $12.50 per share.",
            reason: "The original Form 4 excerpt states the purchase terms.",
            source_block_ids: ["ownership_original_source_excerpt_1"],
          },
          {
            path: "/analysis_output/score",
            replacement: 90,
            reason: "Not authorized.",
            source_block_ids: [],
          },
          {
            path: "/display_payload/data/form4/new_row",
            replacement: "not allowed",
            reason: "Not authorized.",
            source_block_ids: [],
          },
        ],
        unresolved: [],
      },
    });

    const data = (result.value.display_payload as Record<string, unknown>).data as Record<string, unknown>;
    assert.equal(data.filing_summary, "The CEO reported an open-market purchase of 10,000 shares at $12.50 per share.");
    assert.equal((result.value.analysis_output as Record<string, unknown>).score, 55);
    assert.deepEqual(result.appliedPaths, ["/display_payload/data/filing_summary"]);
    assert.ok(result.ignoredPaths.includes("/analysis_output/score"));
    assert.ok(result.ignoredPaths.includes("/display_payload/data/form4/new_row"));
  });

  it("keeps missing ownership UI data as a warning instead of failing persistence", () => {
    const warnings = collectOwnershipRuntimeDisplayPayloadWarnings({
      display_type: "generic",
      data: { filing_summary: "" },
      evidence: [],
      notes: [],
    });
    assert.ok(warnings.some((warning) => /filing_summary|ownership details/i.test(warning)));

    const result = adaptOwnershipPromptResultForAnalysis(buildCompleteOwnershipAnalysis(), buildOwnershipRepairInput());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const displayPayload = result.analysis.display_payload as Record<string, unknown>;
    assert.ok((displayPayload.notes as string[]).some((warning) => /filing_summary|ownership details/i.test(warning)));
  });
});

function buildOwnershipRepairInput() {
  return {
    filing_package: {
      form_type: "4",
      hard_parsers: {
        ownership: {
          parserVersion: "ownership-v1",
          parserGroup: "ownership",
          formType: "Form 4",
          accessionNumber: "0001000000-26-000400",
          isSupported: true,
          summary: "CEO purchase",
          facts: {},
          signals: [],
          calendarItems: [],
          warnings: [],
          raw: {
            source_excerpt: "The reporting person, Acme CEO Jane Smith, acquired 10,000 shares of common stock at $12.50 per share in an open-market purchase.",
            selected_evidence: [
              { label: "form4_transaction", value: "code P; 10,000 shares; $12.50", source: "transaction table" },
            ],
          },
        },
      },
    },
  } as unknown as SecFilingAnalysisInput;
}

function buildOwnershipRepairAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      event_title: "CEO buys 10,000 shares",
      summary: "The CEO bought $ shares in the open market.",
      score: 55,
      signal: "bullish",
    },
    display_payload: {
      display_type: "generic",
      data: { filing_summary: "" },
      evidence: [],
      notes: [],
    },
  };
}

function buildCompleteOwnershipAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "insider_ownership",
      event_title: "CEO buys 10,000 shares",
      primary_ticker: { ticker: "ACME", exchange: "NYSE" },
      tickers: [],
      sector: null,
      industry_group: null,
      theme_group: null,
      sub_theme: null,
      score: 55,
      score_reason: "The CEO made a source-backed open-market purchase.",
      signal: "bullish",
      quick_take: "The CEO purchased 10,000 shares in the open market.",
      summary: "The CEO acquired 10,000 shares at $12.50 per share.",
      why_it_matters: "A direct insider purchase can signal management confidence, though the position size remains limited.",
      bullish_points: [],
      bearish_points: [],
      key_evidence: [],
      what_to_watch_next: [],
      related_tickers: [],
      calendar_items: [],
      confidence: "medium",
      needs_human_review: false,
    },
    display_payload: {
      display_type: "generic",
      data: { filing_summary: "" },
      evidence: [],
      notes: [],
    },
  };
}

