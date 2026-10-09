import {buildSource as buildNeutralSource,isOsForm} from '../sec-os-snapshot/source.ts';
import {sha,stable,REVISION,PROFILE,schemaHash,promptHash,type Filing,type Source} from './contract.ts';
export const isOfferingForm=isOsForm;
const textOrNull=(x:unknown)=>typeof x==='string'&&x.trim()?x:null;
export function familyFor(filing:Filing){
 const a=filing.file_number?.trim()||null,b=filing.registration_number?.trim()||null;
 if(a&&b&&a!==b)return {status:'conflicting' as const,key:null,number:null};
 const number=a??b;
 if(!number||!/^\d{3}-\d+$/.test(number))return {status:'unavailable' as const,key:null,number:null};
 return {status:'confirmed' as const,key:filing.cik+':'+number,number};
}
export function buildSource(raw:Record<string,any>):Source{
 const neutral=buildNeutralSource(raw),p=raw.raw_payload;
 const filing={...neutral.filing,accepted_at:textOrNull(p.accepted_at),file_number:textOrNull(p.file_number),registration_number:textOrNull(p.registration_number)};
 const content={filing,ticker:neutral.ticker,documents:neutral.documents,blocks:neutral.blocks};
 return {...content,fingerprint:sha(stable(content))};
}
export function bindingFor(rawItemId:string,source:Source,revision=REVISION){
 const key=sha(stable([rawItemId,source.filing.accession,source.fingerprint,revision,schemaHash,promptHash,PROFILE]));
 return {id:`${key.slice(0,8)}-${key.slice(8,12)}-5${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`,key,rawItemId,source,sourceFingerprint:source.fingerprint,contractVersion:revision,schemaHash,promptHash,providerProfile:PROFILE,family:familyFor(source.filing)};
}
export type Binding=ReturnType<typeof bindingFor>;

/** Persist references only. The deterministic key remains identical to historical full bindings. */
export function compactBinding(binding:Binding){
 const {source,...identity}=binding;
 return {...identity,bindingVersion:2 as const,filing:source.filing,ticker:source.ticker,
  documents:source.documents.map(d=>({id:d.id,original_sha256:d.original_sha256,text_sha256:d.text_sha256})),
  documentCount:source.documents.length,blockCount:source.blocks.length};
}
export type CompactBinding=ReturnType<typeof compactBinding>;
export type StoredBinding=Binding|CompactBinding;
export function bindingIdentity(binding:StoredBinding){
 return 'source' in binding?{filing:binding.source.filing,ticker:binding.source.ticker}:{filing:binding.filing,ticker:binding.ticker};
}
/** Reconstruct from the raw item; never substitute the old snapshot or repair a mismatch. */
export function hydrateBinding(binding:StoredBinding,raw:Record<string,any>):Binding{
 if(raw.id!==binding.rawItemId)throw Error('offering_source_raw_id_mismatch');
 const source=buildSource(raw),hydrated=bindingFor(binding.rawItemId,source,binding.contractVersion);
 const expected='source' in binding?compactBinding(binding):binding;
 if(stable(compactBinding(hydrated))!==stable(expected))throw Error('offering_source_binding_mismatch');
 return hydrated;
}
