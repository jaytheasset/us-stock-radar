import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { callOnce } from './run.mjs';
import { validateExpirationOutput, buildExpirationRequest } from './contract.ts';
const id = 'tender:' + 'a'.repeat(64);
const value = { version: 'tender-monitor-facts-draft-v1', facts: [{ type: 'expiration', current: { date: '2026-01-28', wording: 'quoted date' }, evidence_ids: [id] }], unresolved: [] };

test('strict format and evidence linkage reject malformed output without repair', () => {
  assert.equal(validateExpirationOutput(JSON.stringify(value), [id]).valid, true);
  assert.equal(validateExpirationOutput('```json\n' + JSON.stringify(value) + '\n```', [id]).valid, false);
  assert.equal(validateExpirationOutput(JSON.stringify(value), []).valid, false);
  const unknown = structuredClone(value); unknown.facts[0].type = 'offer_price';
  assert.equal(validateExpirationOutput(JSON.stringify(unknown), [id]).valid, false);
  const badDate = structuredClone(value); badDate.facts[0].current.date = 'Jan 28';
  assert.equal(validateExpirationOutput(JSON.stringify(badDate), [id]).valid, false);
});

test('validator deliberately accepts semantic errors and leaves input untouched', () => {
  const wrong = structuredClone(value);
  wrong.facts[0].current.date = '2026-01-27';
  wrong.facts[0].previous = { date: '2026-01-28', wording: 'invented or reversed' };
  wrong.facts[0].change = 'extended';
  const raw = JSON.stringify(wrong);
  assert.equal(validateExpirationOutput(raw, [id]).valid, true);
  assert.equal(JSON.stringify(wrong), raw);
});

test('request uses only supplied source and structured Gemini configuration', () => {
  const source = { accession: 'sample', evidence: [{ id, text: 'SEC source' }] };
  const r = buildExpirationRequest(source);
  assert.deepEqual(JSON.parse(r.contents[0].parts[0].text), source);
  assert.equal(r.generationConfig.responseMimeType, 'application/json');
  assert.ok(r.generationConfig.responseJsonSchema);
});

for (const mode of ['success', 'transport', 'http', 'bad-json']) {
  test(`one physical call, no repeat after ${mode}`, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tender-expiration-'));
    let calls = 0;
    const source = { accession: 'offline', evidence: [{ id }] };
    const fetchImpl = async (_url, options) => {
      calls++;
      assert.equal(options.redirect, 'error');
      if (mode === 'transport') throw new Error('offline simulated timeout');
      return new Response(mode === 'http' ? '{}' : JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: mode === 'bad-json' ? 'not json' : JSON.stringify(value) }] } }] }), { status: mode === 'http' ? 429 : 200 });
    };
    try {
      const report = await callOnce({ folder, source, key: 'offline-test', fetchImpl });
      assert.equal(report.completed, mode === 'success');
      await assert.rejects(callOnce({ folder, source, key: 'offline-test', fetchImpl }), { code: 'EEXIST' });
      assert.equal(calls, 1);
      assert.equal(JSON.parse(await readFile(join(folder, 'attempt.json'), 'utf8')).physicalCallLimit, 1);
    } finally {
      assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
      assert.ok(basename(folder).startsWith('tender-expiration-'));
      await rm(folder, { recursive: true, force: true });
    }
  });
}
