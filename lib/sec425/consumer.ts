import {readFacts,enabled} from "./storage.ts";
import {conditionErrors,has425} from "./conditions.ts";
import {listActiveListingMonitorsForConsumer,type ListingMonitor} from "../monitor/listingMonitorPersistence.ts";
import {readReportedHoldingsFilingTime,reportedHoldingsWasActive} from "../monitor/reportedHoldingsTime.ts";
import {evidenceSchema,type FactEvidence} from "./evidence.ts";
import type {assessFacts} from "./facts.ts";
type Assessment=Omit<ReturnType<typeof assessFacts>,"rawOutput">;
export function match425(facts:Assessment,conditions:readonly {key:string;operator:string;value:unknown}[]){
 if(conditionErrors(conditions).length||!has425(conditions)||facts.status!=="available"||!facts.announcement)return false;
 const a=facts.announcement;if(!a.parties.some(p=>p.identity))return false;
 return conditions.every(c=>{
  if(c.key==="sec425.announcement_type")return a.type===c.value;
  if(c.key.startsWith("sec425.transaction."))return a.transactionTypes?.includes(c.key.slice("sec425.transaction.".length) as never)===true;
  const role=c.key==="sec425.acquirer_ticker"?"acquirer":"target",parties=a.parties.filter(p=>p.claim.role===role);
  return parties.length===1&&parties[0].identity?.ticker===c.value;
 });
}
export async function allowedUser(userId:string){
 if(!enabled())return false;
 const {getEffectiveUserPlan}=await import("../subscription/effectivePlan.ts");
 return["pro","advanced","ultimate"].includes((await getEffectiveUserPlan(userId)).effectivePlan);
}
type Dependencies={read:typeof readFacts;list:typeof listActiveListingMonitorsForConsumer;allowed:typeof allowedUser;write:typeof writeAlert;now:()=>Date};
export async function consumeSec425Alerts(rawItemId:string,dependencies:Partial<Dependencies>={}){
 if(!enabled())return{status:"disabled",createdCount:0,existingCount:0};
 const d={read:readFacts,list:listActiveListingMonitorsForConsumer,allowed:allowedUser,write:writeAlert,now:()=>new Date(),...dependencies};
 const read=await d.read(rawItemId),evaluations:{monitorId:string;reason:string}[]=[],writes:{status:string;monitorId:string}[]=[];
 if(read.status!=="available"||read.canonical.status!=="available"||!read.canonical.announcement)return{status:"not_ready",createdCount:0,existingCount:0};
 const monitors=(await d.list()).monitors.filter(m=>has425(m.conditions)),time=readReportedHoldingsFilingTime(read.binding.acceptedAt,read.binding.filingDate);
 for(const monitor of monitors){
  const reason=!reportedHoldingsWasActive(monitor.createdAt,time)?"monitor_activation_not_met":!await d.allowed(monitor.userId)?"plan_unavailable":!match425(read.canonical,monitor.conditions)?"conditions_not_matched":"match";
  evaluations.push({monitorId:monitor.id,reason});if(reason!=="match")continue;
  const a=read.canonical.announcement;
  const evidence=evidenceSchema.parse({version:"sec425_alert_v1",rawItemId,executionId:read.sourceExecutionId,accession:read.binding.accession,sourceUrl:read.binding.sourceUrl,sourceSha256:read.binding.sourceSha256,
   announcementType:a.type,statement:a.statement,transactionTypes:a.transactionTypes??[],companies:a.parties.flatMap(p=>p.identity?[{cik:p.identity.cik,ticker:p.identity.ticker,name:p.identity.companyName??p.identity.sourceName,role:p.claim.role}]:[]),
   terms:a.terms.filter(t=>t.available).map(t=>t.claim),quotes:a.evidence.map(({blockId,sourceField,start,end,sourceQuote})=>({blockId,sourceField,start,end,sourceQuote})),
   conditions:monitor.conditions,monitorCreatedAt:monitor.createdAt,filedAt:time!.instant,evaluatedAt:d.now().toISOString(),scope:"candidate_isolated"});
  writes.push({...await d.write(monitor,evidence),monitorId:monitor.id});
 }
 if(writes.some(w=>w.status==="failed"))throw Error("sec425_alert_write_failed");
 return{status:"completed",evaluations,writes,createdCount:writes.filter(w=>w.status==="created").length,existingCount:writes.filter(w=>w.status==="existing").length};
}
async function writeAlert(m:ListingMonitor,e:FactEvidence){
 const {supabaseUpsert}=await import("../supabase.ts");
 const r=await supabaseUpsert("user_alert_deliveries",{user_id:m.userId,listing_monitor_id:m.id,listing_source_execution_id:e.executionId,sec425_raw_item_id:e.rawItemId,sec425_match_evidence:e,
  alert_event_id:null,ticker:null,title:"Acquisition announcement matched",category:"listing_risk",source_type:"other",source_label:"425 Announcement Monitor",alert_lane:"listing_monitor",alert_domain:"listing",delivery_status:"queued",delivered_channels:[],delivered_at:e.evaluatedAt},
  {onConflict:"listing_monitor_id,sec425_raw_item_id",prefer:"resolution=ignore-duplicates,return=representation"});
 if(!r.ok)return{status:"failed"};return{status:Array.isArray(r.data)&&r.data.length?"created":"existing"};
}
