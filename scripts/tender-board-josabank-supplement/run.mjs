import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildRequest,systemPrompt,validateOutput} from '../tender-fact-batches/contracts/board_recommendation.ts';
import {callOnce,hash,projectSource,model} from '../tender-fact-batches/runner.mjs';
const dir=fileURLToPath(new URL('./',import.meta.url));const repo=resolve(dir,'../..');
const base='6f96b33b24c11ee486399420600005fa7cf2dc10';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
async function freeze(){
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),base);
  const paths=['scripts/tender-expiration','scripts/tender-fact-batches','scripts/tender-board-transition-supplement','lib/sources/sec/forms/tender'];
  execFileSync('git',['diff','--quiet',base,'--',...paths],{cwd:repo});
  const prior={};const files=execFileSync('git',['ls-tree','-r','--name-only',base,'--',...paths],{cwd:repo,encoding:'utf8'}).trim().split('\n');
  for(const p of files){const actual=hash(await readFile(join(repo,p)));if(p.startsWith('scripts/'))assert.equal(actual,hash(execFileSync('git',['show',`${base}:${p}`],{cwd:repo})),p);prior[p]=actual;}
  const manifest=await json(join(dir,'manifest.json'));assert.equal(manifest.model,model);assert.equal(manifest.maxPhysicalCalls,1);assert.equal(manifest.coveragePass,true);assert.equal((await json(join(dir,'source-audit.json'))).coveragePass,true);
  assert.deepEqual((await json(join(dir,'source-plan.json'))).queries,(await json(join(repo,'scripts/tender-fact-batches/board_recommendation/source-plan.json'))).queries);
  const source=await json(join(dir,manifest.sourceFile));assert.equal(source.accession,manifest.accession);for(const e of source.evidence){assert.equal(e.accession,source.accession);assert.equal(hash(e.text),e.textHash);}
  const projected=projectSource(source);const request=buildRequest(projected.providerSource);const folder=join(dir,'run');await mkdir(folder);
  for(const [p,v]of Object.entries({'source.json':source,'provider-source.json':projected.providerSource,'evidence-map.json':projected.evidenceMap,'provider-schema.json':request.generationConfig.responseJsonSchema,'request.json':request}))await save(join(folder,p),v);
  await writeFile(join(folder,'prompt.txt'),systemPrompt,{flag:'wx'});const runFiles={};for(const p of await readdir(folder))runFiles[p]=hash(await readFile(join(folder,p)));
  await save(join(folder,'frozen.json'),{runId:manifest.runId,fact:'board_recommendation',accession:manifest.accession,model,frozenAt:new Date().toISOString(),files:runFiles});
  const supplement={};for(const p of ['PLAN.md','manifest.json','source-audit.json','source-plan.json','identity.json','josabank-sec-index.html','preparation.json','run.mjs','sources/josabank.json','sources/josabank.acquisition.json'])supplement[p]=hash(await readFile(join(dir,p)));
  await save(join(dir,'frozen-supplement.json'),{base,model,prior,supplement});console.log('Frozen Jos. A. Bank; physical calls0');
}
export async function verify(){
  const frozen=await json(join(dir,'frozen-supplement.json'));for(const [p,h]of Object.entries(frozen.prior))assert.equal(hash(await readFile(join(repo,p))),h,p);for(const [p,h]of Object.entries(frozen.supplement))assert.equal(hash(await readFile(join(dir,p))),h,p);
  const folder=join(dir,'run');const f=await json(join(folder,'frozen.json'));for(const [p,h]of Object.entries(f.files))assert.equal(hash(await readFile(join(folder,p))),h,p);
  const source=await json(join(folder,'source.json'));const body=await readFile(join(folder,'request.json'),'utf8');const mapBytes=await readFile(join(folder,'evidence-map.json'),'utf8');
  assert.deepEqual(JSON.parse(body),buildRequest(projectSource(source).providerSource));assert.deepEqual(JSON.parse(mapBytes),projectSource(source).evidenceMap);assert.equal(await readFile(join(folder,'prompt.txt'),'utf8'),systemPrompt);
  return {folder,identity:{runId:f.runId,fact:'board_recommendation',accession:source.accession,name:'josabank'},source,body,mapBytes,frozenMapHash:f.files['evidence-map.json'],validate:validateOutput};
}
async function main([mode,...rest]){
  if(mode==='freeze')return freeze();const c=await verify();if(mode==='verify'){console.log('PASS: exact request, prior artifacts, unchanged contract and queries');return;}
  assert.equal(mode,'live');assert.equal(rest.length,2);assert.equal(rest[0],'--env-file');
  const env=await readFile(rest[1],'utf8');const key=env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');assert.ok(key);
  const a=await callOnce({...c,key});console.log(JSON.stringify({physicalCalls:a.physicalCalls,httpStatus:a.httpStatus,technicalPass:a.technicalPass}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main(process.argv.slice(2)).catch(e=>{console.error(`Stopped: ${e.code??e.name}; ${e.message}; no retry`);process.exitCode=1;});
