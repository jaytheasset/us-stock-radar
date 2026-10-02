import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
registerHooks({ resolve(s,c,next) {
  if (s === "server-only") return {shortCircuit:true,url:"data:text/javascript,export{}"};
  if (s === "@/lib/ai/secInvestableUniverseGate") return {shortCircuit:true,url:"data:text/javascript,export function evaluateSecInvestableUniverse(){return null}"};
  return next(s,c);
} });
const { runSecRawIngest } = await import("../secIngest.ts");
const raw = { source_code:"sec_edgar",source_group:"filings",source_unique_id:"0000000001-26-000001",
  source_url:"https://www.sec.gov/test",title:"S-8",published_at:"2026-01-02T00:00:00Z",fetched_at:"2026-01-02T00:00:00Z",
  body_text:"source",analysis_text:"source",dedupe_key:"test",metadata:{},raw_payload:{form_type:"S-8",cik:"1",documents:[]} };
for (const replay of [false,true]) for (const directAvailable of [false,true]) {
  test(`ingest ${replay ? "replay" : "fresh"}: Structured enqueue only after available direct history (${directAvailable})`, async()=>{
    const calls:string[]=[];
    const deps = {
      fetchRawItems:async()=>({ok:true,status:200,items:[raw],diagnostics:{documentsRequested:0,documentsFetched:0,documentsFailed:0}}),
      ensureSource:async()=>{},createSourceRun:async()=>"running",finishSourceRun:async()=>{},
      findExistingRawItem:async()=>replay ? {id:"00000000-0000-4000-a000-000000000001"} : null,
      saveRawItem:async()=>{calls.push("raw");return {id:"00000000-0000-4000-a000-000000000001"};},
      persistCoverObservations:async()=>({status:"not_applicable"}),recordCoverState:async()=>{},
      persistS8Registration:async()=>{calls.push("direct");if(!directAvailable)throw Error("direct failed");return {status:"available",writeStatus:"replayed"};},
      enqueueS8Structured:async()=>{calls.push("structured");return {status:"enqueued",executionId:"test"};},
    };
    const result=await runSecRawIngest({},deps as never);assert.equal(result.ok,true);
    assert.deepEqual(calls,[...(replay?[]:["raw"]),"direct",...(directAvailable?["structured"]:[])]);
  });
}
test("Structured enqueue failure does not discard successfully stored direct registration",async()=>{
  const result=await runSecRawIngest({}, {
    fetchRawItems:async()=>({ok:true,status:200,items:[raw],diagnostics:{documentsRequested:0,documentsFetched:0,documentsFailed:0}}),
    ensureSource:async()=>{},createSourceRun:async()=>"running",finishSourceRun:async()=>{},
    findExistingRawItem:async()=>({id:"00000000-0000-4000-a000-000000000001"}),
    persistCoverObservations:async()=>({status:"not_applicable"}),recordCoverState:async()=>{},
    persistS8Registration:async()=>({status:"available",writeStatus:"replayed"}),
    enqueueS8Structured:async()=>{throw Error("queue unavailable");},
  } as never);
  assert.equal(result.ok,true);
  const sidecar=result.items?.[0]?.s8_registration_persistence as Record<string,unknown>;
  assert.equal(sidecar.status,"available");assert.equal((sidecar.structured as Record<string,unknown>).status,"failed");
});
