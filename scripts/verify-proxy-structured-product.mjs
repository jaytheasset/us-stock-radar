// Bounded saved-source verification on the authorized local DB; never edits existing rows.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {registerHooks} from 'node:module';
import pg from 'pg';
registerHooks({resolve(s,c,next){return s==='server-only'?{shortCircuit:true,url:'data:text/javascript,export{}'}:next(s,c)}});
const [mode,outDir] = process.argv.slice(2);assert.ok(['seed','replay','fresh','read'].includes(mode));
const out=resolve(outDir);assert.ok(!out.startsWith(process.cwd()));mkdirSync(out,{recursive:true});
const save=(n,v)=>writeFileSync(resolve(out,n),JSON.stringify(v,null,2));
const json=p=>JSON.parse(readFileSync(p,'utf8'));
const cli=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(new URL(cli.DB_URL).hostname,'127.0.0.1');assert.equal(new URL(cli.DB_URL).port,'56322');
process.env.SUPABASE_URL=cli.API_URL;process.env.SUPABASE_SECRET_KEY=cli.SECRET_KEY||cli.SERVICE_ROLE_KEY;
process.env.WORKFLOW_LOCAL_BASE_URL='http://127.0.0.1:3115';process.env.WORKFLOW_LOCAL_DATA_DIR=resolve('.next/workflow-data');
const {buildProxySource}=await import('../lib/sec-proxy/source.ts');
const {loadInput,readProxyStructured,readProxyAccession,proxyRepository,readRun}=await import('../lib/sec-proxy/persistence.ts');
const {processProxyStructured}=await import('../lib/sec-proxy/runtime.ts');
const {enqueueProxyStructured}=await import('../lib/sec-proxy/starter.ts');
const {proxyMonitorFacts,readCurrentProxyFacts}=await import('../lib/monitor/proxyStructuredFacts.ts');
const {evaluateMonitorConditions}=await import('../lib/listingMonitorMatcher.ts');
const {createListingMonitor,listListingMonitorsForOwner,listActiveListingMonitorsForConsumer}=await import('../lib/monitor/listingMonitorPersistence.ts');
const {consumeListingMonitorAlertsForEvent,createListingMonitorAlert}=await import('../lib/monitor/listingMonitorAlertConsumer.ts');
const sourceRoot='C:/Users/PC/.codex/visualizations/2026/10/02/01a0fe0e-fb35-7723-9790-6561fc3aacb0/proxy-structured-v1/json-mode-neutral-expanded/raw';
const retained='C:/Users/PC/Documents/Codex/US-Stock Radar-proxy-recovery-e8c6/outputs';
const cases=[{name:'Alternus',cik:'1883984',ticker:'ALCE',raw:'alternus-mixed-capital.html',one:'proxy-call1-handoff-v3d-alternus',two:'proxy-alternus-capital-shaped-native-schema-once',proposals:8},
 {name:'BigBear',cik:'1836981',ticker:'BBAI',raw:'bigbear-supplement.html',one:'proxy-bigbear-latest-prompts-once',two:'proxy-bigbear-thin-native-schema-once',proposals:0}];
const db=new pg.Client({connectionString:cli.DB_URL});await db.connect();const report={mode,cases:[],actualProviderCalls:0};
try {
 assert.equal((await db.query('select system_identifier::text id from pg_control_system()')).rows[0].id,'7678429483712069671');
 const repo=await proxyRepository();
 if(mode==='seed') {
  const seeded=[];
  for(const c of cases){
   const filing=JSON.parse(json(`${retained}/${c.two}/request.json`).contents[0].parts[0].text).input.filing;
   const html=readFileSync(`${sourceRoot}/${c.raw}`,'utf8');
   const p={form_type:filing.form_type,accession_number:filing.accession_number,cik:c.cik,company_name:filing.company_name,
    filing_date:filing.filing_date,accepted_at:null,ticker:c.ticker,primary_document_url:filing.source_url,
    primary_document_html:html,primary_document_html_truncated:false,attachment_texts:[]};
   let row=(await db.query('select * from raw_items where source_code=$1 and source_unique_id=$2',['sec_edgar',filing.accession_number])).rows[0];
   if(!row)row=(await db.query(`insert into raw_items(source_code,source_group,source_unique_id,source_url,title,published_at,body_text,analysis_text,raw_payload,metadata,dedupe_key)
    values('sec_edgar','filings',$1,$2,$3,$4,$5,$5,$6,$7,$8) returning *`,[filing.accession_number,filing.source_url,filing.company_name,filing.filing_date,html,p,{verification:'proxy-product-20261005'},'sec_edgar:'+filing.accession_number])).rows[0];
   assert.equal(row.metadata.verification,'proxy-product-20261005');assert.deepEqual(row.raw_payload,p);
   const input=buildProxySource(row),old=json(`${retained}/${c.one}/source-package.json`);
   assert.deepEqual(input.source.evidenceBlocks.map(({documentId,...b})=>b),old.evidenceBlocks.map(({documentId,...b})=>b));
   let event=(await db.query('select id from events where raw_item_id=$1',[row.id])).rows[0];
   if(!event)event=(await db.query(`insert into events(raw_item_id,source_code,source_group,source_url,published_at,ticker,event_type,score,delivery_level,title,metadata,impact,signal,group_dedupe_key)
    values($1,'sec_edgar','filings',$2,$3,$4,'shareholder_vote',0,'archive',$5,$6,'low','neutral',$7) returning id`,[row.id,filing.source_url,filing.filing_date,c.ticker,filing.company_name,{verification:'proxy-product-20261005',source_only:true},'proxy-verification:'+filing.accession_number])).rows[0];
   seeded.push({...c,rawItemId:row.id,eventId:event.id,filing,blocks:input.source.evidenceBlocks.length});
  }
  save('seed.json',seeded);save('transport.json',{mode:'replay',responses:Object.fromEntries(cases.map(c=>[c.name,{call1:`${retained}/${c.one}/${c.name==='BigBear'?'call1.response.raw.json':'response.raw.json'}`,call2:`${retained}/${c.two}/response.raw.json`}]))});
  console.log(JSON.stringify(seeded.map(c=>({name:c.name,rawItemId:c.rawItemId,blocks:c.blocks}))));
 } else {
  const seeded=json(resolve(out,'seed.json'));
  if(mode==='fresh'){assert.equal(json(resolve(out,'replay-report.json')).passed,true);const config=json(resolve(out,'transport.json'));save('transport.json',{...config,mode:'fresh'});}
  const manifest=mode==='read'?null:json('app/.well-known/workflow/v1/manifest.json');
  const descriptor=manifest?.workflows['workflows/proxy-structured.ts'].proxyStructuredWorkflow;
  const {start,getRun}=await import('workflow/api');
  for(const c of seeded){
   const verificationKey=mode==='fresh'?'product-fresh-20261005':'product-replay-20261005';
   let enqueued;
   if(mode!=='read'){
    let starts=0;const options={verificationKey,start:async job=>{starts++;return start({workflowId:descriptor.workflowId},[job]);}};
    enqueued=await enqueueProxyStructured(c.rawItemId,options);
    if(enqueued.status==='duplicate'&&existsSync(resolve(out,`${mode}-${c.name}-enqueue.json`)))enqueued=json(resolve(out,`${mode}-${c.name}-enqueue.json`));
    else save(`${mode}-${c.name}-enqueue.json`,enqueued);
    assert.equal(enqueued.status,'enqueued',JSON.stringify(enqueued));
    assert.equal((await enqueueProxyStructured(c.rawItemId,options)).status,'duplicate');assert.ok(starts<=1);
    const run=getRun(enqueued.workflowRunId),began=Date.now();let status;
    while(Date.now()-began<300000){status=await run.status;if(['completed','failed','cancelled'].includes(status))break;await new Promise(r=>setTimeout(r,1000));}
    save(`${mode}-${c.name}-workflow.json`,{status,runId:enqueued.workflowRunId,elapsedMs:Date.now()-began,...(status==='completed'?{result:await run.returnValue}:{})});
    assert.equal(status,'completed');
   }
   const read=await readProxyStructured(c.rawItemId,repo,verificationKey);save(`${mode}-${c.name}-read.json`,read);
   const input=await loadInput(c.rawItemId,repo,verificationKey),stored=await readRun(repo,input.executionId);save(`${mode}-${c.name}-stored.json`,stored);
   // A bounded fresh case may fail validation. Record it; never seek a better response.
   if(read.status!=='available'){report.cases.push({name:c.name,status:read.status,reason:read.reason});continue;}
   assert.equal((await readCurrentProxyFacts(c.eventId,repo,verificationKey)).status,'available');
   assert.equal((await readProxyAccession(c.filing.accession_number,repo)).status,'not_ready','verification namespace must not become automatic FACT');
   const facts=proxyMonitorFacts(read,c.eventId),readers={proxy:facts,listing:{status:'not_ready',reason:'unused'},corporateAction:{status:'not_ready',reason:'unused'},ownership:{status:'not_ready',reason:'unused'}};
   const match=evaluateMonitorConditions(readers,[{key:'proxy.has_capital_structure_proposal',operator:'eq',value:true}],{evaluationDate:'2026-10-05'});
   if(mode==='replay'){assert.equal(read.canonical.items.filter(x=>x.is_proposal).length,c.proposals);assert.equal(match.status,c.name==='Alternus'?'match':'no_match');}
   const duplicate=await processProxyStructured({rawItemId:c.rawItemId,executionId:input.executionId,verificationKey},{repository:repo,fetchImpl:async()=>{throw Error('No provider calls on duplicate');}});
   assert.equal(duplicate.status,'succeeded');
   report.cases.push({name:c.name,status:'available',executionId:input.executionId,match,usage:read.usage,duplicate});
  }
  const ownerId='d2f2c6ce-64fa-40d6-a0b6-7e42e1fa0d32';
  assert.equal((await db.query("select count(*)::int n from auth.users where id=$1 and email like 'sr-review-user-%@example.test'",[ownerId])).rows[0].n,1);
  let monitor=(await listListingMonitorsForOwner(ownerId)).monitors.find(m=>m.conditions.length===1&&m.conditions[0].key==='proxy.has_capital_structure_proposal');
  monitor??=await createListingMonitor({ownerId,conditions:[{key:'proxy.has_capital_structure_proposal',operator:'eq',value:true}]});
  report.monitorId=monitor.id;report.activation=[];
  for(const c of seeded){const consumer=await consumeListingMonitorAlertsForEvent({eventId:c.eventId,conditionFamily:'proxy'}, {
    readProxyFacts:id=>readCurrentProxyFacts(id,repo,mode==='fresh'?'product-fresh-20261005':'product-replay-20261005'),
    listActiveMonitors:listActiveListingMonitorsForConsumer,createAlert:createListingMonitorAlert,now:()=>new Date()});const evaluation=consumer.evaluations.find(e=>e.monitorId===monitor.id);
   assert.equal(consumer.createdCount,0);report.activation.push({name:c.name,evaluation,createdCount:consumer.createdCount});}
  report.passed=report.cases.every(c=>c.status==='available');
  report.actualProviderCalls=mode==='fresh'?cases.reduce((n,c)=>n+['call1','call2'].filter(s=>existsSync(resolve(out,`fresh-${c.name}-${s}-claimed.json`))).length,0):0;
  save(`${mode}-report.json`,report);console.log(JSON.stringify(report));
 }
}finally{await db.end()}
process.exit(0);
