import { processS8Structured } from "@/lib/sec-s8/structuredRuntime";

export async function s8StructuredWorkflow(job: { executionId: string; rawItemId: string }) {
  "use workflow";
  return runS8StructuredStep(job);
}
async function runS8StructuredStep(job: { executionId: string; rawItemId: string }) {
  "use step";
  return processS8Structured(job);
}
runS8StructuredStep.maxRetries = 0;
