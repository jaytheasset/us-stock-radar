import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applySecPrimarySemanticValidationDisposition,
  buildSecPrimaryStructuralValidationDiagnostics,
  classifySecPrimaryStructuralFailure,
  type SecPrimaryStructuralFailureCode,
} from "./secPrimaryValidationDisposition.ts";
import { buildSecValidationRepairTrace } from "../secValidationRepairTrace.ts";

const semanticIssues = [
  {
    code: "score_rationale_meta_language",
    warning: "score_reason describes the score instead of the investor consequence.",
    field_paths: ["/analysis_output/score_reason"],
    allowed_patch_paths: ["/analysis_output/score_reason"],
    candidate_source_block_ids: ["nvda_item_8_01"],
  },
  {
    code: "source_consistency_amount_mismatch",
    warning: "$26B source-consistency diagnostic retained for investigation.",
    field_paths: ["/analysis_output/summary"],
    allowed_patch_paths: ["/analysis_output/summary"],
    candidate_source_block_ids: ["nvda_item_8_01"],
  },
];

test("semantic findings remain full diagnostics while the Primary result stays identical", () => {
  const initial = {
    analysis_output: {
      event_type: "capital_return",
      score: 64,
      signal: "neutral",
      score_reason: "The score is 64 because the authorization is large.",
      monitor_routes: [{ monitor_analyzer_key: "corporate_action" }],
    },
  };
  const before = JSON.stringify(initial);

  const result = applySecPrimarySemanticValidationDisposition({
    family: "8-k-6-k",
    analysisResult: initial,
    issues: semanticIssues,
  });

  assert.strictEqual(result.analysisResult, initial);
  assert.equal(JSON.stringify(result.analysisResult), before);
  assert.equal(result.validationRepair.disposition, "semantic_diagnostic_only");
  assert.equal(result.validationRepair.repair_eligible, false);
  assert.equal(result.validationRepair.repair_strategy, "none");
  assert.equal(result.validationRepair.attempted, false);
  assert.deepEqual(result.validationRepair.issue_codes, [
    "score_rationale_meta_language",
    "source_consistency_amount_mismatch",
  ]);
  assert.deepEqual(result.validationRepair.allowed_patch_paths, []);
  assert.deepEqual(result.validationRepair.applied_patch_paths, []);
  assert.deepEqual(result.validationRepair.control_effects, {
    repair_llm: false,
    primary_output: false,
    routing: false,
    child_fanout: false,
    score_signal_event: false,
    completion: false,
  });
  assert.deepEqual(result.analysisResult.analysis_output.monitor_routes, [
    { monitor_analyzer_key: "corporate_action" },
  ]);
  assert.equal(result.analysisResult.analysis_output.score, 64);
  assert.equal(result.analysisResult.analysis_output.signal, "neutral");
  assert.equal(result.analysisResult.analysis_output.event_type, "capital_return");
});

test("multiple semantic warning descriptions survive into existing validation trace observability", () => {
  const initial = { analysis_output: { score: 64, signal: "neutral" } };
  const disposition = applySecPrimarySemanticValidationDisposition({
    family: "8-k-6-k",
    analysisResult: initial,
    issues: semanticIssues,
  });
  const trace = buildSecValidationRepairTrace({
    analysis: disposition.analysisResult,
    outputText: JSON.stringify(initial),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    model: "fixture-model",
    openAiResponseId: "primary-response",
    prompt: { key: "sec_8k_6k_analysis", version: "fixture" },
    validationRepair: disposition.validationRepair,
  });

  assert.equal(trace.attempted, false);
  assert.equal(trace.status, "not_attempted");
  assert.deepEqual(
    trace.warnings.map((warning) => [warning.code, warning.description]),
    semanticIssues.map((warning) => [warning.code, warning.warning]),
  );
  assert.deepEqual(trace.initial_analysis.parsed_result, trace.final_analysis);
  assert.deepEqual(trace.applied_changes, []);
  assert.equal(trace.repair_analysis, null);
});

test("only typed structural contract failures are repair-eligible", () => {
  const codes: SecPrimaryStructuralFailureCode[] = [
    "transport",
    "json_parse",
    "schema_type",
    "schema_required",
    "schema_enum",
    "schema_contract",
  ];
  for (const code of codes) {
    assert.deepEqual(classifySecPrimaryStructuralFailure(code), {
      disposition: "structural_repair_eligible",
      repair_eligible: true,
      repair_strategy: "existing_minimal_structural_path",
      structural_failure_code: code,
    });
    assert.deepEqual(buildSecPrimaryStructuralValidationDiagnostics({
      family: "424b",
      structuralFailureCode: code,
    }), {
      schema_version: 1,
      family: "424b",
      disposition: "structural_repair_eligible",
      repair_eligible: true,
      repair_strategy: "existing_minimal_structural_path",
      structural_failure_code: code,
      attempted: false,
    });
  }
});

test("production families use the disposition boundary and never invoke their semantic repair builders", () => {
  const preview = readFileSync(new URL("./secFilingAnalysisPreview.ts", import.meta.url), "utf8");
  const disposition = readFileSync(new URL("./secPrimaryValidationDisposition.ts", import.meta.url), "utf8");

  for (const family of ["8-k-6-k", "s-1-f-1", "s-3-f-3", "424b"]) {
    assert.match(preview, new RegExp(`family: \\"${family}\\"`));
  }
  assert.match(preview, /buildSecPrimaryStructuralValidationDiagnostics/);
  assert.doesNotMatch(
    preview,
    /buildSec(?:8k6k|S1F1|S3|424b)ValidationRepairPlan\s*\(/,
  );
  assert.doesNotMatch(
    preview,
    /applySec(?:8k6k|S1F1|S3|424b)ValidationRepairPatches\s*\(/,
  );
  assert.doesNotMatch(disposition, /(?:includes|match|test)\(\s*(?:issue\.)?warning/);
});
