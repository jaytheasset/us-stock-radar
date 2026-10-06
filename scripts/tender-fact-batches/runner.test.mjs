import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, basename, resolve, join } from 'node:path';
import { callOnce, resolveRefs, hash, projectSource, model } from './runner.mjs';
import { buildRequest, validateOutput } from './contracts/expiration.ts';
const accession='test'; const text='SEC test source';
const source={accession,form:'SC TO-I',coverage:{partialDocuments:[],unavailable:[]},evidence:[{id:'tender:'+'a'.repeat(64),accession,document:{accession},text,textHash:hash(text)}]};
const p=projectSource(source); const mapBytes=JSON.stringify(p.evidenceMap); const frozenMapHash=hash(mapBytes);
const output={facts:[{type:'expiration',current:'2025-02-04',evidence_refs:['E1']}],unresolved:[]};
test('ceiling is fixed Gemini 3.5, source-only projection, exact lookup and hash rejection',()=>{
 assert.equal(model,'gemini-3.5-flash');assert.deepEqual(p.providerSource.evidence,[{ref:'E1',text}]);
 const raw=JSON.stringify(output);assert.equal(resolveRefs(raw,mapBytes,frozenMapHash,source,validateOutput).valid,true);
 assert.equal(resolveRefs(raw,mapBytes+' ',frozenMapHash,source,validateOutput).valid,false);
 const wrong=structuredClone(output);wrong.facts[0].current='1999-01-01';assert.equal(validateOutput(JSON.stringify(wrong),['E1']).local.valid,true);
});
for(const mode of ['success','transport','http','bad-ref'])test(`one request, no retry after ${mode}`,async()=>{
 const folder=await mkdtemp(join(tmpdir(),'tender-batch-')); let calls=0;
 try{
  await writeFile(join(folder,'evidence-map.json'),mapBytes);
  const body=JSON.stringify(buildRequest(p.providerSource));
  const fetchImpl=async(url,opts)=>{calls++;assert.ok(url.includes('/gemini-3.5-flash:'));assert.equal(opts.body,body);assert.equal(opts.redirect,'error');assert.ok(await readFile(join(folder,'started.json')));if(mode==='transport')throw Error('simulated');const x=structuredClone(output);if(mode==='bad-ref')x.facts[0].evidence_refs=['E99'];return new Response(mode==='http'?'{}':JSON.stringify({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(x)}]}}]}),{status:mode==='http'?404:200});};
  const args={folder,identity:{runId:'offline',accession},source,body,mapBytes,frozenMapHash,validate:validateOutput,key:'offline',fetchImpl};
  assert.equal((await callOnce(args)).technicalPass,mode==='success');await assert.rejects(callOnce(args),{code:'EEXIST'});assert.equal(calls,1);
 }finally{assert.equal(dirname(resolve(folder)),resolve(tmpdir()));assert.ok(basename(folder).startsWith('tender-batch-'));await rm(folder,{recursive:true,force:true});}
});
