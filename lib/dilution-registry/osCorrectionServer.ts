import 'server-only';
import {sha,stable} from '../sec-os-snapshot/contract.ts';
import {repository,rpc,select,type Repository} from '../sec-os-snapshot/repository.ts';
import {mapShareCountHistoryDatabaseRow} from '../sec-structured-data/shareCountHistory.ts';
import {mapIssuerCommonClassUniverseDatabaseRow,readIssuerCommonClassUniverseAt} from '../sec-structured-data/issuerCommonClassUniverse.ts';
import {normalizeSecDocumentText} from './osPreviewSecFallback.ts';
import {validateDilutionRegistryOsPreview,type DilutionRegistryOsSourceBundle} from './osPreview.ts';

export class OsCorrectionError extends Error{
 readonly status:number;
 constructor(status:number,message:string){super(message);this.status=status;}
}
export type OsCorrectionDraft={
 action:'correct'|'revoke';quantity:string|null;asOf:string|null;evidence:string|null;reason:string;
 expectedRevision:number;observationHash:string;sourceBindingHash:string;requestId:string;
};
export function parseOsCorrectionDraft(value:unknown):OsCorrectionDraft{
 if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
 const v=value as Record<string,unknown>;
 const keys=['action','quantity','asOf','evidence','reason','expectedRevision','observationHash','sourceBindingHash','requestId'];
 if(Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(v,k))
  ||!['correct','revoke'].includes(String(v.action))||typeof v.reason!=='string'||!v.reason.trim()||v.reason.length>2000
  ||!Number.isSafeInteger(v.expectedRevision)||Number(v.expectedRevision)<0
  ||!hash(v.observationHash)||!hash(v.sourceBindingHash)||!uuid(v.requestId))throw invalid();
 if(v.action==='correct'){
  if(typeof v.quantity!=='string'||!/^[1-9][0-9]{0,77}$/.test(v.quantity)||!date(v.asOf)
   ||typeof v.evidence!=='string'||!v.evidence.trim()||v.evidence.length>600)throw invalid();
 }else if(v.quantity!==null||v.asOf!==null||v.evidence!==null)throw invalid();
 return {...v,reason:v.reason.trim(),evidence:typeof v.evidence==='string'?v.evidence.trim():null} as OsCorrectionDraft;
}

async function context(id:string,repo:Repository){
 if(!/^[1-9][0-9]{0,18}$/.test(id)||BigInt(id)>BigInt('9223372036854775807'))throw invalid();
 const c=await rpc(repo,'read_share_count_correction_context',{p_observation_id:id});
 if(!c.observation)throw new OsCorrectionError(404,'The saved observation was not found.');
 return c;
}

export async function readOsCorrectionDetail(id:string,supplied?:Repository){
 const repo=supplied??await repository(),c=await context(id,repo),h=c.observation;
 const eligible=(await select(repo,'share_count_history_eligible',{id:`eq.${id}`,select:'os_correction',limit:'1'}))[0];
 const projected=eligible?.os_correction??null;
 return {id:String(h.id),issuerCik:String(h.issuer_cik),accession:String(h.accession_number),form:String(h.form),
  classId:String(h.canonical_security_class_id??''),classTitle:typeof h.security_class_identity?.identity?.title==='string'?h.security_class_identity.identity.title:'common stock',
  unit:'shares',originalQuantity:String(h.shares_outstanding),originalAsOf:String(h.as_of),
  sourceUrl:String(h.source_document_url),sourceHash:String(h.source_content_hash),originalEvidence:String(h.source_evidence??''),
  sourceText:typeof c.body==='string'?normalizeSecDocumentText(c.body):null,
  sourceAvailable:c.available===true,observationEligible:Boolean(eligible),unavailableReason:c.unavailableReason??null,
  observationHash:String(c.observationHash??''),sourceBindingHash:String(c.sourceBindingHash??''),revision:Number(c.revision),
  correction:projected,history:c.history as Array<Record<string,any>>};
}

export async function listOsCorrectionObservations(filter:{accession?:string;runId?:string}={},supplied?:Repository){
 const repo=supplied??await repository();
 if(filter.accession&&!/^\d{10}-\d{2}-\d{6}$/.test(filter.accession))throw invalid();
 if(filter.runId&&!uuid(filter.runId))throw invalid();
 // Querying original rows deliberately preserves access to stale and revoked history.
 const result=await repo.rpc('list_share_count_correction_observations',{p_accession:filter.accession||null,p_run_id:filter.runId||null});
 if(!result.ok||!Array.isArray(result.data))throw new OsCorrectionError(503,'Saved observations could not be read.');
 return result.data as Array<Record<string,any>>;
}

export async function previewOsCorrection(id:string,input:unknown,supplied?:Repository){
 const repo=supplied??await repository(),draft=parseOsCorrectionDraft(input),c=await context(id,repo);
 await verify(c,draft,repo);
 return {verified:true,action:draft.action,quantity:draft.quantity,asOf:draft.asOf,evidence:draft.evidence,
  revision:c.revision,observationId:id};
}

export async function saveOsCorrection(id:string,input:unknown,actorUserId:string,supplied?:Repository){
 const repo=supplied??await repository(),draft=parseOsCorrectionDraft(input),c=await context(id,repo);
 if(!uuid(actorUserId))throw new OsCorrectionError(403,'An authorized administrator is required.');
 const requestHash=sha(stable({observationId:id,actorUserId,draft}));
 const prior=c.history.find((h:Record<string,any>)=>h.request_id===draft.requestId);
 if(prior){
  if(prior.request_hash!==requestHash||prior.actor_user_id!==actorUserId)throw conflict();
  return {id:prior.id,revision:prior.revision,deduped:true};
 }
 await verify(c,draft,repo);
 try{return await rpc(repo,'append_share_count_correction',{p_observation_id:id,p_actor:actorUserId,p_request:draft.requestId,p_request_hash:requestHash,
  p_expected_revision:draft.expectedRevision,p_observation_hash:draft.observationHash,p_source_binding_hash:draft.sourceBindingHash,
  p_action:draft.action,p_quantity:draft.quantity,p_as_of:draft.asOf,p_evidence:draft.evidence,p_reason:draft.reason});}
 catch(e){
  if(/os_correction_(revision|source|request)_conflict/.test(String(e)))throw conflict();
  if(/os_correction_admin_required/.test(String(e)))throw new OsCorrectionError(403,'An authorized administrator is required.');
  throw new OsCorrectionError(503,'The correction could not be saved. Retry the same request.');
 }
}

async function verify(c:Record<string,any>,draft:OsCorrectionDraft,repo:Repository){
 if(draft.expectedRevision!==c.revision||draft.observationHash!==c.observationHash||draft.sourceBindingHash!==c.sourceBindingHash)throw conflict();
 if(draft.action==='revoke'){
  if(c.history[0]?.action!=='correct')throw new OsCorrectionError(409,'There is no correction to withdraw.');
  return;
 }
 if(c.available!==true)throw new OsCorrectionError(409,c.unavailableReason??'The original source is no longer available.');
 const h=c.observation;
 // Validate the original source contract, without replacing any saved field.
 mapShareCountHistoryDatabaseRow({...h,snapshot_publication_valid:true});
 if(h.canonical_security_class_id!==`sc:v1:${h.issuer_cik}:common_stock:single`||h.canonical_security_class_kind!=='common_stock'
  ||draft.asOf!>h.filed_date)throw invalid();
 const universeRows=c.universes as Record<string,any>[];
 const history=await select(repo,'share_count_history_eligible',{issuer_cik:`eq.${h.issuer_cik}`,select:'*',limit:'1001'});
 if(universeRows.length>1000||history.length>1000)throw new OsCorrectionError(409,'The source support could not be fully checked.');
 const universe=await readIssuerCommonClassUniverseAt({cik:h.issuer_cik,targetAt:h.accepted_at,
  repository:{insertSnapshot:async()=>{throw Error('read only');},readSnapshots:async()=>universeRows.map(mapIssuerCommonClassUniverseDatabaseRow)},
  shareCountHistoryRepository:{insertObservation:async()=>{throw Error('read only');},readHistory:async()=>history.map(mapShareCountHistoryDatabaseRow)}});
 if(universe.status!=='AVAILABLE'||universe.selectedSnapshot.status!=='COMPLETE_SINGLE')throw new OsCorrectionError(409,'Exact single common-stock class support is unavailable.');
 const u=universeRows.find(r=>String(r.id)===universe.selectedSnapshot.id)!;
 const bundle:DilutionRegistryOsSourceBundle={ok:true,sourceMode:'stored',classUniverseMode:'issuer_reference',ledger:c.ledger,
  documents:[{source_ref:h.filing_document,source_url:h.source_document_url,text:normalizeSecDocumentText(c.body)}],classUniverse:u as DilutionRegistryOsSourceBundle['classUniverse']};
 const result=await validateDilutionRegistryOsPreview({issuer:{issuer_cik:h.issuer_cik},instruments:[],snapshots:[],activities:[],totals:[],os_observations:[{
  observation_type:'source_stated',shares_outstanding:draft.quantity,as_of:draft.asOf,security_class_kind:'common_stock',
  security_class_title:h.observation_type==='source_stated'?h.security_class_identity?.identity?.title:'common stock',
  source_accession:h.accession_number,source_form:h.form,source_ref:h.filing_document,evidence:draft.evidence,
 }]},{readSourceBundle:async()=>bundle});
 if(result[0]?.status!=='Verified')throw new OsCorrectionError(422,result[0]?.reasons.join(' ')||'The quantity and date must match the exact source evidence.');
}
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const date=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const invalid=()=>new OsCorrectionError(400,'Enter a positive whole share count, a valid date, exact evidence, and a reason. Identity fields cannot be changed.');
const conflict=()=>new OsCorrectionError(409,'This observation or its source changed. Reload it and preview again.');
