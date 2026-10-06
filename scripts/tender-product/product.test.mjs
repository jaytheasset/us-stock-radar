import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){return s==='server-only'?{shortCircuit:true,url:'data:text/javascript,export{}'}:next(s,c);}});
const {fixture}=await import('./fixture.mjs');
const {buildTenderBinding,hash,stable,TENDER_STRUCTURED_QUERIES}=await import('../../lib/sec-tender/source.ts');
const {tenderStructuredProviderSchema,deriveTenderCurrencyNotations,parseTenderStructured,buildTenderStructuredRequest}=await import('../../lib/sec-tender/contract.ts');
const {runTenderStructuredAnalyzer}=await import('../../lib/sec-tender/analyzer.ts');
const {readTenderStructured}=await import('../../lib/sec-tender/persistence.ts');
const {tenderMonitorFacts}=await import('../../lib/monitor/tenderStructuredFacts.ts');
const {evaluateMonitorConditions}=await import('../../lib/listingMonitorMatcher.ts');
const {validateMonitorConditionInput,getReadyMonitorCondition}=await import('../../lib/monitor/conditionRegistry.ts');
const {consumeListingMonitorAlertsForEvent}=await import('../../lib/monitor/listingMonitorAlertConsumer.ts');
const {runSecRawIngest}=await import('../../lib/secIngest.ts');
const raw=fixture(),built=buildTenderBinding(raw),refs=built.providerSource.evidence.map(e=>e.ref);
const blank=()=>({offer_price:null,board_recommendation:null,offer_status:null,final_results_observed:null});
const output=()=>({...blank(),final_results_observed:{evidence_refs:[refs[0]]}});
const parse=v=>parseTenderStructured(JSON.stringify(v),built.source,built.providerSource);
const envelope=v=>({modelVersion:'gemini-3.5-flash',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(v)}]}}]});

test('4 slots required; expiration/unresolved/observed:false and extra fields rejected',()=>{
 const s=tenderStructuredProviderSchema(built.providerSource);assert.deepEqual(s.required,Object.keys(blank()));assert.equal(parse(blank()).ok,true);
 for(const k of Object.keys(blank())){const v=blank();delete v[k];assert.equal(parse(v).ok,false);}
 for(const k of ['expiration','unresolved'])assert.equal(parse({...blank(),[k]:null}).ok,false);
 assert.equal(parse({...blank(),final_results_observed:{observed:false,evidence_refs:[refs[0]]}}).ok,false);
 assert.equal(parseTenderStructured('{"offer_price":null,"offer_price":null}',built.source,built.providerSource).ok,false);
});
test('currency enum source-literal, no issuer hardcoding; no currency => only null',()=>{
 const p={...built.providerSource,evidence:[{ref:'E1',text:'US$12.00; CAD 3.40; 8 EUR; $0.50; EUR 9; 7 USD'}]};
 assert.deepEqual(deriveTenderCurrencyNotations(p),['US$','$','CAD','EUR','USD']);
 assert.deepEqual(deriveTenderCurrencyNotations(built.providerSource),['$','USD']);
 assert.deepEqual(tenderStructuredProviderSchema({...p,evidence:[{ref:'E1',text:'No price stated'}]}).properties.offer_price,{type:'null'});
 for(const currency_text of ['per share in cash','$18.82','EUR'])assert.equal(parse({...blank(),offer_price:{current:{amount:18.82,currency_text},previous:null,current_evidence_refs:[refs[0]],previous_evidence_refs:[]}}).ok,false);
});
test('canonical fixed unit/true projection; null generates no fact; no semantic repair',()=>{
 const v={...output(),offer_price:{current:{amount:999,currency_text:'$'},previous:{amount:888,currency_text:'$'},current_evidence_refs:[refs[0]],previous_evidence_refs:[refs[0]]}};
 const result=parse(v);assert.equal(result.ok,true);assert.deepEqual(result.result.canonical.facts[0].current,{amount:999,currency_text:'$',unit:'cash_per_share'});assert.equal(result.result.canonical.facts[1].observed,true);
 assert.deepEqual(parse(blank()).result.canonical.facts,[]);
});
test('previous decisions, references and duplicate/foreign references',()=>{
 for(const type of ['offer_price','board_recommendation']){
  const current=type==='offer_price'?{amount:1,currency_text:'$'}:'accept';
  const v={...blank(),[type]:{current,previous:null,current_evidence_refs:[refs[0]],previous_evidence_refs:[]}};
  assert.equal(parse(v).ok,true);v[type].previous=current;assert.equal(parse(v).ok,false);v[type].previous_evidence_refs=[refs[0]];assert.equal(parse(v).ok,true);
  v[type].previous_evidence_refs.push(refs[0]);assert.equal(parse(v).ok,false);v[type].previous_evidence_refs=['FOREIGN'];assert.equal(parse(v).ok,false);
  delete v[type].previous;assert.equal(parse(v).ok,false);
 }
});
test('exact source, projection and full revision binding; CIK neither required nor invented',()=>{
 assert.equal('issuerCik'in built.binding,false);assert.equal('cik'in raw.raw_payload,false);assert.equal(TENDER_STRUCTURED_QUERIES.length,3);assert.ok(TENDER_STRUCTURED_QUERIES.every(q=>!/expiration|carlyle|HSR/i.test(q)));
 for(const e of built.source.evidence){assert.equal(e.textHash,hash(e.text));assert.equal(e.document.accession,raw.source_unique_id);}
 const wrong=structuredClone(built.providerSource);wrong.evidence[0].text+='changed';assert.equal(parseTenderStructured(JSON.stringify(blank()),built.source,wrong).ok,false);
 const altered=structuredClone(raw);altered.raw_payload.documents[0].text+='\nrevision';const b=buildTenderBinding(altered);assert.equal(b.executionId,built.executionId);assert.notEqual(b.binding.sourceFingerprint,built.binding.sourceFingerprint);
 const poison=structuredClone(raw);poison.analysis_text='fabricated';poison.raw_payload.expiration_date='2030-01-01';assert.deepEqual(buildTenderBinding(poison).providerSource,built.providerSource);
 const partial=structuredClone(raw);partial.raw_payload.documents[0].textTruncated=true;assert.throws(()=>buildTenderBinding(partial),/coverage/);
 const foreign=structuredClone(raw);foreign.source_unique_id='0000000000-00-000000';assert.throws(()=>buildTenderBinding(foreign));
});
test('provider exactly one invocation on HTTP, malformed or transport failures; no fallback',async()=>{
 for(const mode of ['ok','http','bad','throw']){let calls=0;const r=await runTenderStructuredAnalyzer(built.source,built.providerSource,{apiKey:'test',fetchImpl:async(url,init)=>{calls++;assert.match(url,/gemini-3.5-flash:generateContent$/);assert.equal(init.redirect,'error');if(mode==='throw')throw Error('test');return new Response(mode==='bad'?'bad':JSON.stringify(envelope(output())),{status:mode==='http'?503:200});}});assert.equal(calls,1);assert.equal(r.ok,mode==='ok');}
});
function stored(){const outputText=JSON.stringify(output()),validated=parse(output()).result;const request=buildTenderStructuredRequest(built.providerSource),body=JSON.stringify(envelope(output()));return {
 run:{id:built.executionId,raw_item_id:raw.id,prompt_key:'sec_tender_structured',prompt_version:'tender_structured_v1',model:'gemini-3.5-flash',status:'succeeded',finished_at:'2026-10-06T00:00:00Z',metadata:{binding:built.binding,state:'succeeded',stages:{structured:{state:'complete',request,requestHash:hash(JSON.stringify(request)),response:{status:200,body,bodyHash:hash(body)}}}}},
 payload:{binding:built.binding,outputText,outputSha256:hash(outputText),canonical:validated.canonical,canonicalHash:hash(stable(validated.canonical)),evidence:validated.evidence}};}
test('Reader validates immutable output, checkpoint, hash, identity and current revision',async()=>{
 for(const mode of ['ok','raw','model','hash','canonical','count','checkpoint']){const s=stored(),r=structuredClone(raw);if(mode==='raw')r.raw_payload.documents[0].text+=' revised';if(mode==='model')s.run.model='other';if(mode==='hash')s.payload.outputSha256='bad';if(mode==='canonical')s.payload.canonical={facts:[]};if(mode==='checkpoint')s.run.metadata.stages.structured.response.body='bad';
  const repo={select:async table=>({ok:true,data:table==='raw_items'?[r]:table==='ai_runs'?[s.run]:mode==='count'?[{payload:s.payload},{payload:s.payload}]:[{payload:s.payload}]})};
  const read=await readTenderStructured(raw.id,repo);assert.equal(read.status,mode==='ok'?'available':'not_ready',mode);
 }
});
const facts=value=>({status:'available',eventId:raw.id,rawItemId:raw.id,sourceExecutionId:built.executionId,persistedAt:'2026-10-06T00:00:00Z',filedAt:raw.published_at,facts:{board_recommendation:null,offer_status:null,final_results_observed:value}});
const readers=value=>({tender:facts(value),listing:{status:'not_ready',reason:'unused'},corporateAction:{status:'not_ready',reason:'unused'},ownership:{status:'not_ready',reason:'unused'}});
const condition={key:'tender.final_results_observed',operator:'eq',value:true};
test('Monitor only 3 safe keys; false rejected; null is not false; typed eq/in',()=>{
 assert.equal(getReadyMonitorCondition('tender.expiration'),null);assert.equal(getReadyMonitorCondition('tender.offer_price'),null);
 assert.deepEqual(validateMonitorConditionInput(condition),[]);assert.ok(validateMonitorConditionInput({...condition,value:false}).length);
 assert.equal(evaluateMonitorConditions(readers(true),[condition],{evaluationDate:'2026-10-06'}).status,'match');
 for(const value of [true,false])assert.equal(evaluateMonitorConditions(readers(null),[{...condition,value}],{evaluationDate:'2026-10-06'}).status,'ineligible');
 for(const [key,value]of [['tender.board_recommendation','reject'],['tender.offer_status','withdrawn']]){assert.deepEqual(validateMonitorConditionInput({key,operator:'in',value:[value]}),[]);assert.ok(validateMonitorConditionInput({key,operator:'eq',value:'unknown'}).length);}
 const read={status:'available',canonical:parse(blank()).result.canonical};assert.equal(tenderMonitorFacts(read,raw.id).facts.final_results_observed,null);
});
test('Tender consumer activation and independent family routing/dedupe',async()=>{
 const active={id:'active',userId:'synthetic',conditions:[condition],createdAt:'2026-01-01T00:00:00Z'};const later={...active,id:'later',createdAt:'2026-10-06T00:00:00Z'};const other={...active,id:'other',conditions:[{key:'proxy.has_proposal',operator:'eq',value:true}]};const writes=new Set();
 const deps={listActiveMonitors:async()=>({monitors:[active,later,other],diagnostics:[]}),readTenderFacts:async()=>facts(true),now:()=>new Date('2026-10-06'),createAlert:async v=>{assert.equal(v.tenderAlert,true);assert.equal(v.monitorId,'active');const had=writes.has(v.monitorId);writes.add(v.monitorId);return {status:had?'existing':'created',monitorId:v.monitorId};}};
 const a=await consumeListingMonitorAlertsForEvent({eventId:raw.id,conditionFamily:'tender'},deps);assert.equal(a.createdCount,1);assert.equal(a.evaluations.length,2);assert.equal(a.evaluations.find(e=>e.monitorId==='later').reasonCode,'monitor_activation_not_met');
 assert.equal((await consumeListingMonitorAlertsForEvent({eventId:raw.id,conditionFamily:'tender'},deps)).createdCount,0);
});
test('automatic ingest trigger: supported, unsupported, dry-run, sidecar failure isolation',async()=>{
 for(const mode of ['supported','unsupported','dry','error']){let calls=0;const item=structuredClone(raw);if(mode==='unsupported')item.raw_payload.form_type='TEST';
  const result=await runSecRawIngest({dryRun:mode==='dry'},{fetchRawItems:async()=>({ok:true,status:200,items:[item],diagnostics:{documentsRequested:0,documentsFetched:0,documentsFailed:0}}),ensureSource:async()=>({}),createSourceRun:async()=>'running',finishSourceRun:async()=>({}),findExistingRawItem:async()=>null,saveRawItem:async()=>raw,persistCoverObservations:async()=>({status:'not_applicable'}),recordCoverState:async()=>({}),enqueueTenderStructured:async()=>{calls++;if(mode==='error')throw Error('isolated');return {status:'enqueued'};}});
  assert.equal(calls,mode==='supported'||mode==='error'?1:0,JSON.stringify(result));assert.equal(result.ok,true,JSON.stringify(result));
 }
});
