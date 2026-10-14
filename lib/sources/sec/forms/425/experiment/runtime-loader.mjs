// Experiment process only: expose existing private provider/config functions in memory.
// Their source is unmodified, including retry/fallback/Primary-repair policy.
export { resolve } from '../../../../../../scripts/resolve-ts-paths.mjs';
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (url.endsWith('/lib/ai/secFilingAnalysisPreview.ts')) {
    return { ...result, source: result.source.toString() + '\nexport { resolveSecLlmConfig, resolveSec425RouterLlmConfig, resolveSec425AnalysisLlmConfig, buildSec425AnalysisModelPlan, runOpenAiJsonPrompt, buildSec425ValidationRepairPrompt, applySec425ValidationRepair };\n' };
  }
  return result;
}
