import { sleep } from "workflow";
import { processProxyStructured, consumeProxyAlertsForRaw, type ProxyJob } from "@/lib/sec-proxy/runtime";

export async function proxyStructuredWorkflow(job:ProxyJob) {
  "use workflow";
  let result = await analyze(job);
  if (result.status === "busy") {
    await sleep("180s");
    result = await analyze(job);
  }
  if (result.status === "succeeded" && !job.verificationKey) await alerts(job.rawItemId);
  return result;
}
async function analyze(job:ProxyJob) { "use step"; return processProxyStructured(job); }
// Only infrastructure replay; a provider claim is immutable even across workflow runs.
analyze.maxRetries = 3;
async function alerts(rawItemId:string) { "use step"; return consumeProxyAlertsForRaw(rawItemId); }
alerts.maxRetries = 3;
