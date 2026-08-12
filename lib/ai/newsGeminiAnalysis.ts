import {
  runStructuredGeminiJson,
  type GeminiStructuredJsonRun,
  type StructuredJsonPrompt,
} from "./geminiStructuredJson.ts";
import { readMonitorRoutingResultFromPrimaryOutput } from "../monitor/monitorRouting.ts";

export type NewsGeminiAnalysisResult<Analysis> =
  | {
      stage: "analysis_error";
      run: GeminiStructuredJsonRun;
      analysis: null;
      error: string;
    }
  | {
      stage: "complete";
      run: GeminiStructuredJsonRun;
      analysis: Analysis;
    };

export async function runNewsGeminiAnalysis<Analysis, Input>({
  apiKey,
  model,
  prompt,
  input,
  maxOutputTokens,
  normalizeAnalysis,
  runPrompt = runStructuredGeminiJson,
}: {
  apiKey: string;
  model: string;
  prompt: StructuredJsonPrompt & { key: string; version: string };
  input: Input;
  maxOutputTokens: number;
  normalizeAnalysis: (value: Record<string, unknown> | null, input: Input) => Analysis | null;
  runPrompt?: typeof runStructuredGeminiJson;
}): Promise<NewsGeminiAnalysisResult<Analysis>> {
  const run = await runPrompt({
    apiKey,
    model,
    prompt,
    maxOutputTokens,
  });

  if (!run.responseOk) {
    return {
      stage: "analysis_error",
      run,
      analysis: null,
      error: run.error || "Gemini news analysis request failed",
    };
  }

  const analysis = normalizeAnalysis(run.parsed, input);
  if (!analysis) {
    return {
      stage: "analysis_error",
      run,
      analysis: null,
      error: run.error || "Gemini response did not contain parseable JSON",
    };
  }

  return {
    stage: "complete",
    run,
    analysis,
  };
}

export function normalizeNewsPrimaryMonitorRouting(
  analysis: Record<string, unknown>,
): Record<string, unknown> {
  const monitorRouting = readMonitorRoutingResultFromPrimaryOutput(analysis);
  const { monitor_routes: _unvalidatedMonitorRoutes, ...analysisWithoutMonitorRoutes } = analysis;
  return {
    ...analysisWithoutMonitorRoutes,
    ...(monitorRouting || {}),
  };
}
