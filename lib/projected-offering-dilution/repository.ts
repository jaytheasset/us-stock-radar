import {repository,rpc,select,type Repository} from '../sec-os-snapshot/repository.ts';
import {buildSource as osSource} from '../sec-os-snapshot/source.ts';
import {buildSource as offeringSource} from '../sec-offering-plan/source.ts';
import {sha,stable,type Snapshot} from '../sec-os-snapshot/contract.ts';
import type {Offering} from '../sec-offering-plan/contract.ts';
import {calculate,CALCULATION_REVISION,type Fact,type Decision} from './calculate.ts';
import {isCombinedForm} from '../sec-combined-offering/eligibility.ts';
import {readCombinedDomainSource} from '../sec-combined-offering/repository.ts';

export type ReadResult={status:'not_ready';reason:string}|{status:'available';eventId:string;rawItemId:string;sourceExecutionId:string;persistedAt:string;filedAt:string;facts:Fact;guard:unknown;sourceUrl:string;evidence:{id:string;text:string}[]};
export async function prepare(rawId:string,repo:Repository){
  const input=await rpc(repo,'read_projected_offering_inputs',{p_raw_id:rawId});
  if(!input.os||!input.offering||!input.raw)return null;
  const o=input.os,p=input.offering;
  let os,offering;
  if(isCombinedForm(input.raw.raw_payload?.form_type)){
    const runs=await select(repo,'ai_runs',{id:`in.(${o.id},${p.id})`,select:'*'});
    const or=runs.find(r=>r.id===o.id),pr=runs.find(r=>r.id===p.id);
    if(!or||!pr||or.metadata.combinedInvocationId!==pr.metadata.combinedInvocationId)return null;
    const a=await readCombinedDomainSource(or,repo),b=await readCombinedDomainSource(pr,repo);
    if(a.parent.id!==input.commonInvocationId||a.parent.id!==b.parent.id
      ||stable(a.value)!==stable(o.value)||stable(b.value)!==stable(p.value))return null;
    os=a.source;offering=b.source;
  }else{os=osSource(input.raw);offering=offeringSource(input.raw);}
  if(o.status!==o.value?.status||p.status!==p.value?.status)return null;
  const fact=calculate({runId:o.id,value:o.value as Snapshot,fingerprint:o.fingerprint,currentFingerprint:os.fingerprint,decision:o.decision as Decision},
    {runId:p.id,value:p.value as Offering,fingerprint:p.fingerprint,currentFingerprint:offering.fingerprint,decision:p.decision as Decision});
  if(!fact)return null;
  const hash=sha(stable([CALCULATION_REVISION,fact.accession,o.id,p.id,fact.provenance]));
  const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  return {id,fact,guard:input.guard,rawId,filedAt:offering.filing.accepted_at??`${offering.filing.filing_date}T00:00:00Z`,
    sourceUrl:os.documents[0].url,evidence:os.blocks.filter(b=>fact.provenance.evidence_blocks.includes(b.id)).map(b=>({id:b.id,text:b.text}))};
}
export async function refreshProjectedForRun(runId:string,supplied?:Repository){
  const repo=supplied??await repository();
  const run=(await select(repo,'ai_runs',{id:`eq.${runId}`,select:'raw_item_id',limit:'1'}))[0];
  if(!run)return {status:'not_ready'};
  return refreshProjected(String(run.raw_item_id),supplied);
}
export async function refreshProjected(rawId:string,supplied?:Repository){
  const repo=supplied??await repository(),prepared=await prepare(rawId,repo);
  if(!prepared)return {status:'not_ready'};
  const saved=await rpc(repo,'save_projected_offering_fact',{p_id:prepared.id,p_raw_id:rawId,p_guard:prepared.guard,p_fact:prepared.fact});
  // The existing Monitor consumer and existing internal outbox. No external delivery or provider invocation.
  if(!supplied){
    const {consumeListingMonitorAlertsForEvent}=await import('../monitor/listingMonitorAlertConsumer.ts');
    const events=await select(repo,'events',{raw_item_id:`eq.${rawId}`,source_code:'eq.sec_edgar',select:'id',limit:'100'});
    for(const e of events){const result=await consumeListingMonitorAlertsForEvent({eventId:String(e.id),conditionFamily:'projected'});if(result.failedCount)throw Error('projected_alert_write_failed');}
  }
  return saved;
}
/** Reads never publish, calculate missing history, enqueue, or invoke a worker. Fresh source/review validation on every read. */
export async function readProjectedFacts(eventId:string,supplied?:Repository):Promise<ReadResult>{
  try{
    const repo=supplied??await repository();
    const e=(await select(repo,'events',{id:`eq.${eventId}`,source_code:'eq.sec_edgar',select:'raw_item_id',limit:'1'}))[0];
    if(!e)return {status:'not_ready',reason:'event_unavailable'};
    const p=await prepare(String(e.raw_item_id),repo);
    if(!p)return {status:'not_ready',reason:'public_pair_unavailable'};
    const stored=(await select(repo,'projected_offering_dilution_facts',{id:`eq.${p.id}`,select:'fact,created_at,source_guard',limit:'1'}))[0];
    if(!stored||stable(stored.fact)!==stable(p.fact)||stable(stored.source_guard)!==stable(p.guard))return {status:'not_ready',reason:'current_fact_unavailable'};
    return {status:'available',eventId,rawItemId:p.rawId,sourceExecutionId:p.id,persistedAt:String(stored.created_at),filedAt:p.filedAt,facts:p.fact,guard:p.guard,sourceUrl:p.sourceUrl,evidence:p.evidence};
  }catch{return {status:'not_ready',reason:'reader_unavailable'};}
}
