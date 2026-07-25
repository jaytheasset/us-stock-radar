import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getServerEnv } from "../env.ts";
import {
  runStructuredGeminiJson,
  type GeminiStructuredJsonRun,
} from "./geminiStructuredJson.ts";
import { runNewsGeminiAnalysis } from "./newsGeminiAnalysis.ts";

const prompt = {
  key: "news_event_analysis",
  version: "test",
  system: "Return the complete normalized news JSON.",
  user: JSON.stringify({
    title: "ACME announces a material contract",
    output_contract: {
      type: "object",
      required: ["score", "primary_ticker"],
    },
  }),
  responseFormat: {
    json_schema: {
      name: "news_event_analysis",
      strict: true,
      schema: {
        type: "object",
        required: ["score", "primary_ticker"],
        properties: {
          score: { type: "integer" },
          primary_ticker: { type: "object" },
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

test("single news analysis call uses Flash-Lite, omits provider schema, and returns normalized output", async () => {
  const calls: Array<{
    model: string;
    maxOutputTokens: number;
  }> = [];
  const result = await runNewsGeminiAnalysis({
    apiKey: "test-key",
    model: "gemini-2.5-flash-lite",
    prompt,
    input: { source: "test" },
    maxOutputTokens: 6000,
    normalizeAnalysis: (value) =>
      value
        ? {
            ...value,
            primary_ticker: {
              ticker: String((value.primary_ticker as Record<string, unknown>)?.ticker || "")
                .trim()
                .toUpperCase(),
              exchange: null,
            },
          }
        : null,
    runPrompt: async ({ model, maxOutputTokens }) => {
      calls.push({ model, maxOutputTokens });
      return successfulRun(model, {
        score: 80,
        primary_ticker: { ticker: "acme" },
      });
    },
  });

  assert.equal(result.stage, "complete");
  assert.deepEqual(calls, [
    {
      model: "gemini-2.5-flash-lite",
      maxOutputTokens: 6000,
    },
  ]);
  assert.deepEqual(result.analysis, {
    score: 80,
    primary_ticker: { ticker: "ACME", exchange: null },
  });
});

test("malformed detail output is not retried", async () => {
  let callCount = 0;
  const result = await runNewsGeminiAnalysis({
    apiKey: "test-key",
    model: "gemini-2.5-flash-lite",
    prompt,
    input: {},
    maxOutputTokens: 6000,
    normalizeAnalysis: () => null,
    runPrompt: async ({ model }) => {
      callCount += 1;
      return {
        ...successfulRun(model, {}),
        ok: false,
        parsed: null,
        error: "Gemini response did not contain parseable JSON",
      };
    },
  });

  assert.equal(result.stage, "analysis_error");
  assert.equal(callCount, 1);
});

test("Gemini request keeps JSON mode but omits responseSchema from generationConfig", async () => {
  let requestBody: Record<string, any> = {};
  const run = await runStructuredGeminiJson({
    apiKey: "test-key",
    model: "gemini-2.5-flash-lite",
    prompt,
    maxOutputTokens: 6000,
    fetchImpl: (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body || "{}"));
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: {
                parts: [{ text: '{"score":80,"primary_ticker":{"ticker":"ACME"}}' }],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch,
  });

  assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
  assert.equal("responseSchema" in requestBody.generationConfig, false);
  assert.deepEqual(run.parsed, {
    score: 80,
    primary_ticker: { ticker: "ACME" },
  });
});

test("parser and deterministic prefilters exit before the news LLM call", () => {
  const ingestSource = readFileSync(
    new URL("../newsIngest.ts", import.meta.url),
    "utf8",
  );
  const prefilterIndex = ingestSource.indexOf(
    "const rawSkipDecision = readRawItemPrefilterSkipDecision(rawItem);",
  );
  const deterministicIndex = ingestSource.indexOf(
    "const deterministicArchive = buildDeterministicArchiveAnalysis(rawItem);",
  );
  const llmIndex = ingestSource.indexOf(
    "const analysisRun = await runNewsAnalysisForRawItem(rawItem",
  );

  assert.ok(prefilterIndex >= 0 && prefilterIndex < deterministicIndex);
  assert.ok(deterministicIndex < llmIndex);
  assert.match(
    ingestSource.slice(prefilterIndex, deterministicIndex),
    /if \(rawSkipDecision\)[\s\S]*?continue;/,
  );
  assert.match(
    ingestSource.slice(deterministicIndex, llmIndex),
    /if \(deterministicArchive\)[\s\S]*?continue;/,
  );
});

test("news runtime wires the existing final normalizer into the single Gemini analysis", () => {
  const previewSource = readFileSync(
    new URL("./newsEventAnalysisPreview.ts", import.meta.url),
    "utf8",
  );

  assert.equal(
    previewSource.match(/runNewsGeminiAnalysis\(\{/g)?.length,
    1,
  );
  assert.match(
    previewSource,
    /runNewsGeminiAnalysis\(\{[\s\S]*?normalizeAnalysis: normalizeNewsAnalysis,[\s\S]*?\}\);/,
  );
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
