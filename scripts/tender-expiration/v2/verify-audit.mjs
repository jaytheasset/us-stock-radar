// Offline audit only. Reports invalid citations; never maps, repairs or drops them.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { verifyFrozen, hash, runId } from './run.mjs';
import { validateExpirationOutput } from './contract.ts';
const dir = fileURLToPath(new URL('./', import.meta.url));
const json = async path => JSON.parse(await readFile(join(dir, path), 'utf8'));
const { source, body } = await verifyFrozen();
const frozen = await json('run/frozen.json');
for (const [file, expected] of Object.entries(frozen.v1Files)) {
  assert.equal(hash(execFileSync('git', ['show', `fc5cc0a5:scripts/tender-expiration/${file}`])), expected, `v1 baseline differs: ${file}`);
}
const started = await json('run/started.json');
assert.equal(started.requestHash, hash(body));
const provider = await json('run/provider-response.txt');
const raw = await readFile(join(dir, 'run/structured.txt'), 'utf8');
assert.equal(raw, provider.candidates[0].content.parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join(''));
const audit = await json('run/audit.json');
assert.deepEqual(audit.validation, validateExpirationOutput(raw, source.evidence.map(e => e.id)));
const ledger = await json('run/ledger.json');
assert.equal(ledger.physicalCalls, 1);
assert.equal(ledger.remainingCasesExecuted, 0);
assert.deepEqual(ledger.cases, [audit]);
const output = JSON.parse(raw);
const citations = output.facts.flatMap(f => f.evidence_ids).map(id => ({ id, exists: source.evidence.some(e => e.id === id) }));
console.log(JSON.stringify({ runId, auditIntegrity: 'PASS', v1MatchesBaseCommit: 'PASS', frozenRequestSourceSchema: 'PASS', rawOutputUnchanged: 'PASS', physicalCalls: 1, remainingCasesExecuted: 0, outputValidation: audit.validation, citations }, null, 2));
