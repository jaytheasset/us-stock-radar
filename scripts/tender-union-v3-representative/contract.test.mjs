import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {deriveCurrencyNotations,buildRequest,validateOutput,projectCanonical} from '../tender-union-v3-dxl/contract.mjs';
import {root,json,hash,callOnce,sourceFiles} from './run.mjs';
import {projectSource} from '../tender-fact-batches/runner.mjs';

const manifest=await json(join(root,'manifest.json'));
const baselines=await json(join(root,'baseline.json'));
const cases={};
for(const c of manifest.cases){
 const prior=join(root,c.prior),source=await json(join(prior,'source.json')),providerSource=await json(join(prior,'provider-source.json')),mapBytes=await readFile(join(prior,'evidence-map.json'),'utf8');
 cases[c.name]={c,prior,source,providerSource,mapBytes,currencies:deriveCurrencyNotations(providerSource),refs:providerSource.evidence.map(e=>e.ref)};
}
const transient=name=>{
 const e=baselines[name].expected,v={expiration:null,offer_price:null,board_recommendation:null,offer_status:null,final_results_observed:null,unresolved:[...e.unresolved]};
 if(e.expiration)v.expiration={current:e.expiration.current,previous:e.expiration.previous,current_evidence_refs:['E1'],previous_evidence_refs:[]};
 if(e.offer_price)v.offer_price={current:e.offer_price.current,previous:e.offer_price.previous,current_evidence_refs:['E8'],previous_evidence_refs:[]};
 if(e.board_recommendation)v.board_recommendation={current:e.board_recommendation.current,previous:e.board_recommendation.previous,current_evidence_refs:['E12'],previous_evidence_refs:[]};
 if(e.offer_status)v.offer_status={current:e.offer_status.current,evidence_refs:['E7']};
 if(e.final_results_observed)v.final_results_observed={observed:true,evidence_refs:['E1']};
 return v;
};

test('01 both representative packets derive exactly bare dollar notation',()=>{
 assert.deepEqual(cases['rumble-active'].currencies,['$']);assert.deepEqual(cases['xerox-terminated'].currencies,['$']);
});
test('02 Rumble baseline is valid under v3 contract',()=>{
 const c=cases['rumble-active'],v=transient('rumble-active');assert.equal(validateOutput(JSON.stringify(v),c.refs,c.currencies).local.valid,true);
 const out=projectCanonical(v);assert.deepEqual(out.facts.map(f=>f.type),['expiration','offer_price','board_recommendation']);
});
test('03 Xerox composite offer baseline emits status only, no offer_price',()=>{
 const c=cases['xerox-terminated'],v=transient('xerox-terminated');assert.equal(validateOutput(JSON.stringify(v),c.refs,c.currencies).local.valid,true);
 assert.deepEqual(projectCanonical(v).facts,[{type:'offer_status',current:'terminated',evidence_refs:['E7']}]);
});
test('04 source-derived currency enum rejects full price token and prose',()=>{
 for(const name of Object.keys(cases)){const c=cases[name],v=transient(name);if(!v.offer_price)continue;
  for(const bad of ['$7.50','per share in cash','USD']){const w=structuredClone(v);w.offer_price.current.currency_text=bad;assert.equal(validateOutput(JSON.stringify(w),c.refs,c.currencies).local.valid,false);}
 }
});
test('05 Rumble previous decisions are explicit null with empty previous refs',()=>{
 const c=cases['rumble-active'],v=transient('rumble-active');
 for(const type of ['expiration','offer_price','board_recommendation']){assert.equal(v[type].previous,null);assert.deepEqual(v[type].previous_evidence_refs,[]);}
 assert.equal(validateOutput(JSON.stringify(v),c.refs,c.currencies).local.valid,true);
});
test('06 Xerox dollar inventory does not force an offer_price object',()=>{
 const c=cases['xerox-terminated'],v=transient('xerox-terminated');assert.deepEqual(c.currencies,['$']);assert.equal(v.offer_price,null);assert.equal(validateOutput(JSON.stringify(v),c.refs,c.currencies).local.valid,true);
});
test('07 exact prior source/provider/map bytes remain frozen inputs',async()=>{
 for(const c of manifest.cases){const prior=cases[c.name].prior,old=await json(join(prior,'frozen.json'));for(const f of sourceFiles){const b=await readFile(join(prior,f));assert.equal(hash(b),old.files[f]);}}
});
test('08 provider source is unchanged and baseline never enters request metadata',()=>{
 for(const name of Object.keys(cases)){const c=cases[name],r=buildRequest(c.providerSource),old=JSON.parse(readFileSync(join(c.prior,'request.json'),'utf8'));
  assert.equal(r.contents[0].parts[0].text,old.contents[0].parts[0].text);
  const nonSource=JSON.stringify({...r,contents:[]});assert.equal(nonSource.includes('"expected"'),false);assert.equal(nonSource.includes('"baseline"'),false);
 }
});
test('09 projectSource reproduces saved provider source and evidence map',()=>{
 for(const name of Object.keys(cases)){const c=cases[name],p=projectSource(c.source);assert.deepEqual(p.providerSource,c.providerSource);assert.deepEqual(JSON.parse(c.mapBytes),p.evidenceMap);}
});
test('10 one-call mock still blocks repeated execution',async()=>{
 const c=cases['rumble-active'],dir=await mkdtemp(join(tmpdir(),'v3-rep-'));await writeFile(join(dir,'evidence-map.json'),c.mapBytes);
 const v=transient('rumble-active'),args={folder:dir,identity:{runId:'mock',accession:c.c.accession,name:'rumble-active'},source:c.source,body:JSON.stringify(buildRequest(c.providerSource)),mapBytes:c.mapBytes,frozenMapHash:hash(c.mapBytes),currencies:c.currencies,key:'mock'};
 let count=0;const fetchImpl=async()=>{count++;return {ok:true,status:200,text:async()=>JSON.stringify({modelVersion:'gemini-3.5-flash',candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(v)}]}}]})};};
 const a=await callOnce({...args,fetchImpl});assert.equal(a.technicalPass,true);assert.equal(count,1);await assert.rejects(callOnce({...args,fetchImpl}));assert.equal(count,1);
});
test('11 no retry on a failed transport',async()=>{
 const c=cases['xerox-terminated'],dir=await mkdtemp(join(tmpdir(),'v3-rep-fail-'));await writeFile(join(dir,'evidence-map.json'),c.mapBytes);
 const args={folder:dir,identity:{runId:'mock-fail',accession:c.c.accession,name:'xerox-terminated'},source:c.source,body:JSON.stringify(buildRequest(c.providerSource)),mapBytes:c.mapBytes,frozenMapHash:hash(c.mapBytes),currencies:c.currencies,key:'mock'};
 let count=0;const a=await callOnce({...args,fetchImpl:async()=>{count++;throw Error('x');}});assert.equal(count,1);assert.equal(a.technicalPass,false);assert.equal(a.retries+a.repairCalls+a.fallbackCalls,0);
});
test('12 paid budget is exactly two filings and one call each',()=>{assert.equal(manifest.maxPhysicalCalls,2);assert.equal(manifest.cases.length,2);assert.equal(new Set(manifest.cases.map(c=>c.accession)).size,2);});
