import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { hash, projectSource } from '../tender-expiration/v3/boundary.mjs';
export { hash, projectSource };
export const base = '276bb1db9d6cd3ac7cad2d8d52fe01df40b64b55';
export const model = 'gemini-3.5-flash';
const root = fileURLToPath(new URL('./', import.meta.url));
const repo = resolve(root, '../..');
const save = (p, v) => writeFile(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const json = async p => JSON.parse(await readFile(p, 'utf8'));
const contractFor = async fact => { assert.ok(['expiration','offer_price','board_recommendation'].includes(fact)); return import(`./contracts/${fact}.ts`); };
async function checkPreviousFact(fact) {
  const prior = fact === 'offer_price' ? 'expiration' : fact === 'board_recommendation' ? 'offer_price' : null;
  if (prior) assert.equal((await json(join(root, prior, 'result.json'))).practicalPass, true, 'Previous FACT must pass before progression');
}

async function priorHashes() {
  const list = execFileSync('git', ['ls-tree','-r','--name-only',base,'--','scripts/tender-expiration'], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
  const result = {};
  for (const file of list) {
    const sha = hash(execFileSync('git', ['show', `${base}:${file}`], { cwd: repo }));
    assert.equal(hash(await readFile(join(repo, file))), sha, file); result[file] = sha;
  }
  return result;
}

export function resolveRefs(raw, mapBytes, frozenMapHash, source, validate) {
  const refs = source.evidence.map((_, i) => `E${i + 1}`);
  const validation = validate(raw, refs);
  if (!validation.providerSchema.valid || !validation.local.valid) return { valid: false, errors: ['validation-gate'], resolved: [] };
  if (hash(mapBytes) !== frozenMapHash) return { valid: false, errors: ['map-hash'], resolved: [] };
  const map = JSON.parse(mapBytes);
  if (!isDeepStrictEqual(map, projectSource(source).evidenceMap)) return { valid: false, errors: ['map-identity'], resolved: [] };
  const resolved = [];
  for (const [fact_index, fact] of JSON.parse(raw).facts.entries()) for (const ref of fact.evidence_refs) {
    const entry = map[ref];
    if (!entry || entry.accession !== source.accession || entry.document.accession !== source.accession || !source.evidence.some(e => e.id === entry.evidence_id)) return { valid: false, errors: ['foreign-or-missing'], resolved: [] };
    resolved.push({ fact_index, ref, evidence_id: entry.evidence_id, accession: entry.accession });
  }
  return { valid: true, errors: [], mappingHash: frozenMapHash, resolved };
}

export async function callOnce({ folder, identity, source, body, mapBytes, frozenMapHash, validate, key, fetchImpl = fetch }) {
  assert.equal(hash(mapBytes), frozenMapHash);
  assert.equal(JSON.parse(body).contents[0].parts[0].text, JSON.stringify(projectSource(source).providerSource));
  await save(join(folder, 'started.json'), { ...identity, model, startedAt: new Date().toISOString(), physicalCallLimit: 1, requestHash: hash(body), mappingHash: frozenMapHash });
  const start = Date.now(); let audit;
  try {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method:'POST', redirect:'error', signal:AbortSignal.timeout(55000), headers:{'Content-Type':'application/json','x-goog-api-key':key}, body });
    const raw = await response.text(); await writeFile(join(folder,'provider-response.txt'), raw, {flag:'wx'});
    let provider; try { provider = JSON.parse(raw); } catch { provider = null; }
    const c = provider?.candidates?.[0];
    const output = (c?.content?.parts ?? []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
    await writeFile(join(folder,'structured.txt'), output, {flag:'wx'});
    const validation = validate(output, source.evidence.map((_, i) => `E${i + 1}`));
    const transportPass = response.ok && c?.finishReason === 'STOP';
    const provenance = transportPass && validation.providerSchema.valid && validation.local.valid ? resolveRefs(output, await readFile(join(folder,'evidence-map.json'),'utf8'), frozenMapHash, source, validate) : {valid:false, errors:['validation-gate'], resolved:[]};
    await save(join(folder,'provenance-audit.json'),provenance);
    audit = {...identity, model, modelVersion:provider?.modelVersion ?? null, physicalCalls:1, httpStatus:response.status, finishReason:c?.finishReason ?? null, latencyMs:Date.now()-start, usage:provider?.usageMetadata ?? null, validation, provenanceValid:provenance.valid, technicalPass:transportPass && validation.providerSchema.valid && validation.local.valid && provenance.valid, failureClass:response.status===404?'PROVIDER_MODEL_UNAVAILABLE':null};
  } catch { audit = {...identity, model, physicalCalls:1, technicalPass:false, latencyMs:Date.now()-start, error:'transport-or-audit-write-failure; no retry; inspect preserved artifacts'}; }
  await save(join(folder,'audit.json'),audit); return audit;
}

async function freeze(fact) {
  await checkPreviousFact(fact);
  const dir = join(root,fact); const manifest = await json(join(dir,'manifest.json'));
  assert.equal(manifest.fact,fact); assert.equal(manifest.model,model); assert.ok(manifest.cases.length>=3 && manifest.cases.length<=5);
  const contract = await contractFor(fact); const previousFiles = await priorHashes();
  const sharedFiles = {};
  for (const file of ['PLAN.md','runner.mjs','runner.test.mjs',`contracts/${fact}.ts`]) sharedFiles[file] = hash(await readFile(join(root,file)));
  for (const file of ['contract.ts','boundary.mjs']) sharedFiles[`../tender-expiration/v3/${file}`] = hash(await readFile(join(root,'../tender-expiration/v3',file)));
  await mkdir(join(dir,'runs'));
  const accessions = new Set();
  for (const c of manifest.cases) {
    const input = await json(resolve(dir,c.sourceFile));
    const source = c.fixtureName ? input.find(x=>x.name===c.fixtureName).source : input;
    assert.ok(!accessions.has(source.accession)); accessions.add(source.accession);
    for (const e of source.evidence) { assert.equal(e.accession,source.accession); assert.equal(hash(e.text),e.textHash); }
    const projected = projectSource(source); const request = contract.buildRequest(projected.providerSource);
    const folder = join(dir,'runs',c.name); await mkdir(folder);
    for (const [file,v] of Object.entries({'source.json':source,'provider-source.json':projected.providerSource,'evidence-map.json':projected.evidenceMap,'provider-schema.json':request.generationConfig.responseJsonSchema,'request.json':request})) await save(join(folder,file),v);
    await writeFile(join(folder,'prompt.txt'),contract.systemPrompt,{flag:'wx'});
    const files = {}; for (const file of await readdir(folder)) files[file] = hash(await readFile(join(folder,file)));
    await save(join(folder,'frozen.json'),{runId:`${manifest.runId}-${c.name}`,fact,model,accession:source.accession,frozenAt:new Date().toISOString(),files});
  }
  await save(join(dir,'frozen-batch.json'),{base,fact,model,manifestHash:hash(await readFile(join(dir,'manifest.json'))),sharedFiles,previousFiles});
  console.log(JSON.stringify({fact,frozen:manifest.cases.length,physicalCalls:0}));
}

export async function verifyBatch(fact) {
  const dir = join(root,fact); const frozen = await json(join(dir,'frozen-batch.json'));
  assert.equal(hash(await readFile(join(dir,'manifest.json'))),frozen.manifestHash);
  for (const [file,sha] of Object.entries(frozen.sharedFiles)) assert.equal(hash(await readFile(resolve(root,file))),sha,file);
  for (const [file,sha] of Object.entries(frozen.previousFiles)) assert.equal(hash(await readFile(join(repo,file))),sha,file);
  const manifest = await json(join(dir,'manifest.json')); const contract = await contractFor(fact); const cases = [];
  for (const c of manifest.cases) {
    const folder = join(dir,'runs',c.name); const f = await json(join(folder,'frozen.json'));
    for (const [file,sha] of Object.entries(f.files)) assert.equal(hash(await readFile(join(folder,file))),sha,file);
    const source = await json(join(folder,'source.json')); const projected = projectSource(source);
    const body = await readFile(join(folder,'request.json'),'utf8'); assert.deepEqual(JSON.parse(body),contract.buildRequest(projected.providerSource));
    const mapBytes = await readFile(join(folder,'evidence-map.json'),'utf8'); assert.deepEqual(JSON.parse(mapBytes),projected.evidenceMap);
    cases.push({folder,identity:{runId:f.runId,fact,accession:source.accession,name:c.name},source,body,mapBytes,frozenMapHash:f.files['evidence-map.json'],validate:contract.validateOutput});
  }
  return {dir,cases};
}

async function main(args) {
  const [mode,fact,...rest]=args;
  if (mode==='freeze') return freeze(fact);
  const {dir,cases}=await verifyBatch(fact);
  if (mode==='verify') { console.log(JSON.stringify({fact,frozen:'PASS',priorFilesUnchanged:'PASS',cases:cases.length})); return; }
  assert.equal(mode,'live'); assert.deepEqual(rest.slice(0,1),['--env-file']); assert.equal(rest.length,2);
  await checkPreviousFact(fact);
  const text = await readFile(rest[1],'utf8'); const key = text.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2'); assert.ok(key);
  await save(join(dir,'started-batch.json'),{fact,model,startedAt:new Date().toISOString(),maxCalls:cases.length});
  const ledger=[];
  for (const c of cases) { const a=await callOnce({...c,key}); ledger.push(a); console.log(JSON.stringify({case:c.identity.name,technicalPass:a.technicalPass,calls:1})); if(!a.technicalPass)break; }
  await save(join(dir,'ledger.json'),{fact,model,physicalCalls:ledger.length,stoppedEarly:ledger.length<cases.length,cases:ledger});
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) main(process.argv.slice(2)).catch(e=>{console.error(`Stopped: ${e.code ?? e.name}; no retry`);process.exitCode=1;});
