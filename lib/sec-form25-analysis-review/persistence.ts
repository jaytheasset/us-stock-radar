import "server-only";
import { form25SourceSha, form25SourceSnapshot, isForm25IdentityRaw, rawIdentityInput, record, sha } from "../sec-form25-identity/canonical.ts";
import { parseSecForm25Filing } from "../sources/sec/forms/form25/parser.ts";
import { AdminApiError } from "../admin/errors.ts";
import { validateCorrections, unavailableCorrections, type AnalysisCorrections, type AnalysisReviewState, type ReviewSource } from "./contract.ts";

type Row = Record<string, unknown>;
type Repository = { select(table:string,query:Record<string,string>):Promise<{ok:boolean;data:unknown;error?:string}>;
  rpc(name:string,payload:Row):Promise<{ok:boolean;data:unknown;error?:string;status:number}> };
export type EffectiveForm25AnalysisReview = {
  status: "not_applicable" | "available" | "unavailable";
  reviewState: AnalysisReviewState;
  baseAnalysisRequiresReview: boolean;
  reason: string;
  rawItemId: string; eventId: string | null; baseVersion: string; revision: number;
  analysis: Row | null; aiRunId: string | null; humanDecisionId: string | null; decisionTime: string | null;
  corrections: AnalysisCorrections; sourceEvidence: ReviewSource[]; history: Row[];
  company: string | null; form: string | null; accession: string | null;
};
const rows = (v:unknown):Row[] => Array.isArray(v)?v.map(record):[];
const blank = (reason:string,rawItemId=""):EffectiveForm25AnalysisReview => ({status:"unavailable",reviewState:"REVIEW",baseAnalysisRequiresReview:true,reason,rawItemId,eventId:null,baseVersion:"",revision:0,analysis:null,aiRunId:null,humanDecisionId:null,decisionTime:null,corrections:{},sourceEvidence:[],history:[],company:null,form:null,accession:null});
async function repository():Promise<Repository>{const db=await import("../supabase.ts");return{select:db.supabaseSelect,rpc:db.supabaseRpc};}
async function select(repo:Repository,table:string,query:Record<string,string>){const r=await repo.select(table,{select:"*",...query});if(!r.ok)throw Error(r.error||"read_unavailable");return rows(r.data);}
async function loadBasis(input:{eventId?:string;rawItemId?:string},repo:Repository){
  let event=input.eventId?(await select(repo,"events",{id:`eq.${input.eventId}`,limit:"1"}))[0]:null;
  const rawItemId=input.rawItemId||String(event?.raw_item_id||"");
  if(!rawItemId)throw Error("raw_item_unavailable");
  const raw=(await select(repo,"raw_items",{id:`eq.${rawItemId}`,limit:"1"}))[0];
  if(!raw)throw Error("raw_item_unavailable");
  if(!isForm25IdentityRaw(raw))throw Error("not_form25");
  if(!event)event=(await select(repo,"events",{raw_item_id:`eq.${rawItemId}`,limit:"1"}))[0]||null;
  const runs=await select(repo,"ai_runs",{raw_item_id:`eq.${rawItemId}`,prompt_key:"ilike.*form25*",order:"started_at.desc,id.desc",limit:"20"});
  let output:Row|null=null,run:Row|null=null;
  for(const candidate of runs){if(candidate.status!=="completed")continue;const found=(await select(repo,"ai_outputs",{ai_run_id:`eq.${candidate.id}`,order:"id.desc",limit:"1"}))[0];if(record(found?.payload).analysis){output=found;run=candidate;break;}}
  const history=await select(repo,"sec_form25_analysis_decisions",{raw_item_id:`eq.${rawItemId}`,order:"revision.asc"});
  const sourceEvidence:ReviewSource[]=[{id:"filing",url:typeof raw.source_url==="string"?raw.source_url:null,text:String(raw.body_text||""),label:"Retained SEC source text"}];
  const rawPayload=record(raw.raw_payload);
  for(const [i,value]of rows(rawPayload.attachment_texts).entries())sourceEvidence.push({id:`attachment:${i}`,url:typeof value.url==="string"?value.url:sourceEvidence[0].url,text:String(value.text||value.content||""),label:String(value.name||value.filename||`Attachment ${i+1}`)});
  const basis={rawSnapshot:form25SourceSnapshot(raw),latestAiRunId:runs[0]?.id||null,outputId:output?.id||null,outputPayload:output?.payload||null};
  return{rawItemId,raw,event,runs,output,run,history,sourceEvidence,basis,baseVersion:sha(basis)};
}
export async function readEffectiveForm25AnalysisReview(input:{eventId?:string;rawItemId?:string;repository?:Repository}):Promise<EffectiveForm25AnalysisReview>{
  try{
    const data=await loadBasis(input,input.repository||await repository());
    if(!isForm25IdentityRaw(data.raw))return{...blank("not_form25",data.rawItemId),status:"not_applicable"};
    const analysis=record(record(data.output?.payload).analysis);const latest=data.history.at(-1);
    const decision=data.history.filter(row=>["corrected","unavailable","awaiting_filing","withdrawn"].includes(String(row.action))).at(-1);
    const baseAnalysisRequiresReview=data.runs[0]?.status==="failed"||!data.output||analysis.needs_human_review===true||record(analysis.analysis_output).needs_human_review===true||data.history.some(row=>row.action==="retry_completed");
    let reviewState:AnalysisReviewState=baseAnalysisRequiresReview?"REVIEW":"ORIGINAL";
    let reason=reviewState==="REVIEW"?"analysis_requires_review":"original_analysis";let corrections:AnalysisCorrections={};
    if(decision&&decision.action!=="withdrawn"){
      if(decision.base_version!==data.baseVersion){reviewState="REVIEW";reason="source_or_analysis_changed";}
      else if(decision.action==="corrected"){corrections=validateCorrections(decision.corrections,data.sourceEvidence);reviewState="HUMAN_CORRECTED";reason="explicit_human_correction";}
      else{reviewState=decision.action==="unavailable"?"UNAVAILABLE":"AWAITING_FILING";corrections=unavailableCorrections("filing");reason=String(decision.reason);}
    }
    if(latest?.action==="retry_requested"){reviewState="REVIEW";reason="retry_in_progress_or_interrupted";corrections={};}
    return{status:"available",reviewState,baseAnalysisRequiresReview,reason,rawItemId:data.rawItemId,eventId:data.event?String(data.event.id):null,baseVersion:data.baseVersion,revision:Number(latest?.revision||0),analysis:data.output?analysis:null,aiRunId:data.run?String(data.run.id):null,humanDecisionId:decision?String(decision.id):null,decisionTime:decision?String(decision.created_at):null,corrections,sourceEvidence:data.sourceEvidence,history:data.history,company:parseSecForm25Filing(rawIdentityInput(data.raw)).facts.issuer_name?.value||null,form:String(record(data.raw.raw_payload).form_type||""),accession:String(data.raw.source_unique_id||"")};
  }catch(error){const message=error instanceof Error?error.message:"analysis_review_unavailable";return {...blank(message,input.rawItemId),...(message==="not_form25"?{status:"not_applicable" as const}:{})};}
}
export async function listForm25AnalysisReviews(){
  const repo=await repository();const raw=await select(repo,"raw_items",{"raw_payload->>form_type":"ilike.25*",order:"fetched_at.desc",limit:"100"});
  return Promise.all(raw.map(row=>readEffectiveForm25AnalysisReview({rawItemId:String(row.id),repository:repo})));
}
export async function applyForm25AnalysisDecision(input:{rawItemId:string;actorUserId:string;action:string;corrections?:unknown;reason:string;expectedVersion:string;expectedRevision:number;requestId:string;repository?:Repository;retryAiRunId?:string}){
  if(!Number.isInteger(input.expectedRevision)||input.expectedRevision<0||!/^[a-f0-9]{64}$/.test(input.expectedVersion))throw new AdminApiError("INVALID_ANALYSIS_REVISION","Refresh the analysis before deciding.",400);
  const repo=input.repository||await repository();const data=await loadBasis(input,repo);
  if(!isForm25IdentityRaw(data.raw))throw new AdminApiError("FORM25_ONLY","This review is limited to Form 25.",400);
  if(!["corrected","unavailable","awaiting_filing","withdrawn","retry_requested","retry_completed","retry_cancelled"].includes(input.action))throw new AdminApiError("INVALID_ANALYSIS_ACTION","Unsupported action.",400);
  let corrections:AnalysisCorrections={};try{if(input.action==="corrected")corrections=validateCorrections(input.corrections,data.sourceEvidence);}catch(error){throw new AdminApiError("INVALID_ANALYSIS_CORRECTION",String(error),400);}
  const result=await repo.rpc("admin_apply_sec_form25_analysis_decision",{p_raw_item_id:input.rawItemId,p_actor_user_id:input.actorUserId,p_action:input.action,p_corrections:corrections,p_reason:input.reason,p_expected_version:input.expectedVersion,p_actual_version:data.baseVersion,p_expected_revision:input.expectedRevision,p_request_id:input.requestId,p_basis:data.basis,p_source_sha256:form25SourceSha(data.raw),p_retry_ai_run_id:input.retryAiRunId||null});
  if(!result.ok)throw new AdminApiError("ANALYSIS_REVIEW_CONFLICT","The source, analysis or review revision changed. Refresh before deciding.",result.status===403?403:409);
  return record(result.data);
}
export async function retryForm25Analysis(input:{rawItemId:string;actorUserId:string;reason:string;expectedVersion:string;expectedRevision:number;requestId:string},deps?:{analyze:(raw:Row)=>Promise<any>}){
  const claim=await applyForm25AnalysisDecision({...input,action:"retry_requested"});
  if(claim.replayed===true)return readEffectiveForm25AnalysisReview({rawItemId:input.rawItemId});
  const repo=await repository();const raw=(await select(repo,"raw_items",{id:`eq.${input.rawItemId}`,limit:"1"}))[0];const attemptedSourceSha=form25SourceSha(raw);
  const event=(await select(repo,"events",{raw_item_id:`eq.${input.rawItemId}`,limit:"1"}))[0];
  let run:any;try{run=await(deps?.analyze||((value:Row)=>import("../ai/secFilingAnalysisPreview.ts").then(m=>m.runSecFilingAnalysisForRawRow(value))))(raw);}catch(error){run={ok:false,error:error instanceof Error?error.message:"Analysis failed"};}
  const {saveSecFilingAiTrace}=await import("../secStores/eventStore.ts");
  const trace=await saveSecFilingAiTrace({rawItemId:input.rawItemId,eventId:event?String(event.id):null,analysis:run.analysis||null,outputText:run.outputText||"",usage:run.usage||null,costEstimate:run.costEstimate||null,model:run.model||"",openAiResponseId:run.openAiResponseId||null,promptKey:run.prompt?.key||"sec_form25_analysis_draft",promptVersion:run.prompt?.version||"failed_before_prompt",prompt:run.prompt||null,repairOutputText:run.repairOutputText,repairUsage:run.repairUsage,repairOpenAiResponseId:run.repairOpenAiResponseId,validationRepair:run.validationRepair||null,error:run.ok?null:run.error||"Analysis failed"});
  const current=await readEffectiveForm25AnalysisReview({rawItemId:input.rawItemId});
  const freshRaw=(await select(repo,"raw_items",{id:`eq.${input.rawItemId}`,limit:"1"}))[0];
  if(form25SourceSha(freshRaw)!==attemptedSourceSha)throw new AdminApiError("ANALYSIS_SOURCE_CHANGED","The filing changed during reanalysis. The attempt was retained; review the new evidence.",409);
  await applyForm25AnalysisDecision({...input,action:"retry_completed",expectedVersion:current.baseVersion,expectedRevision:Number(claim.revision),requestId:input.requestId+":completed",reason:run.ok?"Reanalysis completed; original analysis retained":"Reanalysis failed; human review required",retryAiRunId:trace.aiRunId});
  return readEffectiveForm25AnalysisReview({rawItemId:input.rawItemId});
}
