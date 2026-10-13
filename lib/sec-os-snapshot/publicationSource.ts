import {REVISION,sha,stable,validateOutput,type Snapshot,type Source,type OsRecord} from './contract.ts';
import {buildSource,bindingFor} from './source.ts';
import {readCombinedDomainSource} from '../sec-combined-offering/repository.ts';
import {rpc,type Repository} from './repository.ts';

/** Exact saved output/current source selection. This never invokes extraction. */
export async function readOsPublicationSource(id:string,repo:Repository){
 const context=await rpc(repo,'read_os_snapshot_publication_context',{p_run_id:id});
 const {run,raw,parent,output,decision,latestRootId,rawHash}=context;
 if(!run||!raw)return {status:'not_ready' as const,reason:'run_or_source_missing'};
 if(latestRootId!==(parent?.id??run.id))return {status:'not_ready' as const,reason:'superseded_invocation'};
 if(run.prompt_key!=='sec_os_snapshot'||run.status!=='succeeded')return {status:'not_ready' as const,reason:'run_not_public'};
 let value:Snapshot,source:Source;
 try{
  if(run.metadata.executionKind==='derived_domain_view'){
   const resolved=await readCombinedDomainSource(run,repo);
   source=resolved.source;value=resolved.value as Snapshot;
  }else{
   if(run.metadata.binding.contractVersion!==REVISION)throw Error('unsupported_contract');
   source=buildSource(raw);
   if(stable(bindingFor(raw.id,source))!==stable(run.metadata.binding))throw Error('binding_mismatch');
   const cp=run.metadata.osCheckpoint,checked=validateOutput(cp.raw,source);
   if(cp.provider?.integrityError||!checked.ok||stable(output)!==stable(cp)||sha(cp.raw)!==cp.rawHash
    ||stable(checked.value)!==stable(cp.validated)||cp.status!==run.metadata.osStatus)throw Error('output_mismatch');
   value=checked.value!;
  }
 }catch{return {status:'not_ready' as const,reason:'source_output_contract_mismatch'};}
 if(!value||value.status!==run.metadata.osStatus)return {status:'not_ready' as const,reason:'status_mismatch'};
 if(['hold','reject'].includes(decision?.action))return {status:'not_ready' as const,reason:'decision_not_public'};
 let records:{index:number;record:OsRecord}[];
 if(value.status==='PASS')records=value.current_os.map((record,index)=>({index,record}));
 else if(value.status==='REVIEW_REQUIRED'){
  const indexes=decision?.candidate_indexes;
  if(decision?.action!=='approve'||!Array.isArray(indexes)||!indexes.length||new Set(indexes).size!==indexes.length
   ||indexes.some(i=>!Number.isInteger(i)||i<0||!value.review?.candidates[i]))return {status:'not_ready' as const,reason:'review_not_approved'};
  records=indexes.map(index=>({index,record:value.review!.candidates[index]}));
 }else return {status:'not_ready' as const,reason:'no_direct_os'};
 return {status:'available' as const,context,run,raw,parent,decision,records,source,value,rawHash:String(rawHash),
  outputHash:String(run.metadata.osCheckpoint.rawHash)};
}
