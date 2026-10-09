import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Ajv2020} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {sha,stable,type Snapshot,schemaHash as osSchemaHash} from '../sec-os-snapshot/contract.ts';
import {getContract,evidenceRefs,planReferenceErrors,type Offering} from '../sec-offering-plan/contract.ts';
import {combinedSchema,REVISION,OS_REVISION,OFFERING_REVISION} from './schema.ts';
import {assertCombinedSource,type CombinedSource} from './source.ts';
export {REVISION};

const schema = combinedSchema();
export const schemaText = JSON.stringify(schema, null, 2) + '\n';
export const promptText = readFileSync(resolve(process.cwd(), 'lib/sec-combined-offering/contracts/combined-output-r1/extraction-instructions.md'), 'utf8');
export const schemaHash = sha(schemaText), promptHash = sha(promptText);
const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'lib/sec-combined-offering/contracts/combined-output-r1/manifest.json'), 'utf8'));
if (schemaHash !== manifest.schemaHash || promptHash !== manifest.promptHash) throw Error('combined_contract_hash_mismatch');
const ajv = new Ajv2020({allErrors:true,strict:false});addFormats(ajv);
const envelope = ajv.compile<Record<string,any>>({...schema, required:['version','filing'],
  properties:{...schema.properties,os_snapshot:{},offering_plan:{}}});
const checkOs = ajv.compile({$defs:schema.$defs,...schema.properties.os_snapshot});
const checkOffering = ajv.compile({$defs:schema.$defs,...schema.properties.offering_plan});

/** Descriptor only; the full source is transient provider input, not another persisted copy. */
export function combinedBinding(rawItemId: string, source: CombinedSource) {
  assertCombinedSource(source);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawItemId)) throw Error('combined_raw_id_invalid');
  const identity = {rawItemId, accession:source.filing.accession, sourceVersion:source.sourceVersion,
    sourceFingerprint:source.fingerprint, contractVersion:REVISION, schemaHash,promptHash,
    osContractVersion:OS_REVISION, osSchemaHash, offeringContractVersion:OFFERING_REVISION,
    offeringSchemaHash:getContract(OFFERING_REVISION).schemaHash};
  return {...identity, key:sha(stable(identity))};
}
export type CombinedBinding = ReturnType<typeof combinedBinding>;
type DomainResult<T> = {ok:boolean; stage:string; errors:unknown; value:T|null; meaning:'NOT_ASSESSED'};
type OsDomain = Omit<Snapshot,'version'|'filing'>;
type OfferingDomain = Omit<Offering,'version'|'filing'>;
const fail = <T>(stage:string,errors:unknown):DomainResult<T> => ({ok:false,stage,errors,value:null,meaning:'NOT_ASSESSED'});

/** Retain the exact response; validate each domain separately without filling or transforming fields. */
export function validateCombinedResponse(raw:string, source:CombinedSource, binding:CombinedBinding) {
  const retained = {raw,rawHash:sha(raw),binding};
  const bothFailed = (stage:string,errors:unknown) => ({...retained,ok:false,
    os_snapshot:fail<OsDomain>(stage,errors),offering_plan:fail<OfferingDomain>(stage,errors)});
  try {
    if (stable(combinedBinding(binding.rawItemId,source)) !== stable(binding)) return bothFailed('binding',['Source/contract binding mismatch']);
  } catch {return bothFailed('binding',['Source/contract binding unavailable or invalid']);}
  let value:any;
  try {value=JSON.parse(raw);} catch {return bothFailed('parse',['Invalid JSON']);}
  if (!envelope(value)) return bothFailed('envelope',structuredClone(envelope.errors));
  if (stable(value.filing) !== stable(source.filing)) return bothFailed('identity',['Filing identity mismatch']);
  const blocks = new Set(source.blocks.map(b=>b.id));
  function domain<T>(value:unknown, check:typeof checkOs, offering=false):DomainResult<T> {
    if (!check(value)) return fail('schema',structuredClone(check.errors));
    const errors = evidenceRefs(value).filter(id=>!blocks.has(id)).map(id=>'Unknown evidence: '+id);
    if (offering) errors.push(...planReferenceErrors(value as OfferingDomain));
    return errors.length ? fail('reference',errors) : {ok:true,stage:'complete',errors:[],value:value as T,meaning:'NOT_ASSESSED'};
  }
  const os_snapshot = domain<OsDomain>(value.os_snapshot,checkOs);
  const offering_plan = domain<OfferingDomain>(value.offering_plan,checkOffering,true);
  return {...retained,ok:os_snapshot.ok&&offering_plan.ok,os_snapshot,offering_plan};
}
