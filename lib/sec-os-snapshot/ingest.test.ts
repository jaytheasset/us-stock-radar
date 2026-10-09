import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){if(s==='server-only')return{shortCircuit:true,url:'data:text/javascript,export{}'};if(s==='@/lib/ai/secInvestableUniverseGate')return{shortCircuit:true,url:'data:text/javascript,export function evaluateSecInvestableUniverse(){return null}'};return next(s,c);}});
const {runSecRawIngest}=await import('../secIngest.ts');
for(const form of ['F-1','F-1/A','S-1','S-8']) for(const mode of ['new','existing','dry']) test(`OS enqueue: ${form} / ${mode}`,async()=>{
 const calls:string[]=[],id='00000000-0000-4000-a000-000000000001';
 const row={source_code:'sec_edgar',source_group:'filings',source_unique_id:'0000000001-26-000001',source_url:'https://www.sec.gov/test',title:form,body_text:'source',analysis_text:'source',dedupe_key:'fixture',metadata:{},raw_payload:{form_type:form,cik:'1',documents:[]}};
 const result=await runSecRawIngest({dryRun:mode==='dry'},{fetchRawItems:async()=>({ok:true,status:200,items:[row],diagnostics:{documentsRequested:1,documentsFetched:1,documentsFailed:0}}),ensureSource:async()=>{},createSourceRun:async()=>'running',finishSourceRun:async()=>{},findExistingRawItem:async()=>mode==='existing'?{id}:null,saveRawItem:async()=>{calls.push('saved');return{id};},persistCoverObservations:async()=>({status:'not_applicable'}),persistS8Registration:async()=>({status:'unavailable'}),enqueueCombinedOffering:async()=>{calls.push('combined');return{id,status:'QUEUED'};},enqueueOfferingPlan:async()=>({status:'not_run'}),enqueueOsSnapshot:async()=>{calls.push('os');return{id,status:'QUEUED'};}} as never);
 assert.equal(result.ok,true);assert.equal(calls.includes('combined'),mode!=='dry'&&form==='S-1');assert.equal(calls.includes('os'),mode!=='dry'&&['F-1','F-1/A'].includes(form));if(mode==='new'&&calls.includes('os'))assert.ok(calls.indexOf('saved')<calls.indexOf('os'));
});
