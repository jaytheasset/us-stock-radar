import { loadInput, proxyRepository, rpc, type ProxyRepository } from "./persistence.ts";
import type { ProxyJob } from "./runtime.ts";
import { proxyStructuredWorkflow } from "../../workflows/proxy-structured.ts";

export async function enqueueProxyStructured(rawItemId:string, options:{repository?:ProxyRepository;verificationKey?:string;start?:(job:ProxyJob)=>Promise<{runId:string}>}={}) {
  const repo = options.repository ?? await proxyRepository(), input = await loadInput(rawItemId,repo,options.verificationKey);
  await rpc(repo,"reserve_sec_proxy_structured",{p_id:input.executionId,p_binding:input.binding});
  const scheduled = await rpc(repo,"sec_proxy_transition",{p_id:input.executionId,p_action:"schedule"});
  if (scheduled.claimed !== true) return {status:"duplicate",executionId:input.executionId};
  const job:ProxyJob = {rawItemId,executionId:input.executionId,...(options.verificationKey ? {verificationKey:options.verificationKey} : {})};
  try {
    const start = options.start ?? (async (job:ProxyJob) => {
      const {start} = await import("workflow/api");
      return start(proxyStructuredWorkflow,[job]);
    });
    const run = await start(job);
    await rpc(repo,"sec_proxy_transition",{p_id:input.executionId,p_action:"link",p_value:{token:scheduled.token,workflowRunId:run.runId}});
    return {status:"enqueued",executionId:input.executionId,workflowRunId:run.runId};
  } catch (error) { return {status:"enqueue_uncertain",executionId:input.executionId,error:String(error)}; }
}
