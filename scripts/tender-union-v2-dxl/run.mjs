import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {buildRequest,systemPrompt,validateOutput,validateCanonical,projectCanonical} from './contract.mjs';
import {hash,projectSource,resolveRefs,model} from '../tender-fact-batches/runner.mjs';
export {hash};
export const root=fileURLToPath(new URL('./',import.meta.url)),repo=resolve(root,'../..');
export const prior=join(root,'../tender-union-single-call/runs/dxl-amendment'),folder=join(root,'run');
export const base='04633a09b000cc69f389f0e1fb0e6ce15fcbcc5d',accession='0001193125-26-298540';
export const sourceFiles=['source.json','provider-source.json','evidence-map.json'];
const codeFiles=['contract.mjs','run.mjs','contract.test.mjs','PLAN.md','baseline.json'];
export const json=async p=>JSON.parse(await readFile(p,'utf8'));
export const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();

export async function verifyInputs(target=folder){
 const frozen=await json(join(target,'frozen.json'));
 assert.equal(frozen.model,model);assert.equal(frozen.accession,accession);assert.equal(frozen.maxPhysicalCalls,1);
 for(const [f,h]of Object.entries(frozen.files))assert.equal(hash(await readFile(join(target,f))),h,f);
 for(const [f,h]of Object.entries(frozen.code))assert.equal(hash(await readFile(join(root,f))),h,f);
 const old=await json(join(prior,'frozen.json'));
 for(const f of sourceFiles){const bytes=await readFile(join(target,f));assert.deepEqual(bytes,await readFile(join(prior,f)));assert.equal(hash(bytes),old.files[f]);}
 const source=await json(join(target,'source.json')),providerSource=await json(join(target,'provider-source.json'));
 assert.equal(source.accession,accession);const projected=projectSource(source);
 assert.deepEqual(providerSource,projected.providerSource);
 const mapBytes=await readFile(join(target,'evidence-map.json'),'utf8');assert.deepEqual(JSON.parse(mapBytes),projected.evidenceMap);
 for(const e of source.evidence){assert.equal(e.accession,accession);assert.equal(e.document.accession,accession);assert.equal(hash(e.text),e.textHash);}
 const body=await readFile(join(target,'request.json'),'utf8');assert.deepEqual(JSON.parse(body),buildRequest(providerSource));
 assert.equal(await readFile(join(target,'prompt.txt'),'utf8'),systemPrompt);
 assert.deepEqual(await json(join(target,'provider-schema.json')),buildRequest(providerSource).generationConfig.responseJsonSchema);
 // There can be no baseline/example/message insertion beyond generic contract and exact v1 input.
 assert.equal(JSON.parse(body).contents[0].parts[0].text,(await json(join(prior,'request.json'))).contents[0].parts[0].text);
 const nonSource=JSON.stringify({...JSON.parse(body),contents:[]});
 for(const token of ['2026-07-24','2026-06-22','0.84','0.82','DXL','Destination XL',accession,'"expected":','"baseline":'])assert.ok(!nonSource.includes(token),`Request leakage: ${token}`);
 git(['diff','--exit-code',base,'--','.',':(exclude)scripts/tender-union-v2-dxl']);
 return {folder:target,identity:{runId:frozen.runId,accession},source,body,mapBytes,frozenMapHash:frozen.files['evidence-map.json']};
}

export async function callOnce({folder,identity,source,body,mapBytes,frozenMapHash,key,fetchImpl=fetch}){
 assert.equal(identity.accession,accession);assert.equal(source.accession,accession);
 assert.equal(hash(mapBytes),frozenMapHash);
 assert.deepEqual(JSON.parse(mapBytes),projectSource(source).evidenceMap);
 assert.deepEqual(JSON.parse(body),buildRequest(projectSource(source).providerSource));
 // Exclusive durable reservation precedes the only network site. Failure consumes the run.
 await save(join(folder,'started.json'),{...identity,model,physicalCallLimit:1,startedAt:new Date().toISOString(),requestHash:hash(body),mappingHash:frozenMapHash});
 const start=Date.now();let audit;
 try{
  const response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(55000),headers:{'Content-Type':'application/json','x-goog-api-key':key},body});
  const raw=await response.text();await writeFile(join(folder,'provider-response.txt'),raw,{flag:'wx'});
  let provider;try{provider=JSON.parse(raw);}catch{provider=null;}
  const candidates=provider?.candidates??[],candidate=candidates[0];
  const output=(candidate?.content?.parts??[]).filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join('');
  await writeFile(join(folder,'structured.txt'),output,{flag:'wx'});
  const refs=source.evidence.map((_,i)=>`E${i+1}`),validation=validateOutput(output,refs);
  const transportPass=response.ok&&candidates.length===1&&candidate?.finishReason==='STOP'&&provider?.modelVersion===model;
  let canonicalValidation=null,provenance={valid:false,errors:['validation-gate'],resolved:[]},projectionPass=false;
  if(transportPass&&validation.providerSchema.valid&&validation.local.valid){
   const canonical=projectCanonical(JSON.parse(output)),canonicalRaw=JSON.stringify(canonical);
   await save(join(folder,'canonical.json'),canonical);
   canonicalValidation=validateCanonical(canonicalRaw,refs);
   provenance=resolveRefs(canonicalRaw,await readFile(join(folder,'evidence-map.json'),'utf8'),frozenMapHash,source,validateCanonical);
   projectionPass=canonicalValidation.providerSchema.valid&&canonicalValidation.local.valid;
  }
  await save(join(folder,'provenance-audit.json'),provenance);
  audit={...identity,model,modelVersion:provider?.modelVersion??null,physicalCalls:1,retries:0,repairCalls:0,fallbackCalls:0,semanticCorrections:0,httpStatus:response.status,finishReason:candidate?.finishReason??null,latencyMs:Date.now()-start,usage:provider?.usageMetadata??null,validation,canonicalValidation,projectionPass,provenanceValid:provenance.valid,technicalPass:transportPass&&validation.providerSchema.valid&&validation.local.valid&&projectionPass&&provenance.valid};
 }catch{
  audit={...identity,model,physicalCalls:1,retries:0,repairCalls:0,fallbackCalls:0,semanticCorrections:0,technicalPass:false,latencyMs:Date.now()-start,error:'transport-or-artifact-error; no retry; inspect preserved artifacts'};
 }
 await save(join(folder,'audit.json'),audit);return audit;
}

async function freeze(){
 assert.equal(git(['rev-parse','HEAD']),base);
 git(['diff','--exit-code',base]);
 await mkdir(folder);
 for(const f of sourceFiles)await writeFile(join(folder,f),await readFile(join(prior,f)),{flag:'wx'});
 const request=buildRequest(await json(join(folder,'provider-source.json')));
 await save(join(folder,'request.json'),request);await save(join(folder,'provider-schema.json'),request.generationConfig.responseJsonSchema);
 await writeFile(join(folder,'prompt.txt'),systemPrompt,{flag:'wx'});
 const files={},code={};for(const f of await readdir(folder))files[f]=hash(await readFile(join(folder,f)));
 for(const f of codeFiles)code[f]=hash(await readFile(join(root,f)));
 const previous=await json(join(prior,'request.json'));
 await save(join(folder,'frozen.json'),{runId:`tender-union-v2-dxl-${randomUUID()}`,base,model,accession,maxPhysicalCalls:1,frozenAt:new Date().toISOString(),files,code,sizes:{v1PromptChars:previous.systemInstruction.parts[0].text.length,v2PromptChars:systemPrompt.length,v1SchemaChars:JSON.stringify(previous.generationConfig.responseJsonSchema).length,v2SchemaChars:JSON.stringify(request.generationConfig.responseJsonSchema).length,providerSourceChars:request.contents[0].parts[0].text.length,evidenceUnits:JSON.parse(request.contents[0].parts[0].text).evidence.length}});
 await verifyInputs();console.log('Frozen: identical DXL bytes; paid calls 0');
}

async function preflight(){
 await verifyInputs();assert.ok(!(await readdir(folder)).includes('started.json'));
 const result=execFileSync(process.execPath,['--no-warnings','--experimental-strip-types','--test',join(root,'contract.test.mjs')],{cwd:repo,encoding:'utf8'});
 await writeFile(join(folder,'preflight-tests.txt'),result,{flag:'wx'});
 await save(join(folder,'preflight.json'),{pass:true,checkedAt:new Date().toISOString(),frozenHash:hash(await readFile(join(folder,'frozen.json'))),testOutputHash:hash(result),paidCalls:0});
 console.log(result);
}

async function main([mode,...args]){
 if(mode==='freeze'){assert.equal(args.length,0);return freeze();}
 if(mode==='preflight'){assert.equal(args.length,0);return preflight();}
 const inputs=await verifyInputs();
 if(mode==='verify'){assert.equal(args.length,0);console.log('PASS: frozen artifacts, exact v1 bytes, unchanged prior/product files');return;}
 assert.equal(mode,'live');assert.equal(args[0],'--env-file');assert.equal(args.length,2);
 assert.equal(git(['rev-parse','HEAD']),base);
 const gate=await json(join(folder,'preflight.json'));assert.equal(gate.pass,true);
 assert.equal(gate.frozenHash,hash(await readFile(join(folder,'frozen.json'))));assert.equal(gate.testOutputHash,hash(await readFile(join(folder,'preflight-tests.txt'))));
 assert.ok(!(await readdir(folder)).includes('started.json'),'Call budget consumed');
 const env=await readFile(args[1],'utf8'),key=env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');assert.ok(key);
 const audit=await callOnce({...inputs,key});console.log(JSON.stringify(audit));
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main(process.argv.slice(2)).catch(e=>{console.error(`Stopped: ${e.code??e.name}; ${e.message}; no retry`);process.exitCode=1;});
