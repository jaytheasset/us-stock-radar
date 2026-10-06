// Isolated audit runner; direct Gemini REST, no SDK retry or semantic correction.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { buildExpirationRequest, validateExpirationOutput } from './contract.ts';

export const model = 'gemini-2.5-flash';
export const hash = text => createHash('sha256').update(text).digest('hex');
const dir = fileURLToPath(new URL('./', import.meta.url));
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

export async function callOnce({ folder, source, key, fetchImpl = fetch }) {
  await mkdir(folder, { recursive: true });
  const request = buildExpirationRequest(source);
  const body = JSON.stringify(request);
  // Claim before any network operation; an unknown outcome must never be retried.
  await save(join(folder, 'attempt.json'), { accession: source.accession, model, attemptedAt: new Date().toISOString(), physicalCallLimit: 1, requestHash: hash(body) });
  await save(join(folder, 'request.json'), request);
  const start = Date.now();
  let response;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(55000),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body,
    });
    const raw = await response.text();
    await writeFile(join(folder, 'provider-response.txt'), raw, { flag: 'wx' });
    let provider;
    try { provider = JSON.parse(raw); } catch { provider = null; }
    const candidate = provider?.candidates?.[0];
    const rawOutput = (candidate?.content?.parts ?? []).filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('');
    await writeFile(join(folder, 'structured.txt'), rawOutput, { flag: 'wx' });
    const validation = validateExpirationOutput(rawOutput, source.evidence.map(e => e.id));
    const report = { accession: source.accession, model, modelVersion: provider?.modelVersion ?? null, physicalCalls: 1,
      httpStatus: response.status, finishReason: candidate?.finishReason ?? null, latencyMs: Date.now() - start,
      usage: provider?.usageMetadata ?? null, validation,
      completed: response.ok && candidate?.finishReason === 'STOP' && validation.valid };
    await save(join(folder, 'audit.json'), report);
    return report;
  } catch {
    // Do not log thrown request/header objects or secret-bearing diagnostics.
    const report = { accession: source.accession, model, physicalCalls: 1, completed: false,
      latencyMs: Date.now() - start, error: 'transport-or-audit-write-failure; outcome may be unknown; no retry' };
    await save(join(folder, 'audit.json'), report);
    return report;
  }
}

export async function main(args) {
  const inputs = JSON.parse(await readFile(join(dir, 'fixtures/inputs.json'), 'utf8'));
  assert.equal(inputs.length, 8);
  assert.equal(new Set(inputs.map(c => c.source.accession)).size, 8);
  for (const c of inputs) {
    assert.ok(c.source.evidence.length);
    for (const e of c.source.evidence) {
      assert.equal(e.accession, c.source.accession);
      assert.equal(e.textHash, hash(e.text));
    }
  }
  if (!args.includes('--live')) {
    console.log(JSON.stringify({ mode: 'offline', cases: inputs.length, model, physicalCalls: 0 }));
    return;
  }
  assert.deepEqual(args.slice(0, 2), ['--live', '--env-file']);
  assert.equal(args.length, 3);
  const envText = await readFile(args[2], 'utf8');
  const getEnv = name => envText.match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim().replace(/^(["'])(.*)\1$/, '$2');
  const key = getEnv('GEMINI_API_KEY');
  assert.ok(key, 'GEMINI_API_KEY unavailable');
  assert.equal(getEnv('GEMINI_MODEL'), model, 'Configured model differs from the frozen plan');
  const frozenHashes = {};
  for (const file of ['PLAN.md', 'contract.ts', 'run.mjs', 'run.test.mjs', 'prepare.mjs', 'fixtures/inputs.json']) {
    frozenHashes[file] = hash(await readFile(join(dir, file)));
  }
  const resultsDir = join(dir, 'results');
  await mkdir(resultsDir, { recursive: true });
  await save(join(resultsDir, 'started.json'), { startedAt: new Date().toISOString(), model, maxPhysicalCalls: 8, frozenHashes,
    requests: inputs.map(c => ({ accession: c.source.accession, sha256: hash(JSON.stringify(buildExpirationRequest(c.source))) })) });
  const ledger = [];
  for (const c of inputs) {
    const report = await callOnce({ folder: join(resultsDir, c.name), source: c.source, key });
    ledger.push({ name: c.name, ...report });
    console.log(JSON.stringify({ name: c.name, completed: report.completed, calls: 1 }));
    if (!report.completed) break;
  }
  await save(join(resultsDir, 'ledger.json'), { model, physicalCalls: ledger.length, stoppedEarly: ledger.length < inputs.length, cases: ledger });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(() => { console.error('Experiment stopped; inspect audit files. No automatic retry.'); process.exitCode = 1; });
}
