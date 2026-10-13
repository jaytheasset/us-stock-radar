import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {sha} from '../sec-os-snapshot/contract.ts';
import {withAtmTerms} from './atm.ts';

export const LEGACY_REVISION = 'offering_plan_v1-output-r2';
export const REVISION = 'offering_plan_v1-output-r3';
const root = resolve(process.cwd(), 'lib/sec-offering-plan/contracts');
const legacySchema = readFileSync(resolve(root, 'offering-output-r2/offering-plan-v1.schema.json'), 'utf8');
const legacyPrompt = readFileSync(resolve(root, 'offering-output-r2/extraction-instructions.md'), 'utf8');
const currentSchema = JSON.stringify(withAtmTerms(JSON.parse(legacySchema)), null, 2) + '\n';
const currentPrompt = readFileSync(resolve(root, 'offering-output-r3/extraction-instructions.md'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'offering-output-r3/manifest.json'), 'utf8'));

function contract(revision: string, schemaText: string, promptText: string, hashes: {schemaHash: string; promptHash: string}) {
  const schemaHash = sha(schemaText), promptHash = sha(promptText);
  if (schemaHash !== hashes.schemaHash || promptHash !== hashes.promptHash) throw Error('offering_contract_hash_mismatch');
  return Object.freeze({revision, schemaText, promptText, schemaHash, promptHash});
}
const contracts = new Map([
  [LEGACY_REVISION, contract(LEGACY_REVISION, legacySchema, legacyPrompt, {
    schemaHash: '861dac72eb8ccfb57fea01faf57ac875cd23daa7ff929314ec17c8d0717122bb',
    promptHash: 'd3860dadab45d8c02cc30c174a8a781ee4a4a663b55fbb472984c2e2cf4578bb',
  })],
  [REVISION, contract(REVISION, currentSchema, currentPrompt, manifest)],
]);

/** Select by recorded revision, never infer a revision from result fields. */
export function getContract(revision: string, expected?: {schemaHash: string; promptHash: string}) {
  const selected = contracts.get(revision);
  if (!selected) throw Error('offering_contract_unsupported');
  if (expected && (expected.schemaHash !== selected.schemaHash || expected.promptHash !== selected.promptHash)) {
    throw Error('offering_contract_binding_mismatch');
  }
  return selected;
}
