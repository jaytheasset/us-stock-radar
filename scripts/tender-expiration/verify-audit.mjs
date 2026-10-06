// Offline audit only. No expected-date evaluator or output mutation.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { hash } from './run.mjs';
import { buildExpirationRequest, validateExpirationOutput } from './contract.ts';
const dir = fileURLToPath(new URL('./', import.meta.url));
const json = async path => JSON.parse(await readFile(join(dir, path), 'utf8'));
const started = await json('results/started.json');
for (const [file, expected] of Object.entries(started.frozenHashes)) {
  assert.equal(hash(await readFile(join(dir, file))), expected, `Frozen file changed: ${file}`);
}
const inputs = await json('fixtures/inputs.json');
for (const c of inputs) {
  assert.equal(hash(JSON.stringify(buildExpirationRequest(c.source))), started.requests.find(x => x.accession === c.source.accession).sha256);
  for (const e of c.source.evidence) {
    assert.equal(hash(e.text), e.textHash);
    assert.equal(e.text.length, e.location.end - e.location.start);
    assert.equal(e.document.accession, c.source.accession);
  }
}
const ledger = await json('results/ledger.json');
const folders = (await readdir(join(dir, 'results'), { withFileTypes: true })).filter(e => e.isDirectory());
assert.equal(folders.length, ledger.physicalCalls);
for (const record of ledger.cases) {
  const input = inputs.find(c => c.name === record.name);
  const request = await json(`results/${record.name}/request.json`);
  assert.deepEqual(JSON.parse(request.contents[0].parts[0].text), input.source);
  assert.equal(hash(JSON.stringify(request)), started.requests.find(x => x.accession === input.source.accession).sha256);
  const raw = await readFile(join(dir, `results/${record.name}/structured.txt`), 'utf8');
  assert.deepEqual(validateExpirationOutput(raw, input.source.evidence.map(e => e.id)), record.validation);
  const provider = await json(`results/${record.name}/provider-response.txt`);
  assert.equal(raw, provider.candidates[0].content.parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join(''));
  // Check citation identity independently even when invalid literals halt Zod parsing.
  const output = JSON.parse(raw);
  for (const item of [...output.facts, ...output.unresolved]) {
    for (const id of item.evidence_ids) assert.ok(input.source.evidence.some(e => e.id === id));
  }
}
console.log(JSON.stringify({ frozenHashes: 'PASS', sourceAndRequestIntegrity: 'PASS', rawOutputUnchanged: 'PASS', citationIdentity: 'PASS', physicalCalls: ledger.physicalCalls, plannedCases: inputs.length, stoppedEarly: ledger.stoppedEarly }));
