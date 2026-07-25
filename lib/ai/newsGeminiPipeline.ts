import {
  runStructuredGeminiJson,
  type GeminiStructuredJsonRun,
  type StructuredJsonPrompt,
} from "./geminiStructuredJson.ts";

type RouteDecision = {
  route: string;
};

export type NewsGeminiPipelineResult<Route extends RouteDecision, Analysis, Input> =
  | {
      stage: "route_error";
      routeRun: GeminiStructuredJsonRun;
      routeClassification: null;
      error: string;
    }
  | {
      stage: "skipped";
      routeRun: GeminiStructuredJsonRun;
      routeClassification: Route;
    }
  | {
      stage: "analysis_error";
      routeRun: GeminiStructuredJsonRun;
      routeClassification: Route;
      analysisRun: GeminiStructuredJsonRun;
      input: Input;
      prompt: StructuredJsonPrompt & { key: string; version: string };
      error: string;
    }
  | {
      stage: "complete";
      routeRun: GeminiStructuredJsonRun;
      routeClassification: Route;
      analysisRun: GeminiStructuredJsonRun;
      input: Input;
      prompt: StructuredJsonPrompt & { key: string; version: string };
      analysis: Analysis;
    };

export async function runNewsGeminiPipeline<Route extends RouteDecision, Analysis, Input>({
  apiKey,
  model,
  routePrompt,
  routeMaxOutputTokens,
  analysisMaxOutputTokens,
  normalizeRoute,
  buildSecondPass,
  normalizeAnalysis,
  runPrompt = runStructuredGeminiJson,
}: {
  apiKey: string;
  model: string;
  routePrompt: StructuredJsonPrompt & { key: string; version: string };
  routeMaxOutputTokens: number;
  analysisMaxOutputTokens: number;
  normalizeRoute: (value: Record<string, unknown> | null) => Route | null;
  buildSecondPass: (
    route: Route,
  ) => Promise<{
    input: Input;
    prompt: StructuredJsonPrompt & { key: string; version: string };
  }>;
  normalizeAnalysis: (value: Record<string, unknown> | null, input: Input) => Analysis | null;
  runPrompt?: typeof runStructuredGeminiJson;
}): Promise<NewsGeminiPipelineResult<Route, Analysis, Input>> {
  const run = (prompt: StructuredJsonPrompt, maxOutputTokens: number) =>
    runPrompt({ apiKey, model, prompt, maxOutputTokens });

  let routeRun = await run(routePrompt, routeMaxOutputTokens);
  if (!routeRun.responseOk) {
    return {
      stage: "route_error",
      routeRun,
      routeClassification: null,
      error: routeRun.error || "Gemini route classification request failed",
    };
  }

  let routeClassification = normalizeRoute(routeRun.parsed);
  if (!routeClassification) {
    const retryRun = await run(routePrompt, routeMaxOutputTokens);
    const retryClassification = retryRun.responseOk ? normalizeRoute(retryRun.parsed) : null;
    if (retryClassification) {
      routeRun = retryRun;
      routeClassification = retryClassification;
    }
  }

  if (!routeClassification) {
    return {
      stage: "route_error",
      routeRun,
      routeClassification: null,
      error: routeRun.error || "Gemini route classification did not contain parseable JSON",
    };
  }

  if (routeClassification.route === "skip") {
    return {
      stage: "skipped",
      routeRun,
      routeClassification,
    };
  }

  const { input, prompt } = await buildSecondPass(routeClassification);
  const analysisRun = await run(prompt, analysisMaxOutputTokens);
  if (!analysisRun.responseOk) {
    return {
      stage: "analysis_error",
      routeRun,
      routeClassification,
      analysisRun,
      input,
      prompt,
      error: analysisRun.error || "Gemini news analysis request failed",
    };
  }

  const analysis = normalizeAnalysis(analysisRun.parsed, input);
  if (!analysis) {
    return {
      stage: "analysis_error",
      routeRun,
      routeClassification,
      analysisRun,
      input,
      prompt,
      error: analysisRun.error || "Gemini response did not contain parseable JSON",
    };
  }

  return {
    stage: "complete",
    routeRun,
    routeClassification,
    analysisRun,
    input,
    prompt,
    analysis,
  };
}
