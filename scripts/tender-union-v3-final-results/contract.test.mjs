import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deriveCurrencyNotations,buildRequest,validateOutput,projectCanonical} from '../tender-union-v3-dxl/contract.mjs';
import {prior,folder,json,hash,callOnce,accession,sourceFiles} from './run.mjs';
import {projectSource} from '../tender-fact-batches/runner.mjs';

const source=await json(join(prior,'source.json')),providerSource=await json(join(prior,'provider-source.json')),mapBytes=await readFile(join(prior,'evidence-map.json'),'utf8');
const currencies=deriveCurrencyNotations(providerSource),refs=providerSource.evidence.map(e=>e.ref);
const expected=()=>({expiration:null,offer_price:null,board_recommendation:null,offer_status:null,final_results_observed:{observed:true,evidence_refs:['E2','E8']},unresolved:[]});

test('01 Carlyle currency inventory is dollar despite offer_price being out of scope',()=>assert.deepEqual(currencies,['$']));
test('02 expected final-results-only transient output is valid',()=>{
 const v=expected();assert.equal(validateOutput(JSON.stringify(v),refs,currencies).local.valid,true);
 assert.deepEqual(projectCanonical(v),{facts:[{type:'final_results_observed',observed:true,evidence_refs:['E2','E8']}],unresolved:[]});
});
test('03 dollar inventory does not force offer_price positive',()=>{
 const v=expected();assert.equal(v.offer_price,null);assert.equal(validateOutput(JSON.stringify(v),refs,currencies).local.valid,true);
});
test('04 historical expired offer remains expiration null',()=>{
 const v=expected();assert.equal(v.expiration,null);assert.equal(validateOutput(JSON.stringify(v),refs,currencies).local.valid,true);
});
test('05 final_results_observed false is forbidden',()=>{
 const v=expected();v.final_results_observed={observed:false,evidence_refs:['E2']};assert.equal(validateOutput(JSON.stringify(v),refs,currencies).local.valid,false);
});
test('06 exact prior source/provider/map bytes are stable',async()=>{
 const old=await json(join(prior,'frozen.json'));for(const f of sourceFiles){const b=await readFile(join(prior,f));assert.equal(hash(b),old.files[f]);try{assert.deepEqual(await readFile(join(folder,f)),b);}catch(e){if(e.code!=='ENOENT')throw e;}}
});
test('07 provider source and evidence map reconstruct exactly',()=>{
 const p=projectSource(source);assert.deepEqual(p.providerSource,providerSource);assert.deepEqual(JSON.parse(mapBytes),p.evidenceMap);
});
test('08 request contains unchanged provider source and no baseline leakage',()=>{
 const r=buildRequest(providerSource),priorReq=JSON.parse(readFileSync(join(prior,'request.json'),'utf8'));
 assert.equal(r.contents[0].parts[0].text,priorReq.contents[0].parts[0].text);
 const nonSource=JSON.stringify({...r,contents:[]});for(const t of ['"expected":','"baseline":',accession,'Carlyle','18.82','2026-01-21'])assert.equal(nonSource.includes(t),false);
});
test('09 one physical mock call and durable reservation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v3-final-'));await writeFile(join(dir,'evidence-map.json'),mapBytes);
 const args={folder:dir,identity:{runId:'mock',accession,name:'carlyle-final'},source,body:JSON.stringify(buildRequest(providerSource)),mapBytes,frozenMapHash:hash(mapBytes),currencies,key:'mock'};
 let count=0;const fetchImpl=async()=>{count++;return {ok:true,status:200,text:async()=>JSON.stringify({modelVersion:'gemini-3.5-flash',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(expected())}]}}]})};};
 const a=await callOnce({...args,fetchImpl});assert.equal(a.technicalPass,true);assert.equal(count,1);await assert.rejects(callOnce({...args,fetchImpl}));assert.equal(count,1);
});
test('10 no retry on transport failure',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v3-final-fail-'));await writeFile(join(dir,'evidence-map.json'),mapBytes);
 const args={folder:dir,identity:{runId:'mock-fail',accession,name:'carlyle-final'},source,body:JSON.stringify(buildRequest(providerSource)),mapBytes,frozenMapHash:hash(mapBytes),currencies,key:'mock'};
 let count=0;const a=await callOnce({...args,fetchImpl:async()=>{count++;throw Error('x');}});assert.equal(count,1);assert.equal(a.technicalPass,false);assert.equal(a.retries+a.repairCalls+a.fallbackCalls,0);
});
