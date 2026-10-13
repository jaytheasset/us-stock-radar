import {repository,select,type Repository} from '../sec-offering-plan/repository.ts';
import {consumeListingMonitorAlertsForEvent} from './listingMonitorAlertConsumer.ts';

export async function consumeOfferingPlanEvent(eventId:string){
 const result=await consumeListingMonitorAlertsForEvent({eventId,conditionFamily:'offering_plan'});
 if(result.failedCount)throw Error('offering_plan_internal_alert_write_failed');
 return result;
}
/** Existing completed-result/approval retry entry. No extraction, enqueue or provider call. */
export async function offeringPlanRunSaved(runId:string,supplied?:Repository,consume=consumeOfferingPlanEvent){
 try{
  const repo=supplied??await repository();
  const run=(await select(repo,'ai_runs',{id:`eq.${runId}`,select:'raw_item_id',limit:'1'}))[0];
  if(!run?.raw_item_id)return {status:'not_ready' as const};
  const results=[];
  for(let offset=0;;offset+=1000){
   const events=await select(repo,'events',{raw_item_id:`eq.${run.raw_item_id}`,select:'id',order:'id.asc',offset:String(offset),limit:'1000'});
   for(const event of events)results.push(await consume(String(event.id)));
   if(events.length<1000)break;
  }
  return {status:'completed' as const,results};
 }catch{
  // Committed extraction/approval must remain committed. Replaying the same entry retries safely.
  console.error('[offering-plan-monitor] evaluation failed; replay the saved run');
  return {status:'failed' as const};
 }
}
