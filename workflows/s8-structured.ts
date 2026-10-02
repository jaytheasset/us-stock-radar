import { sleep } from "workflow";
import { analyzeS8StructuredJob, persistS8StructuredJob,
  type S8PreparedResult, type S8StructuredJob } from "@/lib/sec-s8/structuredRuntime";

export async function s8StructuredWorkflow(job: S8StructuredJob) {
  "use workflow";
  // Same bound as the generic child infrastructure recovery: initial + three recoveries.
  // SQL owns the global attempt budget across concurrent/replacement workflows.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const result = await analyzeS8StructuredStep(job);
      if (result.status !== "busy") return await persistS8StructuredStep(result);
    } catch (error) {
      if (attempt === 3) throw error;
    }
    if (attempt < 3) await sleep("180s"); // Matches SQL lease; no heartbeat needed for the 60s provider timeout.
  }
  return {status:"recovery_exhausted" as const};
}
async function analyzeS8StructuredStep(job: S8StructuredJob) {
  "use step";
  return analyzeS8StructuredJob(job);
}
// No semantic/provider-error retry. Only abandoned leases may recover; an uncertain call is recorded in DB.
analyzeS8StructuredStep.maxRetries = 0;
async function persistS8StructuredStep(result: S8PreparedResult) {
  "use step";
  return persistS8StructuredJob(result);
}
// Match the generic child's bounded infrastructure recovery count, without repeating analysis.
persistS8StructuredStep.maxRetries = 3;
