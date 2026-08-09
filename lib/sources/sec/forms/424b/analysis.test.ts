import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build424bAnalysisPrompt, validate424bRoomResult } from "./analysisPrompt.ts";
import { parse424bFiling } from "./parser.ts";
import {
  applySec424bValidationRepairPatches,
  buildSec424bValidationRepairPlan,
} from "../../../../ai/sec424bAnalysisAdapter.ts";
import type { SecFilingAnalysisInput } from "../../../../prompts/secFilingAnalysis.ts";
import {
  APPROVED_424B_EVENT_TYPES,
  type Sec424bFixtureInput,
  type Sec424bRoomResult,
  deriveDeliveryLevel,
} from "./types.ts";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "424b");
const fixturesDir = join(roomDir, "fixtures");
const expectedDir = join(roomDir, "expected");

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function expectedNames(): string[] {
  return readdirSync(expectedDir)
    .filter((file) => file.endsWith(".expected.json"))
    .map((file) => file.replace(/\.expected\.json$/, ""))
    .sort();
}

describe("424B analysis fixtures", () => {
  for (const name of expectedNames()) {
    it(`keeps ${name} in the required output shape`, () => {
      const expected = loadJson<Sec424bRoomResult>(join(expectedDir, `${name}.expected.json`));

      assert.deepEqual(validate424bRoomResult(expected), []);
      assert.ok(APPROVED_424B_EVENT_TYPES.includes(expected.analysis_output.event_type));
      assert.equal(
        deriveDeliveryLevel(expected.analysis_output.score),
        expected.fixture_expected.expected_delivery_level,
      );
      assert.equal(expected.analysis_output.source_group, "filings");
      assert.ok(["generic", "offering_terms", "candidate_special", "spac_transaction_status"].includes(expected.display_payload.display_type));
      assert.equal(expected.display_payload.display_version, "424b-display-payload-v1");
    });
  }

  it("builds an analysis prompt from cleaned source blocks without a router", () => {
    const fixture = loadJson<Sec424bFixtureInput>(join(fixturesDir, "resale-overhang.json"));
    const parserOutput = parse424bFiling(fixture);
    const prompt = build424bAnalysisPrompt(parserOutput);

    assert.ok(prompt.includes("score below 50 = archive; 50 to 74 = feed; 75 or above = alert"));
    assert.ok(prompt.includes("cleaned_source_blocks"));
    assert.ok(prompt.includes("Do not call live APIs"));
    assert.ok(prompt.includes("Write investor-facing copy only."));
    assert.ok(prompt.includes("There is no 424B router LLM"));
    assert.ok(prompt.includes("Choose the final event_type"));
    assert.ok(prompt.includes("Choose the final display_payload.display_type"));
    assert.ok(prompt.includes("spac_transaction_status"));
    assert.ok(prompt.includes("Use offering_terms when 424B source blocks disclose offering"));
    assert.ok(prompt.includes("Do not use post-offering share count assumptions as actual supply."));
    assert.ok(prompt.includes("Do not describe an ATM program as a resale pool"));
    assert.ok(prompt.includes("offering_details must be an array of { label, value, note? }"));
    assert.ok(prompt.includes("note is also visible under the value"));
    assert.ok(prompt.includes("Do not leave material exceptions or investor-critical caveats only"));
    for (const eventType of APPROVED_424B_EVENT_TYPES) {
      assert.ok(prompt.includes(`- ${eventType}`));
    }
  });

  it("adds the 424B5 material-events contract and source block IDs to a representative fixture", () => {
    const fixture = loadJson<Sec424bFixtureInput>(join(fixturesDir, "atm-market-context.json"));
    const prompt = build424bAnalysisPrompt(parse424bFiling(fixture));

    assert.ok(prompt.includes("exactly one role=primary"));
    assert.ok(prompt.includes('"material_events"'));
    assert.ok(prompt.includes('"block_id": "424b_source_'));
    assert.ok(prompt.includes("only for a separate event that would independently change an investor conclusion"));
  });

  it("builds a one-pass source-backed repair plan for local 424B inconsistencies", () => {
    const parserOutput = parse424bFiling({
      formType: "424B5",
      accessionNumber: "0000000000-26-000424",
      companyName: "Repair 424B Inc.",
      ticker: "RPRB",
      filingText: [
        "The selling stockholders may resell 5,000,000 shares of common stock.",
        "There were 10,000,000 shares of common stock outstanding.",
        "Additional warrant shares are issuable only upon future exercise.",
      ].join("\n"),
    });
    const input = {
      filing_package: { hard_parsers: { "424b": parserOutput } },
    } as unknown as SecFilingAnalysisInput;
    const analysisResult = build424bRepairAnalysis();
    const plan = buildSec424bValidationRepairPlan({ analysisResult, input });

    assert.ok(plan);
    assert.ok(plan.sourceBlockIds.length > 0 && plan.sourceBlockIds.length <= 3);
    assert.ok(plan.issues.some((issue) => issue.code === "conflicting_overhang_percentage"));
    assert.ok(plan.issues.some((issue) => issue.code === "unresolved_visible_placeholder"));
    assert.ok(plan.allowedPatchPaths.includes("/analysis_output/event_title"));
    assert.ok(!plan.allowedPatchPaths.includes("/analysis_output/score"));
    assert.ok(plan.prompt.system.includes("only repair attempt"));
  });

  it("applies only allowed existing scalar patches", () => {
    const analysisResult = build424bRepairAnalysis();
    const result = applySec424bValidationRepairPatches({
      analysisResult,
      allowedPatchPaths: ["/analysis_output/event_title"],
      repairResult: {
        patches: [
          {
            path: "/analysis_output/event_title",
            replacement: "Repair 424B registers resale shares",
            reason: "Remove conflicting percentage.",
            source_block_ids: ["424b_primary_1"],
          },
          {
            path: "/analysis_output/score",
            replacement: 5,
            reason: "Not allowed.",
            source_block_ids: [],
          },
        ],
        unresolved: [],
      },
    });

    assert.equal((result.value.analysis_output as Record<string, unknown>).event_title, "Repair 424B registers resale shares");
    assert.equal((result.value.analysis_output as Record<string, unknown>).score, 80);
    assert.deepEqual(result.appliedPaths, ["/analysis_output/event_title"]);
    assert.ok(result.ignoredPaths.includes("/analysis_output/score"));
  });
});

function build424bRepairAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      event_title: "Repair 424B registers shares with 75% overhang",
      quick_take: "The resale pool equals 50% of outstanding shares.",
      summary: "Estimated sale price of $ per share.",
      score: 80,
      score_reason: "The resale pool is material.",
      score_explanation: {
        summary: "Registered resale supply can increase tradable shares.",
        final_read: "Watch selling-holder activity.",
      },
    },
    display_payload: {
      display_type: "offering_terms",
      display_version: "424b-display-payload-v1",
      data: {
        display_mode: "resale_registration",
        investor_takeaway: "Registered resale supply may pressure the stock.",
        needs_human_review: false,
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
      evidence: [],
      notes: [],
    },
  };
}
