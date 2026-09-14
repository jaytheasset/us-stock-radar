import "server-only";
import { buildForm25IdentityEvidence, form25SourceSha, form25SourceSnapshot, isForm25IdentityRaw, rawIdentityInput, record, text, cik, sha, SEC_TICKER_CATALOG,
  type Form25IdentityEvidence, type IdentityCandidate } from "./canonical.ts";
import { parseSecForm25Filing } from "../sources/sec/forms/form25/parser.ts";
import { fetchTickerLookup } from "../sources/sec/parser.ts";
import { buildSecCoverObservationPayload } from "../sec-cover-observations/canonical.ts";
import { readSecCoverObservations } from "../sec-cover-observations/persistence.ts";
import { AdminApiError } from "../admin/errors.ts";
import { classifySecurity } from "../sec-ticker-resolution/canonical.ts";
import { activeForm25IdentityDecision, clearForm25SecurityConflict, forcedDecisionTicker, form25ReferenceAccession, normalizeForm25OverrideReference } from "./forcedOverride.ts";

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
    const last=activeForm25IdentityDecision(history);let state:Extract<Form25EffectiveIdentity,{status:"available"}>["state"]=evidence.status;
    let candidate=evidence.status==="AUTO"&&evidence.candidates.length===1?evidence.candidates[0]!:null;
    let reason=evidence.reason;
    if(last&&last.action!=="withdrawn") {
      if(last.identity_id!==identity.id) {state="REVIEW";candidate=null;reason="human_evidence_reconsideration_required";}
      else if(last.action==="held") {state="HELD";candidate=null;reason="human_identity_hold";}
      else if(last.action==="forced_approved") {
        const ticker=forcedDecisionTicker(last);
        if(!ticker) return unavailable("human_override_ticker_invalid");
        const checked=await checkForcedOverrideConflicts(raw,evidence,ticker,text(last.override_reference),repository);
        if(checked.conflict) {state="REVIEW";candidate=null;reason=checked.conflict;}
        else return {status:"available",state:"HUMAN_APPROVED",ticker,exchange:evidence.exchange,
          identityId:String(identity.id),rawItemId:input.rawItemId,evidenceSha256:String(identity.evidence_sha256),revision:history.length,
          reason:"forced_manual_override",evidence,history};
      }
      else if(last.action==="approved") {
        candidate=evidence.candidates[Number(last.candidate_index)]??null;
        if(!candidate) return unavailable("human_candidate_unavailable");
        if(evidence.mode==="historical_replay") {
          const verified=await historicalCandidates(raw,candidate.accession||"",repository,Boolean(candidate.sourceRawItemId));
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

async function historicalCandidates(raw:Row,accession:string,repository:Form25IdentityRepository,preferRetainedRaw=false):Promise<IdentityCandidate[]|null> {
  if(!/^\d{10}-\d{2}-\d{6}$/.test(accession)) return null;
  const parsed=parseSecForm25Filing(rawIdentityInput(raw));const subject=cik(parsed.facts.subject_company_cik?.value);
  const security=parsed.facts.removed_security?.value;const filingDate=parsed.facts.filing_date?.value;
  if(!subject||!security||!filingDate) return null;
  const candidates:IdentityCandidate[]=[];
  const retained=await repository.select("raw_items",{select:"*",source_unique_id:`eq.${accession}`,source_code:"eq.sec_edgar",limit:"10"});
  if(!retained.ok)return null;
  const parsedRaw=rows(retained.data).flatMap(source=>{
    try{const built=buildSecCoverObservationPayload(String(source.id),source);return built?[{result:built.result,observations:built.observations,sourceRawItemId:String(source.id)}]:[];}catch{return [];}
  });
  // Manual entry can validate the retained original directly; no observation row is required.
  const read=preferRetainedRaw&&parsedRaw.length?{status:"not_found" as const}:await readSecCoverObservations({accessionNumber:accession,repository});
  if(read.status==="unavailable")return null;
  const evidenceSets=preferRetainedRaw&&parsedRaw.length?parsedRaw
    :read.status==="available"&&read.results.length?read.results:parsedRaw;
  for(const item of evidenceSets) {
    const date=text(item.result.filing_date_raw);
    if(cik(item.result.issuer_cik)!==subject||!date||date.slice(0,10)>filingDate.slice(0,10)) continue;
    for(const observation of item.observations) {
      if(!["observed","duplicate_equal"].includes(String(observation.security_title_status))||!["observed","duplicate_equal"].includes(String(observation.trading_symbol_status))) continue;
      if(preferRetainedRaw&&!["observed","duplicate_equal"].includes(String(observation.exchange_status)))continue;
      const title=text(observation.security_title_raw);const ticker=text(observation.trading_symbol_raw);
      // These are review candidates, never automatic historical security relationships.
      const before=classifySecurity(security),after=title?classifySecurity(title):null;
      if(!ticker||!title||!before||!after||before.type!==after.type||before.securityClass!==after.securityClass) continue;
      candidates.push({ticker,exchange:text(observation.exchange_raw),cik:subject,source:String(item.result.source_url),accession,security:title,
        context:String(observation.context_ref),sourceSha256:String(item.result.source_sha256),
        ...("sourceRawItemId" in item?{sourceRawItemId:item.sourceRawItemId,extractionMethod:"retained_sec_cover_parser"}:{})});
    }
  }
  return Array.from(new Map(candidates.map(row=>[sha(row),row])).values());
}

/** A typed symbol is only a search claim until retained SEC context verifies it. */
export async function registerSecForm25IdentityCandidate(input:{rawItemId:string;actorUserId:string;ticker:unknown;historicalAccessionNumber:unknown;
  expectedEvidenceSha256:unknown;expectedRevision:unknown;reason:unknown;requestId:string;repository?:Form25IdentityRepository}) {
  const repository=input.repository??await defaultRepository();
  const ticker=String(input.ticker??"").trim().toUpperCase(),accession=String(input.historicalAccessionNumber??"").trim(),reason=String(input.reason??"").trim();
  if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)||!/^\d{10}-\d{2}-\d{6}$/.test(accession)||reason.length<4||reason.length>2000)
    throw new AdminApiError("FORM25_CANDIDATE_INPUT_INVALID","Enter a ticker, retained SEC accession and evidence reason.",400);
  const rawRead=await repository.select("raw_items",{select:"*",id:`eq.${input.rawItemId}`,limit:"1"});const raw=rows(rawRead.data)[0];
  if(!rawRead.ok||!raw||!isForm25IdentityRaw(raw))throw new AdminApiError("FORM25_SOURCE_UNAVAILABLE","The filing source is unavailable.",409);
  const base=buildForm25IdentityEvidence(raw,{rows:[],available:true},"historical_replay");
  if(!base.subjectCik||base.reason==="subject_cik_conflict"||!base.security)throw new AdminApiError("FORM25_SUBJECT_CONFLICT","Resolve the SEC subject/security conflict before adding a candidate.",409);
  const verified=await historicalCandidates(raw,accession,repository,true);
  const candidates=Array.from(new Map((verified||[]).filter(candidate=>candidate.ticker===ticker&&candidate.exchange&&candidate.security&&candidate.context&&candidate.sourceSha256&&/^https:\/\/(?:www\.)?sec\.gov\/Archives\//i.test(candidate.source))
    .map(candidate=>[`${candidate.ticker}|${candidate.security}|${candidate.context}|${candidate.sourceSha256}`,candidate])).values());
  if(candidates.length!==1)throw new AdminApiError("FORM25_CANDIDATE_EVIDENCE_REQUIRED","The retained SEC source must identify one matching issuer, ticker, security context and exchange. No identity was changed.",409);
  const evidence:Form25IdentityEvidence={...base,status:"REVIEW",reason:"manual_candidate_sec_evidence_requires_approval",candidates};
  const result=await repository.rpc("admin_register_sec_form25_identity_candidate",{p_raw_item_id:input.rawItemId,p_actor_user_id:input.actorUserId,p_evidence:evidence,p_evidence_sha256:sha(evidence),p_raw_snapshot:form25SourceSnapshot(raw),p_expected_sha256:input.expectedEvidenceSha256,p_expected_revision:input.expectedRevision,p_reason:reason,p_request_id:input.requestId});
  if(!result.ok)throw new AdminApiError("FORM25_CANDIDATE_CONFLICT","The evidence or review changed. Refresh before registering a candidate.",result.status===403?403:409);
  return result.data;
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
      const raw=rows(rawRead.data)[0];const verified=rawRead.ok&&raw?await historicalCandidates(raw,candidate.accession||"",repository,Boolean(candidate.sourceRawItemId)):null;
      if(!verified?.some(row=>sha(row)===sha(candidate))) throw new AdminApiError("FORM25_IDENTITY_EVIDENCE_CHANGED","Historical SEC evidence is no longer verified.",409);
    }
  }
  const result=await repository.rpc("admin_apply_sec_form25_identity_decision",{p_raw_item_id:input.rawItemId,p_actor_user_id:input.actorUserId,p_action:action,
    p_candidate_index:action==="approved"?Number(input.candidateIndex):null,p_expected_sha256:input.expectedEvidenceSha256,p_expected_revision:input.expectedRevision,
    p_reason:reason,p_request_id:input.requestId,p_raw_snapshot:form25SourceSnapshot(source)});
  if(!result.ok) throw new AdminApiError("FORM25_IDENTITY_WRITE_CONFLICT","The decision was not saved. Refresh the source and review revision.",result.status===403?403:409);
  return result.data;
}
/** Administrative attribution: absent proof is allowed, positive contradictions are not. */
async function checkForcedOverrideConflicts(raw:Row,evidence:Form25IdentityEvidence,ticker:string,reference:string|null,repository:Form25IdentityRepository) {
  const checks:Row[]=[];const snapshots:Row[]=[];
  if(evidence.reason==="subject_cik_conflict")return {conflict:"override_subject_conflict",checks,snapshots};
  const subject=evidence.subjectCik;
  const accession=form25ReferenceAccession(reference);
  let retained:Row[]=[];
  if(reference) {
    const read=await repository.select("raw_items",{select:"*",source_code:"eq.sec_edgar",...(accession?{source_unique_id:`eq.${accession}`}:{source_url:`eq.${reference}`}),limit:"20"});
    if(read.ok)retained=rows(read.data);
    checks.push({reference,status:!read.ok?"reference_lookup_unavailable":retained.length?"retained_reference":"reference_not_retained"});
  }
  for(const source of retained) {
    snapshots.push({id:String(source.id),snapshot:form25SourceSnapshot(source)});
    let issuer:string|null=null;let titles:string[]=[];
    try {
      if(isForm25IdentityRaw(source)) {
        const parsed=parseSecForm25Filing(rawIdentityInput(source));
        issuer=cik(parsed.facts.subject_company_cik?.value);
        const title=text(parsed.facts.removed_security?.value);if(title)titles=[title];
      } else {
        const parsed=buildSecCoverObservationPayload(String(source.id),source);
        issuer=cik(parsed?.result.issuer_cik);
        const observations=parsed?.observations??[];
        const matching=observations.filter(row=>text(row.trading_symbol_raw)===ticker);
        const relevant=matching.length?matching:observations;
        titles=Array.from(new Set(relevant.filter(row=>["observed","duplicate_equal"].includes(String(row.security_title_status))).map(row=>text(row.security_title_raw)).filter((value):value is string=>Boolean(value))));
      }
    } catch { /* A parser failure is not proof against an administrator's attribution. */ }
    checks.push({rawItemId:source.id,accession:source.source_unique_id,issuerCik:issuer,security:titles,sourceSha256:form25SourceSha(source)});
    if(subject&&issuer&&subject!==issuer)return {conflict:"override_reference_issuer_conflict",checks,snapshots};
    if(titles.length===1&&clearForm25SecurityConflict(evidence.security,titles[0]))return {conflict:"override_reference_security_conflict",checks,snapshots};
  }
  // Existing official catalog evidence can disprove an entered issuer ticker; absence cannot prove it.
  const known=await repository.select("sec_form25_identity_evidence",{select:"evidence,evidence_sha256", "evidence->candidates":`cs.${JSON.stringify([{ticker}])}`,order:"sequence.desc",limit:"100"});
  if(known.ok&&subject) {
    const issuers=new Set(rows(known.data).flatMap(row=>{
      const proof=record(row.evidence) as unknown as Form25IdentityEvidence;
      if(sha(proof)!==row.evidence_sha256||proof.mode!=="current_catalog"||proof.status!=="AUTO")return [];
      return proof.candidates.filter(candidate=>candidate.ticker===ticker&&candidate.source===SEC_TICKER_CATALOG).map(candidate=>cik(candidate.cik)).filter((value):value is string=>Boolean(value));
    }));
    if(issuers.size)checks.push({ticker,knownIssuerCiks:Array.from(issuers).sort(),source:"retained_sec_catalog_identity"});
    if(issuers.size&&!issuers.has(subject))return {conflict:"override_ticker_issuer_conflict",checks,snapshots};
  }
  return {conflict:null,checks,snapshots};
}

export async function applySecForm25ForcedOverride(input:{rawItemId:string;actorUserId:string;action:unknown;ticker:unknown;reference:unknown;
  expectedEvidenceSha256:unknown;expectedRevision:unknown;reason:unknown;requestId:string;repository?:Form25IdentityRepository}) {
  const repository=input.repository??await defaultRepository();
  const action=String(input.action),ticker=String(input.ticker??"").trim().toUpperCase(),reason=String(input.reason??"").trim();
  let reference:string|null;
  try{reference=normalizeForm25OverrideReference(input.reference);}catch(error){throw new AdminApiError("FORM25_OVERRIDE_REFERENCE_INVALID",String((error as Error).message),400);}
  if(!["forced_approved","forced_withdrawn"].includes(action)||reason.length<4||reason.length>2000||(action==="forced_approved"&&!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker)))
    throw new AdminApiError("FORM25_OVERRIDE_INPUT_INVALID","Enter an override ticker and a reason of 4–2,000 characters.",400);
  const current=await readEffectiveSecForm25Identity({rawItemId:input.rawItemId,repository});
  if(current.status!=="available")throw new AdminApiError("FORM25_OVERRIDE_UNAVAILABLE","The original source or audit history cannot be verified.",409);
  const sourceRead=await repository.select("raw_items",{select:"*",id:`eq.${input.rawItemId}`,limit:"1"});const source=rows(sourceRead.data)[0];
  if(!sourceRead.ok||!source||form25SourceSha(source)!==current.evidence.sourceSha256)throw new AdminApiError("FORM25_OVERRIDE_SOURCE_CHANGED","Refresh the changed source.",409);
  const checked=action==="forced_approved"?await checkForcedOverrideConflicts(source,current.evidence,ticker,reference,repository):{conflict:null,checks:[],snapshots:[]};
  if(checked.conflict)throw new AdminApiError("FORM25_OVERRIDE_CONFLICT",`The entered identity conflicts with known SEC issuer or security information (${checked.conflict}).`,409);
  const result=await repository.rpc("admin_apply_sec_form25_forced_override",{p_raw_item_id:input.rawItemId,p_actor_user_id:input.actorUserId,p_action:action,
    p_ticker:action==="forced_approved"?ticker:null,p_reference:reference,p_reason:reason,p_expected_sha256:input.expectedEvidenceSha256,p_expected_revision:input.expectedRevision,
    p_request_id:input.requestId,p_raw_snapshot:form25SourceSnapshot(source),p_reference_snapshots:checked.snapshots,p_conflict_checks:checked.checks});
  if(!result.ok)throw new AdminApiError("FORM25_OVERRIDE_WRITE_CONFLICT","The override was not saved. Refresh the evidence and review history.",result.status===403?403:409);
  return result.data;
}

async function defaultRepository():Promise<Form25IdentityRepository> {const repo=await import("../supabase.ts");return {select:repo.supabaseSelect,rpc:repo.supabaseRpc};}
