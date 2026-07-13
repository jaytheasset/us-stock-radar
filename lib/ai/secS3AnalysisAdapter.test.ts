import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  applySecS3ValidationRepairPatches,
  buildSecS3ValidationRepairPlan,
} from "@/lib/ai/secS3AnalysisAdapter";

describe("S-3/F-3 validation repair", () => {
  it("selects original source blocks and limits repair to local scalar fields", () => {
    const input = buildS3RepairInput();
    const analysisResult = buildS3RepairAnalysis();
    const plan = buildSecS3ValidationRepairPlan({ analysisResult, input });

    assert.ok(plan);
    assert.ok(plan.sourceBlockIds.length > 0 && plan.sourceBlockIds.length <= 3);
    assert.ok(plan.issues.some((issue) => issue.code === "conflicting_overhang_percentage"));
    assert.ok(plan.issues.some((issue) => issue.code === "unresolved_visible_placeholder"));
    assert.ok(plan.allowedPatchPaths.includes("/analysis_output/event_title"));
    assert.ok(plan.allowedPatchPaths.includes("/analysis_output/summary"));
    assert.ok(!plan.allowedPatchPaths.includes("/analysis_output/score"));
    assert.ok(plan.prompt.system.includes("only repair attempt"));
    assert.ok(plan.prompt.user.includes("selected_original_source_blocks"));
  });

  it("ignores unauthorized score edits and new fields", () => {
    const analysisResult = buildS3RepairAnalysis();
    const result = applySecS3ValidationRepairPatches({
      analysisResult,
      allowedPatchPaths: ["/analysis_output/event_title"],
      repairResult: {
        patches: [
          {
            path: "/analysis_output/event_title",
            replacement: "Test issuer registers resale shares",
            reason: "Remove the conflicting percentage.",
            source_block_ids: ["s3_primary_offering_1"],
          },
          {
            path: "/analysis_output/score",
            replacement: 10,
            reason: "Not authorized.",
            source_block_ids: [],
          },
          {
            path: "/display_payload/data/new_field",
            replacement: "not allowed",
            reason: "Not authorized.",
            source_block_ids: [],
          },
        ],
        unresolved: [],
      },
    });

    assert.equal((result.value.analysis_output as Record<string, unknown>).event_title, "Test issuer registers resale shares");
    assert.equal((result.value.analysis_output as Record<string, unknown>).score, 78);
    assert.deepEqual(result.appliedPaths, ["/analysis_output/event_title"]);
    assert.ok(result.ignoredPaths.includes("/analysis_output/score"));
    assert.ok(result.ignoredPaths.includes("/display_payload/data/new_field"));
  });
});

function buildS3RepairInput() {
  return {
    filing_package: {
      form_type: "S-3",
      hard_parsers: {
        s3: {
          is_s3_family: true,
          cleaned_source_blocks: [
            {
              block_type: "cover_and_offering",
              label: "Cover and offering terms",
              source: "primary",
              text: "The selling stockholders may resell 5,000,000 shares. There are 10,000,000 shares outstanding.",
            },
            {
              block_type: "warrant_terms",
              label: "Warrant terms",
              source: "primary",
              text: "The warrant shares are conditional future supply and are excluded from the headline resale overhang.",
            },
          ],
        },
      },
    },
  } as unknown as SecFilingAnalysisInput;
}

function buildS3RepairAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      event_title: "Test issuer registers shares with 75% overhang",
      quick_take: "The resale pool equals 50% of current shares.",
      summary: "Estimated resale price of $ per share.",
      score: 78,
      score_reason: "The registered resale supply is material.",
      score_explanation: {
        summary: "The resale pool can materially expand tradable supply.",
        final_read: "Watch selling-holder activity.",
      },
    },
    display_payload: {
      display_type: "offering_terms",
      display_version: "s3_offering_v1",
      data: {
        display_mode: "resale_registration",
        investor_takeaway: "Registered resale supply may pressure the stock.",
        snapshot_metrics: [{ label: "Resale shares", value: "5,000,000 shares" }],
        share_overhang: {
          status_value: "50.0%",
          basis: {
            label: "Shares outstanding",
            value: "10,000,000 shares",
            numeric_value: 10_000_000,
            unit: "shares",
          },
          rows: [
            {
              label: "Resale shares",
              value: "5,000,000 shares",
              numeric_value: 5_000_000,
              unit: "shares",
              row_role: "counted",
            },
            {
              label: "Warrant shares",
              value: "1,000,000 shares",
              numeric_value: 1_000_000,
              unit: "shares",
              row_role: "conditional",
            },
          ],
          total_note: {
            numerator: "5,000,000 shares",
            denominator: "10,000,000 shares",
            ratio: "50.0%",
          },
        },
      },
    },
  };
}
