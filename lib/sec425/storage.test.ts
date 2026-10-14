import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {processFacts,sourceInput,readFacts,type Repository} from "./storage.ts";
const source=process.env.SEC425_SOURCE_EVIDENCE;
function fixture(){
 const raw=JSON.parse(fs.readFileSync(source+"/diana-fresh-raw.json","utf8"));raw.id="00000000-0000-4000-8000-000000000001";
 const input=sourceInput(raw),run:any={id:input.executionId,raw_item_id:raw.id,prompt_key:"sec425_facts",status:"pending",metadata:{binding:input.binding,state:"pending",stages:{}}};let outputs:any[]=[];
 let checkpointFailure=false;
 const repo:Repository={select:async(table)=>({ok:true,data:table==="raw_items"?[raw]:table==="ai_runs"?[run]:outputs}),rpc:async(name,p:any)=>{
  if(name==="sec425_transition"){
   if(p.p_action==="begin"){
    if(run.metadata.stages.fact?.state==="complete")return{ok:true,data:{checkpoint:run.metadata.stages.fact}};
    if(run.metadata.stages.fact)return{ok:true,data:{claimed:false,status:"busy"}};
    run.status="running";run.metadata.stages.fact={state:"started",requestHash:p.p_value.requestHash,mode:p.p_value.mode};return{ok:true,data:{claimed:true,token:"synthetic"}};
   }
   if(p.p_action==="uncertain"){run.status="failed";run.metadata.state="uncertain";return{ok:true,data:{status:"uncertain"}};}
   if(checkpointFailure)throw Error("synthetic_checkpoint_outage");
   run.metadata.stages.fact={...run.metadata.stages.fact,state:"complete",response:p.p_value.response};return{ok:true,data:{saved:true}};
  }
  run.status=p.p_status;run.metadata.state=p.p_status;run.finished_at="2026-10-15T00:00:00Z";outputs=[{payload:p.p_payload}];return{ok:true,data:{status:p.p_status}};
 }};
 return{raw,input,run,repo,failCheckpoint:()=>{checkpointFailure=true;}};
}
const response=()=>Response.json({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({decision:"not_applicable",reason:"synthetic contract fixture, not an extraction result",context:"prior_background",evidence:[],announcement:null})}]}}]});
test("single durable provider claim: concurrent work/replay cannot issue another request",{skip:!source},async()=>{
 const f=fixture(),job={rawItemId:f.raw.id,executionId:f.input.executionId};let calls=0,release!:()=>void;const wait=new Promise<void>(r=>{release=r;});
 const fetchImpl=async()=>{calls++;await wait;return response();};const first=processFacts(job,{repo:f.repo,fetchImpl,apiKey:"synthetic-key"});
 await new Promise(r=>setTimeout(r,5));assert.equal((await processFacts(job,{repo:f.repo,fetchImpl,apiKey:"synthetic-key"})).status,"busy");release();assert.equal((await first).status,"succeeded");
 await processFacts(job,{repo:f.repo,fetchImpl,apiKey:"synthetic-key"});assert.equal(calls,1);const read=await readFacts(f.raw.id,f.repo);assert.equal(read.status,"available");if(read.status==="available")assert.equal(read.canonical.status,"not_ready");
});
test("unknown transport outcome stays terminal; checkpoint outage cannot cause provider reissue",{skip:!source},async()=>{
 for(const kind of ["transport","checkpoint"]){const f=fixture();let calls=0;const job={rawItemId:f.raw.id,executionId:f.input.executionId};if(kind==="checkpoint")f.failCheckpoint();
  const fetchImpl=async()=>{calls++;if(kind==="transport")throw Error("synthetic timeout");return response();};
  try{await processFacts(job,{repo:f.repo,fetchImpl,apiKey:"synthetic-key"});}catch(e){assert.equal(kind,"checkpoint");}
  const replay=await processFacts(job,{repo:f.repo,fetchImpl,apiKey:"synthetic-key"});assert.equal(replay.status,kind==="transport"?"uncertain":"busy");assert.equal(calls,1);
 }
});
test("changed raw source is stale before a provider call",{skip:!source},async()=>{
 const f=fixture();f.raw.raw_payload.primary_document_html+=" ";let calls=0;
 const result=await processFacts({rawItemId:f.raw.id,executionId:f.input.executionId},{repo:f.repo,apiKey:"synthetic-key",fetchImpl:async()=>{calls++;return response();}});
 assert.equal(result.status,"stale");assert.equal(calls,0);
});
