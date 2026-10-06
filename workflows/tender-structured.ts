import { sleep } from "workflow";
import {
  consumeTenderAlertsForRaw,
  processTenderStructured,
  type TenderStructuredJob,
} from "@/lib/sec-tender/runtime";

export async function tenderStructuredWorkflow(job: TenderStructuredJob) {
  "use workflow";
  let result = await analyze(job);
  if (result.status === "busy") {
    await sleep("180s");
    result = await analyze(job);
  }
  if (result.status === "succeeded") {
    await alerts(job.rawItemId);
  }
  return result;
}

async function analyze(job: TenderStructuredJob) {
  "use step";
  return processTenderStructured(job);
}
// Infrastructure replay can only reuse a completed checkpoint or end uncertain.
// A started provider request is never issued twice.
analyze.maxRetries = 3;

async function alerts(rawItemId: string) {
  "use step";
  return consumeTenderAlertsForRaw(rawItemId);
}
alerts.maxRetries = 3;
