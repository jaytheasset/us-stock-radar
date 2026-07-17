import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptSecNtAnalysisPromptResultForAnalysis,
  buildSecNtAnalysisPromptForInput,
  buildSecNtValidationRepairPlan,
  collectSecNtScoringWarnings,
  enforceSecNtPostRepairInvariants,
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
  assert.equal(display.display_type, "nt_late_filing");
  assert.equal(data.selected_event_type, "other");
  assert.equal(data.delay_status, "within_extension");
  assert.equal(data.underlying_issue, "Routine quarterly review completion");
  assert.equal(data.results_change, "none disclosed");
  assert.equal(data.reason_for_delay_value, "Routine quarterly review completion");
  assert.equal(data.reason_for_delay_note, null);
  assert.equal(data.expected_results_impact_value, "none disclosed");
  assert.equal(data.expected_results_impact_note, null);
  assert.equal(data.extension_days, 5);
  assert.equal(result.analysis.archive_summary, result.analysis.summary);
  assert.ok(Number((result.analysis.nt_source_bundle as Record<string, unknown>).block_count) >= 3);
  assert.deepEqual(result.analysis.nt_validation_warnings, []);
});

test("NT validator repairs routine classifications when Part IV discloses material results changes", () => {
  const input = makeMaterialResultsInput();
  const analysis = {
    event_type: "other",
    score: 35,
    signal: "neutral",
    nt_scoring_assessment: {
      delay_status: "within_extension",
      underlying_issue: "Acquisition accounting work",
      results_change: "mixed",
      financial_reliability_risk: "none",
      severity: "routine",
      material_offset: "Revenue is expected to increase.",
      alert_driver: null,
    },
  };
  const warnings = collectSecNtScoringWarnings(analysis, input);
  assert.ok(warnings.some((warning) => warning.code === "material_results_change_classified_routine"));

  const repairPlan = buildSecNtValidationRepairPlan({ analysisResult: analysis, input });
  assert.ok(repairPlan);
  assert.ok(repairPlan?.sourceBlockIds.length);
  assert.ok(repairPlan?.allowedPatchPaths.includes("/event_type"));
  assert.ok(repairPlan?.allowedPatchPaths.includes("/score"));
});

test("NT post-repair guard prevents quantified earnings changes from remaining routine archives", () => {
  const input = makePositiveMaterialResultsInput();
  const enforcement = enforceSecNtPostRepairInvariants({
    input,
    analysisResult: {
      event_type: "other",
      score: 35,
      signal: "neutral",
      score_reason: "The report is expected within the extension period.",
      score_explanation: { summary: "A routine filing delay." },
      nt_scoring_assessment: {
        delay_status: "within_extension",
        underlying_issue: "Annual report completion delay",
        results_change: "Net income SGD32K to SGD3.9M",
        financial_reliability_risk: "none",
        severity: "routine",
        material_offset: "Filing expected within the extension period",
        alert_driver: null,
      },
    },
  });

  assert.equal(enforcement.applied, true);
  assert.equal(enforcement.value.event_type, "earnings");
  assert.equal(enforcement.value.score, 60);
  assert.equal(enforcement.value.signal, "volatile");
  assert.equal(
    (enforcement.value.nt_scoring_assessment as Record<string, unknown>).severity,
    "meaningful",
  );
  assert.equal(
    enforcement.remainingWarnings.some(
      (warning) => warning.code === "material_results_change_classified_routine",
    ),
    false,
  );
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

test("NT scoring validator escalates explicit restatement and reliability risk", () => {
  const input = makeRestatementRiskInput();
  const warnings = collectSecNtScoringWarnings({
    event_type: "other",
    score: 55,
    signal: "neutral",
    nt_scoring_assessment: {
      delay_status: "within_extension",
      underlying_issue: "Restatement and non-reliance review",
      results_change: "Prior financial statements cannot be relied upon",
      financial_reliability_risk: "explicit",
      severity: "meaningful",
      material_offset: null,
      alert_driver: null,
    },
  }, input);
  const codes = warnings.map((warning) => warning.code);
  assert.ok(codes.includes("explicit_financial_risk_understated"));
});

test("NT validator routes oversized Key Evidence through one bounded repair", () => {
  const input = makeInput();
  const analysis = {
    event_type: "other",
    score: 28,
    signal: "neutral",
    nt_scoring_assessment: {
      delay_status: "within_extension",
      underlying_issue: "Routine quarterly review completion",
      results_change: "none disclosed",
      financial_reliability_risk: "none",
      severity: "routine",
      material_offset: null,
      alert_driver: null,
    },
    key_evidence: [
      "The registrant is filing a notification of late filing because the compilation, dissemination, and review of all information required for the report could not be completed without unreasonable effort and expense.",
      "The report is expected within the extension period.",
    ],
  };

  const warnings = collectSecNtScoringWarnings(analysis, input);
  const warning = warnings.find((item) => item.code === "key_evidence_too_long");
  assert.ok(warning);
  assert.deepEqual(warning?.allowed_patch_paths, ["/key_evidence/0"]);

  const repairPlan = buildSecNtValidationRepairPlan({ analysisResult: analysis, input });
  assert.ok(repairPlan?.allowedPatchPaths.includes("/key_evidence/0"));
  assert.match(repairPlan?.prompt.system || "", /no more than 140 characters/);
});

test("NT validator routes oversized snapshot values through one bounded repair", () => {
  const input = makeInput();
  const analysis = {
    event_type: "earnings",
    score: 65,
    signal: "bearish",
    nt_scoring_assessment: {
      delay_status: "within_extension",
      underlying_issue: "Compilation and review of financial statements and information for the annual report.",
      results_change: "Revenue increase of 14-26% ($1.2-$2.2M), but net loss of $134.7-$141.7M versus prior-year net income of $0.7M.",
      financial_reliability_risk: "possible",
      severity: "meaningful",
      material_offset: null,
      alert_driver: null,
    },
  };

  const warnings = collectSecNtScoringWarnings(analysis, input);
  const codes = warnings.map((warning) => warning.code);
  assert.ok(codes.includes("snapshot_reason_too_long"));
  assert.ok(codes.includes("snapshot_results_too_long"));

  const repairPlan = buildSecNtValidationRepairPlan({ analysisResult: analysis, input });
  assert.ok(repairPlan?.allowedPatchPaths.includes("/nt_scoring_assessment/underlying_issue"));
  assert.ok(repairPlan?.allowedPatchPaths.includes("/nt_scoring_assessment/results_change"));
  assert.match(repairPlan?.prompt.system || "", /no more than 64 characters/);
  assert.match(repairPlan?.prompt.system || "", /no more than 90 characters/);
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

function makeMaterialResultsInput() {
  const parserOutput = parseNtFiling({
    formType: "NT 10-K",
    accessionNumber: "0000000000-26-000002",
    companyName: "Material Change Issuer Inc.",
    ticker: "MCI",
    exchange: "Nasdaq",
    filingText: [
      "FORM 12b-25 NOTIFICATION OF LATE FILING",
      "PART I - REGISTRANT INFORMATION Material Change Issuer Inc.",
      "PART II - RULE 12b-25(b) AND (c) The subject Form 10-K will be filed within fifteen calendar days.",
      "PART III - NARRATIVE Additional time is required to complete acquisition accounting and year-end review procedures.",
      "PART IV - OTHER INFORMATION",
      "Is it anticipated that any significant change in results of operations will be reflected? Yes.",
      "Revenue is expected to increase more than 15%, SG&A is expected to increase approximately 50%, and net loss is expected to widen compared with the prior year.",
      "SIGNATURE",
    ].join("\n"),
  });
  return {
    filing_package: {
      form_type: "NT 10-K",
      company_name: "Material Change Issuer Inc.",
      ticker: "MCI",
      exchange: "Nasdaq",
      hard_parsers: { nt: parserOutput },
    },
  };
}

function makePositiveMaterialResultsInput() {
  const parserOutput = parseNtFiling({
    formType: "NT 20-F",
    accessionNumber: "0000000000-26-000003",
    companyName: "Positive Change Issuer Ltd.",
    ticker: "PCI",
    exchange: "Nasdaq",
    filingText: [
      "FORM 12b-25 NOTIFICATION OF LATE FILING",
      "PART I - REGISTRANT INFORMATION Positive Change Issuer Ltd.",
      "PART II - RULE 12b-25(b) AND (c) The subject Form 20-F will be filed within fifteen calendar days.",
      "PART III - NARRATIVE Additional time is required to complete and finalize the annual report.",
      "PART IV - OTHER INFORMATION",
      "Is it anticipated that any significant change in results of operations will be reflected? Yes.",
      "Net income is expected to increase to SGD3.9 million from SGD32 thousand in the prior year.",
      "SIGNATURE",
    ].join("\n"),
  });
  return {
    filing_package: {
      form_type: "NT 20-F",
      company_name: "Positive Change Issuer Ltd.",
      ticker: "PCI",
      exchange: "Nasdaq",
      hard_parsers: { nt: parserOutput },
    },
  };
}

function makeRestatementRiskInput() {
  const parserOutput = parseNtFiling({
    formType: "NT 10-K",
    accessionNumber: "0000000000-26-000004",
    companyName: "Restatement Risk Issuer Inc.",
    ticker: "RRI",
    exchange: "Nasdaq",
    filingText: [
      "FORM 12b-25 NOTIFICATION OF LATE FILING",
      "PART I - REGISTRANT INFORMATION Restatement Risk Issuer Inc.",
      "PART II - RULE 12b-25(b) AND (c) The subject Form 10-K will be filed within fifteen calendar days.",
      "PART III - NARRATIVE Additional time is required to complete a restatement and related audit procedures.",
      "The audit committee concluded that prior financial statements should no longer be relied upon due to material accounting errors.",
      "PART IV - OTHER INFORMATION",
      "SIGNATURE",
    ].join("\n"),
  });
  return {
    filing_package: {
      form_type: "NT 10-K",
      company_name: "Restatement Risk Issuer Inc.",
      ticker: "RRI",
      exchange: "Nasdaq",
      hard_parsers: { nt: parserOutput },
    },
  };
}
