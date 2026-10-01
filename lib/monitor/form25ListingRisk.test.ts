import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fetchSecEdgarRawItems} from "../sources/sec/parser.ts";
import {buildForm25ListingResult,FORM25_LISTING_CONTRACT_VERSION} from "./form25ListingRisk.ts";
import {validateListingRiskAnalyzerResult} from "./listingRiskAnalyzer.ts";
import type {Form25OriginalDocument} from "../sources/sec/forms/form25/storedSource.ts";
import {buildGenericMonitorPrimaryExecutionContext,enqueueGenericMonitorChildrenAfterPrimary} from "./genericMonitorChildWorkflowStarter.ts";

const directory=new URL("../sources/sec/forms/form25/fixtures/source-connection/",import.meta.url);
const fixtures=JSON.parse(readFileSync(new URL("sources.json",directory),"utf8"));
async function raw(name:string) {
  const fixture=fixtures.find((f:{name:string})=>f.name===name);
  const native=globalThis.fetch;
  try {
    globalThis.fetch=async input=>{
      const url=String(input);
      if(url.endsWith("company_tickers_exchange.json"))return Response.json({fields:["cik","name","ticker","exchange"],data:[]});
      const doc=fixture.sources.find((s:{url:string})=>s.url===url);assert.ok(doc,`Unexpected fetch ${url}`);
      const bytes=readFileSync(new URL(doc.file,directory));assert.equal(createHash("sha256").update(bytes).digest("hex"),doc.sha256);
      return new Response(bytes,{status:200});
    };
    const result=await fetchSecEdgarRawItems({accessionNumber:fixture.accession,cik:fixture.cik,formTypes:[fixture.form],includeDocuments:true});
    assert.equal(result.ok,true);
    return {...result.items[0],id:"25000000-0000-4000-8000-000000000001"};
  }finally{globalThis.fetch=native;}
}

test("real Form25 source states enter existing Listing contracts without invented outcomes or dates",async()=>{
  for(const name of ["TTOO","FTCH","PLTR"]){
    const source=await raw(name);const before=structuredClone(source);
    const p=buildForm25ListingResult(source,"2026-09-30");
    assert.deepEqual(validateListingRiskAnalyzerResult(p.result),[]);
    if(name==="TTOO"){
      assert.equal(p.result.status,"applicable");if(p.result.status!=="applicable")throw Error();
      assert.equal(p.result.facts.classification.event_kind,"listing_removal");
      assert.equal(p.result.facts.classification.event_outcome,"unknown");
      assert.equal(p.result.facts.dates.removal_effective_date.value,"2025-07-21");
      assert.equal(p.result.facts.dates.removal_effective_date.date_status,"occurred");
      assert.equal(p.result.facts.dates.trading_suspension_date.value,"2025-02-12");
      assert.equal(p.result.facts.affected_security.ticker.value,null);
      const earlier=buildForm25ListingResult(source,"2025-07-20");
      assert.equal(earlier.state.listing,"removal_pending");
      assert.equal(earlier.result.status,"applicable");
      if(earlier.result.status==="applicable"){
        assert.equal(earlier.result.facts.classification.event_kind,"trading_suspension");
        assert.equal(earlier.result.facts.dates.removal_effective_date.date_status,"scheduled");
      }
    }else{
      assert.equal(p.result.status,"not_applicable");
      assert.equal(p.state.listing,name==="FTCH"?"removal_pending":"unresolved");
      assert.ok(p.state.reasons.length);
    }
    assert.deepEqual(buildForm25ListingResult(source,"2026-09-30"),p);
    assert.deepEqual(source,before);
  }
});

test("tampered, wrong-scope, withdrawn and conflicting evidence cannot become eligible facts",async()=>{
  const source=await raw("TTOO");
  const tampered=structuredClone(source);
  (tampered.raw_payload.form25_source as {documents:Form25OriginalDocument[]}).documents[0].text+="changed";
  assert.equal(buildForm25ListingResult(tampered,"2026-09-30").result.status,"not_applicable");
  for(const text of ["The removal was withdrawn.","The removal has been stayed."]){
    const changed=structuredClone(source);const doc=(changed.raw_payload.form25_source as {documents:Form25OriginalDocument[]}).documents.at(-1)!;
    doc.text+="\n"+text;doc.sha256=createHash("sha256").update(doc.text).digest("hex");doc.charCount=doc.text.length;
    const p=buildForm25ListingResult(changed,"2026-09-30");
    assert.equal(p.result.status,"not_applicable");assert.ok(p.state.reasons.some((r:string)=>r.includes("withdrawal")));
  }
});

test("Form25 starts the existing child without an LLM route or another analyzer",async()=>{
  for(const form of ["25","25-NSE","25/A","25-NSE/A"]){
    const primary=buildGenericMonitorPrimaryExecutionContext({eventId:"25000000-0000-4000-8000-000000000001",rawItemId:"25000000-0000-4000-8000-000000000002",sourceGroup:"filings",sourceCode:"sec_edgar",sourceIdentity:"0001354457-25-000637",parentPrimaryAiRunId:"25000000-0000-4000-8000-000000000003",parentPromptKey:"sec_form25_analysis_draft",parentPromptVersion:"unchanged",secFormType:form});
    const identities:unknown[]=[];
    const result=await enqueueGenericMonitorChildrenAfterPrimary({primary,primaryAnalysis:{},dependencies:{repository:{reserve:async id=>{identities.push(id);assert.equal(id.analyzerContractVersion,FORM25_LISTING_CONTRACT_VERSION);return{reserved:true,jobId:id.jobId};},claimWorkflowStart:async()=>true,releaseWorkflowStart:async()=>{},attachWorkflowRun:async()=>{}},startWorkflow:async()=>({runId:"test-workflow"})}});
    assert.equal(result.status,"enqueued");assert.equal(identities.length,1);
  }
});
