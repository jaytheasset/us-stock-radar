import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptSecNtAnalysisPromptResultForAnalysis,
  buildSecNtAnalysisPromptForInput,
  collectSecNtScoringWarnings,
  isSecNtFilingInput,
} from "./secNtAnalysisAdapter";
import { parseNtFiling } from "../sources/sec/forms/nt/parser";

test("NT adapter detects parser output and builds an analysis-only prompt", () => {
  const input = makeInput();
  assert.equal(isSecNtFilingInput(input), true);

  const prompt = buildSecNtAnalysisPromptForInput(input);
  assert.equal(prompt.key, "sec_nt_analysis");
  assert.match(prompt.system, /An NT filing is not automatically bearish/);
  assert.doesNotMatch(prompt.user, /router_decision|display_payload/);
});

test("NT adapter builds display payload in code from final analysis", () => {
  const input = makeInput();
  const result = adaptSecNtAnalysisPromptResultForAnalysis(
    {
      source_group: "filings",
      market_scope: "company",
      event_type: "other",
      event_title: "Example issuer expects a short quarterly filing delay",
      primary_ticker: { ticker: "EXM", exchange: "Nasdaq" },
      tickers: [{ ticker: "EXM", exchange: "Nasdaq", role: "primary" }],
      sector: null,
      industry_group: null,
      theme_group: null,
      sub_theme: null,
      score: 28,
      score_reason: "The delay is expected to remain inside the extension window without a material results change.",
      score_explanation: {
        summary: "A short expected delay with no results change keeps investor impact limited.",
      },
      nt_scoring_assessment: {
        delay_status: "within_extension",
        underlying_issue: "Routine quarterly review completion",
        results_change: "none disclosed",
        financial_reliability_risk: "none",
        severity: "routine",
        material_offset: "The report is expected within the extension window.",
        alert_driver: null,
      },
      signal: "neutral",
      quick_take: "The quarterly report is delayed but expected within the standard extension window.",
      summary: "Example issuer needs additional time to complete its quarterly report. It expects to file within the Rule 12b-25 extension and reports no significant results change.",
      why_it_matters: "The notice indicates a short reporting delay rather than a new operating problem.",
      bullish_points: [],
      bearish_points: [],
      key_evidence: ["The issuer expects to file within five calendar days.", "No significant results change is anticipated."],
      what_to_watch_next: ["Quarterly report filing within the extension window."],
      related_tickers: [],
      calendar_items: [],
      confidence: "high",
      needs_human_review: false,
    },
    input,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const display = result.analysis.display_payload as Record<string, unknown>;
  const data = display.data as Record<string, unknown>;
  assert.equal(display.display_type, "generic");
  assert.equal(data.selected_event_type, "other");
  assert.equal(result.analysis.archive_summary, result.analysis.summary);
  assert.ok(Number((result.analysis.nt_source_bundle as Record<string, unknown>).block_count) >= 3);
  assert.deepEqual(result.analysis.nt_validation_warnings, []);
});

test("NT scoring validator catches overstated routine and neutral alert outputs", () => {
  const warnings = collectSecNtScoringWarnings({
    score: 78,
    signal: "neutral",
    nt_scoring_assessment: {
      delay_status: "within_extension",
      underlying_issue: "Routine close procedures",
      results_change: "none disclosed",
      financial_reliability_risk: "none",
      severity: "routine",
      material_offset: null,
      alert_driver: null,
    },
  });
  const codes = warnings.map((warning) => warning.code);
  assert.ok(codes.includes("neutral_alert_score_conflict"));
  assert.ok(codes.includes("missing_alert_driver"));
  assert.ok(codes.includes("score_severity_mismatch"));
  assert.ok(codes.includes("routine_delay_overstated"));
});

function makeInput() {
  const parserOutput = parseNtFiling({
    formType: "NT 10-Q",
    accessionNumber: "0000000000-26-000001",
    companyName: "Example Issuer Inc.",
    ticker: "EXM",
    exchange: "Nasdaq",
    filingText: [
      "FORM 12b-25 NOTIFICATION OF LATE FILING",
      "PART I - REGISTRANT INFORMATION Example Issuer Inc.",
      "PART II - RULE 12b-25(b) AND (c) The subject Form 10-Q will be filed within five calendar days.",
      "PART III - NARRATIVE Additional time is required to complete the quarterly financial statements.",
      "PART IV - OTHER INFORMATION Is it anticipated that any significant change in results of operations will be reflected? No.",
      "SIGNATURE",
    ].join("\n"),
  });
  return {
    filing_package: {
      form_type: "NT 10-Q",
      company_name: "Example Issuer Inc.",
      ticker: "EXM",
      exchange: "Nasdaq",
      hard_parsers: { nt: parserOutput },
    },
  };
}
