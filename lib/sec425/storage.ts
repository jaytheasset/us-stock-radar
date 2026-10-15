import { buildSecFilingAnalysisPackage } from "../prompts/secFilingAnalysisPackage.ts";
import { buildSecGeminiRequestBody } from "../ai/secFilingAnalysisPreview.ts";
import { buildFactPrompt, assessFacts, VERSION } from "./facts.ts";
import { hash, stable, record, text } from "../sec-proxy/source.ts";
import { proxyRepository, rows, rpc, type ProxyRepository } from "../sec-proxy/persistence.ts";
export { hash, stable, record, text, rows, rpc };
export type Repository=ProxyRepository;
export const PURPOSE="sec425_facts";
export const enabled=()=>process.env.SEC425_MONITOR_ENABLED==="true";
export async function repository(){return proxyRepository();}
export function sourceInput(raw:Record<string,unknown>){
 const p=record(raw.raw_payload),html=text(p.primary_document_html);
 if(raw.source_code!=="sec_edgar"||p.form_type!=="425"||raw.source_unique_id!==p.accession_number||!/^\d{10}-\d{2}-\d{6}$/.test(text(p.accession_number))||!html||p.primary_document_html_truncated===true)throw Error("sec425_raw_invalid");
 const input={filing_package:buildSecFilingAnalysisPackage(raw,{maxChars:50000,maxDocumentChars:24000})},prompt=buildFactPrompt(input),request=buildSecGeminiRequestBody(prompt,"gemini-2.5-flash");
 const filing=record(input.filing_package),source=record(filing.sec425_primary_source);
 if(source.complete!==true||source.sourceSha256!==hash(html))throw Error("sec425_source_hash_invalid");
 const binding={rawItemId:text(raw.id),accession:text(p.accession_number),issuerCik:text(p.cik).padStart(10,"0"),formType:"425",contractVersion:VERSION,attempt:"automatic",
  sourceUrl:text(source.url),sourceSha256:hash(html),filedAt:text(p.accepted_at)||text(p.filing_date),acceptedAt:text(p.accepted_at),filingDate:text(p.filing_date),rawHash:hash(stable({source_unique_id:raw.source_unique_id,raw_payload:p,body_text:raw.body_text})),
  sourceFingerprint:hash(stable({request,version:VERSION,sourceHash:hash(html)}))};
 const h=hash(stable([PURPOSE,binding.rawItemId,binding.rawHash,binding.sourceFingerprint]));
 return{input,prompt,request,binding,executionId:`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
}
export async function loadSource(rawId:string,repo:Repository){
 if(!/^[0-9a-f-]{36}$/i.test(rawId))throw Error("sec425_raw_id_invalid");
 const raw=rows(await repo.select("raw_items",{select:"*",id:`eq.${rawId}`,limit:"2"}));if(raw.length!==1)throw Error("sec425_raw_missing");return sourceInput(raw[0]);
}
export async function readRun(repo:Repository,id:string){return rows(await repo.select("ai_runs",{select:"*",id:`eq.${id}`,prompt_key:`eq.${PURPOSE}`,limit:"1"}))[0];}
export function responseAssessment(body:string,input:ReturnType<typeof sourceInput>){
 const response=JSON.parse(body);
 if(response.candidates?.length!==1||response.candidates[0].finishReason!=="STOP")throw Error("sec425_provider_incomplete");
 const outputText=response.candidates[0].content.parts.filter((p:any)=>!p.thought).map((p:any)=>p.text??"").join("");
 const output=JSON.parse(outputText),assessment=assessFacts(output,input.input);
 const {rawOutput,...canonical}=assessment;
 return{canonical,output,usage:response.usageMetadata??null};
}
export async function readFacts(rawId:string,supplied?:Repository){
 try{
  const repo=supplied??await repository(),source=await loadSource(rawId,repo),run=await readRun(repo,source.executionId);
  if(!run||run.status!=="succeeded")return{status:"not_ready" as const,reason:run?text(record(run.metadata).state):"facts_missing"};
  const metadata=record(run.metadata),stage=record(record(metadata.stages).fact),response=record(stage.response);
  if(stable(metadata.binding)!==stable(source.binding)||stage.state!=="complete"||stage.requestHash!==hash(JSON.stringify(source.request))||response.bodyHash!==hash(text(response.body))||response.status!==200)throw Error("sec425_checkpoint_invalid");
  const outputs=rows(await repo.select("ai_outputs",{select:"*",ai_run_id:`eq.${source.executionId}`,output_type:`eq.${PURPOSE}`,limit:"2"}));if(outputs.length!==1)throw Error("sec425_output_invalid");
  const payload=record(outputs[0].payload),checked=responseAssessment(text(response.body),source);
  if(stable(payload.binding)!==stable(source.binding)||payload.canonicalHash!==hash(stable(payload.canonical))||stable(checked.canonical)!==stable(payload.canonical))throw Error("sec425_canonical_integrity_invalid");
  return{status:"available" as const,rawItemId:rawId,sourceExecutionId:source.executionId,persistedAt:text(run.finished_at),binding:source.binding,canonical:checked.canonical,rawOutput:checked.output,mode:stage.mode};
 }catch(error){return{status:"not_ready" as const,reason:error instanceof Error?error.message:"reader_unavailable"};}
}
export async function processFacts(job:{rawItemId:string;executionId:string},options:{repo?:Repository;fetchImpl?:typeof fetch;apiKey?:string}={}){
 const repo=options.repo??await repository(),source=await loadSource(job.rawItemId,repo),run=await readRun(repo,job.executionId);
 if(!run||run.raw_item_id!==job.rawItemId)throw Error("sec425_job_invalid");
 if(["succeeded","failed","stale"].includes(text(run.status)))return{status:text(record(run.metadata).state)};
 if(source.executionId!==job.executionId||stable(record(run.metadata).binding)!==stable(source.binding))return rpc(repo,"finish_sec425_facts",{p_id:job.executionId,p_status:"stale",p_payload:{binding:record(run.metadata).binding,canonical:null,error:"source_changed"}});
 const request=JSON.stringify(source.request),claim=await rpc(repo,"sec425_transition",{p_id:job.executionId,p_action:"begin",p_value:{stage:"fact",requestHash:hash(request),mode:options.fetchImpl?"retained_response_replay":"provider"}});
 let response=record(record(claim.checkpoint).response);
 if(!claim.checkpoint){
  if(claim.claimed!==true)return{status:text(claim.status)};
  const start=Date.now(),key=options.apiKey??(await import("../env.ts")).getServerEnv().geminiApiKey;
  try{
   if(!key)throw Error("api_key_missing");
   const res=await(options.fetchImpl??fetch)("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",{method:"POST",redirect:"error",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:request,signal:AbortSignal.timeout(120000)});
   const body=await res.text();if(body.includes(key))throw Error("credential_echo");
   response={status:res.status,body,bodyHash:hash(body),latencyMs:Date.now()-start};
  }catch{return rpc(repo,"sec425_transition",{p_id:job.executionId,p_action:"uncertain",p_value:{stage:"fact",token:claim.token}});}
  await rpc(repo,"sec425_transition",{p_id:job.executionId,p_action:"checkpoint",p_value:{stage:"fact",token:claim.token,response}});
 }
 if(response.bodyHash!==hash(text(response.body)))throw Error("sec425_checkpoint_corrupt");
 let canonical:unknown=null,usage:unknown=null,error:string|null=null;
 try{if(response.status!==200)throw Error("provider_http_failure");const result=responseAssessment(text(response.body),source);canonical=result.canonical;usage=result.usage;if(result.canonical.status==="invalid")error="invalid_json_structure";}
 catch(e){error=e instanceof Error?e.message:"provider_output_invalid";}
 return rpc(repo,"finish_sec425_facts",{p_id:job.executionId,p_status:error?"failed":"succeeded",p_payload:{binding:source.binding,canonical,canonicalHash:hash(stable(canonical)),usage,error}});
}
