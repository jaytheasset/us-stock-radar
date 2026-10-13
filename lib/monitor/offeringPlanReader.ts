import {repository,select,loadOfferingSource,type Repository} from '../sec-offering-plan/repository.ts';
import {sha,stable,validateOutput,type Offering,type Source} from '../sec-offering-plan/contract.ts';
import {eligibleComponent,publicOfferingPlanEvidence,offeringPlanEvidenceSchema,type OfferingPlanFacts} from './offeringPlanFacts.ts';
import {z} from 'zod';
const uuid=z.string().uuid();
export async function readOfferingPlanAlertForOwner(ownerId:string,alertId:string,supplied?:Repository){
 if(!uuid.safeParse(ownerId).success||!uuid.safeParse(alertId).success)return null;
 const repo=supplied??await repository();
 const row=(await select(repo,'user_alert_deliveries',{id:`eq.${alertId}`,user_id:`eq.${ownerId}`,alert_lane:'eq.listing_monitor',alert_domain:'eq.listing',select:'id,user_id,offering_plan_match_evidence',limit:'1'}))[0];
 if(!row||row.user_id!==ownerId)return null;
 const stored=offeringPlanEvidenceSchema.safeParse(row.offering_plan_match_evidence);if(!stored.success)return null;
 const current=await readOfferingPlanFacts(stored.data.eventId,repo);
 const currentValidity=current.status==='available'&&current.identity.runId===stored.data.runId&&current.identity.sourceFingerprint===stored.data.sourceFingerprint&&current.identity.outputHash===stored.data.outputHash&&current.identity.decisionId===stored.data.decisionId&&current.identity.candidateIndex===stored.data.candidateIndex?'current':'unavailable_or_changed';
 return {kind:'offering_plan_match_v1' as const,evidence:publicOfferingPlanEvidence(stored.data)!,currentValidity};
}
/** Exact current raw/run only. Latest incomplete or rejected work blocks older PASS fallback. */
export async function readOfferingPlanFacts(eventId:string,supplied?:Repository):Promise<OfferingPlanFacts>{
 const unavailable=(reason:string):OfferingPlanFacts=>({status:'not_ready',reason});
 try{
  if(!uuid.safeParse(eventId).success)return unavailable('event_invalid');const repo=supplied??await repository();
  const event=(await select(repo,'events',{id:`eq.${eventId}`,select:'id,raw_item_id',limit:'1'}))[0];if(!event?.raw_item_id)return unavailable('event_missing');
  const rawId=String(event.raw_item_id);
  const latest=(await select(repo,'ai_runs',{raw_item_id:`eq.${rawId}`,prompt_key:'in.(sec_offering_plan,sec_combined_offering)',select:'*',order:'metadata->>reservedAt.desc,id.desc',limit:'3'}));
  // Parent and child share reservedAt. Select the latest invocation first, then its designated child.
  const first=latest[0];if(!first)return unavailable('run_missing');let run=first;
  const parent=first.prompt_key==='sec_combined_offering'?first:first.metadata.executionKind==='derived_domain_view'
   ?(await select(repo,'ai_runs',{id:`eq.${first.metadata.combinedInvocationId}`,select:'*',limit:'1'}))[0]:null;
  if(parent){if(parent.metadata.combinedStatus!=='COMPLETE')return unavailable('latest_run_not_public');run=(await select(repo,'ai_runs',{id:`eq.${parent.metadata.binding.offeringRunId}`,select:'*',limit:'1'}))[0];}
  if(!run||run.prompt_key!=='sec_offering_plan'||run.raw_item_id!==rawId||run.status!=='succeeded')return unavailable('run_not_public');
  let source:Source,value:Offering;const cp=run.metadata.offeringCheckpoint;
  if(parent){const checked=await (await import('../sec-combined-offering/repository.ts')).readCombinedDomainSource(run,repo);source=checked.source;value=checked.value as Offering;}
  else{
   source=(await loadOfferingSource(run.metadata.binding,repo)).source;
   const output=(await select(repo,'ai_outputs',{ai_run_id:`eq.${run.id}`,output_type:'eq.sec_offering_plan',select:'payload',limit:'1'}))[0]?.payload;
   const validated=validateOutput(cp.raw,source,run.metadata.binding.contractVersion);
   if(cp.provider?.integrityError || (cp.provider?.rawBytesBase64 && Buffer.from(cp.provider.rawBytesBase64,'base64').toString('utf8')!==cp.raw) || stable(output)!==stable(cp)||sha(cp.provider?.rawBytesBase64?Buffer.from(cp.provider.rawBytesBase64,'base64'):cp.raw)!==cp.rawHash||!validated.ok||stable(validated.value)!==stable(cp.validated)||cp.status!==run.metadata.offeringStatus)return unavailable('source_output_mismatch');value=validated.value!;
  }
  if(!value||value.status!==run.metadata.offeringStatus)return unavailable('status_mismatch');
  const decisions=await select(repo,'sec_offering_plan_decisions',{run_id:`eq.${run.id}`,select:'id,action,candidate_indexes,created_at',order:'created_at.desc,id.desc',limit:'1'});
  const decision=decisions[0];let plan=value.plan,decisionId:null|string=null,candidateIndex:null|number=null;
  if(decision&&decision.action!=='approve')return unavailable('decision_not_public');
  if(value.status==='REVIEW_REQUIRED'){
   if(decision?.action!=='approve'||decision.candidate_indexes?.length!==1)return unavailable('review_not_approved');
   candidateIndex=decision.candidate_indexes[0];decisionId=decision.id;plan=value.review?.candidates[candidateIndex!]!;if(!plan)return unavailable('candidate_missing');
  }else if(value.status!=='PASS')return unavailable('result_not_public');
  const components=plan.components.flatMap(c=>{const eligible=eligibleComponent(c,plan,source);return eligible?[eligible]:[];});
  return {status:'available',eventId,sourceExecutionId:run.id,persistedAt:run.finished_at,filedAt:source.filing.filing_date,components,identity:{version:'offering_plan_match_v1',meaning:'stated_plan_component_not_execution',runId:run.id,rawId,eventId,accession:source.filing.accession,sourceFingerprint:source.fingerprint,outputHash:cp.rawHash,contractVersion:run.metadata.binding.contractVersion,filedAt:source.filing.filing_date,decisionId,candidateIndex}};
 }catch{return unavailable('source_unavailable_or_mismatch');}
}
