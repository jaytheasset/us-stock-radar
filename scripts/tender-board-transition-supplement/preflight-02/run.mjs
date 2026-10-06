import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {buildRequest,systemPrompt,validateOutput} from '../tender-fact-batches/contracts/board_recommendation.ts';
import {callOnce,hash,projectSource,model} from '../tender-fact-batches/runner.mjs';
const dir=fileURLToPath(new URL('./',import.meta.url));const repo=resolve(dir,'../..');
const base='af34a2d142dd853fc7c3e2e2d8de65b0d329cab7';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});

async function freeze(){
  assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),base);
  const paths=['scripts/tender-expiration','scripts/tender-fact-batches','lib/sources/sec/forms/tender'];
  const files=execFileSync('git',['ls-tree','-r','--name-only',base,'--',...paths],{cwd:repo,encoding:'utf8'}).trim().split('\n');
  const prior={};
  // Respect repository checkout filters (Windows CRLF); then preserve exact existing disk bytes.
  for(const file of files){const expected=hash(execFileSync('git',['cat-file','--filters',`${base}:${file}`],{cwd:repo}));assert.equal(hash(await readFile(join(repo,file))),expected,file);prior[file]=expected;}
  const manifest=await json(join(dir,'manifest.json'));assert.equal(manifest.model,model);assert.equal(manifest.maxPhysicalCalls,2);assert.equal(manifest.cases.length,2);
  const plan=await json(join(dir,'source-plan.json'));const original=await json(join(repo,'scripts/tender-fact-batches/board_recommendation/source-plan.json'));assert.deepEqual(plan.queries,original.queries);
  const coverage=await json(join(dir,'source-audit.json'));await mkdir(join(dir,'runs'));
  for(const c of manifest.cases){
    assert.equal(c.coveragePass,coverage[c.name].coveragePass);if(!c.coveragePass)continue;
    const source=await json(join(dir,c.sourceFile));assert.equal(source.accession,c.accession);
    for(const e of source.evidence){assert.equal(e.accession,source.accession);assert.equal(hash(e.text),e.textHash);}
    const {providerSource,evidenceMap}=projectSource(source);const request=buildRequest(providerSource);const folder=join(dir,'runs',c.name);await mkdir(folder);
    for(const [file,v]of Object.entries({'source.json':source,'provider-source.json':providerSource,'evidence-map.json':evidenceMap,'provider-schema.json':request.generationConfig.responseJsonSchema,'request.json':request}))await save(join(folder,file),v);
    await writeFile(join(folder,'prompt.txt'),systemPrompt,{flag:'wx'});const frozenFiles={};for(const file of await readdir(folder))frozenFiles[file]=hash(await readFile(join(folder,file)));
    await save(join(folder,'frozen.json'),{runId:`${manifest.runId}-${c.name}`,fact:'board_recommendation',model,accession:c.accession,frozenAt:new Date().toISOString(),files:frozenFiles});
  }
  const supplement={};for(const file of ['PLAN.md','manifest.json','source-plan.json','source-audit.json','preparation-attempt.json','run.mjs','preflight.test.mjs','beacon-identity.json','cream-identity.json','beacon-sec-index.html','cream-sec-index.html'])supplement[file]=hash(await readFile(join(dir,file)));
  for(const file of await readdir(join(dir,'sources')))supplement[`sources/${file}`]=hash(await readFile(join(dir,'sources',file)));
  await save(join(dir,'frozen-supplement.json'),{base,model,prior,supplement});console.log('Frozen: Beacon eligible; Cream SOURCE_COVERAGE skipped; provider calls0');
}

export async function verify(){
  const frozen=await json(join(dir,'frozen-supplement.json'));
  for(const [p,h]of Object.entries(frozen.prior))assert.equal(hash(await readFile(join(repo,p))),h,p);
  for(const [p,h]of Object.entries(frozen.supplement))assert.equal(hash(await readFile(join(dir,p))),h,p);
  const manifest=await json(join(dir,'manifest.json'));const cases=[];
  for(const c of manifest.cases){
    if(!c.coveragePass)continue;
    const folder=join(dir,'runs',c.name);const frozenCase=await json(join(folder,'frozen.json'));
    for(const [p,h]of Object.entries(frozenCase.files))assert.equal(hash(await readFile(join(folder,p))),h,p);
    const source=await json(join(folder,'source.json'));const body=await readFile(join(folder,'request.json'),'utf8');
    assert.deepEqual(JSON.parse(body),buildRequest(projectSource(source).providerSource));assert.equal(await readFile(join(folder,'prompt.txt'),'utf8'),systemPrompt);
    const mapBytes=await readFile(join(folder,'evidence-map.json'),'utf8');assert.deepEqual(JSON.parse(mapBytes),projectSource(source).evidenceMap);
    cases.push({folder,identity:{runId:frozenCase.runId,fact:'board_recommendation',accession:c.accession,name:c.name},source,body,mapBytes,frozenMapHash:frozenCase.files['evidence-map.json'],validate:validateOutput});
  }
  return cases;
}
export async function eligibleCase(name){
  const cases=await verify();const found=cases.find(c=>c.identity.name===name);assert.ok(found,'SOURCE_COVERAGE: case not eligible; zero provider calls');return found;
}
async function main([mode,name,...rest]){
  if(mode==='freeze')return freeze();
  if(mode==='verify'){console.log(JSON.stringify({eligible:(await verify()).map(c=>c.identity.name),priorUnchanged:true,contractUnchanged:true}));return;}
  assert.equal(mode,'live');assert.deepEqual(rest.slice(0,1),['--env-file']);assert.equal(rest.length,2);
  const c=await eligibleCase(name); // Coverage gate before reading credentials or invoking callOnce.
  const env=await readFile(rest[1],'utf8');const key=env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');assert.ok(key);
  const result=await callOnce({...c,key});console.log(JSON.stringify({name,physicalCalls:result.physicalCalls,technicalPass:result.technicalPass,httpStatus:result.httpStatus}));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main(process.argv.slice(2)).catch(e=>{console.error(`Stopped: ${e.code??e.name}; ${e.message}; no retry`);process.exitCode=1;});
