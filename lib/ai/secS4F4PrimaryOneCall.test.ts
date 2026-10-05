import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import ts from "typescript";

// Execute the real S-4/F-4 branch and both provider retry loops with only IO/helper
// dependencies substituted. No environment, DB, provider credential or network access.
const source = readFileSync(new URL("./secFilingAnalysisPreview.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("preview.ts", source, ts.ScriptTarget.Latest, true);
function fn(name: string) {
  const node = ast.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
  assert.ok(node && ts.isFunctionDeclaration(node));
  return node;
}
const branch = fn("runSecFilingAnalysisForRawRow").body!.statements.find((s) =>
  ts.isIfStatement(s) && s.expression.getText(ast) === "isS4F4FilingInput(input)");
assert.ok(branch);
const executable = stripTypeScriptTypes([
  fn("runOpenAiJsonPrompt").getText(ast), fn("runGeminiJsonPromptAttempts").getText(ast),
  `async function run(input, llmConfig) { const env = {}, rawItem = {}; ${branch.getText(ast)} }`,
].join("\n"), { mode: "transform" });

for (const provider of ["gemini", "openai"]) {
  for (const outcome of ["success", "validation-failure", "invalid-json", "429", "network-error"]) {
    test(`S-4/F-4 ${provider}: ${outcome} ends after exactly one provider attempt`, async () => {
      let calls = 0, waits = 0;
      const parsed = { analysis_output: { summary: "$ ___", score: 68 }, display_payload: { data: { filing_summary: "" } } };
      const outputText = outcome === "invalid-json" ? "not json" : JSON.stringify(parsed);
      const dependencies = {
        SEC_LLM_MAX_ATTEMPTS: 3,
        isS4F4FilingInput: () => true,
        buildSecS4F4AnalysisPromptForInput: () => ({ key: "sec_s4_f4_analysis", version: "v1", system: "source", user: "source",
          responseFormat: { json_schema: {} } }),
        adaptSecS4F4AnalysisPromptResultForAnalysis: (value: unknown) => {
          assert.deepEqual(value, parsed, "Primary result must not be repaired");
          return outcome === "validation-failure" ? { ok: false, error: "Invalid structure" } : { ok: true, analysis: value };
        },
        summarizeRawRow: () => ({}), estimateCost: () => null,
        buildGeminiGenerateContentUrl: () => "https://provider.invalid",
        readSecProviderPhase: () => "primary", readSecProviderAttemptStages: () => ({}),
        readGeminiResponseSchema: () => ({}), readMaxOutputTokens: () => 5000, readGeminiThinkingConfig: () => ({}),
        beginSecAnalysisSpan: () => () => {}, traceSecAnalysis: () => {},
        readResponseOutputText: (body: { outputText: string }) => body.outputText,
        readGeminiResponseOutputText: (body: { outputText: string }) => body.outputText,
        readGeminiFinishReason: () => "STOP", readSecLlmSafetyStopReason: () => "",
        parseAnalysisJson: (value: string) => { try { return JSON.parse(value); } catch { return null; } },
        normalizeGeminiUsage: () => null, shouldRetryOpenAiRun: () => true,
        readSecProviderErrorClass: () => "test-error", secAnalysisErrorClass: () => "test-error",
        waitForRetry: async () => { waits++; },
        runGeminiJsonPrompt: () => { throw new Error("Unbounded/fallback path forbidden"); },
        fetch: async () => {
          calls++;
          if (outcome === "network-error") throw new Error("mock network failure");
          return { ok: outcome !== "429", status: outcome === "429" ? 429 : 200, statusText: "mock",
            json: async () => ({ outputText, error: outcome === "429" ? { message: "rate limited" } : undefined }) };
        },
      };
      const run = new Function(...Object.keys(dependencies), `${executable}; return run;`)(...Object.values(dependencies));
      const result = await run({}, { provider, model: "test-primary", fallbackModel: "forbidden-fallback", apiKey: "mock" });
      assert.equal(calls, 1);
      assert.equal(waits, 0);
      assert.equal(result.ok, outcome === "success");
      assert.ok(!result.validationRepair && !result.repairOutputText && !result.prompt.repair);
    });
  }
}
