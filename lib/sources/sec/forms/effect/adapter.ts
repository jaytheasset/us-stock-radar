import { analyzeEffectFiling, buildEffectResult } from "./analysis";
import { SEC_EFFECT_FORMS } from "../common/forms";
import { buildEffectDisplayPayload } from "./displayPayload";
import { parseEffectFiling } from "./parser";
import { routeEffectFiling } from "./router";
import { EFFECT_PARSER_GROUP } from "./types";

export const effectAdapterKey = "sec-effect";
export const effectSupportedForms = SEC_EFFECT_FORMS;
export const effectParserGroup = EFFECT_PARSER_GROUP;
export const effectAnalysisMode = "generic_sec_analysis";

export const buildEffectRouterPrompt = null;
export const buildEffectAnalysisPrompt = null;

export const effectAdapter = {
  key: effectAdapterKey,
  supportedForms: effectSupportedForms,
  parserGroup: effectParserGroup,
  analysisMode: effectAnalysisMode,
  parse: parseEffectFiling,
  route: routeEffectFiling,
  analyze: analyzeEffectFiling,
  buildResult: buildEffectResult,
  buildDisplayPayload: buildEffectDisplayPayload,
  buildRouterPrompt: buildEffectRouterPrompt,
  buildAnalysisPrompt: buildEffectAnalysisPrompt,
} as const;

export const effectFormAdapter = effectAdapter;
