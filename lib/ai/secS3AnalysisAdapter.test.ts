import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  adaptSecS3AnalysisPromptResultForAnalysis,
  applySecS3ValidationRepairPatches,
  buildSecS3ValidationRepairPlan,
} from "@/lib/ai/secS3AnalysisAdapter";
import {
  buildSecS3OfferingAnalysisPrompt,
  getSecS3OfferingSourceBlockIds,
} from "@/lib/prompts/secS3OfferingAnalysis";

describe("S-3 material events output contract", () => {
  it("requires and preserves one primary plus a genuinely separate secondary for S-3ASR", () => {
    const input = buildS3MaterialEventsInput("S-3ASR");
    const sourceBlockIds = getSecS3OfferingSourceBlockIds(input);
    const result = buildS3MaterialEventsResult(sourceBlockIds, [
      {
        role: "primary",
        event_type: "dilution_risk",
        event_summary: "The automatic shelf registration creates future equity issuance capacity without launching a current sale.",
        key_terms: ["automatic shelf", "$500 million capacity"],
        source_block_ids: [sourceBlockIds[0]],
      },
      {
        role: "secondary",
        event_type: "legal_risk",
        event_summary: "A separately disclosed court order could independently restrict the issuer's principal operating asset.",
        key_terms: ["court order", "operating restriction"],
        source_block_ids: [sourceBlockIds[1]],
      },
    ]);

    const prompt = buildSecS3OfferingAnalysisPrompt(input);
    const schema = prompt.responseFormat.json_schema.schema as Record<string, any>;
    const analysisSchema = schema.properties.analysis_output as Record<string, any>;
    const adapted = adaptSecS3AnalysisPromptResultForAnalysis(result, input);

    assert.equal(prompt.version, "v64-material-events");
    assert.ok(prompt.system.includes("exactly one role=primary"));
    assert.ok(prompt.user.includes(`"block_id":"${sourceBlockIds[0]}"`));
    assert.ok(analysisSchema.required.includes("material_events"));
    assert.equal(analysisSchema.properties.material_events.items.additionalProperties, false);
    assert.equal(adapted.ok, true);
    if (!adapted.ok) return;
    assert.deepEqual(adapted.analysis.material_events, result.analysis_output.material_events);
  });

  it("keeps a routine analyzed S-3 as one primary event and rejects duplicate primaries", () => {
    const input = buildS3MaterialEventsInput("S-3");
    const sourceBlockIds = getSecS3OfferingSourceBlockIds(input);
    const primary = {
      role: "primary",
      event_type: "dilution_risk",
      event_summary: "The registration statement preserves future shelf capacity but does not start an active sale.",
      key_terms: ["future shelf capacity", "no active sale"],
      source_block_ids: [sourceBlockIds[0]],
    };
    const routine = buildS3MaterialEventsResult(sourceBlockIds, [primary], 25);
    const duplicatePrimary = buildS3MaterialEventsResult(sourceBlockIds, [primary, { ...primary }], 25);

    assert.equal(adaptSecS3AnalysisPromptResultForAnalysis(routine, input).ok, true);
    const rejected = adaptSecS3AnalysisPromptResultForAnalysis(duplicatePrimary, input);
    assert.equal(rejected.ok, false);
    if (rejected.ok) return;
    assert.match(rejected.error, /exactly one primary/);
  });

  it("does not impose the new output contract on the shared F-3 path", () => {
    const input = buildS3MaterialEventsInput("F-3");
    const prompt = buildSecS3OfferingAnalysisPrompt(input);
    const schema = prompt.responseFormat.json_schema.schema as Record<string, any>;
    const analysisSchema = schema.properties.analysis_output as Record<string, any>;
    const result = buildS3MaterialEventsResult([], undefined);
    delete (result.analysis_output as Record<string, unknown>).material_events;

    assert.equal(prompt.version, "v63-news-style-taxonomy-schema");
    assert.ok(!prompt.system.includes("exactly one role=primary"));
    assert.ok(!analysisSchema.required.includes("material_events"));
    assert.equal(adaptSecS3AnalysisPromptResultForAnalysis(result, input).ok, true);
  });
});

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

  it("repairs a standalone pre-funded row misclassified as an alternative pool", () => {
    const input = buildStandalonePrefundedInput();
    const analysisResult = buildStandalonePrefundedAnalysis();
    const plan = buildSecS3ValidationRepairPlan({ analysisResult, input });

    assert.ok(plan);
    assert.ok(plan.issues.some((issue) => issue.code === "orphan_prefunded_alternative_pool"));
    assert.ok(!plan.issues.some((issue) => issue.code === "overhang_counted_sum_mismatch"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/share_overhang/rows/0/row_role"));
    assert.ok(!plan.allowedPatchPaths.includes("/display_payload/data/share_overhang/total_note/numerator"));

    const repaired = applySecS3ValidationRepairPatches({
      analysisResult,
      allowedPatchPaths: plan.allowedPatchPaths,
      repairResult: {
        patches: [
          {
            path: "/display_payload/data/share_overhang/rows/0/row_role",
            replacement: "orphan_prefunded_alternative_pool",
            reason: "The pre-funded warrants are standalone registered resale supply.",
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
    assert.deepEqual(repaired.appliedPaths, ["/display_payload/data/share_overhang/rows/0/row_role"]);
  });

  it("keeps a pre-funded alternative when a counted maximum offering pool exists", () => {
    const input = buildStandalonePrefundedInput();
    const analysisResult = buildStandalonePrefundedAnalysis();
    const displayPayload = analysisResult.display_payload as Record<string, unknown>;
    const data = displayPayload.data as Record<string, unknown>;
    const shareOverhang = data.share_overhang as Record<string, unknown>;
    shareOverhang.rows = [
      {
        label: "Common shares or pre-funded warrants maximum offering pool",
        value: "2,112,677 shares",
        numeric_value: 2_112_677,
        unit: "shares",
        row_role: "counted",
      },
      ...((shareOverhang.rows as Array<Record<string, unknown>>).slice(0, 1)),
    ];
    const totalNote = shareOverhang.total_note as Record<string, unknown>;
    totalNote.numerator = "2,112,677 shares";
    totalNote.ratio = "116.7%";
    shareOverhang.status_value = "116.7%";

    const plan = buildSecS3ValidationRepairPlan({ analysisResult, input });

    assert.ok(!plan || !plan.issues.some((issue) => issue.code === "orphan_prefunded_alternative_pool"));
  });

  it("does not treat warrant rows with a common-stock class basis as duplicate ordinary supply", () => {
    const input = buildStandalonePrefundedInput();
    const analysisResult = buildStandalonePrefundedAnalysis();
    const displayPayload = analysisResult.display_payload as Record<string, unknown>;
    const data = displayPayload.data as Record<string, unknown>;
    const shareOverhang = data.share_overhang as Record<string, unknown>;
    const rows = shareOverhang.rows as Array<Record<string, unknown>>;
    rows.forEach((row) => {
      row.row_role = "counted";
      row.class_basis = "common stock";
    });

    const plan = buildSecS3ValidationRepairPlan({ analysisResult, input });

    assert.ok(!plan || !plan.issues.some((issue) => issue.code === "duplicate_prefunded_replacement_pool"));
  });
});

function buildStandalonePrefundedInput() {
  return {
    filing_package: {
      form_type: "S-3",
      hard_parsers: {
        s3: {
          is_s3_family: true,
          cleaned_source_blocks: [
            {
              block_type: "share_count_basis_context",
              label: "Registered resale supply",
              source: "primary",
              text: [
                "This prospectus registers 6,464,792 shares issuable upon exercise of previously issued warrants.",
                "The warrants include 2,112,677 standalone pre-funded warrants with a $0.001 exercise price.",
                "There were 1,810,380 shares outstanding, making the registered resale supply approximately 357%.",
              ].join(" "),
            },
          ],
        },
      },
    },
  } as unknown as SecFilingAnalysisInput;
}

function buildStandalonePrefundedAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      event_title: "Test issuer registers 6.46 million shares with 357% overhang",
      quick_take: "Registered resale supply equals approximately 357% of outstanding shares.",
      summary: "The filing registers 6,464,792 shares for resale.",
      score: 88,
      score_reason: "The registered resale pool materially exceeds current shares.",
    },
    display_payload: {
      display_type: "offering_terms",
      display_version: "s3_offering_v1",
      data: {
        display_mode: "resale_registration",
        investor_takeaway: "Registered resale supply may pressure the stock.",
        snapshot_metrics: [{ label: "Overhang", value: "357.1%" }],
        share_overhang: {
          status_value: "357.1%",
          basis: {
            label: "Shares outstanding",
            value: "1,810,380 shares",
            numeric_value: 1_810_380,
            unit: "shares",
          },
          rows: [
            {
              label: "Pre-funded warrants",
              value: "2,112,677 shares",
              numeric_value: 2_112_677,
              unit: "shares",
              row_role: "alternative",
              note: "Immediately exercisable at $0.001 per share",
            },
            {
              label: "Series F warrants",
              value: "2,112,677 shares",
              numeric_value: 2_112_677,
              unit: "shares",
              row_role: "counted",
            },
            {
              label: "Series G warrants",
              value: "2,112,677 shares",
              numeric_value: 2_112_677,
              unit: "shares",
              row_role: "counted",
            },
            {
              label: "Placement agent warrants",
              value: "126,761 shares",
              numeric_value: 126_761,
              unit: "shares",
              row_role: "counted",
            },
          ],
          total_note: {
            numerator: "6,464,792 shares",
            denominator: "1,810,380 shares",
            ratio: "357.1%",
          },
        },
      },
    },
  };
}

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

function buildS3MaterialEventsInput(formType: string) {
  return {
    filing_package: {
      form_type: formType,
      company_name: "Example Shelf Corp.",
      primary_ticker: { ticker: "SHELF", exchange: "NASDAQ" },
      hard_parsers: {
        s3: {
          form_type: formType,
          cleaned_source_blocks: [
            {
              block_type: "offering_terms",
              label: "Automatic shelf capacity",
              source: "registration statement",
              text: "The issuer registers up to $500 million of securities for future offerings and is not commencing a sale with this filing.",
            },
            {
              block_type: "legal_update",
              label: "Separate court order",
              source: "registration statement",
              text: "A court order separately restricts operation of the issuer's principal asset pending further review.",
            },
          ],
        },
      },
    },
  } as unknown as SecFilingAnalysisInput;
}

function buildS3MaterialEventsResult(
  sourceBlockIds: string[],
  materialEvents?: Array<Record<string, unknown>>,
  score = 70,
) {
  return {
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "dilution_risk",
      material_events: materialEvents || [
        {
          role: "primary",
          event_type: "dilution_risk",
          event_summary: "The shelf registration creates future issuance capacity without launching a current sale.",
          key_terms: ["future issuance capacity"],
          source_block_ids: [sourceBlockIds[0]],
        },
      ],
      event_title: "Shelf registration preserves future issuance capacity",
      primary_ticker: null,
      tickers: [],
      sector: null,
      industry_group: null,
      theme_group: null,
      sub_theme: null,
      score,
      score_reason: "Future issuance capacity matters, while the absence of an active sale limits immediacy.",
      score_explanation: { summary: "Future issuance capacity is meaningful but no sale starts now." },
      signal: "neutral",
      quick_take: "The filing registers future capacity without current sale terms.",
      summary: "The issuer registered shelf capacity for possible later offerings, with no active sale launched in this filing.",
      why_it_matters: "Future offerings could add supply when the issuer later activates the shelf.",
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
      display_type: "offering_terms",
      display_version: "1.0",
      data: {
        display_mode: "shelf_capacity",
        snapshot_metrics: [{ label: "Shelf capacity", value: "$500 million" }],
        share_overhang: { rows: [] },
        instrument_details: [],
        investor_takeaway: "The shelf creates future capacity but no current sale.",
        needs_human_review: false,
      },
      evidence: [],
      notes: [],
    },
  };
}
