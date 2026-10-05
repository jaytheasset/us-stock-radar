import { runProxyProposalRouting } from "../sources/sec/forms/proxy/proposalRouting.ts";
import { hash, record, stable, text } from "./source.ts";
import { loadInput, proxyRepository, readRun, rpc, rows, type ProxyRepository } from "./persistence.ts";

export type ProxyJob = {rawItemId:string;executionId:string;verificationKey?:string};
/** Retrying this infrastructure step cannot reclaim a started provider stage. */
export async function processProxyStructured(job:ProxyJob, options:{repository?:ProxyRepository;fetchImpl?:typeof fetch;apiKey?:string}={}) {
  const repo = options.repository ?? await proxyRepository(), run = await readRun(repo,job.executionId);
  if (!run || run.raw_item_id !== job.rawItemId) throw Error("proxy_job_identity_invalid");
  if (["succeeded","failed","stale"].includes(text(run.status))) return {status:text(record(run.metadata).state)};
  // A read outage is retryable infrastructure failure, not evidence that the source changed.
  const input = await loadInput(job.rawItemId,repo,job.verificationKey);
  if (input.executionId !== job.executionId || stable(input.binding) !== stable(record(run.metadata).binding)) {
    return rpc(repo,"finish_sec_proxy_structured",{p_id:job.executionId,p_status:"stale",p_payload:{binding:record(run.metadata).binding,error:"proxy_source_changed",canonical:null}});
  }
  let blocked:string|null = null, stageNumber = 0;
  const fetchImpl:typeof fetch = async (url,init) => {
    const stage = ++stageNumber === 1 ? "call1" : "call2", request = text(init?.body), requestHash = hash(request);
    let claim;
    try { claim = await rpc(repo,"sec_proxy_transition",{p_id:job.executionId,p_action:"begin",p_value:{stage,requestHash,request:JSON.parse(request),mode:options.fetchImpl?"injected_response_replay":"provider"}}); }
    catch (error) { blocked="busy"; throw error; }
    if (claim.checkpoint) {
      const cp = record(record(claim.checkpoint).response);
      if (cp.bodyHash !== hash(text(cp.body))) throw Error("proxy_checkpoint_corrupt");
      return new Response(text(cp.body),{status:Number(cp.status)});
    }
    if (claim.claimed !== true) { blocked=text(claim.status); throw Error(`proxy_${blocked}`); }
    const started = Date.now();
    let response:Response, body:string;
    try {
      response = await (options.fetchImpl ?? fetch)(url,{...init,signal:AbortSignal.timeout(90000)});
      body = await response.text();
    } catch {
      blocked="uncertain";
      await rpc(repo,"sec_proxy_transition",{p_id:job.executionId,p_action:"uncertain",p_value:{stage,token:claim.token}});
      throw Error("proxy_provider_outcome_unknown");
    }
    // Storage failure retains started state; retries must not issue the request again.
    try {
      await rpc(repo,"sec_proxy_transition",{p_id:job.executionId,p_action:"checkpoint",p_value:{stage,token:claim.token,
        response:{status:response.status,body,bodyHash:hash(body),latencyMs:Date.now()-started}}});
    } catch (error) { blocked="busy"; throw error; }
    return new Response(body,{status:response.status});
  };
  const apiKey = options.apiKey ?? (await import("../env.ts")).getServerEnv().geminiApiKey;
  const routed = await runProxyProposalRouting({apiKey:apiKey || "",sourcePackage:input.source,formType:input.formType,fetchImpl});
  if (blocked) return {status:blocked};
  // All timing comes from durable transport checkpoints; replay timing is not provider latency.
  const stages = record(record((await readRun(repo,job.executionId)).metadata).stages);
  const canonical = routed.ok ? routed.call2!.run.validation.value : null;
  const payload = {binding:input.binding,canonical,canonicalHash:hash(stable(canonical)),error:routed.error,
    trace:{call1:routed.call1.run.validation,call2:routed.call2?.run.validation ?? null},
    usage:{call1:routed.call1.run.usage,call2:routed.call2?.run.usage ?? null},
    transport:Object.fromEntries(Object.entries(stages).map(([k,v]) => [k,{mode:record(v).mode,latencyMs:record(record(v).response).latencyMs}]))};
  return rpc(repo,"finish_sec_proxy_structured",{p_id:job.executionId,p_status:routed.ok?"succeeded":"failed",p_payload:payload});
}

/** Both completion and event creation call this, closing either ordering of the raw/event race. */
export async function consumeProxyAlertsForRaw(rawItemId:string) {
  const repo = await proxyRepository();
  const events = rows(await repo.select("events",{select:"id",raw_item_id:`eq.${rawItemId}`,source_code:"eq.sec_edgar"}));
  const {consumeListingMonitorAlertsForEvent} = await import("../monitor/listingMonitorAlertConsumer.ts");
  const results = [];
  for (const event of events) results.push(await consumeListingMonitorAlertsForEvent({eventId:text(event.id),conditionFamily:"proxy"}));
  if (results.some(r => r.failedCount > 0)) throw Error("proxy_alert_persistence_failed");
  return results;
}
