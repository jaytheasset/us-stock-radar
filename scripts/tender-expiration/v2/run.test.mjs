import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { accession, callOnce, hash } from './run.mjs';
import { buildExpirationRequest, expirationJsonSchema, validateExpirationOutput } from './contract.ts';
const id = 'tender:' + 'a'.repeat(64);
const good = { facts: [{ type: 'expiration', current: { date: '2025-02-04', wording: 'source quote' }, evidence_ids: [id] }], unresolved: [] };
const valid = x => validateExpirationOutput(JSON.stringify(x), [id]).valid;

test('provider schema contains single enum, no const or removed fields; previous optional', () => {
  assert.deepEqual(Object.keys(expirationJsonSchema.properties), ['facts', 'unresolved']);
  const fact = expirationJsonSchema.properties.facts.items;
  assert.deepEqual(fact.properties.type.enum, ['expiration']);
  assert.deepEqual(fact.required, ['type', 'current', 'evidence_ids']);
  assert.deepEqual(Object.keys(fact.properties), ['type', 'current', 'previous', 'evidence_ids']);
  assert.equal(expirationJsonSchema.properties.unresolved.items.type, 'string');
  assert.ok(!JSON.stringify(expirationJsonSchema).includes('"const"'));
});

test('reject capitalization, forbidden fields, absent current, null previous, bad dates and unknown IDs', () => {
  assert.equal(valid(good), true);
  for (const type of ['Expiration', 'EXPIRATION', 'offer_price']) {
    const x = structuredClone(good); x.facts[0].type = type; assert.equal(valid(x), false);
  }
  for (const field of ['version', 'filing_kind']) assert.equal(valid({ ...good, [field]: 'x' }), false);
  for (const field of ['change', 'extended', 'unchanged', 'changed']) {
    const x = structuredClone(good); x.facts[0][field] = 'x'; assert.equal(valid(x), false);
  }
  const absent = structuredClone(good); delete absent.facts[0].current; assert.equal(valid(absent), false);
  const bad = structuredClone(good); bad.facts[0].current.date = 'Feb 4'; assert.equal(valid(bad), false);
  const nil = structuredClone(good); nil.facts[0].previous = null; assert.equal(valid(nil), false);
  assert.equal(validateExpirationOutput(JSON.stringify(good), []).valid, false);
  assert.equal(validateExpirationOutput('```json\n' + JSON.stringify(good) + '\n```', [id]).valid, false);
});

test('unresolved strings and optional previous accepted; semantic mistakes stay untouched', () => {
  assert.equal(valid({ facts: [], unresolved: ['Source does not establish expiration.'] }), true);
  assert.equal(valid({ facts: [], unresolved: [{ detail: 'object forbidden' }] }), false);
  const wrong = structuredClone(good);
  wrong.facts[0].current.date = '2025-04-30';
  wrong.facts[0].previous = { date: '2025-05-01', wording: 'invented prior' };
  const raw = JSON.stringify(wrong);
  assert.equal(validateExpirationOutput(raw, [id]).valid, true);
  assert.equal(JSON.stringify(wrong), raw);
});

for (const mode of ['success', 'transport', 'http', 'invalid-output']) {
  test(`exact frozen bytes and single request after ${mode}`, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tender-v2-'));
    const source = { accession, evidence: [{ id }] };
    const body = JSON.stringify(buildExpirationRequest(source), null, 2) + '\n';
    let calls = 0;
    const fetchImpl = async (_url, options) => {
      calls++;
      assert.equal(options.body, body);
      assert.equal(options.redirect, 'error');
      assert.equal(JSON.parse(await readFile(join(folder, 'started.json'), 'utf8')).requestHash, hash(body));
      if (mode === 'transport') throw new Error('simulated timeout');
      return new Response(mode === 'http' ? '{}' : JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: mode === 'invalid-output' ? JSON.stringify({ ...good, version: '1' }) : JSON.stringify(good) }] } }] }), { status: mode === 'http' ? 429 : 200 });
    };
    try {
      const result = await callOnce({ folder, source, body, key: 'offline-test', fetchImpl });
      assert.equal(result.completed, mode === 'success');
      await assert.rejects(callOnce({ folder, source, body, key: 'offline-test', fetchImpl }), { code: 'EEXIST' });
      assert.equal(calls, 1);
    } finally {
      assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
      assert.ok(basename(folder).startsWith('tender-v2-'));
      await rm(folder, { recursive: true, force: true });
    }
  });
}

test('runner refuses any other filing before a request', async () => {
  let calls = 0;
  await assert.rejects(callOnce({ folder: '', source: { accession: 'other' }, body: '{}', key: '', fetchImpl: async () => { calls++; } }));
  assert.equal(calls, 0);
});
