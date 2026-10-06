import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {callOnce,hash,projectSource,model} from '../tender-fact-batches/runner.mjs';
const root=fileURLToPath(new URL('./',import.meta.url)),repo=resolve(root,'../..');
const base='c36f5cbf54f8d5d70d2781717c1aeb8c2eaa2a68';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
async function gate(fact) {
  assert.ok(['offer_status','final_results_observed'].includes(fact));
  if(fact==='final_results_observed')assert.equal((await json(join(root,'offer_status/result.json'))).practicalPass,true,'offer_status must PASS first');
}
async function inventory(folder,prefix='') {
  const files=[];for(const e of await readdir(folder,{withFileTypes:true})){const p=join(prefix,e.name);if(e.isDirectory())files.push(...await inventory(join(folder,e.name),p));else files.push(p);}return files;
}
async function freeze(fact) {
  await gate(fact);assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),base);
  const paths=['scripts/tender-expiration','scripts/tender-fact-batches','scripts/tender-board-transition-supplement','scripts/tender-board-josabank-supplement','lib/sources/sec/forms/tender'];
  execFileSync('git',['diff','--quiet',base,'--',...paths],{cwd:repo});
  const prior={};for(const p of execFileSync('git',['ls-tree','-r','--name-only',base,'--',...paths],{cwd:repo,encoding:'utf8'}).trim().split('\n')){const h=hash(await readFile(join(repo,p)));if(p.startsWith('scripts/'))assert.equal(h,hash(execFileSync('git',['show',`${base}:${p}`],{cwd:repo})),p);prior[p]=h;}
  const dir=join(root,fact),manifest=await json(join(dir,'manifest.json')),audit=await json(join(dir,'source-audit.json')),contract=await import(pathToFileURL(join(dir,'contract.mjs')));
  assert.equal(manifest.model,model);assert.equal(manifest.maxPhysicalCallsPerCase,1);assert.equal(audit.coveragePass,true);assert.ok(manifest.cases.length>=3&&manifest.cases.length<=5);
  const inputs={};for(const p of await inventory(dir))inputs[join(fact,p)]=hash(await readFile(join(dir,p)));
  for(const p of ['PLAN.md','run.mjs','contracts.test.mjs'])inputs[p]=hash(await readFile(join(root,p)));
  if(fact==='final_results_observed')for(const p of await inventory(join(root,'offer_status')))inputs[join('offer_status',p)]=hash(await readFile(join(root,'offer_status',p)));
  await mkdir(join(dir,'runs'));const seen=new Set();
  for(const c of manifest.cases){
    const source=await json(join(dir,c.sourceFile));assert.equal(source.accession,c.accession);assert.ok(!seen.has(source.accession));seen.add(source.accession);
    for(const e of source.evidence){assert.equal(e.accession,source.accession);assert.equal(e.document.accession,source.accession);assert.equal(hash(e.text),e.textHash);}
    const p=projectSource(source),request=contract.buildRequest(p.providerSource),folder=join(dir,'runs',c.name);await mkdir(folder);
    for(const [f,v]of Object.entries({'source.json':source,'provider-source.json':p.providerSource,'evidence-map.json':p.evidenceMap,'provider-schema.json':request.generationConfig.responseJsonSchema,'request.json':request}))await save(join(folder,f),v);
    await writeFile(join(folder,'prompt.txt'),contract.systemPrompt,{flag:'wx'});const files={};for(const f of await readdir(folder))files[f]=hash(await readFile(join(folder,f)));
    await save(join(folder,'frozen.json'),{runId:`${manifest.runId}-${c.name}`,fact,model,accession:source.accession,frozenAt:new Date().toISOString(),files});
  }
  await save(join(dir,'frozen-batch.json'),{base,fact,model,prior,inputs});console.log(JSON.stringify({fact,frozen:seen.size,physicalCalls:0}));
}
export async function verify(fact){
  await gate(fact);const dir=join(root,fact),f=await json(join(dir,'frozen-batch.json'));
  for(const [p,h]of Object.entries(f.prior))assert.equal(hash(await readFile(join(repo,p))),h,p);
  for(const [p,h]of Object.entries(f.inputs))assert.equal(hash(await readFile(join(root,p))),h,p);
  const manifest=await json(join(dir,'manifest.json')),contract=await import(pathToFileURL(join(dir,'contract.mjs'))),cases=[];
  for(const c of manifest.cases){const folder=join(dir,'runs',c.name),frozen=await json(join(folder,'frozen.json'));for(const [p,h]of Object.entries(frozen.files))assert.equal(hash(await readFile(join(folder,p))),h,p);
    const source=await json(join(folder,'source.json')),body=await readFile(join(folder,'request.json'),'utf8'),mapBytes=await readFile(join(folder,'evidence-map.json'),'utf8'),projected=projectSource(source);
    assert.deepEqual(JSON.parse(body),contract.buildRequest(projected.providerSource));assert.deepEqual(JSON.parse(mapBytes),projected.evidenceMap);assert.equal(await readFile(join(folder,'prompt.txt'),'utf8'),contract.systemPrompt);
    cases.push({folder,identity:{runId:frozen.runId,fact,name:c.name,accession:source.accession},source,body,mapBytes,frozenMapHash:frozen.files['evidence-map.json'],validate:contract.validateOutput});
  }return {dir,cases};
}
async function main([mode,fact,name,...args]){
  if(mode==='freeze')return freeze(fact);const {cases}=await verify(fact);
  if(mode==='verify'){console.log(`${fact}: frozen inputs, request, map and protected files PASS`);return;}
  assert.equal(mode,'live');assert.deepEqual(args.slice(0,1),['--env-file']);assert.equal(args.length,2);
  const index=cases.findIndex(c=>c.identity.name===name);assert.ok(index>=0);
  // Human-readable Codex source review is required before progressing to the next paid case.
  for(const c of cases.slice(0,index)){const r=await json(join(c.folder,'review.json'));assert.equal(r.pass,true,'Previous semantic/contract failure stops batch');assert.equal(r.outputHash,hash(await readFile(join(c.folder,'structured.txt'))));assert.equal((await json(join(c.folder,'audit.json'))).technicalPass,true);}
  const env=await readFile(args[1],'utf8'),key=env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');assert.ok(key);
  const a=await callOnce({...cases[index],key});console.log(JSON.stringify({case:name,httpStatus:a.httpStatus,technicalPass:a.technicalPass,physicalCalls:a.physicalCalls}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main(process.argv.slice(2)).catch(e=>{console.error(`Stopped: ${e.code??e.name}; ${e.message}; no retry`);process.exitCode=1;});
