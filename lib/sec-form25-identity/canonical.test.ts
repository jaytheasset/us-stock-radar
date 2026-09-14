import assert from "node:assert/strict";
import test from "node:test";
import {buildForm25IdentityEvidence,form25SourceSha,SEC_TICKER_CATALOG,sha} from "./canonical.ts";
const raw={source_unique_id:"0001354457-25-000637",source_url:"https://www.sec.gov/Archives/edgar/data/1354457/000135445725000637/primary_doc.xml",body_text:"<edgarSubmission><exchange><cik>0001354457</cik><entityName>Nasdaq Stock Market LLC</entityName></exchange><issuer><cik>0001492674</cik><entityName>T2 Biosystems, Inc.</entityName></issuer><descriptionClassSecurity>Common Stock</descriptionClassSecurity></edgarSubmission>",raw_payload:{form_type:"25-NSE/A",cik:"1354457"}};
const candidate={ticker:"TTOO",cik:"1492674",exchange:"Nasdaq",source:SEC_TICKER_CATALOG};
test("Form25 uses official subject CIK, never exchange/filer or LLM ticker",()=>{
 const result=buildForm25IdentityEvidence(raw,{rows:[candidate,{...candidate,cik:"1354457",ticker:"TTWO"}],available:true});
 assert.equal(result.subjectCik,"0001492674");assert.equal(result.status,"AUTO");assert.equal(result.candidates[0]?.ticker,"TTOO");
});
test("missing catalog match and failed catalog are distinct unresolved reasons",()=>{
 assert.equal(buildForm25IdentityEvidence(raw,{rows:[],available:true}).reason,"subject_not_in_sec_catalog");
 assert.equal(buildForm25IdentityEvidence(raw,{rows:[],available:false}).reason,"sec_catalog_unavailable");
});
test("multiple rows never choose a preferred ticker by heuristic",()=>{
 const result=buildForm25IdentityEvidence(raw,{rows:[candidate,{...candidate,ticker:"TTOOW"}],available:true});
 assert.equal(result.status,"REVIEW");assert.equal(result.candidates.length,2);
});
test("subject index disagreement is review even with unique catalog result",()=>{
 const result=buildForm25IdentityEvidence({...raw,raw_payload:{...raw.raw_payload,form25_index_subject_cik:"12345",form25_index_subject_cik_count:1}},{rows:[candidate],available:true});
 assert.equal(result.status,"REVIEW");assert.equal(result.reason,"subject_cik_conflict");
});
test("warrant and unknown removed securities cannot auto-link common issuer catalog",()=>{
 for(const security of ["Warrants","Preferred Stock","Notes due 2030",""]) {
  const result=buildForm25IdentityEvidence({...raw,body_text:raw.body_text.replace("Common Stock",security)},{rows:[candidate],available:true});
  assert.notEqual(result.status,"AUTO");
 }
});
test("historical mode is never automatic and source hash excludes runtime timestamp",()=>{
 assert.equal(buildForm25IdentityEvidence(raw,{rows:[candidate],available:true},"historical_replay").status,"REVIEW");
 assert.equal(form25SourceSha({...raw,fetched_at:"2025-01-01"}),form25SourceSha({...raw,fetched_at:"2026-01-01"}));
});
test("catalog ordering and duplicates preserve evidence SHA",()=>{
 const second={...candidate,ticker:"TTOOW"};
 assert.equal(sha(buildForm25IdentityEvidence(raw,{rows:[candidate,second,candidate],available:true})),sha(buildForm25IdentityEvidence(raw,{rows:[second,candidate],available:true})));
});
test("malformed ticker does not become automatic identity",()=>{
 assert.equal(buildForm25IdentityEvidence(raw,{rows:[{...candidate,ticker:"N/A"}],available:true}).status,"UNRESOLVED");
});
test("identity metadata changes invalidate source while workflow metadata does not",()=>{
 assert.notEqual(form25SourceSha({...raw,metadata:{form25_exchange:"NYSE"}}),form25SourceSha({...raw,metadata:{form25_exchange:"Nasdaq"}}));
 assert.equal(form25SourceSha({...raw,metadata:{workflow_status:"started"}}),form25SourceSha({...raw,metadata:{workflow_status:"complete"}}));
});
test("current catalog exchange is not labeled as the original removal exchange",()=>{
 const noExchange={...raw,body_text:raw.body_text.replace(/<exchange>.*?<\/exchange>/,""),raw_payload:{...raw.raw_payload,exchange:"Nasdaq"}};
 const result=buildForm25IdentityEvidence(noExchange,{rows:[candidate],available:true});
 assert.equal(result.exchange,null);assert.equal(result.candidates[0].exchange,"Nasdaq");
});
