import assert from "node:assert/strict";
import test from "node:test";
import { getServerEnv } from "../env.ts";
import {
  runStructuredGeminiJson,
  type GeminiStructuredJsonRun,
} from "./geminiStructuredJson.ts";
import { runNewsGeminiPipeline } from "./newsGeminiPipeline.ts";

const prompt = {
  key: "test_prompt",
  version: "v1",
  system: "Return JSON.",
  user: "{}",
  responseFormat: {
    json_schema: {
      name: "test",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["route"],
        properties: {
          route: { type: "string" },
          nullable_value: { type: ["string", "null"] },
        },
      },
    },
  },
};

test("NEWS_GEMINI_MODEL defaults independently from the SEC Gemini model", () => {
  const previousNewsModel = process.env.NEWS_GEMINI_MODEL;
  const previousSecModel = process.env.GEMINI_MODEL;
  delete process.env.NEWS_GEMINI_MODEL;
  process.env.GEMINI_MODEL = "gemini-sec-only";

  try {
    const env = getServerEnv();
    assert.equal(env.newsGeminiModel, "gemini-2.5-flash-lite");
    assert.equal(env.geminiModel, "gemini-sec-only");
  } finally {
    restoreEnv("NEWS_GEMINI_MODEL", previousNewsModel);
    restoreEnv("GEMINI_MODEL", previousSecModel);
  }
});

test("Gemini structured JSON uses the selected model, schema, parsed output, and normalized usage", async () => {
  let requestUrl = "";
  let requestBody: Record<string, any> = {};
  const run = await runStructuredGeminiJson({
    apiKey: "test-key",
    model: "gemini-2.5-flash-lite",
    prompt,
    maxOutputTokens: 700,
    fetchImpl: (async (input, init) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body || "{}"));
      return new Response(
        JSON.stringify({
          responseId: "gemini-response-id",
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [{ text: '```json\n{"route":"company"}\n```' }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 11,
            candidatesTokenCount: 7,
            totalTokenCount: 18,
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });

  assert.match(requestUrl, /models\/gemini-2\.5-flash-lite:generateContent/);
  assert.match(requestUrl, /key=test-key/);
  assert.equal(requestBody?.generationConfig.maxOutputTokens, 700);
  assert.equal(requestBody?.generationConfig.responseMimeType, "application/json");
  assert.equal(requestBody?.generationConfig.thinkingConfig.thinkingBudget, 0);
  assert.equal(
    "additionalProperties" in requestBody?.generationConfig.responseSchema,
    false,
  );
  assert.deepEqual(
    requestBody?.generationConfig.responseSchema.properties.nullable_value,
    { type: "string", nullable: true },
  );
  assert.equal(run.ok, true);
  assert.equal(run.responseId, "gemini-response-id");
  assert.deepEqual(run.parsed, { route: "company" });
  assert.deepEqual(run.usage, {
    input_tokens: 11,
    output_tokens: 7,
    total_tokens: 18,
    promptTokenCount: 11,
    candidatesTokenCount: 7,
    totalTokenCount: 18,
  });
});

test("a first-pass skip never builds or calls the second pass", async () => {
  const calls: Array<{ model: string; maxOutputTokens: number }> = [];
  let secondPassBuilt = false;
  const result = await runNewsGeminiPipeline({
    apiKey: "test-key",
    model: "gemini-2.5-flash-lite",
    routePrompt: prompt,
    routeMaxOutputTokens: 700,
    analysisMaxOutputTokens: 6000,
    normalizeRoute: (value) =>
      value?.route === "skip" ? { route: "skip", reason: "not material" } : null,
    buildSecondPass: async () => {
      secondPassBuilt = true;
      return { input: {}, prompt };
    },
    normalizeAnalysis: (value) => value,
    runPrompt: async ({ model, maxOutputTokens }) => {
      calls.push({ model, maxOutputTokens });
      return successfulRun(model, { route: "skip" });
    },
  });

  assert.equal(result.stage, "skipped");
  assert.equal(secondPassBuilt, false);
  assert.deepEqual(calls, [
    { model: "gemini-2.5-flash-lite", maxOutputTokens: 700 },
  ]);
});

test("both news passes use Gemini 2.5 Flash-Lite", async () => {
  const calls: Array<{ model: string; maxOutputTokens: number }> = [];
  const result = await runNewsGeminiPipeline({
    apiKey: "test-key",
    model: "gemini-2.5-flash-lite",
    routePrompt: prompt,
    routeMaxOutputTokens: 700,
    analysisMaxOutputTokens: 6000,
    normalizeRoute: (value) =>
      value?.route === "company" ? { route: "company" } : null,
    buildSecondPass: async () => ({ input: { ticker: "ACME" }, prompt }),
    normalizeAnalysis: (value) => value,
    runPrompt: async ({ model, maxOutputTokens }) => {
      calls.push({ model, maxOutputTokens });
      return successfulRun(
        model,
        calls.length === 1 ? { route: "company" } : { score: 80 },
      );
    },
  });

  assert.equal(result.stage, "complete");
  assert.deepEqual(calls, [
    { model: "gemini-2.5-flash-lite", maxOutputTokens: 700 },
    { model: "gemini-2.5-flash-lite", maxOutputTokens: 6000 },
  ]);
});

function successfulRun(
  model: string,
  parsed: Record<string, unknown>,
): GeminiStructuredJsonRun {
  return {
    ok: true,
    responseOk: true,
    status: 200,
    statusText: "OK",
    model,
    responseId: "response-id",
    outputText: JSON.stringify(parsed),
    parsed,
    usage: null,
    body: null,
  };
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
