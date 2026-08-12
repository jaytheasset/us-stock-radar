import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getServerEnv } from "../env.ts";
import {
  LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS,
  MONITOR_ROUTING_RESULT_JSON_SCHEMA,
  validateMonitorRoutingResult,
} from "../monitor/monitorRouting.ts";
import {
  runStructuredGeminiJson,
  type GeminiStructuredJsonRun,
} from "./geminiStructuredJson.ts";
import { sanitizeNasdaqCorporateActionAnalysis } from "./nasdaqCorporateActionAnalysis.ts";
import {
  normalizeNewsPrimaryMonitorRouting,
  runNewsGeminiAnalysis,
} from "./newsGeminiAnalysis.ts";

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

test("a dedicated caller may opt into a root plain-string response schema without changing news defaults", async () => {
  let requestBody: Record<string, any> = {};
  const responseSchema = {
    type: "object",
    required: ["offering_monitor_payload"],
    properties: { offering_monitor_payload: { type: "string" } },
  };
  await runStructuredGeminiJson({
    apiKey: "test-key",
    model: "gemini-2.5-flash",
    prompt,
    maxOutputTokens: 1000,
    responseSchema,
    fetchImpl: (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body || "{}"));
      return new Response(JSON.stringify({
        candidates: [{ finishReason: "STOP", content: { parts: [{ text: '{"offering_monitor_payload":"{}"}' }] } }],
      }), { status: 200 });
    }) as typeof fetch,
  });

  assert.deepEqual(requestBody.generationConfig.responseSchema, responseSchema);
  assert.equal(requestBody.generationConfig.temperature, 0);
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

test("general news prompt requires source-backed directional points without manufacturing both sides", () => {
  const promptSource = readFileSync(
    new URL("../prompts/newsEventAnalysis.ts", import.meta.url),
    "utf8",
  );

  assert.match(promptSource, /NEWS_EVENT_ANALYSIS_PROMPT_VERSION = "v27-monitor-routing"/);
  assert.match(promptSource, /distinct directional facts explicitly source-backed by the article body/);
  assert.match(promptSource, /use fewer items or an empty array \[\]/);
  assert.match(promptSource, /Empty arrays are normal and expected/);
  assert.match(promptSource, /Do not manufacture both bullish_points and bearish_points/);
  assert.match(promptSource, /For a bullish signal[\s\S]*?otherwise use bearish_points: \[\]/);
  assert.match(promptSource, /For a bearish signal[\s\S]*?otherwise use bullish_points: \[\]/);
  assert.match(promptSource, /For volatile or mixed developments[\s\S]*?source-backed facts on both sides/);
  assert.match(promptSource, /neutral, administrative, or mechanical news[\s\S]*?arrays may naturally be empty/);
  assert.match(
    promptSource,
    /Do not unnecessarily repeat the same fact across bullish_points, bearish_points, summary, why_it_matters, and key_evidence/,
  );
  assert.match(
    promptSource,
    /required: \[[\s\S]*?"bullish_points",[\s\S]*?"bearish_points",/,
  );
  assert.match(promptSource, /Required key; use an empty array when no source-backed bullish fact exists/);
  assert.match(promptSource, /Required key; use an empty array when no source-backed bearish fact exists/);
});

test("News and Nasdaq Primary schemas reuse the Generic Monitor routing contract", () => {
  const newsPromptSource = readFileSync(new URL("../prompts/newsEventAnalysis.ts", import.meta.url), "utf8");
  const nasdaqPromptSource = readFileSync(
    new URL("../prompts/nasdaqCorporateActionAnalysis.ts", import.meta.url),
    "utf8",
  );

  assert.match(newsPromptSource, /NEWS_EVENT_ANALYSIS_PROMPT_VERSION = "v27-monitor-routing"/);
  assert.match(nasdaqPromptSource, /NASDAQ_CORPORATE_ACTION_ANALYSIS_PROMPT_VERSION = "v7-monitor-routing"/);
  assert.match(newsPromptSource, /required: \[[\s\S]*?"event_type",\s*"monitor_routes",/);
  assert.match(
    newsPromptSource,
    /monitor_routes: MONITOR_ROUTING_RESULT_JSON_SCHEMA\.properties\.monitor_routes/,
  );
  assert.match(nasdaqPromptSource, /output_contract: newsEventAnalysisResponseSchema/);
  assert.deepEqual(
    MONITOR_ROUTING_RESULT_JSON_SCHEMA.properties.monitor_routes.items.properties.monitor_analyzer_key.enum,
    ["listing_risk"],
  );
});

test("News Primary keeps valid empty/listing routes and does not map event_type into routes", () => {
  const noRoute = normalizeNewsPrimaryMonitorRouting({
    event_type: "listing_risk",
    score: 55,
    monitor_routes: [],
  });
  const listingRoute = normalizeNewsPrimaryMonitorRouting({
    event_type: "strategic_transaction",
    score: 80,
    monitor_routes: [{ monitor_analyzer_key: "listing_risk" }],
  });

  assert.deepEqual(noRoute.monitor_routes, []);
  assert.equal(noRoute.event_type, "listing_risk");
  assert.deepEqual(listingRoute.monitor_routes, [{ monitor_analyzer_key: "listing_risk" }]);
  assert.equal(listingRoute.event_type, "strategic_transaction");
});

test("News and Nasdaq reject invalid or duplicate routes without blocking existing Primary fields", () => {
  const invalidRoutes = [
    [{ monitor_analyzer_key: "financial_risk" }],
    [
      { monitor_analyzer_key: "listing_risk" },
      { monitor_analyzer_key: "listing_risk" },
    ],
  ];

  for (const monitor_routes of invalidRoutes) {
    assert.notDeepEqual(validateMonitorRoutingResult({ monitor_routes }), []);

    const news = normalizeNewsPrimaryMonitorRouting({
      event_type: "listing_risk",
      score: 61,
      summary: "Existing News Primary publication remains available.",
      monitor_routes,
    });
    const nasdaq = sanitizeNasdaqCorporateActionAnalysis({
      event_type: "listing_risk",
      score: 62,
      summary: "Existing Nasdaq Primary publication remains available.",
      monitor_routes,
    });

    assert.equal(news.score, 61);
    assert.equal(Object.hasOwn(news, "monitor_routes"), false);
    assert.equal(nasdaq.score, 62);
    assert.equal(Object.hasOwn(nasdaq, "monitor_routes"), false);
  }
});

test("News, Nasdaq, and SEC-oriented routing instructions are semantic rather than automatic mappings", () => {
  const newsPromptSource = readFileSync(new URL("../prompts/newsEventAnalysis.ts", import.meta.url), "utf8");
  const nasdaqPromptSource = readFileSync(
    new URL("../prompts/nasdaqCorporateActionAnalysis.ts", import.meta.url),
    "utf8",
  );

  assert.match(LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS, /regained compliance/i);
  assert.match(LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS, /procedural listing actions/i);
  assert.match(
    LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS,
    /simple reverse split without explicit listing or compliance context/i,
  );
  assert.match(LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS, /Do not derive monitor_routes from event_type/i);
  assert.match(newsPromptSource, /LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS/);
  assert.match(nasdaqPromptSource, /LISTING_RISK_MONITOR_ROUTING_PROMPT_INSTRUCTIONS/);
  assert.match(
    nasdaqPromptSource,
    /simple reverse split may retain its existing event_type while monitor_routes is \[\]/i,
  );
});

test("single-pass news analysis preserves source-backed directional array shapes", async () => {
  const examples = [
    {
      name: "bullish-only",
      analysis: {
        signal: "bullish",
        bullish_points: ["Contract adds $40 million of committed revenue"],
        bearish_points: [],
      },
    },
    {
      name: "bearish-only",
      analysis: {
        signal: "bearish",
        bullish_points: [],
        bearish_points: ["Guidance was cut below the prior range"],
      },
    },
    {
      name: "volatile-with-both-sides",
      analysis: {
        signal: "volatile",
        bullish_points: ["Trial met its primary efficacy endpoint"],
        bearish_points: ["Serious adverse events exceeded the control arm"],
      },
    },
  ] as const;

  for (const example of examples) {
    const result = await runNewsGeminiAnalysis({
      apiKey: "test-key",
      model: "gemini-2.5-flash-lite",
      prompt,
      input: {},
      maxOutputTokens: 6000,
      normalizeAnalysis: (value) => value,
      runPrompt: async ({ model }) => successfulRun(model, { ...example.analysis }),
    });

    assert.equal(result.stage, "complete", example.name);
    assert.deepEqual(result.analysis, example.analysis, example.name);
  }
});

test("Nasdaq Corporate Actions uses the shared single-call Flash-Lite path without OpenAI", () => {
  const previewSource = readFileSync(
    new URL("./nasdaqCorporateActionAnalysisPreview.ts", import.meta.url),
    "utf8",
  );
  const promptSource = readFileSync(
    new URL("../prompts/nasdaqCorporateActionAnalysis.ts", import.meta.url),
    "utf8",
  );

  assert.equal(
    previewSource.match(/runNewsGeminiAnalysis\(\{/g)?.length,
    1,
  );
  assert.match(previewSource, /model = env\.newsGeminiModel/);
  assert.match(previewSource, /apiKey: env\.geminiApiKey/);
  assert.doesNotMatch(
    previewSource,
    /env\.openAi|OPENAI_API_KEY|OPENAI_MODEL|api\.openai\.com|runStructuredOpenAiJson/,
  );
  assert.match(promptSource, /output_contract: newsEventAnalysisResponseSchema/);
});

test("only nasdaq_corporate_actions routes to the dedicated analysis prompt", () => {
  const ingestSource = readFileSync(
    new URL("../newsIngest.ts", import.meta.url),
    "utf8",
  );
  const routeStart = ingestSource.indexOf("function runNewsAnalysisForRawItem(");
  const routeEnd = ingestSource.indexOf("async function runNewsIngestForSource", routeStart);
  const routeSource = ingestSource.slice(routeStart, routeEnd);

  assert.ok(routeStart >= 0 && routeEnd > routeStart);
  assert.match(
    routeSource,
    /if \(rawItem\.source_code === "nasdaq_corporate_actions"\)[\s\S]*?return runNasdaqCorporateActionAnalysisForRawItem/,
  );
  assert.match(routeSource, /return runNewsEventAnalysisForRawItem\(rawItem, options\);/);
  assert.equal(routeSource.match(/rawItem\.source_code ===/g)?.length, 1);
  assert.doesNotMatch(
    routeSource,
    /rawItem\.source_code === "(?!nasdaq_corporate_actions")[^"]+"/,
  );
});

test("Nasdaq Corporate Actions preserves analysis fields while removing CUSIP administration", () => {
  const analysis = sanitizeNasdaqCorporateActionAnalysis({
    score: 62,
    signal: "volatile",
    quick_take: "Trading terms changed. CUSIP 123456789 was assigned.",
    summary: "The merger closed. The new CUSIP is an administrative identifier.",
    why_it_matters: "Holders face a forced conversion.",
    score_reason: "CUSIP update and conversion mechanics.",
    bullish_points: ["Defined cash consideration"],
    bearish_points: ["CUSIP processing may take time", "Trading liquidity may be interrupted"],
    key_evidence: ["CUSIP 123456789", "Conversion becomes effective Monday"],
    what_to_watch_next: ["Settlement timing"],
  });

  assert.equal(analysis.score, 62);
  assert.equal(analysis.signal, "volatile");
  assert.equal(analysis.quick_take, "Trading terms changed.");
  assert.equal(analysis.summary, "The merger closed.");
  assert.equal(analysis.why_it_matters, "Holders face a forced conversion.");
  assert.equal(analysis.score_reason, "");
  assert.deepEqual(analysis.bullish_points, ["Defined cash consideration"]);
  assert.deepEqual(analysis.bearish_points, ["Trading liquidity may be interrupted"]);
  assert.deepEqual(analysis.key_evidence, ["Conversion becomes effective Monday"]);
  assert.deepEqual(analysis.what_to_watch_next, ["Settlement timing"]);
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
