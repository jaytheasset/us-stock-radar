import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildS1F1AnalysisPrompt, validateS1F1RequiredOutputShape } from "./analysisPrompt.ts";
import { s1F1Adapter } from "./adapter.ts";
import { parseS1F1Filing } from "./parser.ts";
import {
  applySecS1F1ValidationRepairPatches,
  buildSecS1F1ValidationRepairPlan,
} from "../../../../ai/secS1F1AnalysisAdapter.ts";
import type { SecFilingAnalysisInput } from "../../../../prompts/secFilingAnalysis.ts";
import {
  APPROVED_SEC_EVENT_TYPES,
  type S1F1ParserInput,
  type S1F1RequiredOutputJson,
} from "./types.ts";

const ROOM_URL = new URL("./", import.meta.url);
const FIXTURE_NAMES = [
  "edgar-cava-s1-ipo",
  "edgar-reddit-s1a-pricing",
  "edgar-arm-f1a-ads-ipo",
  "edgar-spirit-posam-deregistration",
  "edgar-liberty-f1mef-rule462b",
  "edgar-medline-s1mef-rule462b",
] as const;

function loadJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(new URL(relativePath, ROOM_URL), "utf8")) as T;
}

describe("S-1/F-1 analysis output fixtures", () => {
  for (const name of FIXTURE_NAMES) {
    it(`keeps ${name} in the required output JSON shape`, () => {
      const fixture = loadJson<{ expected: { event_type: string; delivery_level: string } }>(`fixtures/${name}.json`);
      const expected = loadJson<S1F1RequiredOutputJson>(`expected/${name}.expected.json`);
      const errors = validateS1F1RequiredOutputShape(expected);

      assert.deepEqual(errors, []);
      assert.equal(expected.analysis_output.event_type, fixture.expected.event_type);
      assert.ok(APPROVED_SEC_EVENT_TYPES.includes(expected.analysis_output.event_type));
    });
  }

  it("builds an analysis prompt that preserves the parser > analysis LLM flow", () => {
    const fixture = loadJson<{ input: S1F1ParserInput }>("fixtures/edgar-reddit-s1a-pricing.json");
    const parserOutput = parseS1F1Filing(fixture.input);
    const prompt = buildS1F1AnalysisPrompt(parserOutput);

    assert.ok(prompt.includes("Required Output JSON"));
    assert.ok(prompt.includes("S-1 / F-1, S-1/A / F-1/A"));
    assert.ok(prompt.includes("Do not call live APIs"));
    assert.ok(prompt.includes("There is no S-1/F-1 router LLM"));
    assert.ok(prompt.includes("Return display_payload yourself"));
    assert.ok(prompt.includes("Visible UI contract"));
    assert.ok(prompt.includes("Stored-only evidence contract"));
    assert.ok(prompt.includes("Do not place investor-critical terms only"));
    assert.ok(prompt.includes("Cleaned source input"));
    assert.ok(prompt.includes("cleaned_source_blocks"));
    assert.ok(prompt.includes("Do not treat parser-generated facts"));
    assert.ok(prompt.includes("Do not return parser_output"));
    assert.ok(!prompt.includes("Parser output:"));
    assert.ok(prompt.includes('"analysis_output"'));
    assert.ok(prompt.includes('"display_payload"'));
    assert.ok(!prompt.includes('"fixture_expected"'));
  });

  it("requires the analysis LLM to choose the S-1/F-1 display mode", () => {
    const fixture = loadJson<{ input: S1F1ParserInput }>("fixtures/edgar-cava-s1-ipo.json");
    const parserOutput = parseS1F1Filing(fixture.input);
    const prompt = buildS1F1AnalysisPrompt(parserOutput);

    assert.ok(prompt.includes("display_payload.data.display_mode"));
    assert.ok(prompt.includes("ipo_registration"));
    assert.ok(prompt.includes("resale_registration"));
    assert.ok(prompt.includes("rule_462b_mef"));
  });

  it("separates S-1 Monitor seller side from display component structure", () => {
    const fixture = loadJson<{ input: S1F1ParserInput }>("fixtures/edgar-reddit-s1a-pricing.json");
    const parserOutput = parseS1F1Filing(fixture.input);
    const prompt = buildS1F1AnalysisPrompt(parserOutput);

    assert.match(prompt, /mixed_offering describes independently material offering components or security structure/);
    assert.match(prompt, /Offering Monitor side describes the economic seller\/source of securities and proceeds recipient/);
    assert.match(prompt, /issuer-only transaction with those components remains primary for Monitor side/);
    assert.match(prompt, /resale means an actual selling holder or selling securityholder resells securities/);
    assert.match(prompt, /mixed requires both an issuer primary sale and an actual selling-holder resale/);
    assert.match(prompt, /Rule 144 language[\s\S]*alone are not evidence of an actual selling-holder resale/);
    assert.match(prompt, /choose side=mixed only when the source actually supports both seller sides/);
  });

  it("keeps S-1 Monitor gross distinct from display proceeds and fee-table values", () => {
    const fixture = loadJson<{ input: S1F1ParserInput }>("fixtures/edgar-reddit-s1a-pricing.json");
    const parserOutput = parseS1F1Filing(fixture.input);
    const prompt = buildS1F1AnalysisPrompt(parserOutput);

    assert.match(prompt, /actual means the source-backed gross transaction amount for the current specific issuer primary transaction/);
    assert.match(prompt, /not only cash already received at closing/);
    assert.match(prompt, /A fixed, approximate, up-to, or committed maximum gross amount may be available/);
    assert.match(prompt, /approximation with quality=estimated/);
    assert.match(prompt, /up-to or maximum amount with bound=maximum/);
    assert.match(prompt, /Gross is the purchase amount or transaction consideration before fees and offering expenses/);
    assert.match(prompt, /net proceeds are after those deductions and are not gross/);
    assert.match(prompt, /registration fee-table ceiling alone is not Monitor transaction gross/);
    assert.match(prompt, /fee-table occurrence does not invalidate that independently source-backed amount/);
    assert.match(prompt, /display-only fixed-proceeds and calculability rules[\s\S]*do not override the Monitor rule/);
    assert.match(prompt, /If Monitor gross is not source-backed, keep it unavailable and never substitute net proceeds/);
  });

  it("does not add the S-1 Monitor alignment contract to F-1 analysis", () => {
    const fixture = loadJson<{ input: S1F1ParserInput }>("fixtures/edgar-arm-f1a-ads-ipo.json");
    const parserOutput = parseS1F1Filing(fixture.input);
    const prompt = buildS1F1AnalysisPrompt(parserOutput);

    assert.doesNotMatch(prompt, /S-1\/F-1 Offering Monitor semantic alignment/);
  });

  it("does not use SPAC transaction UI for blank-check IPO registration alone", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText:
        "This is the initial public offering of units of a blank check company and special purpose acquisition company. No target company has been selected.",
    });

    assert.equal(parserOutput.raw.spacTransactionStatus?.statusDetected, false);
    assert.ok(parserOutput.raw.cleanedSourceBlocks?.some((block) => block.text.includes("initial public offering")));
  });

  it("passes de-SPAC source text to the analysis LLM instead of choosing the SPAC transaction UI in the parser", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText:
        "The registration statement relates to a de-SPAC business combination with TargetCo, Inc. The target company is TargetCo, Inc. The expected ticker will be TGTX. The redemption rate was 82%. The minimum cash condition was waived. PIPE financing and a backstop are in place. The expected closing date is June 30, 2026. The ticker change date is July 1, 2026. Trust cash before redemptions was $250 million and trust cash after redemptions was $45 million. Redemption price was $10.50 per share. Public shares remaining were 4,500,000.",
    });

    assert.ok(parserOutput.raw.cleanedSourceBlocks?.some((block) => block.text.includes("TargetCo, Inc")));
    assert.ok(parserOutput.raw.cleanedSourceBlocks?.some((block) => block.text.includes("minimum cash condition")));
  });

  it("exposes the live integration adapter entrypoints and normalizes runtime input", () => {
    const parserOutput = s1F1Adapter.parse({
      formType: "S-1",
      accessionNumber: "0000000000-26-000001",
      primaryDocumentText: "This is our initial public offering. No public market currently exists for our common stock.",
      ticker: "TEST",
      companyName: "Test IPO Inc.",
      attachments: [
        {
          filename: "ex107.htm",
          description: "Filing Fee Table",
          text: "Calculation of Filing Fee Tables",
        },
      ],
    });

    assert.equal(s1F1Adapter.key, "sec-s1-f1");
    assert.equal(s1F1Adapter.parserGroup, "s1-f1");
    assert.equal(s1F1Adapter.analysisMode, "analysis_only");
    assert.deepEqual([...s1F1Adapter.supportedForms], ["S-1", "S-1/A", "F-1", "F-1/A", "S-1MEF", "F-1MEF", "POS AM"]);
    assert.equal("selectRoute" in s1F1Adapter, false);
    assert.equal("buildDisplayPayload" in s1F1Adapter, false);
    assert.equal(typeof s1F1Adapter.buildAnalysisPrompt, "function");
    assert.equal(parserOutput.accessionNumber, "0000000000-26-000001");
    assert.equal(parserOutput.facts.ticker, "TEST");
    assert.equal(parserOutput.raw.attachmentNames[0], "ex107.htm");
    assert.ok(parserOutput.raw.cleanedSourceBlocks?.some((block) => block.text.includes("initial public offering")));
  });

  it("rejects analysis output that substitutes a different primary ticker", () => {
    const expected = loadJson<S1F1RequiredOutputJson>("expected/edgar-reddit-s1a-pricing.expected.json");
    const changed: S1F1RequiredOutputJson = {
      ...expected,
      analysis_output: {
        ...expected.analysis_output,
        primary_ticker: {
          ticker: "WRONG",
        },
        tickers: ["WRONG"],
      },
    };

    const errors = validateS1F1RequiredOutputShape(changed);
    assert.ok(errors.includes("analysis_output.primary_ticker must be null; ticker metadata is restored from filing_package."));
    assert.ok(errors.includes("analysis_output.tickers must be empty; ticker metadata is restored from filing_package."));
  });

  it("builds one source-backed repair plan for conflicting overhang prose", () => {
    const input = buildRepairTestInput();
    const analysisResult = buildRepairTestAnalysis();
    const plan = buildSecS1F1ValidationRepairPlan({ analysisResult, input });

    assert.ok(plan);
    assert.ok(plan.issues.some((issue) => issue.code === "conflicting_overhang_percentage"));
    assert.ok(plan.allowedPatchPaths.includes("/analysis_output/event_title"));
    assert.ok(plan.sourceBlockIds.length > 0 && plan.sourceBlockIds.length <= 3);
    assert.equal(new Set(plan.sourceBlockIds).size, plan.sourceBlockIds.length);
    assert.ok(plan.prompt.user.includes("selected_original_source_blocks"));
    assert.ok(plan.prompt.system.includes("only repair attempt"));
  });

  it("repairs only explicitly allowed existing scalar paths", () => {
    const analysisResult = buildRepairTestAnalysis();
    const result = applySecS1F1ValidationRepairPatches({
      analysisResult,
      allowedPatchPaths: ["/analysis_output/event_title"],
      repairResult: {
        patches: [
          {
            path: "/analysis_output/event_title",
            replacement: "Test issuer files primary offering",
            reason: "Remove unsupported percentage.",
            source_block_ids: ["s1f1_primary_offering_1"],
          },
          {
            path: "/analysis_output/score",
            replacement: 5,
            reason: "Unauthorized score edit.",
            source_block_ids: [],
          },
          {
            path: "/display_payload/data/new_field",
            replacement: "not allowed",
            reason: "Unauthorized add.",
            source_block_ids: [],
          },
        ],
        unresolved: [],
      },
    });

    assert.equal((result.value.analysis_output as Record<string, unknown>).event_title, "Test issuer files primary offering");
    assert.equal((result.value.analysis_output as Record<string, unknown>).score, 70);
    assert.deepEqual(result.appliedPaths, ["/analysis_output/event_title"]);
    assert.ok(result.ignoredPaths.includes("/analysis_output/score"));
    assert.ok(result.ignoredPaths.includes("/display_payload/data/new_field"));
  });

  it("flags unresolved visible placeholders and a conditional pre-funded row as local repair candidates", () => {
    const input = buildRepairTestInput();
    const analysisResult = buildRepairTestAnalysis();
    const analysisOutput = analysisResult.analysis_output as Record<string, unknown>;
    analysisOutput.summary = "Estimated price range of $ to $ per share.";
    const data = (analysisResult.display_payload as Record<string, unknown>).data as Record<string, unknown>;
    const shareOverhang = data.share_overhang as Record<string, unknown>;
    const rows = shareOverhang.rows as Array<Record<string, unknown>>;
    rows[0].row_role = "conditional";
    rows[0].label = "Pre-Funded Warrant Shares";
    rows[0].note = "$0.001 exercise price";

    const plan = buildSecS1F1ValidationRepairPlan({ analysisResult, input });

    assert.ok(plan);
    assert.ok(plan.issues.some((issue) => issue.code === "unresolved_visible_placeholder"));
    assert.ok(plan.issues.some((issue) => issue.code === "share_equivalent_marked_conditional"));
    assert.ok(plan.allowedPatchPaths.includes("/analysis_output/summary"));
    assert.ok(plan.allowedPatchPaths.includes("/display_payload/data/share_overhang/rows/0/row_role"));
    assert.ok(!plan.allowedPatchPaths.includes("/analysis_output/score"));
    assert.match(plan.prompt.system, /replace only the affected scalar with concise pending wording/i);
    assert.match(plan.prompt.system, /never infer, calculate, or invent a missing price/i);
  });
});

function buildRepairTestInput() {
  const parserOutput = parseS1F1Filing({
    formType: "S-1",
    accessionNumber: "0000000000-26-000099",
    companyName: "Repair Test Inc.",
    ticker: "RPR",
    filingText: [
      "The company is offering 9,240,000 shares of common stock or pre-funded warrants in lieu of common stock.",
      "The pre-funded warrants have an exercise price of $0.001 per share.",
      "There were 10,000,000 shares of common stock outstanding before the offering.",
    ].join("\n"),
  });
  return {
    filing_package: {
      hard_parsers: {
        "s1-f1": parserOutput,
      },
    },
  } as unknown as SecFilingAnalysisInput;
}

function buildRepairTestAnalysis(): Record<string, unknown> {
  return {
    analysis_output: {
      event_title: "Repair Test Announces 88.0% Dilution Offering",
      score: 70,
      signal: "bearish",
      quick_take: "The offering expands potential supply.",
      summary: "The company filed a primary offering.",
      score_reason: "Potential dilution is material.",
      score_explanation: {
        summary: "The offering can materially increase share supply.",
        final_read: "Watch final pricing and share count.",
        upward_factors: [],
        limiting_factors: [],
      },
    },
    display_payload: {
      display_type: "offering_terms",
      display_version: "s1_f1_offering_v1",
      data: {
        display_mode: "primary_offering",
        display_quick_take: "The offering expands potential supply.",
        company_story: "Repair Test develops test products.",
        share_overhang: {
          status_value: "92.4%",
          rows: [
            {
              label: "Primary Shares",
              value: "9,240,000 shares",
              numeric_value: 9_240_000,
              unit: "shares",
              row_role: "counted",
              note: "Current primary offering supply",
            },
          ],
          basis: {
            label: "Shares outstanding",
            value: "10,000,000 shares",
            numeric_value: 10_000_000,
            unit: "shares",
          },
          total_note: {
            numerator: "9,240,000 shares",
            denominator: "10,000,000 shares",
            ratio: "92.4%",
          },
        },
      },
    },
  };
}
