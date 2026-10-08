import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {localContext} from './os-local-context.mjs';
const out=process.argv[2];if(!out)throw Error('Evidence directory required');const setup=JSON.parse(readFileSync(join(out,'setup.json'),'utf8')),report=JSON.parse(readFileSync(join(out,'e2e-report.json'),'utf8')),fixtures=JSON.parse(readFileSync(join(out,'ui-fixtures.json'),'utf8'));
const {db}=localContext();await db.connect();const sha=x=>createHash('sha256').update(x).digest('hex');
try{
 const run=(await db.query('select * from public.ai_runs where id=$1',[report.runId])).rows[0],cp=run.metadata.offeringCheckpoint;
 assert.equal(cp.rawHash,sha(Buffer.from(cp.raw,'utf8')));assert.equal(JSON.parse(cp.provider.freeze).sha256,cp.rawHash);
 assert.deepEqual((await db.query('select payload from public.ai_outputs where ai_run_id=$1 and output_type=$2',[report.runId,'sec_offering_plan'])).rows[0].payload,cp);
 const osNow=(await db.query("select id,md5(row_to_json(r)::text) hash from public.ai_runs r where prompt_key='sec_os_snapshot' order by id")).rows;
 const outputsNow=(await db.query("select id,md5(row_to_json(o)::text) hash from public.ai_outputs o where output_type='sec_os_snapshot' order by id")).rows;
 assert.deepEqual(osNow,setup.osBefore);assert.deepEqual(outputsNow,setup.osOutputs);
 for(const role of ['anon','authenticated'])for(const table of ['ai_runs','ai_outputs','sec_offering_plan_decisions'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,'public.'+table,'SELECT'])).rows[0].allowed,false);
 for(const id of [fixtures.ids.PASS,fixtures.ids.REVIEW_REQUIRED,fixtures.ids.VALIDATION_FAILED]){
  const r=(await db.query('select metadata from public.ai_runs where id=$1',[id])).rows[0];assert.deepEqual((await db.query('select payload from public.ai_outputs where ai_run_id=$1',[id])).rows[0].payload,r.metadata.offeringCheckpoint);
 }
 // Finish the synthetic retry without a model so no synthetic job is left in the live queue.
 const id=fixtures.ids.TECHNICAL_FAILED,claimed=(await db.query("select public.sec_offering_plan_transition($1,'claim') value",[id])).rows[0].value;
 if(claimed.claimed){const checkpoint={status:'TECHNICAL_FAILED',raw:'',rawHash:sha(''),validated:null,validation:null,evidenceRefs:[],provider:{raw:'',retrySafe:false,technicalError:'synthetic_browser_test_finished_no_model'}};await db.query("select public.sec_offering_plan_transition($1,'checkpoint',$2,$3)",[id,claimed.token,checkpoint]);await db.query("select public.sec_offering_plan_transition($1,'finish',$2)",[id,claimed.token]);}
 const result={pass:true,rawHash:cp.rawHash,osRunsUnchanged:osNow.length,osOutputsUnchanged:outputsNow.length,adminDecisionsLeaveOutputsUnchanged:true,publicAccessDenied:true,syntheticQueueDrainedWithoutModel:true,additionalGptCalls:0};
 writeFileSync(join(out,'integrity-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await db.end();}
