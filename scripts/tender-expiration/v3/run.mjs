// Isolated one-call canary. No product imports, provider retry or semantic repair.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { buildRequest, systemPrompt, validateOutput } from './contract.ts';
import { hash, projectSource, resolveProvenance } from './boundary.mjs';
import { systemPrompt as v2Prompt } from '../v2/contract.ts';
export const base = 'f1796606bf7a70f65cf6902a195325e1560182b6';
export const accession = '0001213900-25-000757';
export const model = 'gemini-2.5-flash';
export const runId = 'tender-expiration-v3-rumble-canary-20261006';
const dir = fileURLToPath(new URL('./', import.meta.url));
const repo = resolve(dir, '../../..');
const runDir = join(dir, 'run');
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

async function priorHashes() {
  const files = execFileSync('git', ['ls-tree', '-r', '--name-only', base, '--', 'scripts/tender-expiration'], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
  const result = {};
  for (const path of files) {
    const baseline = hash(execFileSync('git', ['show', `${base}:${path}`], { cwd: repo }));
    assert.equal(hash(await readFile(join(repo, path))), baseline, `Previous audit changed: ${path}`);
    result[path] = baseline;
  }
  return result;
}

export async function freeze() {
  const previousFiles = await priorHashes();
  const source = await json(join(dir, '../v2/run/source.json'));
  assert.equal(source.accession, accession);
  const { providerSource, evidenceMap } = projectSource(source);
  const request = buildRequest(providerSource);
  await mkdir(runDir); // Exclusive run directory; never overwrite a prior freeze.
  await save(join(runDir, 'provider-source.json'), providerSource);
  await save(join(runDir, 'evidence-map.json'), evidenceMap);
  await save(join(runDir, 'provider-schema.json'), request.generationConfig.responseJsonSchema);
  await writeFile(join(runDir, 'prompt.txt'), systemPrompt, { flag: 'wx' });
  await save(join(runDir, 'request.json'), request);
  const before = v2Prompt.split('\n'); const after = systemPrompt.split('\n');
  await writeFile(join(runDir, 'prompt.diff'), ['--- v2/systemPrompt', '+++ v3/systemPrompt', ...before.filter(x => !after.includes(x)).map(x => '-' + x), ...after.filter(x => !before.includes(x)).map(x => '+' + x)].join('\n') + '\n', { flag: 'wx' });
  const files = {};
  for (const file of ['PLAN.md', 'contract.ts', 'boundary.mjs', 'run.mjs', 'run.test.mjs', 'run/provider-source.json', 'run/evidence-map.json', 'run/provider-schema.json', 'run/prompt.txt', 'run/request.json', 'run/prompt.diff']) files[file] = hash(await readFile(join(dir, file)));
  await save(join(runDir, 'frozen.json'), { runId, base, accession, model, frozenAt: new Date().toISOString(), files, previousFiles });
  console.log(JSON.stringify({ runId, physicalCalls: 0, refs: Object.keys(evidenceMap), requestHash: files['run/request.json'], mappingHash: files['run/evidence-map.json'] }));
}

export async function verifyFrozen() {
  const frozen = await json(join(runDir, 'frozen.json'));
  assert.equal(frozen.runId, runId);
  assert.deepEqual(await priorHashes(), frozen.previousFiles);
  for (const [file, sha] of Object.entries(frozen.files)) assert.equal(hash(await readFile(join(dir, file))), sha, file);
  const source = await json(join(dir, '../v2/run/source.json'));
  const { providerSource, evidenceMap } = projectSource(source);
  assert.deepEqual(await json(join(runDir, 'provider-source.json')), providerSource);
  const mapBytes = await readFile(join(runDir, 'evidence-map.json'), 'utf8');
  assert.deepEqual(JSON.parse(mapBytes), evidenceMap);
  const body = await readFile(join(runDir, 'request.json'), 'utf8');
  assert.deepEqual(JSON.parse(body), buildRequest(providerSource));
  assert.deepEqual(JSON.parse(body).generationConfig.responseJsonSchema, await json(join(runDir, 'provider-schema.json')));
  for (const e of source.evidence) { assert.equal(e.accession, accession); assert.equal(hash(e.text), e.textHash); }
  return { source, providerSource, mapBytes, frozenMapHash: frozen.files['run/evidence-map.json'], body };
}

export async function callOnce({ folder, source, providerSource, mapBytes, frozenMapHash, body, key, fetchImpl = fetch }) {
  assert.equal(source.accession, accession);
  assert.equal(hash(mapBytes), frozenMapHash);
  assert.deepEqual(projectSource(source).providerSource, providerSource);
  assert.deepEqual(JSON.parse(mapBytes), projectSource(source).evidenceMap);
  assert.deepEqual(JSON.parse(body), buildRequest(providerSource));
  await save(join(folder, 'started.json'), { runId, accession, model, startedAt: new Date().toISOString(), maxPhysicalCalls: 1, requestHash: hash(body), mappingHash: frozenMapHash });
  const start = Date.now();
  let audit;
  try {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(55000), headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
    });
    const raw = await response.text();
    await writeFile(join(folder, 'provider-response.txt'), raw, { flag: 'wx' });
    let provider;
    try { provider = JSON.parse(raw); } catch { provider = null; }
    const candidate = provider?.candidates?.[0];
    const output = (candidate?.content?.parts ?? []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
    await writeFile(join(folder, 'structured.txt'), output, { flag: 'wx' });
    const validation = validateOutput(output, providerSource.evidence.map(e => e.ref));
    const transportPass = response.ok && candidate?.finishReason === 'STOP';
    // No lookup whatsoever until both shape gates pass on a complete response.
    const provenance = transportPass && validation.providerSchema.valid && validation.local.valid
      ? resolveProvenance({ raw: output, mapBytes: await readFile(join(folder, 'evidence-map.json'), 'utf8'), frozenMapHash, source })
      : { valid: false, errors: ['not-run-validation-gate'], resolved: [] };
    await save(join(folder, 'provenance-audit.json'), provenance);
    audit = { runId, accession, model, modelVersion: provider?.modelVersion ?? null, physicalCalls: 1,
      httpStatus: response.status, finishReason: candidate?.finishReason ?? null, latencyMs: Date.now() - start,
      usage: provider?.usageMetadata ?? null, validation, provenanceValid: provenance.valid, mappingHash: frozenMapHash,
      technicalPass: transportPass && validation.providerSchema.valid && validation.local.valid && provenance.valid,
      semanticReview: 'pending-direct-source-review' };
  } catch {
    audit = { runId, accession, model, physicalCalls: 1, technicalPass: false, latencyMs: Date.now() - start,
      error: 'transport-or-audit-write-failure; outcome may be unknown; no retry' };
  }
  await save(join(folder, 'audit.json'), audit);
  return audit;
}

async function main(args) {
  if (args.length === 1 && args[0] === '--freeze') return freeze();
  const prepared = await verifyFrozen();
  if (!args.length) { console.log(JSON.stringify({ runId, frozen: 'PASS', v1v2ByteIdentical: 'PASS', physicalCallsThisCommand: 0 })); return; }
  assert.deepEqual(args.slice(0, 2), ['--live', '--env-file']); assert.equal(args.length, 3);
  const envText = await readFile(args[2], 'utf8');
  const env = name => envText.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2');
  const key = env('GEMINI_API_KEY'); assert.ok(key); assert.equal(env('GEMINI_MODEL'), model);
  const audit = await callOnce({ folder: runDir, ...prepared, key });
  await save(join(runDir, 'ledger.json'), { runId, model, physicalCalls: 1, cases: [audit], stopped: true, otherFilingsExecuted: 0 });
  console.log(JSON.stringify({ runId, physicalCalls: 1, technicalPass: audit.technicalPass, stopped: true }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(() => { console.error('v3 stopped; inspect audit. No automatic retry.'); process.exitCode = 1; });
}
