import {repository,select,type Repository} from '../sec-os-snapshot/repository.ts';
import {buildSource as osSource} from '../sec-os-snapshot/source.ts';
import {buildSource as offeringSource} from '../sec-offering-plan/source.ts';
import {readCombinedDomainSource} from '../sec-combined-offering/repository.ts';
import {PROJECTED_RETIRED_REASON} from './repository.ts';
import {readMatchingOsRun} from '../sec-offering-plan/repository.ts';
import type {Fact} from './calculate.ts';

export type ImpactRead={status:'not_ready';reason:string}|{status:'available';facts:Fact;sourceUrl:string;evidence:{id:string;text:string}[]};
export type ImpactHistory={factId:string;createdAt:string;read:Extract<ImpactRead,{status:'not_ready'}>;current:false;retired:true;evidenceAvailable:boolean;
 recorded:{facts:Fact;sourceUrl:string;evidence:{id:string;text:string}[]};
 decisions:{domain:'os'|'offering';id:string|null;approvedAt:string|null}[]};
const uuid=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/** Exact immutable history. Current eligibility and evidence availability never replace the recorded fact. */
async function history(stored:Record<string,any>,repo:Repository):Promise<ImpactHistory>{
 const facts=stored.fact as Fact;let sourceUrl='',evidence:{id:string;text:string}[]=[],evidenceAvailable=false;
 try{
  const runs=await select(repo,'ai_runs',{id:`in.(${facts.os_run_id},${facts.offering_run_id})`,select:'*'});
  const o=runs.find(r=>r.id===facts.os_run_id&&r.prompt_key==='sec_os_snapshot'),p=runs.find(r=>r.id===facts.offering_run_id&&r.prompt_key==='sec_offering_plan');
  if(!o||!p||o.raw_item_id!==stored.raw_item_id||p.raw_item_id!==stored.raw_item_id)throw Error('history_pair_mismatch');
  let a,b;
  if(o.metadata.executionKind==='derived_domain_view'||p.metadata.executionKind==='derived_domain_view'){
   const os=await readCombinedDomainSource(o,repo),off=await readCombinedDomainSource(p,repo);
   if(os.parent.id!==off.parent.id)throw Error('history_parent_mismatch');a=os.source;b=off.source;
  }else{
   const raw=(await select(repo,'raw_items',{id:`eq.${stored.raw_item_id}`,select:'*',limit:'1'}))[0];
   a=osSource(raw);b=offeringSource(raw);
  }
  if(a.fingerprint!==facts.provenance.os_fingerprint||b.fingerprint!==facts.provenance.offering_fingerprint
   ||o.metadata.binding.sourceFingerprint!==a.fingerprint||p.metadata.binding.sourceFingerprint!==b.fingerprint)throw Error('history_source_changed');
  const refs=new Set(facts.provenance.evidence_blocks),blocks=new Map([...a.blocks,...b.blocks].map(v=>[v.id,v.text]));
  if([...refs].some(id=>!blocks.has(id)))throw Error('history_evidence_missing');
  sourceUrl=b.documents[0]?.url??'';evidence=[...refs].map(id=>({id,text:blocks.get(id)!}));evidenceAvailable=true;
 }catch{ /* Old quantities remain historical; unavailable evidence is never substituted. */ }
 const decisions=await Promise.all((['os','offering'] as const).map(async domain=>{
  const id=domain==='os'?facts.provenance.os_decision_id:facts.provenance.offering_decision_id;
  if(!id)return {domain,id:null,approvedAt:null};
  const row=(await select(repo,domain==='os'?'sec_os_snapshot_decisions':'sec_offering_plan_decisions',{
   id:`eq.${id}`,run_id:`eq.${domain==='os'?facts.os_run_id:facts.offering_run_id}`,select:'id,action,created_at',limit:'1'}))[0];
  return {domain,id,approvedAt:row?.action==='approve'?String(row.created_at):null};
 }));
 return {factId:String(stored.id),createdAt:String(stored.created_at),read:{status:'not_ready',reason:PROJECTED_RETIRED_REASON},
  recorded:{facts,sourceUrl,evidence},current:false,retired:true,evidenceAvailable,decisions};
}

/** Called only after the existing administrator permission gate; no persistence or implicit approval. */
export async function readOfferingImpact(runId:string,supplied?:Repository){
 if(!uuid(runId))return {osRunId:null,history:null};const repo=supplied??await repository();
 const run=(await select(repo,'ai_runs',{id:`eq.${runId}`,prompt_key:'eq.sec_offering_plan',select:'id,raw_item_id,metadata',limit:'1'}))[0];
 if(!run)return {osRunId:null,history:null};
 const stored=(await select(repo,'projected_offering_dilution_facts',{'fact->>offering_run_id':`eq.${runId}`,raw_item_id:`eq.${run.raw_item_id}`,select:'*',order:'created_at.desc,id.desc',limit:'1'}))[0];
 if(stored)return {osRunId:stored.fact.os_run_id as string,history:await history(stored,repo)};
 return {osRunId:await readMatchingOsRun(run,repo),history:null};
}

/** Ownership is checked before any fact, run, source or decision read. No private admin fields leave this reader. */
export async function readProjectedAlertForOwner(ownerId:string,alertId:string,supplied?:Repository){
 if(!uuid(ownerId)||!uuid(alertId))return null;const repo=supplied??await repository();
 const alert=(await select(repo,'user_alert_deliveries',{id:`eq.${alertId}`,user_id:`eq.${ownerId}`,alert_lane:'eq.listing_monitor',
  select:'id,alert_event_id,projected_fact_id,projected_scenario',limit:'1'}))[0];
 if(!alert?.projected_fact_id)return null;
 const stored=(await select(repo,'projected_offering_dilution_facts',{id:`eq.${alert.projected_fact_id}`,select:'*',limit:'1'}))[0];
 if(!stored)return null;
 return {alertId:String(alert.id),eventId:alert.alert_event_id as string|null,scenario:String(alert.projected_scenario),...await history(stored,repo)};
}
