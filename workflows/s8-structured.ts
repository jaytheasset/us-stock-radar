import { analyzeS8StructuredJob, persistS8StructuredJob,
  type S8PreparedResult, type S8StructuredJob } from "@/lib/sec-s8/structuredRuntime";

export async function s8StructuredWorkflow(job: S8StructuredJob) {
  "use workflow";
  const result = await analyzeS8StructuredStep(job);
  return persistS8StructuredStep(result);
}
async function analyzeS8StructuredStep(job: S8StructuredJob) {
  "use step";
  return analyzeS8StructuredJob(job);
}
// No model retry or semantic repair. A failed/uncertain provider attempt is never silently repeated.
analyzeS8StructuredStep.maxRetries = 0;
async function persistS8StructuredStep(result: S8PreparedResult) {
  "use step";
  return persistS8StructuredJob(result);
}
// Match the generic child's bounded infrastructure recovery count, without repeating analysis.
persistS8StructuredStep.maxRetries = 3;
