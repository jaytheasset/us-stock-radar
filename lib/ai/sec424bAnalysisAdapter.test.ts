import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  applySec424bValidationRepairPatches,
  buildSec424bValidationRepairPlan,
  collect424bDisplayPayloadWarnings,
  normalize424bOfferingDisplayModel,
  synchronize424bAnalysisOverhangPercentages,
} from "@/lib/ai/sec424bAnalysisAdapter";

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
