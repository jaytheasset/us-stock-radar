import test from "node:test";
import assert from "node:assert/strict";
import {consumeSec425Alerts} from "./consumer.ts";

// Synthetic delivery fixtures only: these assertions do not assess model semantics.
const rawId="00000000-0000-4000-8000-000000000001";
const conditions=[{key:"sec425.announcement_type",operator:"eq",value:"revised_acquisition_proposal"}];
function fixture(){
 const writes:unknown[]=[];
 const read:any={status:"available",sourceExecutionId:"00000000-0000-4000-8000-000000000002",
  binding:{accession:"0000000001-26-000001",sourceUrl:"https://www.sec.gov/Archives/edgar/data/1/000000000126000001/test.htm",sourceSha256:"a".repeat(64),acceptedAt:"2026-02-01T12:00:00Z",filingDate:"2026-02-01"},
  canonical:{status:"available",announcement:{type:"revised_acquisition_proposal",statement:"Synthetic proposal",transactionTypes:["acquisition"],
   parties:[{claim:{role:"target"},identity:{cik:"0000000001",ticker:"SYN",companyName:"Synthetic Company"}}],
   terms:[{available:true,claim:"Synthetic non-binding term"},{available:false,claim:"Unsupported term"}],evidence:[]}}};
 const monitor:any={id:"00000000-0000-4000-8000-000000000003",userId:"synthetic-owner",createdAt:"2026-01-01T00:00:00Z",conditions};
 const dependencies={read:async()=>read,list:async()=>({monitors:[monitor]}) as any,allowed:async()=>true,
  write:async(m:unknown,e:unknown)=>{writes.push({m,e});return{status:"created"};},now:()=>new Date("2026-02-02T00:00:00Z")};
 return{read,monitor,dependencies,writes};
}
async function enabled(run:()=>Promise<void>){
 const before=process.env.SEC425_MONITOR_ENABLED;process.env.SEC425_MONITOR_ENABLED="true";
 try{await run();}finally{if(before===undefined)delete process.env.SEC425_MONITOR_ENABLED;else process.env.SEC425_MONITOR_ENABLED=before;}
}
test("default disabled consumer performs no source, plan or write operation",async()=>{
 const before=process.env.SEC425_MONITOR_ENABLED;delete process.env.SEC425_MONITOR_ENABLED;
 try{assert.equal((await consumeSec425Alerts(rawId,{read:async()=>{throw Error("must not read");}})).status,"disabled");}
 finally{if(before!==undefined)process.env.SEC425_MONITOR_ENABLED=before;}
});
test("unavailable source, pre-activation filing, unavailable plan and mismatched predicates produce no delivery",async()=>enabled(async()=>{
 for(const scenario of ["unavailable","old","plan","mismatch"]){
  const f=fixture();
  if(scenario==="unavailable")f.read.status="not_ready";
  if(scenario==="old")f.monitor.createdAt="2026-03-01T00:00:00Z";
  if(scenario==="plan")f.dependencies.allowed=async()=>false;
  if(scenario==="mismatch")f.monitor.conditions=[...conditions,{key:"sec425.target_ticker",operator:"eq",value:"OTHER"}];
  assert.equal((await consumeSec425Alerts(rawId,f.dependencies)).createdCount,0,scenario);assert.equal(f.writes.length,0,scenario);
 }
}));
test("raw-only match preserves owner, execution and conditions; unsupported terms are excluded",async()=>enabled(async()=>{
 const f=fixture(),before=JSON.stringify(f.read);const result=await consumeSec425Alerts(rawId,f.dependencies);
 assert.equal(result.createdCount,1);assert.equal(f.writes.length,1);
 const written=f.writes[0] as any;
 assert.equal(written.m.userId,"synthetic-owner");assert.equal(written.e.rawItemId,rawId);
 assert.equal(written.e.executionId,f.read.sourceExecutionId);assert.deepEqual(written.e.conditions,conditions);
 assert.deepEqual(written.e.terms,["Synthetic non-binding term"]);assert.equal(JSON.stringify(f.read),before);
}));
test("delivery persistence failure remains a failure rather than a successful empty result",async()=>enabled(async()=>{
 const f=fixture();f.dependencies.write=async()=>({status:"failed"});
 await assert.rejects(consumeSec425Alerts(rawId,f.dependencies),/sec425_alert_write_failed/);
}));
