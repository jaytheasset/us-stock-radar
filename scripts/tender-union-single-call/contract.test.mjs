import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename,resolve} from 'node:path';
import {buildRequest,buildProviderSchema,validateOutput,contracts,types} from './contract.mjs';
import {checkBudget} from './run.mjs';
import {dedupe} from './prepare.mjs';
import {callOnce,hash,projectSource,resolveRefs,model} from '../tender-fact-batches/runner.mjs';
const facts=[{type:'expiration',current:'2025-02-04',evidence_refs:['E1']},{type:'offer_price',current:{amount:7.5,currency_text:'$',unit:'cash_per_share'},evidence_refs:['E1']},{type:'board_recommendation',current:'no_recommendation',evidence_refs:['E1']},{type:'offer_status',current:'withdrawn',evidence_refs:['E1']},{type:'final_results_observed',observed:true,evidence_refs:['E1']}];
const valid=f=>validateOutput(JSON.stringify({facts:f,unresolved:[]}),['E1']).local.valid;
test('discriminated union exactly reuses accepted branches; each subset is valid',()=>{
 assert.deepEqual(buildProviderSchema(['E1']).properties.facts.items.anyOf,types.map(t=>contracts[t].buildProviderSchema(['E1']).properties.facts.items));
 for(let mask=0;mask<32;mask++)assert.ok(valid(facts.filter((_,i)=>mask&(1<<i))));
 assert.equal(valid([...facts,facts[0]]),false);assert.equal(valid([facts[0],facts[0]]),false);
 for(const f of [{...facts[0],observed:true},{...facts[4],observed:false},{...facts[3],previous:'terminated'},{...facts[2],current:'unknown'},{...facts[1],current:{...facts[1].current,amount:'7.5'}},{...facts[0],evidence_refs:['E99']},{...facts[0],evidence_refs:['E1','E1']}])assert.equal(valid([f]),false);
});
test('shape validation never fills, corrects or deletes semantic claims',()=>{
 const x=JSON.stringify({facts:[{...facts[0],current:'1999-01-01'}],unresolved:[]});assert.ok(validateOutput(x,['E1']).local.valid);assert.equal(JSON.parse(x).facts[0].current,'1999-01-01');
 assert.equal(validateOutput('{"facts":[],"unresolved":[],"summary":"bad"}',['E1']).local.valid,false);
});
test('four filing budget, duplicate accession and same-case re-call rejected',()=>{
 const m={model,maxPhysicalCalls:4,maxCallsPerFiling:1,cases:['a','b','c','d'].map(name=>({name,accession:name}))};
 checkBudget(m,[],'a');assert.throws(()=>checkBudget(m,['a'],'a'));assert.throws(()=>checkBudget(m,['a','b','c','d'],'d'));assert.throws(()=>checkBudget({...m,cases:[...m.cases,{name:'e',accession:'e'}]},[],'a'));assert.throws(()=>checkBudget({...m,cases:[m.cases[0],m.cases[0]]},[],'a'));
});
test('source range dedupe preserves revision/document boundaries and surviving identity',()=>{
 const a={id:'a',accession:'x',document:{documentId:'d'},sourceHash:'s',renderedHash:'r',location:{start:0,end:10,representation:'v'},chars:10},b={...a,id:'b',location:{...a.location,start:2,end:8},chars:6};
 assert.deepEqual(dedupe([a,a,b]),[a]);assert.equal(dedupe([a,{...b,sourceHash:'other'}]).length,2);assert.equal(dedupe([a,{...b,document:{documentId:'other'}}]).length,2);
});
for(const mode of ['success','http','transport','duplicate-type'])test(`single physical unified fetch/no retry: ${mode}`,async()=>{
 const accession='test',text='Quoted source only',source={accession,form:'SC TO-I',coverage:{partialDocuments:[],unavailable:[]},evidence:[{id:'tender:'+'a'.repeat(64),accession,document:{accession},text,textHash:hash(text)}]},p=projectSource(source),body=JSON.stringify(buildRequest(p.providerSource)),mapBytes=JSON.stringify(p.evidenceMap),folder=await mkdtemp(join(tmpdir(),'tender-union-'));let calls=0;
 try{await writeFile(join(folder,'evidence-map.json'),mapBytes);const output={facts:mode==='duplicate-type'?[facts[0],facts[0]]:facts,unresolved:[]};
  const fetchImpl=async(url,opts)=>{calls++;assert.ok(url.includes('/gemini-3.5-flash:'));assert.equal(opts.body,body);assert.equal(opts.redirect,'error');assert.ok(await readFile(join(folder,'started.json')));if(mode==='transport')throw Error('simulated');return new Response(JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(output)}]}}]}),{status:mode==='http'?500:200});};
  const args={folder,identity:{runId:'offline',accession},source,body,mapBytes,frozenMapHash:hash(mapBytes),validate:validateOutput,key:'offline',fetchImpl};assert.equal((await callOnce(args)).technicalPass,mode==='success');await assert.rejects(callOnce(args),{code:'EEXIST'});assert.equal(calls,1);
  assert.equal(resolveRefs(JSON.stringify({facts,unresolved:[]}),mapBytes,hash(mapBytes+'bad'),source,validateOutput).valid,false);
 }finally{assert.equal(dirname(resolve(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('tender-union-'));await rm(folder,{recursive:true,force:true});}
});
