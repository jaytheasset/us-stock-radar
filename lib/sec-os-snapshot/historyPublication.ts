import {sha,stable} from './contract.ts';
import {repository,rpc,select,type Repository} from './repository.ts';
import {readOsPublicationSource} from './publicationSource.ts';
import {validateDilutionRegistryOsPreview,type DilutionRegistryOsSourceBundle} from '../dilution-registry/osPreview.ts';
import {mapIssuerCommonClassUniverseDatabaseRow,readIssuerCommonClassUniverseAt} from '../sec-structured-data/issuerCommonClassUniverse.ts';
import {mapShareCountHistoryDatabaseRow,toShareCountHistoryDatabaseRow,type SnapshotShareCountHistoryObservation} from '../sec-structured-data/shareCountHistory.ts';
import {OS_SNAPSHOT_HISTORY_SOURCE,OS_SNAPSHOT_PUBLICATION_VERSION} from '../sec-structured-data/osSnapshotHistoryContract.ts';

const commonTitles=new Set(['Common Stock','Common stock','common stock']);
const timestamp=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));

/** No value extraction or repair: only publish complete, source-verified existing records. */
export async function prepareOsSnapshotHistory(id:string,repo:Repository){
 const read=await readOsPublicationSource(id,repo);
 if(read.status!=='available')return {observations:[],omitted:[{index:null,reason:read.reason}]};
 const {run,raw,source,records,context,decision,outputHash}=read;
 const f=source.filing,d=source.documents[0],ledger=context.ledger;
 const observations:SnapshotShareCountHistoryObservation[]=[],omitted:{index:number|null;reason:string}[]=[];
 const omit=(index:number|null,reason:string)=>{omitted.push({index,reason});};
 if(!ledger||ledger.issuer_cik!==f.cik||ledger.accession_number!==f.accession||ledger.form!==f.form
  ||ledger.filed_date!==f.filing_date||!timestamp(ledger.accepted_at)||!ledger.source_raw_id
  ||!d||d.url!==`https://www.sec.gov/Archives/edgar/data/${f.cik.replace(/^0+/,'')}/${f.accession.replaceAll('-','')}/${ledger.primary_document}`){
  omit(null,'exact_filing_ledger_or_document_unavailable');return {observations,omitted};
 }
 const history=await select(repo,'share_count_history_eligible',{issuer_cik:`eq.${f.cik}`,select:'*',limit:'1001'});
 const universeRows=context.universes as Record<string,any>[];
 if(history.length>1000||universeRows.length>1000){omit(null,'class_support_scope_exceeded');return {observations,omitted};}
 const universe=await readIssuerCommonClassUniverseAt({cik:f.cik,targetAt:ledger.accepted_at,
  repository:{insertSnapshot:async()=>{throw Error('read only');},readSnapshots:async()=>universeRows.map(mapIssuerCommonClassUniverseDatabaseRow)},
  shareCountHistoryRepository:{insertObservation:async()=>{throw Error('read only');},readHistory:async()=>history.map(mapShareCountHistoryDatabaseRow)}});
 for(const {index,record} of records){
  if(record.scope!=='class'||!record.share_class||!commonTitles.has(record.share_class)){omit(index,'unsupported_exact_common_stock_class');continue;}
  if(!record.as_of_date){omit(index,'direct_as_of_date_required');continue;}
  if(universe.status!=='AVAILABLE'){omit(index,universe.reason);continue;}
  const u=universe.selectedSnapshot,canonicalId=`sc:v1:${f.cik}:common_stock:single`;
  if(u.status!=='COMPLETE_SINGLE'||u.reason!=='COMPLETE_SINGLE_COMMON_STOCK'||u.universeAsOf>record.as_of_date
   ||stable(u.requiredCanonicalSecurityClassIds)!==stable([canonicalId])||u.classEvidence.length!==1
   ||u.classEvidence[0].canonicalSecurityClassId!==canonicalId||!u.id){omit(index,'exact_single_common_class_unavailable');continue;}
  const ur=universeRows.find(r=>String(r.id)===u.id)!;
  const blocks=record.evidence_blocks.map(id=>source.blocks.find(b=>b.id===id)!);
  const portions=[...new Set(blocks.flatMap(b=>[b.text,...b.text.split(/(?<=[.!?;])\s+|\n+/)]).map(s=>s.replace(/\s+/g,' ').trim()))]
   .filter(s=>s.length>0&&s.length<=600&&s.includes(record.share_class!)&&/\bshares?\b/.test(s));
  const bundle:DilutionRegistryOsSourceBundle={ok:true,sourceMode:'stored',classUniverseMode:'issuer_reference',
   ledger:{issuer_cik:f.cik,accession_number:f.accession,form:f.form,primary_document:ledger.primary_document},
   documents:[{source_ref:ledger.primary_document,source_url:d.url,text:d.text}],
   classUniverse:{issuer_cik:ur.issuer_cik,source_accession:ur.source_accession,source_form:ur.source_form,
    universe_as_of:ur.universe_as_of,source_documents:ur.source_documents,status:ur.status,reason:ur.reason,
    required_canonical_security_class_ids:ur.required_canonical_security_class_ids,class_evidence:ur.class_evidence}};
  const exact:string[]=[];
  for(const evidence of portions){
   const [check]=await validateDilutionRegistryOsPreview({issuer:{cik:f.cik},instruments:[],snapshots:[],activities:[],totals:[],
    os_observations:[{observation_type:'source_stated',shares_outstanding:record.quantity,as_of:record.as_of_date,
     security_class_kind:'common_stock',security_class_title:record.share_class,source_accession:f.accession,source_form:f.form,
     source_ref:ledger.primary_document,evidence}]},{readSourceBundle:async()=>bundle});
   if(check?.status==='Verified')exact.push(evidence);
  }
  // Multiple different supporting excerpts are kept unavailable, not resolved by first-match heuristics.
  if(exact.length!==1){omit(index,exact.length?'ambiguous_evidence_excerpt':'exact_actual_os_evidence_unavailable');continue;}
  const evidence=exact[0],proof={version:OS_SNAPSHOT_PUBLICATION_VERSION,runId:run.id,parentId:read.parent?.id??null,
   rawId:raw.id,rawHash:read.rawHash,outputHash,sourceFingerprint:source.fingerprint,
   contractVersion:run.metadata.binding.contractVersion,schemaHash:run.metadata.binding.schemaHash,
   decisionId:decision?.id??null,recordIndex:index,record:structuredClone(record),
   universeId:u.id,universeHash:ur.publication_hash,ledgerHash:context.ledgerHash};
  const key=sha(stable([OS_SNAPSHOT_PUBLICATION_VERSION,proof]));
  const observation:SnapshotShareCountHistoryObservation={
   observationType:'source_stated',issuerCik:f.cik,sharesOutstanding:record.quantity,asOf:record.as_of_date,
   securityClassBasis:'SOURCE_STATED_SECURITY_CLASS',securityClassIdentity:{canonicalKey:`SOURCE_STATED_SECURITY_CLASS|${sha(record.share_class)}`,identity:{title:record.share_class}},
   securityClassMetadata:{sourceRef:ledger.primary_document,evidence,sourceDeclaredClassKind:'common_stock',canonicalSecurityClassId:canonicalId},
   canonicalSecurityClassId:canonicalId,canonicalSecurityClassKind:'common_stock',canonicalSecurityClassStatus:'mapped',
   canonicalSecurityClassProvenance:{method:'verified_snapshot_exact_unqualified_common_stock_and_existing_single_universe',universeId:u.id,titleSimilarityUsed:false},
   shareBasisIdentity:'shares_outstanding:source_stated',shareBasisMetadata:{measurement:'shares_outstanding',unit:{kind:'shares',representation:'positive_integer'}},
   accessionNumber:f.accession,form:f.form,filingDocument:ledger.primary_document,filedDate:f.filing_date,
   acceptedAt:new Date(ledger.accepted_at).toISOString(),acceptedAtSource:'sec_filing_ledger',acceptedAtProvenance:{source:'sec_filing_ledger.accepted_at'},
   ingestedAt:new Date().toISOString(),sourceConceptNamespaceUri:null,sourceConceptLocalName:null,sourceFactKey:key,
   sourceContextRef:ledger.primary_document,sourceArtifactId:raw.id,filingLedgerRawSourceId:ledger.source_raw_id,
   sourceFactIdentity:{factKey:key,sourceRef:ledger.primary_document,accession:f.accession,documentName:ledger.primary_document,observationType:'source_stated',artifactId:raw.id},
   sourceContext:{sourceRef:ledger.primary_document,asOf:record.as_of_date,issuerCik:f.cik},sourceDimensions:[],sourceProvenance:{snapshot:proof},
   sourceType:OS_SNAPSHOT_HISTORY_SOURCE,authoritativeStatus:null,authoritativeDecisionVersion:null,authoritativeDecisionReason:null,authoritativeDecisionLineage:null,
   sourceDocumentUrl:d.url,sourceContentHash:d.original_sha256,sourceEvidence:evidence,sourceAnalyzer:null,
  };
  observations.push(observation);
 }
 return {observations,omitted};
}

export async function publishOsSnapshotHistory(id:string,supplied?:Repository){
 const repo=supplied??await repository(),prepared=await prepareOsSnapshotHistory(id,repo);
 if(!prepared.observations.length)return {status:'not_published' as const,inserted:0,deduped:0,omitted:prepared.omitted};
 const saved=await rpc(repo,'publish_os_snapshot_share_history',{p_rows:prepared.observations.map(o=>toShareCountHistoryDatabaseRow(o))});
 return {status:'published' as const,...saved,omitted:prepared.omitted};
}

/** Completion/approval remains committed if publication fails; exact-run replay retries it. */
export async function osSnapshotRunSaved(id:string,supplied?:Repository){
 try{return await publishOsSnapshotHistory(id,supplied);}
 catch{console.error('[os-history] publication failed; replay the saved run');return {status:'failed' as const,reason:'publication_retry_required'};}
}
