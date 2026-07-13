import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  adaptSecS8AnalysisPromptResultForAnalysis,
  applySecS8ValidationRepairPatches,
  buildSecS8ValidationRepairPlan,
  collectS8RuntimeDisplayPayloadWarnings,
} from "@/lib/ai/secS8AnalysisAdapter";

describe("S-8 validation repair", () => {
  it("selects original S-8 blocks and limits repair to existing scalar fields", () => {
    const input = buildS8RepairInput();
    const analysisResult = buildS8RepairAnalysis();
    const plan = buildSecS8ValidationRepairPlan({ analysisResult, input });

    assert.ok(plan);
    assert.ok(plan.sourceBlockIds.length > 0 && plan.sourceBlockIds.length <= 3);
    assert.ok(plan.issues.some((issue) => issue.code === "missing_narrative_summary"));
    assert.ok(plan.issues.some((issue) => issue.code === "unresolved_visible_placeholder"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/narrative_summary"));
    assert.ok(plan.allowedPatchPaths.includes("/analysis_output/summary"));
    assert.ok(!plan.allowedPatchPaths.includes("/display_payload/data/s8_ui_mode"));
    assert.ok(!plan.allowedPatchPaths.includes("/analysis_output/score"));
    assert.ok(plan.prompt.system.includes("only repair attempt"));
  });

  it("ignores unauthorized score, mode, and structural edits", () => {
    const analysisResult = buildS8RepairAnalysis();
    const result = applySecS8ValidationRepairPatches({
      analysisResult,
      allowedPatchPaths: ["/display_payload/data/narrative_summary"],
      repairResult: {
        patches: [
          {
            path: "/display_payload/data/narrative_summary",
            replacement: "Acme registered 2 million shares for employee equity awards.",
            reason: "The S-8 source block states the registered plan share count.",
            source_block_ids: ["s8_primary_1"],
          },
          {
            path: "/display_payload/data/s8_ui_mode",
            replacement: "reoffer_resale",
            reason: "Not authorized.",
            source_block_ids: [],
          },
          {
            path: "/analysis_output/score",
            replacement: 90,
            reason: "Not authorized.",
            source_block_ids: [],
          },
        ],
        unresolved: [],
      },
    });

    const data = (result.value.display_payload as Record<string, unknown>).data as Record<string, unknown>;
    assert.equal(data.narrative_summary, "Acme registered 2 million shares for employee equity awards.");
    assert.equal(data.s8_ui_mode, "plan_registration");
    assert.equal((result.value.analysis_output as Record<string, unknown>).score, 55);
    assert.deepEqual(result.appliedPaths, ["/display_payload/data/narrative_summary"]);
    assert.ok(result.ignoredPaths.includes("/display_payload/data/s8_ui_mode"));
    assert.ok(result.ignoredPaths.includes("/analysis_output/score"));
  });

  it("stores unsupported UI mode as a warning instead of failing persistence", () => {
    const input = buildS8RepairInput();
    const analysisResult = buildCompleteS8Analysis("unsupported_mode");
    const warnings = collectS8RuntimeDisplayPayloadWarnings(analysisResult.display_payload as Record<string, unknown>);
    assert.ok(warnings.some((warning) => /s8_ui_mode/i.test(warning)));

    const result = adaptSecS8AnalysisPromptResultForAnalysis(analysisResult, input);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const displayPayload = result.analysis.display_payload as Record<string, unknown>;
    assert.ok((displayPayload.notes as string[]).some((warning) => /s8_ui_mode/i.test(warning)));
  });
});

function buildS8RepairInput() {
  return {
    filing_package: {
      form_type: "S-8",
      hard_parsers: {
        s8: {
          parserVersion: "s8-v1",
          parserGroup: "s8",
          formType: "S-8",
          accessionNumber: "0001000000-26-000300",
          isSupported: true,
          summary: "Employee plan registration",
          facts: {
            issuerName: "Acme Components",
            ticker: "ACME",
            exchange: "NYSE",
            filedAt: "2026-07-13",
          },
          signals: [],
          calendarItems: [],
          warnings: [],
          raw: {
            sourceDocuments: [
              {
                id: "primary",
                documentRole: "primary",
                source: "primary",
                documentType: "S-8",
                description: "Registration statement",
                textKind: "text",
                text: "Acme Components registers 2,000,000 common shares for issuance under its 2026 Equity Incentive Plan.",
              },
            ],
            attachments: [],
            sections: [],
            parentFilingContext: null,
            marketContext: null,
            sourceTextExcerpt: "Acme registers 2,000,000 plan shares.",
          },
        },
      },
    },
  } as unknown as SecFilingAnalysisInput;
}

function buildS8RepairAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      event_title: "Acme registers employee plan shares",
      summary: "The company registered $ shares for its equity plan.",
      score: 55,
      signal: "neutral",
    },
    display_payload: {
      display_type: "generic",
      data: {
        s8_ui_mode: "plan_registration",
        narrative_summary: "",
      },
      evidence: [],
      notes: [],
    },
  };
}

function buildCompleteS8Analysis(mode: string): Record<string, unknown> {
  return {
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "dilution_risk",
      event_title: "Acme registers employee plan shares",
      primary_ticker: { ticker: "ACME", exchange: "NYSE" },
      tickers: [],
      sector: null,
      industry_group: null,
      theme_group: null,
      sub_theme: null,
      score: 55,
      score_reason: "The filing adds future employee equity capacity.",
      signal: "neutral",
      quick_take: "Acme registered employee plan shares that may increase future equity supply.",
      summary: "Acme registered 2 million common shares under its employee equity plan.",
      why_it_matters: "Future awards can expand outstanding shares as employees receive or exercise equity compensation.",
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
      data: {
        s8_ui_mode: mode,
        narrative_summary: "Acme registered 2 million shares for employee equity awards.",
      },
      evidence: [],
      notes: [],
    },
  };
}

