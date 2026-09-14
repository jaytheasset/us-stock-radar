import "server-only";
import { buildForm25IdentityEvidence, form25SourceSha, form25SourceSnapshot, isForm25IdentityRaw, rawIdentityInput, record, text, cik, sha, SEC_TICKER_CATALOG,
  type Form25IdentityEvidence, type IdentityCandidate } from "./canonical.ts";
import { parseSecForm25Filing } from "../sources/sec/forms/form25/parser.ts";
import { fetchTickerLookup } from "../sources/sec/parser.ts";
import { readSecCoverObservations } from "../sec-cover-observations/persistence.ts";
import { AdminApiError } from "../admin/errors.ts";
import { classifySecurity } from "../sec-ticker-resolution/canonical.ts";

type Row = Record<string, unknown>;
export type Form25IdentityRepository = { select(table: string, query: Record<string, string>): Promise<{ok:boolean;data:unknown;status:number;error?:string}>;
  rpc(name:string,payload:Row):Promise<{ok:boolean;data:unknown;status:number;error?:string}> };
export type Form25EffectiveIdentity = { status:"unavailable"; ticker:null; exchange:null; reason:string }
 | { status:"available"; state:"AUTO"|"REVIEW"|"UNRESOLVED"|"HUMAN_APPROVED"|"HELD"; ticker:string|null; exchange:string|null;
   identityId:string;rawItemId:string;evidenceSha256:string;revision:number;reason:string;evidence:Form25IdentityEvidence;history:Row[] };
const unavailable = (reason:string):Form25EffectiveIdentity => ({status:"unavailable",ticker:null,exchange:null,reason});
const rows = (value:unknown):Row[] => Array.isArray(value) ? value.map(record) : [];

export async function ensureSecForm25Identity(input:{rawItemId:string;repository?:Form25IdentityRepository;
  historicalAccessionNumber?:string;catalogLoader?:()=>Promise<IdentityCandidate[]>}):Promise<Form25EffectiveIdentity> {
  try {
    const repository=input.repository??await defaultRepository();
    const rawRead=await repository.select("raw_items",{select:"*",id:`eq.${input.rawItemId}`,limit:"1"});
    const raw=rows(rawRead.data)[0];
    if(!rawRead.ok||!raw||!isForm25IdentityRaw(raw)) return unavailable("form25_raw_unavailable");
    if(!input.historicalAccessionNumber) {
      const existing=await readEffectiveSecForm25Identity({rawItemId:input.rawItemId,repository});
      if(existing.status==="available"&&existing.evidence.mode==="historical_replay") return existing;
    }
    let evidence:Form25IdentityEvidence;
    if(input.historicalAccessionNumber) {
      evidence=buildForm25IdentityEvidence(raw,{rows:[],available:true},"historical_replay");
      const candidates=await historicalCandidates(raw,input.historicalAccessionNumber,repository);
      if(candidates===null) return unavailable("historical_evidence_unavailable");
      if(evidence.reason==="subject_cik_conflict"||!evidence.subjectCik) return unavailable(evidence.reason);
      evidence={...evidence,candidates,status:candidates.length?"REVIEW":"UNRESOLVED",reason:candidates.length?"historical_evidence_requires_review":"historical_security_evidence_unavailable"};
    } else {
      let catalog:IdentityCandidate[]=[];let available=false;
      try {
        catalog=input.catalogLoader?await input.catalogLoader():Array.from((await fetchTickerLookup(true)).values()).flat().map(row=>({...row,source:SEC_TICKER_CATALOG}));
        available=true;
      } catch { /* secFetch already performs its bounded transient retry; preserve failure status. */ }
      evidence=buildForm25IdentityEvidence(raw,{rows:catalog,available});
    }
    const write=await repository.rpc("persist_sec_form25_identity",{p_raw_item_id:input.rawItemId,p_evidence:evidence,p_evidence_sha256:sha(evidence),p_raw_snapshot:form25SourceSnapshot(raw)});
    if(!write.ok) return unavailable("identity_persistence_failed");
    return readEffectiveSecForm25Identity({rawItemId:input.rawItemId,repository});
  } catch { return unavailable("identity_lookup_failed"); }
}

export async function readEffectiveSecForm25Identity(input:{rawItemId:string;repository?:Form25IdentityRepository}):Promise<Form25EffectiveIdentity> {
  try {
    const repository=input.repository??await defaultRepository();
    const [identityRead,rawRead,humanRead]=await Promise.all([
      repository.select("sec_form25_identity_evidence",{select:"*",raw_item_id:`eq.${input.rawItemId}`,order:"sequence.desc",limit:"1"}),
      repository.select("raw_items",{select:"*",id:`eq.${input.rawItemId}`,limit:"1"}),
      repository.select("sec_form25_identity_human_decisions",{select:"*",raw_item_id:`eq.${input.rawItemId}`,order:"revision.asc",limit:"1001"}),
    ]);
    if(!identityRead.ok||!rawRead.ok||!humanRead.ok) return unavailable("identity_read_failed");
    const identity=rows(identityRead.data)[0];const raw=rows(rawRead.data)[0];const history=rows(humanRead.data);
    if(!identity||!raw||history.length>1000) return unavailable("identity_record_unavailable");
    const evidence=record(identity.evidence) as unknown as Form25IdentityEvidence;
    if(sha(evidence)!==identity.evidence_sha256||evidence.sourceSha256!==form25SourceSha(raw)||!isForm25IdentityRaw(raw)) return unavailable("identity_evidence_changed");
    const subject=cik(parseSecForm25Filing(rawIdentityInput(raw)).facts.subject_company_cik?.value);
    if(subject!==evidence.subjectCik) return unavailable("identity_subject_changed");
    for(let i=0;i<history.length;i++) if(Number(history[i]!.revision)!==i+1 || (i>0&&history[i]!.previous_decision_id!==history[i-1]!.id)) return unavailable("identity_history_invalid");
    const last=history.at(-1);let state:Extract<Form25EffectiveIdentity,{status:"available"}>["state"]=evidence.status;
    let candidate=evidence.status==="AUTO"&&evidence.candidates.length===1?evidence.candidates[0]!:null;
    let reason=evidence.reason;
    if(last&&last.action!=="withdrawn") {
      if(last.identity_id!==identity.id) {state="REVIEW";candidate=null;reason="human_evidence_reconsideration_required";}
      else if(last.action==="held") {state="HELD";candidate=null;reason="human_identity_hold";}
      else if(last.action==="approved") {
        candidate=evidence.candidates[Number(last.candidate_index)]??null;
        if(!candidate) return unavailable("human_candidate_unavailable");
        if(evidence.mode==="historical_replay") {
          const verified=await historicalCandidates(raw,candidate.accession||"",repository);
          if(!verified?.some(row=>sha(row)===sha(candidate))) return unavailable("historical_evidence_changed");
        }
        state="HUMAN_APPROVED";reason="human_candidate_approved";
      } else return unavailable("identity_action_invalid");
    }
    if(candidate&&cik(candidate.cik)!==subject) return unavailable("candidate_issuer_mismatch");
    return {status:"available",state,ticker:candidate?.ticker??null,exchange:evidence.exchange,
      identityId:String(identity.id),rawItemId:input.rawItemId,evidenceSha256:String(identity.evidence_sha256),revision:history.length,reason,evidence,history};
  } catch { return unavailable("identity_read_failed"); }
}

async function historicalCandidates(raw:Row,accession:string,repository:Form25IdentityRepository):Promise<IdentityCandidate[]|null> {
  if(!/^\d{10}-\d{2}-\d{6}$/.test(accession)) return null;
  const parsed=parseSecForm25Filing(rawIdentityInput(raw));const subject=cik(parsed.facts.subject_company_cik?.value);
  const security=parsed.facts.removed_security?.value;const filingDate=parsed.facts.filing_date?.value;
  if(!subject||!security||!filingDate) return null;
  const read=await readSecCoverObservations({accessionNumber:accession,repository});
  if(read.status!=="available") return null;
  const candidates:IdentityCandidate[]=[];
  for(const item of read.results) {
    const date=text(item.result.filing_date_raw);
    if(cik(item.result.issuer_cik)!==subject||!date||date.slice(0,10)>filingDate.slice(0,10)) continue;
    for(const observation of item.observations) {
      if(!["observed","duplicate_equal"].includes(String(observation.security_title_status))||!["observed","duplicate_equal"].includes(String(observation.trading_symbol_status))) continue;
      const title=text(observation.security_title_raw);const ticker=text(observation.trading_symbol_raw);
      // These are review candidates, never automatic historical security relationships.
      const before=classifySecurity(security),after=title?classifySecurity(title):null;
      if(!ticker||!title||!before||!after||before.type!==after.type||before.securityClass!==after.securityClass) continue;
      candidates.push({ticker,exchange:text(observation.exchange_raw),cik:subject,source:String(item.result.source_url),accession,security:title,
        context:String(observation.context_ref),sourceSha256:String(item.result.source_sha256)});
    }
  }
  return Array.from(new Map(candidates.map(row=>[sha(row),row])).values());
}

export async function listSecForm25Identities(repository?:Form25IdentityRepository) {
  const repo=repository??await defaultRepository();const result=await repo.select("sec_form25_identity_evidence",{select:"raw_item_id",order:"sequence.desc",limit:"100"});
  if(!result.ok)return {status:"unavailable" as const,items:[]};
  const ids=Array.from(new Set(rows(result.data).map(row=>String(row.raw_item_id))));
  return {status:"available" as const,items:await Promise.all(ids.map(rawItemId=>readEffectiveSecForm25Identity({rawItemId,repository:repo})))};
}
export async function applySecForm25IdentityDecision(input:{rawItemId:string;actorUserId:string;action:unknown;candidateIndex:unknown;
  expectedEvidenceSha256:unknown;expectedRevision:unknown;reason:unknown;requestId:string;repository?:Form25IdentityRepository}) {
  const repository=input.repository??await defaultRepository();
  const action=String(input.action);const reason=String(input.reason??"").trim();
  if(!["approved","held","withdrawn"].includes(action)||reason.length<4||reason.length>2000) throw new AdminApiError("FORM25_IDENTITY_ACTION_INVALID","Choose an action and provide a reason of 4–2,000 characters.",400);
  const effective=await readEffectiveSecForm25Identity({rawItemId:input.rawItemId,repository});
  if(effective.status!=="available") throw new AdminApiError("FORM25_IDENTITY_UNAVAILABLE","The source or identity history cannot be verified.",409);
  const sourceRead=await repository.select("raw_items",{select:"*",id:`eq.${input.rawItemId}`,limit:"1"});
  const source=rows(sourceRead.data)[0];
  if(!sourceRead.ok||!source||form25SourceSha(source)!==effective.evidence.sourceSha256) throw new AdminApiError("FORM25_IDENTITY_SOURCE_CHANGED","Refresh the changed filing source.",409);
  if(action==="approved") {
    const candidate=effective.evidence.candidates[Number(input.candidateIndex)];
    if(!candidate||!Number.isInteger(Number(input.candidateIndex))) throw new AdminApiError("FORM25_IDENTITY_CANDIDATE_REQUIRED","Choose a retained SEC evidence candidate.",409);
    if(effective.evidence.mode==="historical_replay") {
      const rawRead=await repository.select("raw_items",{select:"*",id:`eq.${input.rawItemId}`,limit:"1"});
      const raw=rows(rawRead.data)[0];const verified=rawRead.ok&&raw?await historicalCandidates(raw,candidate.accession||"",repository):null;
      if(!verified?.some(row=>sha(row)===sha(candidate))) throw new AdminApiError("FORM25_IDENTITY_EVIDENCE_CHANGED","Historical SEC evidence is no longer verified.",409);
    }
  }
  const result=await repository.rpc("admin_apply_sec_form25_identity_decision",{p_raw_item_id:input.rawItemId,p_actor_user_id:input.actorUserId,p_action:action,
    p_candidate_index:action==="approved"?Number(input.candidateIndex):null,p_expected_sha256:input.expectedEvidenceSha256,p_expected_revision:input.expectedRevision,
    p_reason:reason,p_request_id:input.requestId,p_raw_snapshot:form25SourceSnapshot(source)});
  if(!result.ok) throw new AdminApiError("FORM25_IDENTITY_WRITE_CONFLICT","The decision was not saved. Refresh the source and review revision.",result.status===403?403:409);
  return result.data;
}
async function defaultRepository():Promise<Form25IdentityRepository> {const repo=await import("../supabase.ts");return {select:repo.supabaseSelect,rpc:repo.supabaseRpc};}
