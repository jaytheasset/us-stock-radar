import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { parseSc13Filing } from "@/lib/sources/sec/forms/sc13/parser";
import {
  adaptSecSc13AnalysisPromptResultForAnalysis,
  applySecSc13ValidationRepairPatches,
  buildSecSc13ValidationRepairPlan,
  collectSc13RuntimeDisplayPayloadWarnings,
} from "@/lib/ai/secSc13AnalysisAdapter";

describe("SC13 validation repair", () => {
  it("selects original SC13 source blocks and limits repair to existing scalar fields", () => {
    const input = buildSc13RepairInput();
    const analysisResult = buildSc13RepairAnalysis();
    const plan = buildSecSc13ValidationRepairPlan({ analysisResult, input });

    assert.ok(plan);
    assert.ok(plan.sourceBlockIds.length > 0 && plan.sourceBlockIds.length <= 3);
    assert.ok(plan.issues.some((issue) => issue.code === "missing_issuer_name"));
    assert.ok(plan.issues.some((issue) => issue.code === "missing_ownership_intent"));
    assert.ok(plan.issues.some((issue) => issue.code === "unresolved_visible_placeholder"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/issuerName"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/ownershipIntent"));
    assert.ok(!plan.allowedPatchPaths.includes("/display_payload/data/reportingPersons"));
    assert.ok(!plan.allowedPatchPaths.includes("/analysis_output/score"));
    const promptInput = JSON.parse(plan.prompt.user) as Record<string, unknown>;
    const sourceBlocks = promptInput.selected_original_source_blocks as Array<Record<string, unknown>>;
    assert.ok(sourceBlocks.every((block) => !["parser_warning", "filing_metadata"].includes(String(block.block_type))));
  });

  it("ignores unauthorized score and array edits", () => {
    const analysisResult = buildSc13RepairAnalysis();
    const result = applySecSc13ValidationRepairPatches({
      analysisResult,
      allowedPatchPaths: ["/display_payload/data/issuerName", "/display_payload/data/ownershipIntent"],
      repairResult: {
        patches: [
          {
            path: "/display_payload/data/issuerName",
            replacement: "Acme Corp.",
            reason: "Item 1 identifies the issuer.",
            source_block_ids: ["sc13_original_source_block_1"],
          },
          {
            path: "/display_payload/data/ownershipIntent",
            replacement: "Active engagement regarding strategic alternatives",
            reason: "Item 4 states the reporting person's purpose.",
            source_block_ids: ["sc13_original_source_block_3"],
          },
          {
            path: "/display_payload/data/reportingPersons",
            replacement: "Jane Smith",
            reason: "Arrays cannot be repaired.",
            source_block_ids: [],
          },
          {
            path: "/analysis_output/score",
            replacement: 90,
            reason: "Score changes are not authorized.",
            source_block_ids: [],
          },
        ],
        unresolved: [],
      },
    });

    const data = (result.value.display_payload as Record<string, unknown>).data as Record<string, unknown>;
    assert.equal(data.issuerName, "Acme Corp.");
    assert.equal(data.ownershipIntent, "Active engagement regarding strategic alternatives");
    assert.deepEqual(data.reportingPersons, []);
    assert.equal((result.value.analysis_output as Record<string, unknown>).score, 65);
    assert.ok(result.ignoredPaths.includes("/display_payload/data/reportingPersons"));
    assert.ok(result.ignoredPaths.includes("/analysis_output/score"));
  });

  it("keeps missing SC13 UI values as warnings instead of failing persistence", () => {
    const warnings = collectSc13RuntimeDisplayPayloadWarnings({
      display_type: "generic",
      data: { issuerName: "", reportingPersons: [], ownershipIntent: "" },
      evidence: [],
      notes: [],
    });
    assert.equal(warnings.length, 3);

    const result = adaptSecSc13AnalysisPromptResultForAnalysis(
      buildCompleteSc13Analysis(),
      buildSc13RepairInput(),
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const displayPayload = result.analysis.display_payload as Record<string, unknown>;
    assert.ok((displayPayload.notes as string[]).some((warning) => /issuerName/i.test(warning)));
    assert.ok((displayPayload.notes as string[]).some((warning) => /reportingPersons/i.test(warning)));
    assert.ok((displayPayload.notes as string[]).some((warning) => /ownershipIntent/i.test(warning)));
  });
});

function buildSc13RepairInput() {
  const parserOutput = parseSc13Filing({
    formType: "SC 13D",
    accessionNumber: "0001000000-26-000013",
    issuerName: "Acme Corp.",
    companyName: "Acme Corp.",
    primaryTicker: { ticker: "ACME", exchange: "NYSE" },
    filedAt: "2026-07-10",
    text: [
      "SCHEDULE 13D",
      "Item 1. Security and Issuer",
      "This statement relates to the common stock of Acme Corp.",
      "Item 2. Identity and Background",
      "The reporting person is Jane Smith.",
      "Item 4. Purpose of Transaction",
      "The reporting person acquired the shares to engage with management regarding strategic alternatives.",
      "Item 5. Interest in Securities of the Issuer",
      "Jane Smith beneficially owns 1,000,000 shares, representing 8.5% of the class.",
    ].join("\n\n"),
  });
  return {
    filing_package: {
      form_type: "SC 13D",
      company_name: "Acme Corp.",
      primary_ticker: { ticker: "ACME", exchange: "NYSE" },
      hard_parsers: { sc13: parserOutput },
    },
  } as unknown as SecFilingAnalysisInput;
}

function buildSc13RepairAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      event_title: "Investor reports active ownership stake",
      summary: "The filer reported a purchase price of $ per share.",
      score: 65,
      signal: "volatile",
    },
    display_payload: {
      display_type: "generic",
      data: { issuerName: "", reportingPersons: [], ownershipIntent: "" },
      evidence: [],
      notes: [],
    },
  };
}

function buildCompleteSc13Analysis(): Record<string, unknown> {
  return {
    parser_output: {},
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "insider_ownership",
      event_title: "Investor reports active stake",
      primary_ticker: { ticker: "ACME", exchange: "NYSE" },
      tickers: [],
      sector: null,
      industry_group: null,
      theme_group: null,
      sub_theme: null,
      score: 65,
      score_reason: "The filing discloses a meaningful active ownership position.",
      signal: "volatile",
      quick_take: "An investor disclosed an active ownership position.",
      summary: "The reporting person disclosed an active stake and plans to engage with management.",
      why_it_matters: "Active ownership can precede strategic or governance pressure.",
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
      data: { issuerName: "", reportingPersons: [], ownershipIntent: "" },
      evidence: [],
      notes: [],
    },
  };
}
