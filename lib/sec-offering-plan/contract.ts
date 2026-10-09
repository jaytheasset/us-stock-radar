import {Ajv2020} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {getContract,LEGACY_REVISION,REVISION} from './contracts.ts';
import type {AtmTerm} from './atm.ts';
import {sha,stable} from '../sec-os-snapshot/contract.ts';
import type {Block,Document} from '../sec-os-snapshot/contract.ts';
export {sha,stable};
export type {Block,Document};
export {getContract,LEGACY_REVISION,REVISION};
export const PURPOSE='sec_offering_plan',PROFILE='codex-cli:gpt-6-astra:high:v1';
export const {schemaText,promptText,schemaHash,promptHash}=getContract(REVISION);
export type Filing={issuer:string;cik:string;accession:string;form:string;filing_date:string;accepted_at:string|null;file_number:string|null;registration_number:string|null};
export type Source={filing:Filing;ticker:string|null;documents:Document[];blocks:Block[];fingerprint:string};
export type Quantity={status:'stated'|'blank'|'not_stated';value:string|null;unit:string};
export type Price={status:'fixed'|'range'|'blank'|'not_stated';qualification:string;value:string|null;low:string|null;high:string|null;currency:string|null;per_unit:string|null};
export type Component={id:string;seller_type:string;security_type:string;security_label:string;quantity:Quantity;price:Price;scenario:string|null;depositary:null|{underlying_share_class:string|null;underlying_shares_per_security:string|null;evidence_blocks:string[]};evidence_blocks:string[]};
// Absence is historical/unassessed; [] is an explicit empty observation in r3. Never backfill it.
export type Plan={atm_terms?:AtmTerm[];components:Component[];over_allotment:{component_ids:string[];seller_type:string;security_label:string;quantity:Quantity;scenario:string|null;evidence_blocks:string[]}[];post_offering_os:{security_label:string;quantity:string;unit:string;scenario:string|null;evidence_blocks:string[]}[];proceeds:{kind:string;recipient:string;amount:string|null;currency:string|null;scenario:string|null;evidence_blocks:string[]}[]};
export type Offering={version:string;filing:Filing;status:'PASS'|'REVIEW_REQUIRED'|'NO_DIRECT_OFFERING_PLAN';plan:Plan;review:null|{code:string;evidence_blocks:string[];candidates:Plan[]}};
const ajv=new Ajv2020({allErrors:true,strict:false});addFormats(ajv);
const validators=new Map([LEGACY_REVISION,REVISION].map(revision=>[revision,ajv.compile(JSON.parse(getContract(revision).schemaText))]));
export function evidenceRefs(value:unknown):string[]{
 const refs:string[]=[];function walk(x:unknown){if(!x||typeof x!=='object')return;for(const[k,v]of Object.entries(x)){if(k==='evidence_blocks'&&Array.isArray(v))refs.push(...v);else walk(v);}}walk(value);return [...new Set(refs)];
}
/** Format/identity/reference integrity only. No defaults, coercion, inference or value repair. */
// Keep the historical two-argument reader API. New execution must pass its binding revision.
export function validateOutput(raw:string,source:Source,revision=LEGACY_REVISION){
 const fail=(stage:string,errors:unknown)=>({ok:false,stage,errors,value:null,meaning:'NOT_ASSESSED' as const});
 const validate=validators.get(revision);if(!validate)return fail('contract',['Unsupported Offering contract']);
 let value:unknown;try{value=JSON.parse(raw);}catch{return fail('parse',['Invalid JSON']);}
 if(!validate(value))return fail('schema',structuredClone(validate.errors));
 const v=value as Offering,errors:string[]=[];
 if(stable(v.filing)!==stable(source.filing))errors.push('Filing identity mismatch');
 const blocks=new Map(source.blocks.map(b=>[b.id,b])),docs=new Map(source.documents.map(d=>[d.id,d]));
 if(blocks.size!==source.blocks.length||docs.size!==source.documents.length)errors.push('Duplicate source IDs');
 for(const d of docs.values())if(sha(d.original)!==d.original_sha256||sha(d.text)!==d.text_sha256)errors.push('Document hash mismatch: '+d.id);
 for(const id of evidenceRefs(v)){const b=blocks.get(id),d=b&&docs.get(b.document_id);if(!b||!d){errors.push('Unknown evidence: '+id);continue;}if(sha(b.text)!==b.sha256||d.text.split('\n').slice(b.line_start-1,b.line_end).join('\n')!==b.text)errors.push('Source block integrity: '+id);}
 errors.push(...planReferenceErrors(v));
 return errors.length?fail('reference',errors):{ok:true,stage:'complete',errors:[],value:v,meaning:'NOT_ASSESSED' as const};
}

/** Applied only after schema validation, also reused by the combined response adapter. */
export function planReferenceErrors(v:Pick<Offering,'plan'|'review'>):string[]{
 const errors:string[]=[];
 for(const plan of [v.plan,...(v.review?.candidates??[])]){const ids=plan.components.map(c=>c.id);if(new Set(ids).size!==ids.length)errors.push('Duplicate component IDs');for(const o of [...plan.over_allotment,...(plan.atm_terms??[])])for(const id of o.component_ids)if(!ids.includes(id))errors.push('Unknown component: '+id);}
 return errors;
}
