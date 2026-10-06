import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deriveCurrencyNotations,buildProviderSchema,buildRequest,validateOutput,projectCanonical} from './contract.mjs';
import {prior,folder,json,hash,callOnce,accession,sourceFiles} from './run.mjs';
import {projectSource} from '../tender-fact-batches/runner.mjs';

const source=await json(join(prior,'source.json')),p=projectSource(source),refs=p.providerSource.evidence.map(e=>e.ref),currencies=deriveCurrencyNotations(p.providerSource);
const mapBytes=await readFile(join(prior,'evidence-map.json'),'utf8'),frozenMapHash=hash(mapBytes);
const empty=()=>({expiration:null,offer_price:null,board_recommendation:null,offer_status:null,final_results_observed:null,unresolved:[]});
const correct=()=>({...empty(),
 expiration:{current:'2026-07-24',previous:'2026-06-22',current_evidence_refs:['E1'],previous_evidence_refs:['E4']},
 offer_price:{current:{amount:0.84,currency_text:'$',unit:'cash_per_share'},previous:{amount:0.82,currency_text:'$',unit:'cash_per_share'},current_evidence_refs:['E8'],previous_evidence_refs:['E12']},
 board_recommendation:{current:'reject',previous:null,current_evidence_refs:['E11'],previous_evidence_refs:[]}
});
const valid=v=>validateOutput(JSON.stringify(v),refs,currencies).local.valid;

test('01 DXL source-derived currency inventory is exactly bare dollar notation',()=>assert.deepEqual(currencies,['$']));
test('02 currency inventory comes only from evidence text and is deterministic',()=>{
 const s={evidence:[{text:'Price US$12.00; another 10 CAD; unrelated SEC 10; € 5.00.'}]};
 assert.deepEqual(deriveCurrencyNotations(s),['US$','€','CAD']);
 assert.deepEqual(deriveCurrencyNotations(s),deriveCurrencyNotations(s));
});
test('03 provider schema constrains both current and previous currency_text to source inventory',()=>{
 const schema=buildProviderSchema(refs,currencies),price=schema.properties.offer_price.properties;
 assert.deepEqual(price.current.properties.currency_text.enum,['$']);
 assert.deepEqual(price.previous.properties.currency_text.enum,['$']);
});
test('04 v2 bad currency role outputs are structurally rejected before canonical projection',()=>{
 const v=correct();v.offer_price.current.currency_text='per share in cash';assert.equal(valid(v),false);
 v.offer_price.current.currency_text='$';v.offer_price.previous.currency_text='$0.82';assert.equal(valid(v),false);
});
test('05 correct DXL values remain valid and projection does not rewrite semantics',()=>{
 const v=correct();assert.equal(valid(v),true);const out=projectCanonical(v),price=out.facts.find(f=>f.type==='offer_price');
 assert.equal(price.current.currency_text,'$');assert.equal(price.previous.currency_text,'$');assert.equal(price.current.amount,0.84);assert.equal(price.previous.amount,0.82);
});
test('06 fixed slots still require explicit previous decision and refs',()=>{
 const v=correct();delete v.expiration.previous;assert.equal(valid(v),false);
 const w=correct();w.expiration.previous=null;w.expiration.previous_evidence_refs=['E4'];assert.equal(valid(w),false);
});
test('07 null slots do not create canonical false facts',()=>assert.deepEqual(projectCanonical(empty()),{facts:[],unresolved:[]}));
test('08 no currency inventory makes offer_price positive structurally impossible',()=>{
 const no=[];const schema=buildProviderSchema(refs,no);assert.equal(schema.properties.offer_price.type,'null');
 const v=correct();assert.equal(validateOutput(JSON.stringify(v),refs,no).local.valid,false);
});
test('09 exact v2 source/provider/map bytes retained before any paid call',async()=>{
 const old=await json(join(prior,'frozen.json'));
 for(const f of sourceFiles){const b=await readFile(join(prior,f));assert.equal(hash(b),old.files[f]);try{assert.deepEqual(await readFile(join(folder,f)),b);}catch(e){if(e.code!=='ENOENT')throw e;}}
});
test('10 request has exact same provider source and no baseline leakage',async()=>{
 const r=buildRequest(p.providerSource),v2=await json(join(prior,'request.json'));assert.equal(r.contents[0].parts[0].text,v2.contents[0].parts[0].text);
 const nonSource=JSON.stringify({...r,contents:[]});for(const token of ['2026-07-24','2026-06-22','0.84','0.82','DXL',accession,'"expected":','"baseline":'])assert.ok(!nonSource.includes(token));
});
test('11 foreign currency strings cannot pass merely because they occur as prose',()=>{
 const v=correct();for(const x of ['USD','$0.84','per share in cash','cash']){const w=structuredClone(v);w.offer_price.current.currency_text=x;assert.equal(valid(w),false);}
});
test('12 amount and semantic state remain model-owned, not normalized by projection',()=>{
 const v=correct();v.offer_price.current.amount=999;assert.equal(valid(v),true);assert.equal(projectCanonical(v).facts.find(f=>f.type==='offer_price').current.amount,999);
});
test('13 one physical fetch and durable reservation remain enforced',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tender-v3-offline-'));await writeFile(join(dir,'evidence-map.json'),mapBytes);
 const args={folder:dir,identity:{runId:'v3-offline',accession},source,body:JSON.stringify(buildRequest(p.providerSource)),mapBytes,frozenMapHash,currencies,key:'mock'};
 let count=0;const fetchImpl=async()=>{count++;return {ok:true,status:200,text:async()=>JSON.stringify({modelVersion:'gemini-3.5-flash',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(correct())}]}}]})};};
 const a=await callOnce({...args,fetchImpl});assert.equal(count,1);assert.equal(a.technicalPass,true);assert.equal(a.semanticCorrections,0);
 await assert.rejects(callOnce({...args,fetchImpl}));assert.equal(count,1);
});
test('14 no retry on HTTP/transport/schema failure',async()=>{
 for(const kind of ['throw','http','schema']){const dir=await mkdtemp(join(tmpdir(),'tender-v3-fail-'));await writeFile(join(dir,'evidence-map.json'),mapBytes);
  const args={folder:dir,identity:{runId:'v3-'+kind,accession},source,body:JSON.stringify(buildRequest(p.providerSource)),mapBytes,frozenMapHash,currencies,key:'mock'};let count=0;
  const fetchImpl=async()=>{count++;if(kind==='throw')throw Error('x');return {ok:kind!=='http',status:kind==='http'?503:200,text:async()=>JSON.stringify({modelVersion:'gemini-3.5-flash',candidates:[{finishReason:'STOP',content:{parts:[{text:kind==='schema'?JSON.stringify({facts:[]}):JSON.stringify(correct())}]}}]})};};
  const a=await callOnce({...args,fetchImpl});assert.equal(count,1);assert.equal(a.technicalPass,false);assert.equal(a.retries+a.repairCalls+a.fallbackCalls,0);
 }
});
test('15 schema inventory is source-derived before request and not stored in provider user content',()=>{
 const r=buildRequest(p.providerSource);assert.deepEqual(r.generationConfig.responseJsonSchema.properties.offer_price.properties.current.properties.currency_text.enum,['$']);
 const user=JSON.parse(r.contents[0].parts[0].text);assert.equal(Object.hasOwn(user,'currencyInventory'),false);
});
