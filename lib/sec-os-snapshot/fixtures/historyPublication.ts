import {sha,validateOutput,type OsRecord} from '../contract.ts';
import {bindingFor,buildSource} from '../source.ts';

/** Synthetic contract fixture only. Never a collected SEC filing or live provider output. */
export function historyPublicationFixture(overrides:Partial<OsRecord>={},evidence='As of January 30, 2026, there were 1,000 shares of common stock outstanding.'){
 const raw={id:'10000000-0000-4000-a000-000000000091',source_code:'sec_edgar',source_unique_id:'0000000091-26-000001',source_group:'filings',
  raw_payload:{company_name:'TEST ONLY O/S publication',cik:'0000000091',accession_number:'0000000091-26-000001',form_type:'F-1',filing_date:'2026-02-02',
   primary_document_url:'https://www.sec.gov/Archives/edgar/data/91/000000009126000001/test.htm',primary_document_html:`<p>${evidence}</p>`,primary_document_html_truncated:false}};
 const source=buildSource(raw),binding=bindingFor(raw.id,source);
 const record:OsRecord={scope:'class',share_class:'common stock',quantity:'1000',as_of_date:'2026-01-30',as_of_text:'as of January 30, 2026',evidence_blocks:[source.blocks[0].id],...overrides};
 const value={version:'os_snapshot_v1',filing:source.filing,status:'PASS' as string,current_os:[record],review:null as any};
 const checkpoint=()=>{const text=JSON.stringify(value),validation=validateOutput(text,source);return {status:value.status,raw:text,rawHash:sha(text),validated:validation.value,validation,provider:{raw:text},evidenceRefs:record.evidence_blocks};};
 const run={id:binding.id,raw_item_id:raw.id,prompt_key:'sec_os_snapshot',status:'succeeded',metadata:{binding,osStatus:value.status,osCheckpoint:checkpoint()}};
 const classId='sc:v1:0000000091:common_stock:single';
 const universe={id:'91001',snapshot_version:'issuer-common-class-universe-snapshot-v1',issuer_cik:'0000000091',
  universe_as_of:'2026-01-01',accepted_at:'2026-01-02T00:00:00.000Z',source_accession:'0000000091-26-000002',source_form:'10-K',source_filed_date:'2026-01-02',source_documents:['baseline.htm'],
  status:'COMPLETE_SINGLE',reason:'COMPLETE_SINGLE_COMMON_STOCK',required_canonical_security_class_ids:[classId],class_evidence:[{canonicalSecurityClassId:classId,sharesOutstanding:'900',
   sourceFacts:[{factKey:sha('fixture-fact'),contextRef:'fixture-context',sharesOutstanding:'900',documentName:'baseline.htm',sourceUrl:'https://www.sec.gov/Archives/fixture',contentHash:sha('fixture-source'),artifactId:'10000000-0000-4000-a000-000000000093',dimensions:[]}]}],
  aggregate_evidence:[],excluded_evidence:[],completeness_provenance:{historicalClassUnionUsed:false,testOnly:true},source_identity_hash:sha('fixture-universe'),created_at:'2026-01-02T00:00:00.000Z',publication_hash:sha('fixture-universe-row')};
 const context={run,raw,parent:null,output:run.metadata.osCheckpoint,decision:null as any,latestRootId:run.id,rawHash:sha('fixture-raw-json'),ledgerHash:sha('fixture-ledger'),universes:[universe],
  ledger:{issuer_cik:'0000000091',accession_number:raw.source_unique_id,form:'F-1',filed_date:'2026-02-02',accepted_at:'2026-02-02T00:00:00.000Z',primary_document:'test.htm',source_raw_id:'10000000-0000-4000-a000-000000000094'}};
 const freeze=()=>{run.metadata.osStatus=value.status;run.metadata.osCheckpoint=checkpoint();context.output=run.metadata.osCheckpoint;};
 return {raw,source,binding,record,value,run,context,universe,freeze};
}
