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
  fn("runGeminiJsonPrompt").getText(ast), fn("runGeminiJsonPromptModelSequence").getText(ast),
  `async function run(input, llmConfig) { const env = {}, rawItem = {}; ${branch.getText(ast)} }`,
].join("\n"), { mode: "transform" });

for (const provider of ["gemini", "openai"]) {
  for (const outcome of ["success", "repair", "repair-failure", "validation-failure", "invalid-json", "429", "network-error", "retry-success"]) {
    test(`S-4/F-4 ${provider}: restores pre-MCP policy for ${outcome}`, async () => {
      let calls = 0, waits = 0;
      const models: string[] = [];
      const parsed = { analysis_output: { summary: "$ ___", score: 68 }, display_payload: { data: { filing_summary: "" } } };
      const outputText = outcome === "invalid-json" ? "not json" : JSON.stringify(parsed);
      const dependencies = {
        SEC_LLM_MAX_ATTEMPTS: 3,
        isS4F4FilingInput: () => true,
        buildSecS4F4AnalysisPromptForInput: () => ({ key: "sec_s4_f4_analysis", version: "v1", system: "source", user: "source",
          responseFormat: { json_schema: {} } }),
        adaptSecS4F4AnalysisPromptResultForAnalysis: (value: unknown) => {
          assert.deepEqual(value, parsed);
          return outcome === "validation-failure" ? { ok: false, error: "Invalid structure" } : { ok: true, analysis: value };
        },
        summarizeRawRow: () => ({}), estimateCost: () => null,
        combineUsage: () => null,
        buildSecS4F4ValidationRepairPlan: () => outcome.startsWith("repair") ? {
          prompt: { key: "sec_s4_f4_validation_repair", version: "v1", system: "repair", user: "source", responseFormat: { json_schema: {} } },
          issues: [{code:"missing_filing_summary"}], sourceBlockIds: ["original"], allowedPatchPaths: ["/display_payload/data/filing_summary"],
        } : null,
        applySecS4F4ValidationRepairPatches: () => ({value:parsed,appliedPaths:[],ignoredPaths:[],unresolved:[]}),
        buildGeminiGenerateContentUrl: (config: {model:string}) => `https://provider.invalid/${config.model}`,
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
        fetch: async (url: string, init: {body:string}) => {
          calls++;
          models.push(provider === "gemini" ? url.split("/").at(-1)! : JSON.parse(init.body).model);
          if (outcome === "network-error") throw new Error("mock network failure");
          const limited = outcome === "429" || (outcome === "retry-success" && calls < 3)
            || (outcome === "repair-failure" && calls === 2);
          return { ok: !limited, status: limited ? 429 : 200, statusText: "mock",
            json: async () => ({ outputText, error: limited ? { message: "rate limited" } : undefined }) };
        },
      };
      const run = new Function(...Object.keys(dependencies), `${executable}; return run;`)(...Object.values(dependencies));
      const result = await run({}, { provider, model: "test-primary", fallbackModel: "test-fallback", apiKey: "mock" });
      const retries = ["invalid-json", "429", "network-error", "retry-success"].includes(outcome);
      assert.equal(calls, retries ? 3 : outcome.startsWith("repair") ? 2 : 1);
      assert.equal(waits, retries ? 2 : 0);
      assert.equal(result.ok, ["success", "repair", "repair-failure", "retry-success"].includes(outcome));
      if (retries && provider === "gemini") assert.deepEqual(models,["test-primary","test-primary","test-fallback"]);
      if (outcome.startsWith("repair")) {
        assert.equal(result.validationRepair.attempted,true);
        assert.equal(result.validationRepair.succeeded,outcome === "repair");
        assert.equal(models[1],"test-primary", "repair remains one bounded attempt, no fallback");
      }
    });
  }
}
