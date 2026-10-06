// Applied extension Gemini 3.5 Flash one-call canary. Reuses the exact v3 contract and provenance boundary.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { buildRequest, systemPrompt, validateOutput } from '../v3/contract.ts';
import { hash, projectSource, resolveProvenance } from '../v3/boundary.mjs';

export const base = 'bf5ea372f42c06ad2a5b02a0ebb101797d15f835';
export const accession = '0001193125-26-026154';
export const model = 'gemini-3.5-flash';
export const runId = 'tender-expiration-v5-applied-extension-gemini35-20261006';
const dir = fileURLToPath(new URL('./', import.meta.url));
const repo = resolve(dir, '../../..');
const runDir = join(dir, 'run');
const json = async p => JSON.parse(await readFile(p, 'utf8'));
const save = (p, value) => writeFile(p, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

async function priorHashes() {
  const list = execFileSync('git', ['ls-tree','-r','--name-only',base,'--','scripts/tender-expiration'], {cwd:repo,encoding:'utf8'}).trim();
  const files = list ? list.split('\n') : [];
  const result = {};
  for (const path of files) {
    const baseline = hash(execFileSync('git',['show',`${base}:${path}`],{cwd:repo}));
    assert.equal(hash(await readFile(join(repo,path))), baseline, `Previous audit changed: ${path}`);
    result[path] = baseline;
  }
  return result;
}

export async function loadSource() {
  const cases = await json(join(dir, '../fixtures/inputs.json'));
  const entry = cases.find(c => c?.source?.accession === accession);
  assert.ok(entry, 'Applied extension fixture missing');
  assert.equal(entry.name, 'extension');
  assert.equal(entry.source.form, 'SC TO-T/A');
  return entry.source;
}

export async function freeze() {
  const previousFiles = await priorHashes();
  const source = await loadSource();
  const { providerSource, evidenceMap } = projectSource(source);
  assert.deepEqual(providerSource.evidence.map(e=>e.ref), source.evidence.map((_,i)=>`E${i+1}`));
  const request = buildRequest(providerSource);
  const v3Prompt = await readFile(join(dir, '../v3/run/prompt.txt'), 'utf8');
  assert.equal(systemPrompt, v3Prompt, 'v3 prompt must be reused byte-for-byte');
  await mkdir(runDir, { recursive:false }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  // Refuse to freeze into a started or already frozen run.
  try { await readFile(join(runDir,'frozen.json')); throw new Error('run already frozen'); } catch(e) { if(e.code !== 'ENOENT') throw e; }
  await save(join(runDir,'source.json'), source);
  await save(join(runDir,'provider-source.json'), providerSource);
  await save(join(runDir,'evidence-map.json'), evidenceMap);
  await save(join(runDir,'provider-schema.json'), request.generationConfig.responseJsonSchema);
  await writeFile(join(runDir,'prompt.txt'), systemPrompt, {flag:'wx'});
  await save(join(runDir,'request.json'), request);
  const files = {};
  for (const file of ['PLAN.md','run.mjs','run.test.mjs','run/source.json','run/provider-source.json','run/evidence-map.json','run/provider-schema.json','run/prompt.txt','run/request.json'])
    files[file]=hash(await readFile(join(dir,file)));
  await save(join(runDir,'frozen.json'), {runId,base,accession,model,frozenAt:new Date().toISOString(),files,previousFiles});
  console.log(JSON.stringify({runId,physicalCalls:0,refs:Object.keys(evidenceMap),requestHash:files['run/request.json'],mappingHash:files['run/evidence-map.json']}));
}

export async function verifyFrozen() {
  const frozen = await json(join(runDir,'frozen.json'));
  assert.equal(frozen.runId,runId);
  assert.deepEqual(await priorHashes(), frozen.previousFiles);
  for (const [file,sha] of Object.entries(frozen.files)) assert.equal(hash(await readFile(join(dir,file))),sha,file);
  const source = await json(join(runDir,'source.json'));
  assert.deepEqual(source, await loadSource());
  const {providerSource,evidenceMap}=projectSource(source);
  assert.deepEqual(await json(join(runDir,'provider-source.json')),providerSource);
  const mapBytes=await readFile(join(runDir,'evidence-map.json'),'utf8');
  assert.deepEqual(JSON.parse(mapBytes),evidenceMap);
  const body=await readFile(join(runDir,'request.json'),'utf8');
  assert.deepEqual(JSON.parse(body),buildRequest(providerSource));
  assert.equal(await readFile(join(runDir,'prompt.txt'),'utf8'),systemPrompt);
  for (const e of source.evidence) { assert.equal(e.accession,accession); assert.equal(hash(e.text),e.textHash); }
  return {source,providerSource,mapBytes,frozenMapHash:frozen.files['run/evidence-map.json'],body};
}

export async function callOnce({folder,source,providerSource,mapBytes,frozenMapHash,body,key,fetchImpl=fetch}) {
  assert.equal(source.accession,accession);
  assert.equal(hash(mapBytes),frozenMapHash);
  assert.deepEqual(projectSource(source).providerSource,providerSource);
  assert.deepEqual(JSON.parse(mapBytes),projectSource(source).evidenceMap);
  assert.deepEqual(JSON.parse(body),buildRequest(providerSource));
  await save(join(folder,'started.json'),{runId,accession,model,startedAt:new Date().toISOString(),maxPhysicalCalls:1,requestHash:hash(body),mappingHash:frozenMapHash});
  const start=Date.now();
  let audit;
  try {
    const response=await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(55000),
      headers:{'Content-Type':'application/json','x-goog-api-key':key},body,
    });
    const raw=await response.text();
    await writeFile(join(folder,'provider-response.txt'),raw,{flag:'wx'});
    let provider; try { provider=JSON.parse(raw); } catch { provider=null; }
    const candidate=provider?.candidates?.[0];
    const output=(candidate?.content?.parts??[]).filter(p=>typeof p.text==='string'&&!p.thought).map(p=>p.text).join('');
    await writeFile(join(folder,'structured.txt'),output,{flag:'wx'});
    const validation=validateOutput(output,providerSource.evidence.map(e=>e.ref));
    const transportPass=response.ok&&candidate?.finishReason==='STOP';
    const provenance=transportPass&&validation.providerSchema.valid&&validation.local.valid
      ? resolveProvenance({raw:output,mapBytes:await readFile(join(folder,'evidence-map.json'),'utf8'),frozenMapHash,source})
      : {valid:false,errors:['not-run-validation-gate'],resolved:[]};
    await save(join(folder,'provenance-audit.json'),provenance);
    audit={runId,accession,model,modelVersion:provider?.modelVersion??null,physicalCalls:1,httpStatus:response.status,
      finishReason:candidate?.finishReason??null,latencyMs:Date.now()-start,usage:provider?.usageMetadata??null,
      validation,provenanceValid:provenance.valid,mappingHash:frozenMapHash,
      technicalPass:transportPass&&validation.providerSchema.valid&&validation.local.valid&&provenance.valid,
      semanticReview:'pending-direct-source-review'};
  } catch {
    audit={runId,accession,model,physicalCalls:1,technicalPass:false,latencyMs:Date.now()-start,
      error:'transport-or-audit-write-failure; outcome may be unknown; no retry'};
  }
  await save(join(folder,'audit.json'),audit);
  return audit;
}

async function main(args) {
  if (args.length===1&&args[0]==='--freeze') return freeze();
  const prepared=await verifyFrozen();
  if (!args.length) { console.log(JSON.stringify({runId,frozen:'PASS',priorFilesUnchanged:'PASS',physicalCallsThisCommand:0})); return; }
  assert.deepEqual(args.slice(0,2),['--live','--env-file']); assert.equal(args.length,3);
  const envText=await readFile(args[2],'utf8');
  const env=name=>envText.match(new RegExp(`^${name}=(.*)$`,'m'))?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');
  const key=env('GEMINI_API_KEY'); assert.ok(key,'GEMINI_API_KEY unavailable');
  const audit=await callOnce({folder:runDir,...prepared,key});
  await save(join(runDir,'ledger.json'),{runId,model,physicalCalls:1,cases:[audit],stopped:true,otherFilingsExecuted:0});
  console.log(JSON.stringify({runId,physicalCalls:1,technicalPass:audit.technicalPass,stopped:true}));
}
if (process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  main(process.argv.slice(2)).catch(()=>{console.error('Applied v5 Gemini 3.5 stopped; inspect audit. No automatic retry.');process.exitCode=1;});
}


