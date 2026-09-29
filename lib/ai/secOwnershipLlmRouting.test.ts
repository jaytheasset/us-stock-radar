import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildOwnershipAnalysisInput,
  buildOwnershipAnalysisPrompt,
} from "../sources/sec/forms/ownership/analysisPrompt.ts";
import {
  buildOwnershipDisplayPayload,
  buildOwnershipRoutingDecision,
  parseOwnershipFiling,
} from "../sources/sec/forms/ownership/parser.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ownershipRoot = join(here, "../sources/sec/forms/ownership");

const cases = [
  { formType: "4", fixture: "form4-insider-purchase.json" },
  { formType: "4/A", fixture: "form4a-admin-amendment.json" },
  { formType: "144", fixture: "form144-routine-proposed-sale.json" },
  { formType: "144/A", fixture: "form144a-material-increase.json" },
] as const;

test("every Ownership form reaches one Gemini call with parser routing and display input preserved", async () => {
  const previewSource = readFileSync(join(here, "secFilingAnalysisPreview.ts"), "utf8");
  const runtimeSource = extractRuntimeFunction(previewSource);

  assert.equal(runtimeSource.includes("buildDeterministicOwnershipAnalysis(input)"), false);
  assert.ok(runtimeSource.includes("if (isOwnershipFilingInput(input))"));
  assert.ok(runtimeSource.includes("buildOwnershipOneCallPrompt(input, rawItem)"));
  assert.ok(runtimeSource.includes("runStructuredGeminiJson({"));

  const providerCalls: Array<{ formType: string; prompt: string }> = [];
  const runSecFilingAnalysisForRawRow = compileRuntimeFunction({
    providerCalls,
  });

  for (const item of cases) {
    const fixture = readFixture(item.fixture);
    const parserOutput = parseOwnershipFiling(fixture as never);
    const routing = buildOwnershipRoutingDecision(parserOutput);
    const displayPayload = buildOwnershipDisplayPayload(parserOutput);
    const analysisInput = buildOwnershipAnalysisInput(parserOutput);
    const input = {
      filing_package: {
        form_adapter: { analysisMode: "ownership_direct_analysis" },
        hard_parsers: { ownership: parserOutput },
      },
    };
    const rawItem = {
      id: `mock-${item.formType}`,
      formType: item.formType,
      input,
      parserOutput,
    };

    const result = await runSecFilingAnalysisForRawRow(rawItem);

    assert.equal(result.ok, true, item.formType);
    assert.equal(result.openAiResponseId, `mock-llm-${item.formType}`, item.formType);
    assert.equal(result.prompt.key, "sec_ownership_one_call", item.formType);
    assert.deepEqual(result.ownershipStructuredCandidate, { version: "ownership_context_selection_v1", rows: [] });
    assert.equal(result.analysis.event_title, `LLM title for ${item.formType}`, item.formType);
    assert.equal(result.analysis.summary, `LLM summary for ${item.formType}`, item.formType);
    assert.equal(result.analysis.score, 61, item.formType);
    assert.equal(result.analysis.signal, "neutral", item.formType);
    assert.strictEqual(result.input, input, item.formType);
    assert.strictEqual(
      result.input.filing_package.hard_parsers.ownership,
      parserOutput,
      item.formType,
    );
    assert.deepEqual(buildOwnershipRoutingDecision(parserOutput), routing, item.formType);
    assert.deepEqual(buildOwnershipDisplayPayload(parserOutput), displayPayload, item.formType);
    assert.deepEqual(buildOwnershipAnalysisInput(parserOutput), analysisInput, item.formType);
  }

  assert.deepEqual(
    providerCalls.map((call) => call.formType),
    cases.map((item) => item.formType),
  );
  for (const call of providerCalls) {
    assert.ok(call.prompt.startsWith("form_type:"));
  }
});

test("all Ownership forms require LLM execution in developer dry-run", async () => {
  const previewSource = readFileSync(join(here, "secFilingAnalysisPreview.ts"), "utf8");
  const parserSource = readFileSync(join(ownershipRoot, "parser.ts"), "utf8");
  const formAdapterSource = readFileSync(join(ownershipRoot, "adapter.ts"), "utf8");
  const analysisAdapterSource = readFileSync(join(here, "secOwnershipAnalysisAdapter.ts"), "utf8");
  const start = previewSource.indexOf("async function runSecFilingAnalysisWithoutLlmForRawRow(");
  const end = previewSource.indexOf("\nexport async function runSecFilingAnalysisForRawRow(", start);
  assert.ok(start >= 0 && end > start);

  const withoutLlmSource = previewSource.slice(start, end);
  assert.equal(withoutLlmSource.includes("buildDeterministicOwnershipAnalysis(input)"), false);
  assert.ok(withoutLlmSource.includes("LLM required but disabled for SEC analysis dry-run"));
  assert.ok(withoutLlmSource.includes("buildSecFilingPromptForInput(input, options)"));
  assert.equal(previewSource.includes("attachOwnershipArchiveContextGuardPreview"), false);
  assert.equal(parserSource.includes("buildDeterministicOwnershipResult"), false);
  assert.equal(formAdapterSource.includes("tryDeterministicResult"), false);
  assert.equal(formAdapterSource.includes("buildDeterministicResult"), false);
  assert.equal(analysisAdapterSource.includes("buildDeterministicOwnershipAnalysis"), false);

  const runWithoutLlm = compileWithoutLlmFunction(withoutLlmSource);
  for (const item of cases) {
    const fixture = readFixture(item.fixture);
    const parserOutput = parseOwnershipFiling(fixture as never);
    const input = {
      filing_package: {
        form_type: item.formType,
        form_adapter: { analysisMode: "ownership_direct_analysis" },
        hard_parsers: { ownership: parserOutput },
      },
    };
    const result = await runWithoutLlm({ id: `dry-run-${item.formType}` }, input);

    assert.equal(result.ok, false, item.formType);
    assert.equal(result.stage, "openai", item.formType);
    assert.equal(result.error, "LLM required but disabled for SEC analysis dry-run", item.formType);
    assert.equal(result.prompt.key, "sec_ownership_analysis", item.formType);
  }
});

function compileWithoutLlmFunction(withoutLlmSource: string) {
  const executableSource = stripTypeScriptTypes(withoutLlmSource, { mode: "transform" });
  const factory = new Function(
    "mocks",
    `const {
      isS3AmendmentInput,
      buildDeterministicEffectAnalysis,
      buildDeterministicSc13Analysis,
      buildDeterministicS8ArchiveAnalysis,
      buildSecFilingPromptForInput,
      summarizeRawRow
    } = mocks;
    ${executableSource}
    return runSecFilingAnalysisWithoutLlmForRawRow;`,
  );

  return factory({
    isS3AmendmentInput: () => false,
    buildDeterministicEffectAnalysis: () => null,
    buildDeterministicSc13Analysis: () => null,
    buildDeterministicS8ArchiveAnalysis: () => null,
    buildSecFilingPromptForInput: (input: Record<string, any>) => ({
      key: "sec_ownership_analysis",
      version: "v1",
      input,
    }),
    summarizeRawRow: (rawItem: { id: string }) => ({ id: rawItem.id }),
  }) as (rawItem: Record<string, unknown>, input: Record<string, unknown>) => Promise<Record<string, any>>;
}

function compileRuntimeFunction({
  providerCalls,
}: {
  providerCalls: Array<{ formType: string; prompt: string }>;
}) {
  const previewSource = readFileSync(join(here, "secFilingAnalysisPreview.ts"), "utf8");
  const runtimeSource = extractRuntimeFunction(previewSource).replace(
    "export async function runSecFilingAnalysisForRawRow",
    "async function runSecFilingAnalysisForRawRow",
  );
  const executableSource = stripTypeScriptTypes(runtimeSource, {
    mode: "transform",
  });
  const factory = new Function(
    "mocks",
    `const {
      buildInputFromSecRawRowWithParentContext,
      beginSecAnalysisSpan,
      traceSecAnalysis,
      stringValue,
      readRecord,
      readStringArray,
      secAnalysisErrorClass,
      attachSecMarketContext,
      attachOwnershipFilingContext,
      buildDeterministicEffectAnalysis,
      evaluateSecInvestableUniverse,
      buildDeterministicSc13Analysis,
      buildDeterministicS8ArchiveAnalysis,
      getServerEnv,
      resolveSecLlmConfig,
      isS3AmendmentInput,
      isOwnershipFilingInput,
      buildOwnershipOneCallPrompt,
      runStructuredGeminiJson,
      validateOwnershipOneCallOutput,
      OWNERSHIP_ONE_CALL_MODEL,
      OWNERSHIP_ONE_CALL_PROMPT_KEY,
      OWNERSHIP_ONE_CALL_PROMPT_VERSION,
      adaptOwnershipPromptResultForAnalysis,
      estimateCost,
      summarizeRawRow
    } = mocks;
    ${executableSource}
    return runSecFilingAnalysisForRawRow;`,
  );

  return factory({
    buildInputFromSecRawRowWithParentContext: async (rawItem: { input: unknown }) => rawItem.input,
    beginSecAnalysisSpan: () => () => undefined,
    traceSecAnalysis: () => undefined,
    stringValue: (value: unknown) => typeof value === "string" ? value.trim() : "",
    readRecord: (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null,
    readStringArray: (value: unknown) => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [],
    secAnalysisErrorClass: (error: unknown) => error instanceof Error ? error.name : "UnknownError",
    attachSecMarketContext: async () => undefined,
    attachOwnershipFilingContext: async () => undefined,
    buildDeterministicEffectAnalysis: () => null,
    evaluateSecInvestableUniverse: () => null,
    buildDeterministicSc13Analysis: () => null,
    buildDeterministicS8ArchiveAnalysis: () => null,
    getServerEnv: () => ({ openAiModel: "mock-model", geminiApiKey: "mock-key" }),
    resolveSecLlmConfig: () => ({
      provider: "openai",
      model: "mock-model",
      apiKey: "mock-key",
      apiKeyEnvName: "OPENAI_API_KEY",
    }),
    isS3AmendmentInput: () => false,
    isOwnershipFilingInput: () => true,
    buildOwnershipOneCallPrompt: (_input: Record<string, any>, rawItem: { formType: string }) => {
      const formType = rawItem.formType;
      return {
        prompt: { system: "mock system", user: `form_type:${formType}`, responseFormat: { json_schema: {} } },
        contextPromptSha256: "mock-context-hash",
      };
    },
    runStructuredGeminiJson: async ({ model, prompt, maxOutputTokens }: { model: string; prompt: { user: string }; maxOutputTokens: number }) => {
      assert.equal(model, "gemini-3.5-flash");
      assert.equal(maxOutputTokens, 12_000);
      const formType = prompt.user.replace("form_type:", "");
      assert.ok(formType);
      providerCalls.push({ formType, prompt: prompt.user });
      return {
        ok: true,
        responseOk: true,
        status: 200,
        responseId: `mock-llm-${formType}`,
        parsed: {
          primary: { analysis_output: {
            event_title: `LLM title for ${formType}`,
            summary: `LLM summary for ${formType}`,
            key_evidence: [`LLM evidence for ${formType}`],
            score: 61,
            signal: "neutral",
          } },
          structured: { version: "ownership_context_selection_v1", rows: [] },
        },
        outputText: "mocked ownership JSON",
        usage: null,
        body: null,
      };
    },
    validateOwnershipOneCallOutput: (value: Record<string, any>) => ({
      primary: value.primary, structured: value.structured, errors: [],
    }),
    OWNERSHIP_ONE_CALL_MODEL: "gemini-3.5-flash",
    OWNERSHIP_ONE_CALL_PROMPT_KEY: "sec_ownership_one_call",
    OWNERSHIP_ONE_CALL_PROMPT_VERSION: "ownership_one_call_reliability_date_v1",
    adaptOwnershipPromptResultForAnalysis: (value: Record<string, any>) => ({
      ok: true,
      analysis: value.analysis_output,
    }),
    estimateCost: () => null,
    summarizeRawRow: (rawItem: { id: string }) => ({ id: rawItem.id }),
  }) as (rawItem: Record<string, unknown>) => Promise<Record<string, any>>;
}

function extractRuntimeFunction(previewSource: string) {
  const start = previewSource.indexOf("export async function runSecFilingAnalysisForRawRow(");
  const end = previewSource.indexOf("\nfunction resolveSecLlmConfig(", start);
  assert.ok(start >= 0 && end > start);
  return previewSource.slice(start, end);
}

function readFixture(filename: string) {
  return JSON.parse(readFileSync(join(ownershipRoot, "fixtures", filename), "utf8")) as Record<string, unknown>;
}
