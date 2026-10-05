import assert from "node:assert/strict";
import test from "node:test";
import {buildProxySource,hash,record,stable} from "./source.ts";
import {processProxyStructured} from "./runtime.ts";
import {readProxyStructured,type ProxyRepository} from "./persistence.ts";
import {proxyMonitorFacts} from "../monitor/proxyStructuredFacts.ts";
import {evaluateMonitorConditions} from "../listingMonitorMatcher.ts";
import {consumeListingMonitorAlertsForEvent} from "../monitor/listingMonitorAlertConsumer.ts";

const raw = () => ({id:"d0000000-0000-4000-8000-000000000001",source_code:"sec_edgar",source_unique_id:"0000000001-26-000001",
 source_url:"https://www.sec.gov/example",body_text:"PROPOSAL 1\nApprove the authorized common share increase. Stockholders will vote on Proposal 1.",
 raw_payload:{form_type:"PRE 14A",accession_number:"0000000001-26-000001",cik:"1",company_name:"Fixture",filing_date:"2026-10-01",attachment_texts:[]}});
const handoff = {version:"proxy_analysis_handoff_v3",document_notes:[],candidates:[{title:"Call1 title is not FACT",claims:[{text:"Approve authorized share increase",evidence:["E1"]}]}]};
const canonical = {version:"proxy_final_structured_v1",items:[{proposal_id:"P1",is_proposal:true,category:"capital_structure",capital_facts:{canonical_core:{
 action:{value:"Approve authorized share increase",evidence:["E1"]},proposal_status:null,changes:[{scope:null,reverse_split_ratio:null,authorized_shares_before:null,
 authorized_shares_after:{value:"roughly two hundred million, subject to amendment",evidence:["E1"]}}],prior_completed_capital_actions:[]},supporting_details:{}}}]};
const response = (value:unknown) => new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(value)}]},finishReason:"STOP"}],usageMetadata:{totalTokenCount:10}}),{status:200});
function harness() {
 const source=raw(),input=buildProxySource(source),job={rawItemId:source.id,executionId:input.executionId};
 const run:Record<string,any>={id:job.executionId,raw_item_id:job.rawItemId,prompt_version:"proxy_product_v1",status:"pending",metadata:{binding:input.binding,state:"pending",stages:{}}};
 let output:any=null,fetches=0,failFinish=false;
 const repo:ProxyRepository={select:async(table)=>({ok:true,data:table==="raw_items"?[source]:table==="ai_runs"?[run]:output?[{payload:output}]:[]}),rpc:async(name,p)=>{
  if(name==="finish_sec_proxy_structured"){
   if(failFinish){failFinish=false;return {ok:false,data:null,error:"transient storage failure"};}
   output=p.p_payload;run.status=p.p_status;run.finished_at="2026-10-05T00:00:00Z";run.metadata.state=p.p_status;run.usage=record(output).usage;
   return {ok:true,data:{status:run.status}};
  }
  const v=record(p.p_value),stage=String(v.stage),s=run.metadata.stages[stage];
  if(p.p_action==="begin"){
   if(s){if(s.requestHash!==v.requestHash)return {ok:false,data:null,error:"request changed"};return {ok:true,data:s.state==="complete"?{checkpoint:s}:{claimed:false,status:"busy"}};}
   run.status="running";run.metadata.stages[stage]={state:"started",requestHash:v.requestHash,mode:v.mode,startedAt:new Date().toISOString()};
   return {ok:true,data:{claimed:true,token:stage}};
  }
  if(p.p_action==="checkpoint"){s.state="complete";s.response=v.response;return {ok:true,data:{saved:true}};}
  run.status="failed";run.metadata.state="uncertain";return {ok:true,data:{status:"uncertain"}};
 }};
 const provider:typeof fetch=async()=>response(++fetches===1?handoff:canonical);
 return {source,input,job,run,repo,provider,fetches:()=>fetches,output:()=>output,failFinish:()=>{failFinish=true;}};
}
test("canonical Call2 only, exact source binding and checkpoint replay survive persistence failure",async()=>{
 const h=harness();h.failFinish();
 await assert.rejects(processProxyStructured(h.job,{repository:h.repo,apiKey:"fixture",fetchImpl:h.provider}),/transient storage failure/);
 assert.equal(h.fetches(),2);
 assert.equal((await processProxyStructured(h.job,{repository:h.repo,apiKey:"fixture",fetchImpl:h.provider})).status,"succeeded");
 assert.equal(h.fetches(),2);assert.equal(stable(h.output().canonical),stable(canonical));assert.ok(!stable(h.output().canonical).includes("Call1 title"));
 assert.equal(h.output().canonicalHash,hash(stable(canonical)));
 const read=await readProxyStructured(h.source.id,h.repo);assert.equal(read.status,"available");
 assert.equal((await processProxyStructured(h.job,{repository:h.repo,apiKey:"fixture",fetchImpl:h.provider})).status,"succeeded");assert.equal(h.fetches(),2);
 h.source.body_text+=" changed";assert.match((await readProxyStructured(h.source.id,h.repo)).status,/not_ready/);
});
test("unknown provider outcome never issues another call; incomplete and corrupt checkpoints are ineligible",async()=>{
 const h=harness();let calls=0;
 const fetchImpl:typeof fetch=async()=>{calls++;throw Error("connection lost after dispatch");};
 assert.equal((await processProxyStructured(h.job,{repository:h.repo,apiKey:"fixture",fetchImpl})).status,"uncertain");
 assert.equal((await processProxyStructured(h.job,{repository:h.repo,apiKey:"fixture",fetchImpl})).status,"uncertain");assert.equal(calls,1);
 assert.deepEqual(await readProxyStructured(h.source.id,h.repo),{status:"not_ready",reason:"provider_outcome_uncertain"});
 const complete=harness();await processProxyStructured(complete.job,{repository:complete.repo,apiKey:"fixture",fetchImpl:complete.provider});
 complete.run.metadata.stages.call2.response.body+="tampered";
 assert.deepEqual(await readProxyStructured(complete.source.id,complete.repo),{status:"not_ready",reason:"proxy_stored_validation_failed"});
});
test("raw read outage remains retryable; changed source becomes stale before dispatch",async()=>{
 const h=harness();let unavailable=true;
 const repo:ProxyRepository={...h.repo,select:async(table,query)=>{
  if(table==="raw_items"&&unavailable){unavailable=false;return {ok:false,data:null,error:"raw_store_unavailable"};}
  return h.repo.select(table,query);
 }};
 await assert.rejects(processProxyStructured(h.job,{repository:repo,apiKey:"fixture",fetchImpl:h.provider}),/raw_store_unavailable/);
 assert.equal(h.run.status,"pending");assert.equal(h.fetches(),0);
 assert.equal((await processProxyStructured(h.job,{repository:repo,apiKey:"fixture",fetchImpl:h.provider})).status,"succeeded");
 assert.equal(h.fetches(),2);
 const changed=harness();changed.source.body_text+=" changed";
 assert.equal((await processProxyStructured(changed.job,{repository:changed.repo,apiKey:"fixture",fetchImpl:changed.provider})).status,"stale");
 assert.equal(changed.fetches(),0);
});

test("failed validator is terminal and never retried",async()=>{
 const h=harness();let calls=0;
 const fetchImpl:typeof fetch=async()=>{calls++;return response({version:"invalid"});};
 assert.equal((await processProxyStructured(h.job,{repository:h.repo,apiKey:"fixture",fetchImpl})).status,"failed");
 await processProxyStructured(h.job,{repository:h.repo,apiKey:"fixture",fetchImpl});assert.equal(calls,1);assert.equal(h.output().canonical,null);
});
test("matcher uses only typed presence; unknown prose numeric/date keys cannot match",async()=>{
 const h=harness();await processProxyStructured(h.job,{repository:h.repo,apiKey:"fixture",fetchImpl:h.provider});
 const proxy=proxyMonitorFacts(await readProxyStructured(h.source.id,h.repo),"e0000000-0000-4000-8000-000000000001");
 const readers={proxy,listing:{status:"not_ready" as const,reason:"unused"},corporateAction:{status:"not_ready" as const,reason:"unused"},ownership:{status:"not_ready" as const,reason:"unused"}};
 const match=(key:string,value:unknown)=>evaluateMonitorConditions(readers,[{key,operator:"eq",value}],{evaluationDate:"2026-10-05"});
 assert.equal(match("proxy.has_capital_structure_proposal",true).status,"match");
 assert.equal(match("proxy.has_capital_structure_proposal",false).status,"no_match");
 assert.equal(match("proxy.authorized_shares_after",200000000).status,"ineligible");
 assert.equal(match("proxy.effective_date","2026-10-05").status,"ineligible");
});
test("existing consumer honors activation, internal alert dedupe and missing FACT",async()=>{
 const h=harness();await processProxyStructured(h.job,{repository:h.repo,apiKey:"fixture",fetchImpl:h.provider});
 let facts=proxyMonitorFacts(await readProxyStructured(h.source.id,h.repo),"e0000000-0000-4000-8000-000000000001");
 const conditions=[{key:"proxy.has_capital_structure_proposal",operator:"eq" as const,value:true}],saved=new Set<string>();
 const deps={readProxyFacts:async()=>facts,listActiveMonitors:async()=>({diagnostics:[],monitors:[
  {id:"early",userId:"fixture",domain:"listing" as const,isActive:true,conditions,createdAt:"2026-09-01T00:00:00Z",updatedAt:"2026-09-01T00:00:00Z"},
  {id:"late",userId:"fixture",domain:"listing" as const,isActive:true,conditions,createdAt:"2026-10-02T00:00:00Z",updatedAt:"2026-10-02T00:00:00Z"}]}),
  createAlert:async(i:{monitorId:string;eventId:string})=>{const k=i.monitorId+i.eventId,exists=saved.has(k);saved.add(k);return {status:exists?"existing" as const:"created" as const,monitorId:i.monitorId};},now:()=>new Date("2026-10-05T00:00:00Z")};
 const first=await consumeListingMonitorAlertsForEvent({eventId:"fixture",conditionFamily:"proxy"},deps);
 assert.equal(first.createdCount,1);assert.equal(first.evaluations.find(e=>e.monitorId==="late")?.reasonCode,"monitor_activation_not_met");
 assert.equal((await consumeListingMonitorAlertsForEvent({eventId:"fixture",conditionFamily:"proxy"},deps)).existingCount,1);
 facts={status:"not_ready",reason:"provider_outcome_uncertain"};assert.equal((await consumeListingMonitorAlertsForEvent({eventId:"fixture",conditionFamily:"proxy"},deps)).writes.length,0);
});
