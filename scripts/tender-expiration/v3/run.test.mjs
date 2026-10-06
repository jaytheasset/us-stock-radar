import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve } from 'node:path';
import { buildProviderSchema, buildRequest, validateOutput } from './contract.ts';
import { hash, projectSource, resolveProvenance } from './boundary.mjs';
import { accession, callOnce } from './run.mjs';
const source = { accession, form: 'SC TO-I', coverage: { partialDocuments: [], unavailable: [], externalReferences: 'not-resolved', selection: 'bounded source slices' }, evidence: ['first source', 'second source'].map((text, i) => ({ id: 'tender:' + String(i + 1).repeat(64), accession, form: 'SC TO-I', document: { accession, documentId: 'sample.htm', url: 'https://www.sec.gov/sample' }, sourceHash: 'sourcehash', renderedHash: 'renderhash', textHash: hash(text), location: { start: i * 100, end: i * 100 + text.length, representation: 'test' }, text })) };
const { providerSource, evidenceMap } = projectSource(source);
const mapBytes = JSON.stringify(evidenceMap, null, 2) + '\n';
const frozenMapHash = hash(mapBytes);
const good = { facts: [{ type: 'expiration', current: '2025-02-04', evidence_refs: ['E2'] }], unresolved: [] };
const check = obj => validateOutput(JSON.stringify(obj), ['E1', 'E2']);

test('opaque projection preserves text/order and removes technical metadata; refs dynamic', () => {
  assert.deepEqual(providerSource.evidence, source.evidence.map((e, i) => ({ ref: `E${i + 1}`, text: e.text })));
  assert.deepEqual(Object.keys(evidenceMap), ['E1', 'E2']);
  assert.equal(evidenceMap.E2.evidence_id, source.evidence[1].id);
  const body = JSON.stringify(providerSource);
  for (const token of ['tender:', 'documentId', 'sourceHash', 'renderedHash', 'textHash', 'location', 'offset', 'accession', 'https://']) assert.ok(!body.includes(token), token);
});

test('provider schema supported subset, dynamic enum and no citation maxItems', () => {
  const schema = buildProviderSchema(['E1', 'E2', 'E3']);
  assert.deepEqual(schema.properties.facts.items.properties.evidence_refs.items.enum, ['E1', 'E2', 'E3']);
  assert.equal(schema.properties.facts.items.properties.evidence_refs.maxItems, undefined);
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'enum', 'items', 'minItems', 'maxItems']);
  function visit(s) { for (const [key, value] of Object.entries(s)) { assert.ok(allowed.has(key), key); if (key === 'properties') for (const v of Object.values(value)) visit(v); if (key === 'items') visit(value); } }
  visit(schema);
  assert.equal(schema.properties.facts.maxItems, 1);
});

test('local catches dates/duplicates; both validators reject invalid refs and removed fields', () => {
  assert.equal(check(good).local.valid, true);
  const wrongDate = structuredClone(good); wrongDate.facts[0].current = 'Feb 4';
  assert.equal(check(wrongDate).providerSchema.valid, true); assert.equal(check(wrongDate).local.valid, false);
  const duplicate = structuredClone(good); duplicate.facts[0].evidence_refs = ['E2', 'E2'];
  assert.equal(check(duplicate).providerSchema.valid, true); assert.equal(check(duplicate).local.valid, false);
  for (const refs of [[], ['E3'], ['e2'], ['tender:123']]) { const x = structuredClone(good); x.facts[0].evidence_refs = refs; assert.equal(check(x).providerSchema.valid, false); }
  for (const key of ['version', 'filing_kind']) assert.equal(check({ ...good, [key]: 'x' }).local.valid, false);
  for (const key of ['wording', 'change', 'extended', 'unchanged', 'changed', 'evidence_ids', 'url', 'offset']) { const x = structuredClone(good); x.facts[0][key] = 'x'; assert.equal(check(x).local.valid, false); }
  const nil = structuredClone(good); nil.facts[0].previous = null; assert.equal(check(nil).local.valid, false);
  const badCase = structuredClone(good); badCase.facts[0].type = 'Expiration'; assert.equal(check(badCase).local.valid, false);
  assert.equal(check({ facts: [good.facts[0], good.facts[0]], unresolved: [] }).local.valid, false);
  assert.equal(validateOutput('```json\n{}\n```', ['E1']).local.valid, false);
});

test('exact identity lookup only after validation; invalid refs/hash/foreign map rejected', () => {
  const raw = JSON.stringify(good);
  const result = resolveProvenance({ raw, mapBytes, frozenMapHash, source });
  assert.equal(result.valid, true);
  assert.deepEqual(result.resolved, [{ fact_index: 0, ref: 'E2', evidence_id: source.evidence[1].id, accession }]);
  assert.equal(resolveProvenance({ raw, mapBytes: mapBytes + ' ', frozenMapHash, source }).valid, false);
  const badMap = structuredClone(evidenceMap); badMap.E2.accession = 'foreign';
  const badBytes = JSON.stringify(badMap);
  assert.equal(resolveProvenance({ raw, mapBytes: badBytes, frozenMapHash: hash(badBytes), source }).valid, false);
  const wrong = structuredClone(good); wrong.facts[0].evidence_refs = ['E3'];
  const invalid = resolveProvenance({ raw: JSON.stringify(wrong), mapBytes, frozenMapHash, source });
  assert.equal(invalid.valid, false); assert.deepEqual(invalid.resolved, []);
  assert.equal(JSON.stringify(good), raw);
});

test('wrong semantic dates and valid but wrong source selections are never repaired', () => {
  const wrong = structuredClone(good); wrong.facts[0].current = '2025-04-30'; wrong.facts[0].previous = '2025-05-01'; wrong.facts[0].evidence_refs = ['E1'];
  const raw = JSON.stringify(wrong);
  assert.equal(check(wrong).local.valid, true);
  const result = resolveProvenance({ raw, mapBytes, frozenMapHash, source });
  assert.equal(result.resolved[0].evidence_id, source.evidence[0].id);
  assert.equal(JSON.stringify(wrong), raw);
});

for (const mode of ['success', 'transport', 'http', 'invalid-ref']) {
  test(`one frozen request, no repeat after ${mode}`, async () => {
    const folder = await mkdtemp(join(tmpdir(), 'tender-v3-'));
    const body = JSON.stringify(buildRequest(providerSource), null, 2) + '\n';
    let calls = 0;
    const fetchImpl = async (_url, options) => {
      calls++; assert.equal(options.body, body); assert.equal(options.redirect, 'error');
      assert.equal(JSON.parse(await readFile(join(folder, 'started.json'), 'utf8')).mappingHash, frozenMapHash);
      if (mode === 'transport') throw new Error('simulated timeout');
      const output = structuredClone(good); if (mode === 'invalid-ref') output.facts[0].evidence_refs = ['E99'];
      return new Response(mode === 'http' ? '{}' : JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(output) }] } }] }), { status: mode === 'http' ? 429 : 200 });
    };
    try {
      await writeFile(join(folder, 'evidence-map.json'), mapBytes);
      const args = { folder, source, providerSource, mapBytes, frozenMapHash, body, key: 'offline-test', fetchImpl };
      const result = await callOnce(args); assert.equal(result.technicalPass, mode === 'success');
      if (mode === 'invalid-ref') assert.deepEqual(JSON.parse(await readFile(join(folder, 'provenance-audit.json'), 'utf8')).errors, ['not-run-validation-gate']);
      await assert.rejects(callOnce(args), { code: 'EEXIST' }); assert.equal(calls, 1);
    } finally {
      assert.equal(dirname(resolve(folder)), resolve(tmpdir())); assert.ok(basename(folder).startsWith('tender-v3-'));
      await rm(folder, { recursive: true, force: true });
    }
  });
}
