import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildRequest,systemPrompt,validateOutput} from './contract.mjs';
import {callOnce,hash,projectSource,model} from '../tender-fact-batches/runner.mjs';
const root=fileURLToPath(new URL('./',import.meta.url)),repo=resolve(root,'../..');
export const base='0e020ecb090bf41dedcc9b4dd75bf5e56420ccaa';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
export async function inventory(folder,prefix=''){const files=[];for(const e of await readdir(folder,{withFileTypes:true})){const p=join(prefix,e.name);if(e.isDirectory())files.push(...await inventory(join(folder,e.name),p));else files.push(p);}return files;}
export function checkBudget(manifest,started,name){
 assert.equal(manifest.model,model);assert.equal(manifest.maxPhysicalCalls,4);assert.equal(manifest.maxCallsPerFiling,1);assert.ok(manifest.cases.length>0&&manifest.cases.length<=4);
 assert.equal(new Set(manifest.cases.map(c=>c.accession)).size,manifest.cases.length);assert.equal(new Set(manifest.cases.map(c=>c.name)).size,manifest.cases.length);
 assert.ok(started.length<4,'Physical call budget consumed');assert.ok(manifest.cases.some(c=>c.name===name));assert.ok(!started.includes(name),'Filing already consumed');
}
async function freeze(){
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),base);
 execFileSync('git',['diff','--quiet',base],{cwd:repo});
 const manifest=await json(join(root,'manifest.json'));checkBudget(manifest,[],manifest.cases[0].name);assert.equal((await json(join(root,'baseline.json'))).coveragePass,true);
 const paths=['scripts/tender-expiration','scripts/tender-fact-batches','scripts/tender-board-transition-supplement','scripts/tender-board-josabank-supplement','scripts/tender-terminal-facts','lib/sources/sec/forms/tender'];
 const prior={};for(const p of execFileSync('git',['ls-tree','-r','--name-only',base,'--',...paths],{cwd:repo,encoding:'utf8'}).trim().split('\n'))prior[p]=hash(await readFile(join(repo,p)));
 const inputs={};for(const p of await inventory(root))inputs[p]=hash(await readFile(join(root,p)));
 await mkdir(join(root,'runs'));
 for(const c of manifest.cases){
  const source=await json(join(root,c.sourceFile));assert.equal(source.accession,c.accession);assert.equal(source.form,c.form);assert.equal(new Set(source.evidence.map(e=>e.id)).size,source.evidence.length);
  for(const e of source.evidence){assert.equal(e.accession,source.accession);assert.equal(e.document.accession,source.accession);assert.equal(e.form,source.form);assert.equal(hash(e.text),e.textHash);}
  const p=projectSource(source),request=buildRequest(p.providerSource),folder=join(root,'runs',c.name);await mkdir(folder);
  for(const [f,v]of Object.entries({'source.json':source,'provider-source.json':p.providerSource,'evidence-map.json':p.evidenceMap,'provider-schema.json':request.generationConfig.responseJsonSchema,'request.json':request}))await save(join(folder,f),v);
  await writeFile(join(folder,'prompt.txt'),systemPrompt,{flag:'wx'});const files={};for(const f of await readdir(folder))files[f]=hash(await readFile(join(folder,f)));
  await save(join(folder,'frozen.json'),{runId:`${manifest.runId}-${c.name}`,accession:source.accession,model,frozenAt:new Date().toISOString(),files});
 }
 await save(join(root,'frozen-batch.json'),{base,model,maxPhysicalCalls:4,prior,inputs});console.log('Four filing-level unified requests frozen; physical calls0');
}
export async function verify(){
 const frozen=await json(join(root,'frozen-batch.json'));
 for(const [p,h]of Object.entries(frozen.prior))assert.equal(hash(await readFile(join(repo,p))),h,p);
 for(const [p,h]of Object.entries(frozen.inputs))assert.equal(hash(await readFile(join(root,p))),h,p);
 const manifest=await json(join(root,'manifest.json')),cases=[];
 for(const c of manifest.cases){const folder=join(root,'runs',c.name),f=await json(join(folder,'frozen.json'));for(const [p,h]of Object.entries(f.files))assert.equal(hash(await readFile(join(folder,p))),h,p);
  const source=await json(join(folder,'source.json')),body=await readFile(join(folder,'request.json'),'utf8'),mapBytes=await readFile(join(folder,'evidence-map.json'),'utf8'),projected=projectSource(source);
  assert.deepEqual(JSON.parse(body),buildRequest(projected.providerSource));assert.deepEqual(JSON.parse(mapBytes),projected.evidenceMap);assert.equal(await readFile(join(folder,'prompt.txt'),'utf8'),systemPrompt);
  cases.push({folder,identity:{runId:f.runId,fact:'tender_five_fact_union',name:c.name,accession:source.accession},source,body,mapBytes,frozenMapHash:f.files['evidence-map.json'],validate:validateOutput});
 }return {manifest,cases};
}
async function main([mode,name,...args]){
 if(mode==='freeze')return freeze();const {manifest,cases}=await verify();if(mode==='verify'){console.log('PASS frozen requests/projection/mapping and all prior experiments unchanged');return;}
 assert.equal(mode,'live');assert.deepEqual(args.slice(0,1),['--env-file']);assert.equal(args.length,2);
 const started=[];for(const c of cases)if((await readdir(c.folder)).includes('started.json'))started.push(c.identity.name);checkBudget(manifest,started,name);
 const index=cases.findIndex(c=>c.identity.name===name);for(const c of cases.slice(0,index)){const r=await json(join(c.folder,'review.json'));assert.equal(r.pass,true,'Earlier failure stops paid batch');assert.equal(r.outputHash,hash(await readFile(join(c.folder,'structured.txt'))));assert.equal((await json(join(c.folder,'audit.json'))).technicalPass,true);}
 const env=await readFile(args[1],'utf8'),key=env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');assert.ok(key);
 const a=await callOnce({...cases[index],key});console.log(JSON.stringify({case:name,httpStatus:a.httpStatus,physicalCalls:a.physicalCalls,technicalPass:a.technicalPass}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main(process.argv.slice(2)).catch(e=>{console.error(`Stopped: ${e.code??e.name}; ${e.message}; no retry`);process.exitCode=1;});
