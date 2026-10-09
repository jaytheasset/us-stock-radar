import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Ajv2020} from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {sha,stable} from '../sec-os-snapshot/contract.ts';
import type {Block,Document} from '../sec-os-snapshot/contract.ts';
export {sha,stable};
export type {Block,Document};
export const PURPOSE='sec_offering_plan',REVISION='offering_plan_v1-output-r2',PROFILE='codex-cli:gpt-6-astra:high:v1';
const dir=resolve(process.cwd(),'lib/sec-offering-plan/contracts/offering-output-r2');
export const schemaText=readFileSync(resolve(dir,'offering-plan-v1.schema.json'),'utf8');
export const promptText=readFileSync(resolve(dir,'extraction-instructions.md'),'utf8');
export const schemaHash=sha(schemaText),promptHash=sha(promptText);
if(schemaHash!=='861dac72eb8ccfb57fea01faf57ac875cd23daa7ff929314ec17c8d0717122bb'||promptHash!=='d3860dadab45d8c02cc30c174a8a781ee4a4a663b55fbb472984c2e2cf4578bb')throw Error('offering_contract_hash_mismatch');
export type Filing={issuer:string;cik:string;accession:string;form:string;filing_date:string;accepted_at:string|null;file_number:string|null;registration_number:string|null};
export type Source={filing:Filing;ticker:string|null;documents:Document[];blocks:Block[];fingerprint:string};
export type Quantity={status:'stated'|'blank'|'not_stated';value:string|null;unit:string};
export type Price={status:'fixed'|'range'|'blank'|'not_stated';qualification:string;value:string|null;low:string|null;high:string|null;currency:string|null;per_unit:string|null};
export type Component={id:string;seller_type:string;security_type:string;security_label:string;quantity:Quantity;price:Price;scenario:string|null;depositary:null|{underlying_share_class:string|null;underlying_shares_per_security:string|null;evidence_blocks:string[]};evidence_blocks:string[]};
export type Plan={components:Component[];over_allotment:{component_ids:string[];seller_type:string;security_label:string;quantity:Quantity;scenario:string|null;evidence_blocks:string[]}[];post_offering_os:{security_label:string;quantity:string;unit:string;scenario:string|null;evidence_blocks:string[]}[];proceeds:{kind:string;recipient:string;amount:string|null;currency:string|null;scenario:string|null;evidence_blocks:string[]}[]};
export type Offering={version:string;filing:Filing;status:'PASS'|'REVIEW_REQUIRED'|'NO_DIRECT_OFFERING_PLAN';plan:Plan;review:null|{code:string;evidence_blocks:string[];candidates:Plan[]}};
const ajv=new Ajv2020({allErrors:true,strict:false});addFormats(ajv);const validate=ajv.compile(JSON.parse(schemaText));
export function evidenceRefs(value:unknown):string[]{
 const refs:string[]=[];function walk(x:unknown){if(!x||typeof x!=='object')return;for(const[k,v]of Object.entries(x)){if(k==='evidence_blocks'&&Array.isArray(v))refs.push(...v);else walk(v);}}walk(value);return [...new Set(refs)];
}
/** Format/identity/reference integrity only. No defaults, coercion, inference or value repair. */
export function validateOutput(raw:string,source:Source){
 const fail=(stage:string,errors:unknown)=>({ok:false,stage,errors,value:null,meaning:'NOT_ASSESSED' as const});
 let value:unknown;try{value=JSON.parse(raw);}catch{return fail('parse',['Invalid JSON']);}
 if(!validate(value))return fail('schema',structuredClone(validate.errors));
 const v=value as Offering,errors:string[]=[];
 if(stable(v.filing)!==stable(source.filing))errors.push('Filing identity mismatch');
 const blocks=new Map(source.blocks.map(b=>[b.id,b])),docs=new Map(source.documents.map(d=>[d.id,d]));
 if(blocks.size!==source.blocks.length||docs.size!==source.documents.length)errors.push('Duplicate source IDs');
 for(const d of docs.values())if(sha(d.original)!==d.original_sha256||sha(d.text)!==d.text_sha256)errors.push('Document hash mismatch: '+d.id);
 for(const id of evidenceRefs(v)){const b=blocks.get(id),d=b&&docs.get(b.document_id);if(!b||!d){errors.push('Unknown evidence: '+id);continue;}if(sha(b.text)!==b.sha256||d.text.split('\n').slice(b.line_start-1,b.line_end).join('\n')!==b.text)errors.push('Source block integrity: '+id);}
 for(const plan of [v.plan,...(v.review?.candidates??[])]){const ids=plan.components.map(c=>c.id);if(new Set(ids).size!==ids.length)errors.push('Duplicate component IDs');for(const o of plan.over_allotment)for(const id of o.component_ids)if(!ids.includes(id))errors.push('Unknown component: '+id);}
 return errors.length?fail('reference',errors):{ok:true,stage:'complete',errors:[],value:v,meaning:'NOT_ASSESSED' as const};
}
