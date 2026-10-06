// v2 canary only. Preserves v1 and sends a previously frozen request exactly once.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { buildExpirationRequest, expirationJsonSchema, systemPrompt, validateExpirationOutput } from './contract.ts';
import { systemPrompt as v1Prompt } from '../contract.ts';

export const model = 'gemini-2.5-flash';
export const accession = '0001213900-25-000757';
export const runId = 'tender-expiration-v2-rumble-canary-20261006';
export const hash = text => createHash('sha256').update(text).digest('hex');
const dir = fileURLToPath(new URL('./', import.meta.url));
const runDir = join(dir, 'run');
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

async function v1Hashes(root = resolve(dir, '..'), prefix = '') {
  const entries = {};
  for (const e of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (!prefix && e.name === 'v2') continue;
    const name = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) Object.assign(entries, await v1Hashes(root, name));
    else entries[name] = hash(await readFile(join(root, name)));
  }
  return entries;
}

export async function freeze() {
  // No network. A second freeze cannot overwrite an existing run.
  await mkdir(runDir);
  const cases = JSON.parse(await readFile(join(dir, '../fixtures/inputs.json'), 'utf8'));
  const source = cases.find(c => c.source.accession === accession).source;
  const request = buildExpirationRequest(source);
  assert.deepEqual(expirationJsonSchema.properties.facts.items.properties.type.enum, ['expiration']);
  assert.ok(!JSON.stringify(expirationJsonSchema).includes('"const"'));
  await save(join(runDir, 'source.json'), source);
  await save(join(runDir, 'request.json'), request);
  await save(join(runDir, 'provider-schema.json'), expirationJsonSchema);
  await writeFile(join(runDir, 'prompt.txt'), systemPrompt, { flag: 'wx' });
  // Exact removed/added lines for review; not sent to Gemini.
  const before = v1Prompt.split('\n'); const after = systemPrompt.split('\n');
  const diff = ['--- v1/systemPrompt', '+++ v2/systemPrompt',
    ...before.filter(x => !after.includes(x)).map(x => '-' + x),
    ...after.filter(x => !before.includes(x)).map(x => '+' + x)].join('\n') + '\n';
  await writeFile(join(runDir, 'prompt.diff'), diff, { flag: 'wx' });
  const files = {};
  for (const file of ['PLAN.md', 'contract.ts', 'run.mjs', 'run.test.mjs', 'run/source.json', 'run/request.json', 'run/provider-schema.json', 'run/prompt.txt', 'run/prompt.diff']) {
    files[file] = hash(await readFile(join(dir, file)));
  }
  await save(join(runDir, 'frozen.json'), { runId, accession, model, frozenAt: new Date().toISOString(), files, v1Files: await v1Hashes() });
  console.log(JSON.stringify({ runId, frozen: true, physicalCalls: 0, requestHash: files['run/request.json'] }));
}

export async function verifyFrozen() {
  const frozen = JSON.parse(await readFile(join(runDir, 'frozen.json'), 'utf8'));
  assert.equal(frozen.runId, runId);
  for (const [file, sha] of Object.entries(frozen.files)) assert.equal(hash(await readFile(join(dir, file))), sha, file);
  assert.deepEqual(await v1Hashes(), frozen.v1Files, 'v1 must remain byte-identical');
  const source = JSON.parse(await readFile(join(runDir, 'source.json'), 'utf8'));
  const cases = JSON.parse(await readFile(join(dir, '../fixtures/inputs.json'), 'utf8'));
  assert.deepEqual(source, cases.find(c => c.source.accession === accession).source);
  const body = await readFile(join(runDir, 'request.json'), 'utf8');
  assert.deepEqual(JSON.parse(body), buildExpirationRequest(source));
  assert.deepEqual(JSON.parse(body).generationConfig.responseJsonSchema, JSON.parse(await readFile(join(runDir, 'provider-schema.json'), 'utf8')));
  for (const e of source.evidence) {
    assert.equal(e.accession, accession);
    assert.equal(hash(e.text), e.textHash);
  }
  return { source, body };
}

export async function callOnce({ folder, source, body, key, fetchImpl = fetch }) {
  assert.equal(source.accession, accession);
  assert.deepEqual(JSON.parse(body).contents[0].parts[0].text, JSON.stringify(source));
  // Claim before fetch. Even a crash/unknown outcome cannot be retried.
  await save(join(folder, 'started.json'), { runId, accession, model, startedAt: new Date().toISOString(), maxPhysicalCalls: 1, requestHash: hash(body) });
  const started = Date.now();
  let audit;
  try {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(55000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
    });
    const raw = await response.text();
    await writeFile(join(folder, 'provider-response.txt'), raw, { flag: 'wx' });
    let provider;
    try { provider = JSON.parse(raw); } catch { provider = null; }
    const candidate = provider?.candidates?.[0];
    const output = (candidate?.content?.parts ?? []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
    await writeFile(join(folder, 'structured.txt'), output, { flag: 'wx' });
    const validation = validateExpirationOutput(output, source.evidence.map(e => e.id));
    audit = { runId, accession, model, modelVersion: provider?.modelVersion ?? null, physicalCalls: 1,
      httpStatus: response.status, finishReason: candidate?.finishReason ?? null, latencyMs: Date.now() - started,
      usage: provider?.usageMetadata ?? null, validation,
      completed: response.ok && candidate?.finishReason === 'STOP' && validation.valid };
  } catch {
    audit = { runId, accession, model, physicalCalls: 1, completed: false, latencyMs: Date.now() - started,
      error: 'transport-or-audit-write-failure; outcome may be unknown; no retry' };
  }
  await save(join(folder, 'audit.json'), audit);
  return audit;
}

async function main(args) {
  if (args.length === 1 && args[0] === '--freeze') return freeze();
  const { source, body } = await verifyFrozen();
  if (!args.length) { console.log(JSON.stringify({ frozen: 'PASS', v1Unchanged: 'PASS', runId, physicalCallsThisCommand: 0 })); return; }
  assert.deepEqual(args.slice(0, 2), ['--live', '--env-file']);
  assert.equal(args.length, 3);
  const envText = await readFile(args[2], 'utf8');
  const env = name => envText.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2');
  const key = env('GEMINI_API_KEY');
  assert.ok(key, 'GEMINI_API_KEY unavailable');
  assert.equal(env('GEMINI_MODEL'), model);
  const audit = await callOnce({ folder: runDir, source, body, key });
  await save(join(runDir, 'ledger.json'), { runId, model, physicalCalls: 1, cases: [audit], stopped: true, remainingCasesExecuted: 0 });
  console.log(JSON.stringify({ runId, physicalCalls: 1, completed: audit.completed, stopped: true }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(() => { console.error('v2 stopped; inspect audit. No automatic retry.'); process.exitCode = 1; });
}
