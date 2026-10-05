import assert from "node:assert/strict";
import test from "node:test";
import {registerHooks} from "node:module";
registerHooks({resolve(s,c,next){
  if(s === "@/lib/ai/secInvestableUniverseGate") return {shortCircuit:true,url:"data:text/javascript,export function evaluateSecInvestableUniverse(){return null}"};
  if(s === "server-only") return {shortCircuit:true,url:"data:text/javascript,export{}"};
  return next(s,c);
}});
const {runSecRawIngest}=await import("../secIngest.ts");
test("fresh and existing SEC Proxy raw paths schedule the same raw identity; dry runs never schedule",async()=>{
  for(const mode of ["fresh","existing","dry"]){
    const calls:string[]=[],id="d0000000-0000-4000-8000-000000000001";
    const row={source_code:"sec_edgar",source_group:"filings",source_unique_id:"0000000001-26-000001",source_url:"https://www.sec.gov/example",
      title:"Proxy",body_text:"Proposal 1",analysis_text:"Proposal 1",published_at:"2026-10-01",fetched_at:"2026-10-05",dedupe_key:"fixture",metadata:{},
      raw_payload:{form_type:"PRE 14A",cik:"1",ticker:"TEST",documents:[]}};
    const result=await runSecRawIngest({dryRun:mode==="dry"},{
      fetchRawItems:async()=>({ok:true,status:200,items:[row],diagnostics:{documentsRequested:1,documentsFetched:1,documentsFailed:0}}) as never,
      ensureSource:async()=>({}) as never,createSourceRun:async()=>"running",finishSourceRun:async()=>({}) as never,
      findExistingRawItem:async()=>mode==="existing"?{id,title:"Proxy"}:null,
      saveRawItem:async()=>({id,title:"Proxy"}),
      enqueueProxyStructured:async rawId=>{calls.push(rawId);return {status:"enqueued",executionId:id,workflowRunId:"fixture"};},
    });
    assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(calls,mode==="dry"?[]:[id]);
  }
});
