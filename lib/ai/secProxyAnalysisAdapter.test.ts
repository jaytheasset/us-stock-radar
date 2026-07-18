import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { parseProxyFiling } from "@/lib/sources/sec/forms/proxy/parser";
import {
  applySecProxyValidationRepairPatches,
  buildSecProxyValidationRepairPlan,
} from "@/lib/ai/secProxyAnalysisAdapter";

describe("Proxy validation repair", () => {
  it("selects original proxy blocks and limits repair to existing empty scalar fields", () => {
    const input = buildProxyRepairInput();
    const analysisResult = buildProxyRepairAnalysis();
    const plan = buildSecProxyValidationRepairPlan({ analysisResult, input });

    assert.ok(plan);
    assert.ok(plan.sourceBlockIds.length > 0 && plan.sourceBlockIds.length <= 3);
    assert.ok(plan.issues.some((issue) => issue.code === "snapshot_label_missing"));
    assert.ok(plan.issues.some((issue) => issue.code === "proposal_explanation_missing"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/snapshot/0/label"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/proposals/0/explanation"));
    assert.ok(!plan.allowedPatchPaths.includes("/analysis_output/score"));
    assert.ok(plan.prompt.system.includes("only repair attempt"));
    assert.ok(plan.prompt.user.includes("selected_original_source_blocks"));
  });

  it("ignores unauthorized score edits and new proposal rows", () => {
    const analysisResult = buildProxyRepairAnalysis();
    const result = applySecProxyValidationRepairPatches({
      analysisResult,
      allowedPatchPaths: ["/display_payload/data/proposals/0/explanation"],
      repairResult: {
        patches: [
          {
            path: "/display_payload/data/proposals/0/explanation",
            replacement: "Shareholders are choosing the directors who will oversee the company.",
            reason: "The proposal text identifies a director election.",
            source_block_ids: ["proxy_proposal_1"],
          },
          {
            path: "/analysis_output/score",
            replacement: 90,
            reason: "Not authorized.",
            source_block_ids: [],
          },
          {
            path: "/display_payload/data/proposals/1/title",
            replacement: "Invented proposal",
            reason: "Not authorized.",
            source_block_ids: [],
          },
        ],
        unresolved: [],
      },
    });

    const output = result.value as Record<string, unknown>;
    const displayPayload = output.display_payload as Record<string, unknown>;
    const data = displayPayload.data as Record<string, unknown>;
    const proposals = data.proposals as Array<Record<string, unknown>>;
    assert.equal(proposals[0]?.explanation, "Shareholders are choosing the directors who will oversee the company.");
    assert.equal((output.analysis_output as Record<string, unknown>).score, 35);
    assert.equal(proposals.length, 1);
    assert.deepEqual(result.appliedPaths, ["/display_payload/data/proposals/0/explanation"]);
    assert.ok(result.ignoredPaths.includes("/analysis_output/score"));
    assert.ok(result.ignoredPaths.includes("/display_payload/data/proposals/1/title"));
  });

  it("repairs benefit-only reverse-split language when original blocks disclose investor risk", () => {
    const parserOutput = parseProxyFiling({
      formType: "DEF 14A",
      accessionNumber: "0001104659-25-034266",
      companyName: "TransCode Therapeutics",
      primaryTicker: { ticker: "RNAZ", exchange: "NASDAQ" },
      filingText: [
        "Proposal 1: Approve a reverse stock split at a ratio selected by the board.",
        "The primary purpose is to increase the bid price to regain compliance with Nasdaq's minimum bid requirement.",
        "If Nasdaq delists the common stock, trading may move to an over-the-counter market that is less liquid.",
        "Delisting could also impair the company's ability to raise equity capital and obtain financing.",
      ].join("\n"),
    });
    const input = {
      filing_package: {
        form_type: "DEF 14A",
        hard_parsers: { proxy: parserOutput },
      },
    } as unknown as SecFilingAnalysisInput;
    const analysisResult = {
      analysis_output: {
        event_title: "TransCode seeks reverse split approval",
        quick_take: "The reverse split should boost liquidity by increasing the per-share price.",
        score_reason: "A higher share price should improve liquidity.",
        why_it_matters: "The proposal may enhance liquidity for investors.",
        score_explanation: { summary: "The split supports liquidity." },
        score: 78,
        signal: "volatile",
      },
      display_payload: {
        display_type: "proxy_vote",
        display_version: "proxy_vote_v1",
        data: {
          summary_title: "Reverse Split Vote",
          summary_sentence: "Shareholders will vote on a reverse stock split.",
          snapshot: [],
          proposals: [
            {
              id: "1",
              title: "Reverse stock split",
              type: "Capital structure",
              board_recommendation: "Support",
              is_shareholder_proposal: false,
              explanation: "The proposal should improve liquidity by increasing the stock price.",
              details: [],
            },
          ],
        },
        evidence: [],
        notes: [],
      },
    };

    const plan = buildSecProxyValidationRepairPlan({ analysisResult, input });

    assert.ok(plan);
    assert.ok(plan.issues.some((issue) => issue.code === "reverse_split_benefit_only_framing"));
    assert.ok(plan.allowedPatchPaths.includes("/analysis_output/quick_take"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/proposals/0/explanation"));
    assert.ok(plan.prompt.user.includes("minimum bid"));
    assert.ok(plan.sourceBlockIds.length > 0 && plan.sourceBlockIds.length <= 3);
  });
});

function buildProxyRepairInput() {
  const parserOutput = parseProxyFiling({
    formType: "DEF 14A",
    accessionNumber: "0001000000-26-000101",
    companyName: "Acme Components",
    primaryTicker: { ticker: "ACMX", exchange: "NASDAQ" },
    filingText: [
      "ACME COMPONENTS, INC. 2026 Proxy Statement",
      "The Annual Meeting of Shareholders will be held on June 12, 2026.",
      "The record date for voting is April 30, 2026.",
      "Proposal 1: Election of three directors. Board recommendation: FOR.",
    ].join("\n"),
  });

  return {
    filing_package: {
      form_type: "DEF 14A",
      hard_parsers: { proxy: parserOutput },
    },
  } as unknown as SecFilingAnalysisInput;
}

function buildProxyRepairAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      event_title: "Acme schedules annual shareholder meeting",
      score: 35,
      signal: "neutral",
    },
    display_payload: {
      display_type: "proxy_vote",
      display_version: "proxy_vote_v1",
      data: {
        summary_title: "Proxy Vote Summary",
        summary_sentence: "Shareholders will vote on the election of three directors.",
        snapshot: [{ label: "", value: "June 12, 2026", note: "Annual meeting" }],
        proposals: [
          {
            id: "1",
            title: "Election of three directors",
            type: "Director election",
            board_recommendation: "Support",
            is_shareholder_proposal: false,
            explanation: "",
            details: [],
          },
        ],
      },
      evidence: [],
      notes: [],
    },
  };
}
