import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildSecValidationRepairTrace } from "../secValidationRepairTrace.ts";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), "utf8");

test("records a successful repair with full warnings, prompt, results, and applied before/after values", () => {
  const trace = buildSecValidationRepairTrace({
    analysis: { score: 61, quick_take: "Repaired take" },
    outputText: JSON.stringify({ score: 48, quick_take: "Initial take" }),
    repairOutputText: JSON.stringify({
      patches: [
        { path: "/score", replacement: 61 },
        { path: "/quick_take", replacement: "Repaired take" },
      ],
      unresolved: [],
    }),
    usage: { input_tokens: 130, output_tokens: 60, total_tokens: 190 },
    repairUsage: { input_tokens: 30, output_tokens: 20, total_tokens: 50 },
    model: "test-model",
    openAiResponseId: "first-response",
    repairOpenAiResponseId: "repair-response",
    prompt: {
      repair: {
        key: "sec_periodic_reports_validation_repair",
        version: "test-version",
        system: "Repair system prompt",
        user: JSON.stringify({
          validator_issues: [
            { code: "score_warning", warning: "Score conflicts with source-backed severity." },
          ],
          selected_original_source_blocks: [
            { block_id: "annual-performance", text: "Safe selected source text" },
          ],
        }),
        responseFormat: { json_schema: { name: "repair" } },
      },
    },
    validationRepair: {
      attempted: true,
      succeeded: true,
      issue_codes: ["score_warning"],
      source_block_ids: ["annual-performance"],
      applied_patch_paths: ["/score", "/quick_take"],
      ignored_patch_paths: [],
      unresolved: [],
    },
  });

  assert.equal(trace.status, "succeeded");
  assert.deepEqual(trace.warnings.map((warning) => [warning.code, warning.description]), [
    ["score_warning", "Score conflicts with source-backed severity."],
  ]);
  assert.equal(trace.repair_prompt?.user?.includes("selected_original_source_blocks"), true);
  assert.deepEqual(trace.initial_analysis.parsed_result, { score: 48, quick_take: "Initial take" });
  assert.equal(trace.repair_analysis?.parsed_result?.patches instanceof Array, true);
  assert.deepEqual(trace.applied_changes, [
    { path: "/score", before: 48, after: 61, before_present: true, after_present: true },
    {
      path: "/quick_take",
      before: "Initial take",
      after: "Repaired take",
      before_present: true,
      after_present: true,
    },
  ]);
  assert.equal(trace.source_selection.source_block_ids[0], "annual-performance");
  assert.deepEqual(trace.initial_analysis.usage, {
    input_tokens: 100,
    output_tokens: 40,
    total_tokens: 140,
  });
});

test("records an explicit no-repair result for new runs", () => {
  const trace = buildSecValidationRepairTrace({
    analysis: { score: 50 },
    outputText: "{\"score\":50}",
    usage: null,
    model: "test-model",
    openAiResponseId: null,
    prompt: { key: "analysis", version: "v1" },
    validationRepair: { attempted: false },
  });

  assert.equal(trace.attempted, false);
  assert.equal(trace.status, "not_attempted");
  assert.equal(trace.repair_analysis, null);
});

test("records a failed repair without inventing applied changes", () => {
  const trace = buildSecValidationRepairTrace({
    analysis: { score: 50 },
    outputText: "{\"score\":50}",
    repairOutputText: "",
    usage: { total_tokens: 100 },
    repairUsage: null,
    model: "test-model",
    openAiResponseId: "first-response",
    prompt: {
      repair: {
        key: "repair",
        version: "v1",
        system: "system",
        user: JSON.stringify({ validator_issues: [{ code: "warning", warning: "Human-readable warning" }] }),
      },
    },
    validationRepair: {
      attempted: true,
      succeeded: false,
      issue_codes: ["warning"],
      applied_patch_paths: [],
      error: "provider rejected repair output",
    },
  });

  assert.equal(trace.status, "failed");
  assert.equal(trace.error_summary, "provider rejected repair output");
  assert.deepEqual(trace.applied_changes, []);
  assert.equal(trace.warnings[0]?.description, "Human-readable warning");
});

test("SEC debug pages and APIs require administrator permissions", () => {
  const page = read("app/development/sec/page.tsx");
  const issuesPage = read("app/development/sec/issues/page.tsx");
  const readApi = read("app/api/development/sec-form-room/route.ts");
  const liveApi = read("app/api/development/sec-live/route.ts");
  const testsApi = read("app/api/development/sec-tests/route.ts");
  const client = read("app/development/sec/SecDevelopmentClient.tsx");

  assert.match(page, /requireAdminPermission\("system\.read"\)/);
  assert.match(issuesPage, /requireAdminPermission\("system\.read"\)/);
  assert.match(readApi, /respondWithAdminReadAccess\(request, "system\.read"/);
  assert.match(readApi, /process\.env\.NODE_ENV === "production"/);
  assert.doesNotMatch(readApi, /export async function POST/);
  assert.match(readApi, /view !== "detail" && view !== "diagnostics"/);
  assert.match(readApi, /parseSecDiagnosticFilters/);
  assert.match(readApi, /getSecDevRoomDiagnostics/);
  assert.match(readApi, /DIAGNOSTIC_QUERY_KEYS/);
  assert.match(liveApi, /respondWithAdminReadAccess\(request, "data\.run"/);
  assert.match(testsApi, /respondWithAdminReadAccess\(request, "data\.run"/);
  assert.match(client, /교정 없음/);
  assert.match(client, /과거 실행이라 세부 교정 기록 없음/);
});
