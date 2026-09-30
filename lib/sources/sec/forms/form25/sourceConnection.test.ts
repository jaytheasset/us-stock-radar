import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { fetchSecEdgarRawItems } from "../../parser.ts";
import { captureForm25Document, readStoredForm25Source, type Form25OriginalDocument } from "./storedSource.ts";
import { evaluateStoredForm25 } from "../../../../sec-delisting-state/state.ts";
import { runForm25DelistingAutomaticTrigger } from "../../../../sec-delisting-state/automaticTrigger.ts";
import type { DelistingRepository } from "../../../../sec-delisting-state/reader.ts";

type Fixture = { name: string; accession: string; cik: string; form: string; filingDate: string; sources: {file:string;url:string;sha256:string}[] };
type Bundle = {documents:Form25OriginalDocument[]};
const directory = new URL("./fixtures/source-connection/", import.meta.url);
const fixtures: Fixture[] = JSON.parse(readFileSync(new URL("sources.json", directory), "utf8"));
const expected = JSON.parse(readFileSync(new URL("expected.json", directory), "utf8"));
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const nativeFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = nativeFetch; });
async function collect(fixture: Fixture) {
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("company_tickers_exchange.json")) return Response.json({fields:["cik","name","ticker","exchange"],data:[]});
    const source = fixture.sources.find(source => source.url === url);
    assert.ok(source, `Unexpected external request: ${url}`);
    const bytes = readFileSync(new URL(source.file, directory));
    assert.equal(sha(bytes), source.sha256);
    return new Response(bytes, {status:200,headers:{"content-type":url.endsWith(".json")?"application/json":"text/html"}});
  };
  const result = await fetchSecEdgarRawItems({accessionNumber:fixture.accession,cik:fixture.cik,formTypes:[fixture.form],includeDocuments:true});
  assert.equal(result.ok,true,result.error);
  assert.equal(result.items.length,1);
  return {...result.items[0],id:"25000000-0000-4000-8000-000000000001"};
}

for (const fixture of fixtures) test(`${fixture.name}: real SEC acquisition retains originals and existing reader semantics`, async () => {
  const raw = await collect(fixture); const before = structuredClone(raw);
  const source = readStoredForm25Source(raw);
  assert.equal(source.status,"available"); if(source.status!=="available")return;
  const ground = expected.find((row: {name:string}) => row.name===fixture.name);
  for(const document of source.documents){
    const original=fixture.sources.find(item=>item.url===document.url);assert.ok(original);
    assert.equal(document.text,readFileSync(new URL(original.file,directory),"utf8"));assert.equal(document.sha256,original.sha256);
  }
  const facts=source.parser.facts;
  assert.equal(facts.issuer_name?.value,ground.issuerName);
  assert.equal(facts.subject_company_cik?.value,ground.issuerCik);
  assert.equal(facts.removed_security?.value,ground.security);
  assert.equal(facts.rule_provision?.value,ground.rule);
  assert.equal(facts.filing_date?.value,ground.filed);
  assert.equal(facts.delisting_or_removal_date?.value??null,ground.removalDate);
  assert.equal(facts.trading_suspension_date?.value??null,ground.suspensionDate);
  assert.equal(facts.exchange?.value??null,ground.exchange);
  assert.equal(source.scopeVerified,true);
  const scope={issuerCik:ground.issuerCik,securityTitle:ground.security,exchange:ground.exchange};
  const state=evaluateStoredForm25({raw,scope,asOf:"2026-09-30"});
  assert.equal(state.listing,ground.listing);assert.equal(state.trading,ground.trading);
  assert.deepEqual(state.sourceDocuments.map(doc=>doc.sha256),source.documents.map(doc=>doc.sha256));
  if(fixture.name==="TTOO")assert.equal(evaluateStoredForm25({raw,scope,asOf:"2025-07-20"}).listing,"removal_pending");
  const repository:DelistingRepository={select:async table=>({ok:true,status:200,data:table==="raw_items"?[raw]:[]}),rpc:async()=>{throw Error("No semantic RPC without event");}};
  const result=await runForm25DelistingAutomaticTrigger({rawItemId:raw.id,accession:fixture.accession,asOf:"2026-09-30",repository});
  assert.equal(result.status,"completed");
  assert.equal(result.result?.listing,ground.listing);
  if(!ground.xmlScope){
    assert.equal(source.isXml,false,"HTML scope must not pretend to be XML");
    assert.ok(result.reasons.includes("removal_effective_evidence_unavailable"));
    assert.equal(state.removalDate,null,"SEC index effectiveness is not removal");
    assert.ok(source.documents.some(doc=>doc.text.includes(facts.subject_company_cik!.evidence)));
  }
  const rerun=await collect(fixture);
  assert.deepEqual(rerun.raw_payload.form25_source,raw.raw_payload.form25_source);
  assert.deepEqual(raw,before,"Readers must never mutate raw records or Primary input");
});

test("new original-source selection rejects tampering, incomplete capture, duplicate XML and unrelated evidence", async () => {
  const raw=await collect(fixtures.find(f=>f.name==="TTOO")!);
  for(const mutate of [
    (bundle:Bundle)=>{bundle.documents[1].text+=" altered";},
    (bundle:Bundle)=>{bundle.documents[1].truncated=true;},
    (bundle:Bundle)=>{bundle.documents[1].url=bundle.documents[1].url.replace("000135445725000637","000135445725000999");},
    (bundle:Bundle)=>{bundle.documents.pop();},
    (bundle:Bundle)=>{bundle.documents.push({...bundle.documents[1],url:bundle.documents[1].url.replace("primary_doc.xml","other.xml")});},
  ]){
    const bad=structuredClone(raw);mutate(bad.raw_payload.form25_source as Bundle);
    assert.equal(readStoredForm25Source(bad).status,"unavailable");
  }
});

test("new source path preserves withdrawal and conflicting-notice fail-closed rules", async () => {
  const raw=await collect(fixtures.find(f=>f.name==="TTOO")!);
  const scope={issuerCik:"0001492674",securityTitle:"Common Stock",exchange:"Nasdaq Stock Market LLC"};
  const bundle=raw.raw_payload.form25_source as {documents:NonNullable<ReturnType<typeof captureForm25Document>>[]};
  const notice=bundle.documents.at(-1)!;
  const original=notice.text;
  notice.text+="\nThe removal was withdrawn.";notice.sha256=sha(notice.text);notice.charCount=notice.text.length;
  assert.ok(evaluateStoredForm25({raw,scope,asOf:"2026-09-30"}).reasons.includes("withdrawal_stay_or_conflicting_source_requires_review"));
  notice.text=original;notice.sha256=sha(original);notice.charCount=original.length;
  const conflictText=original.replaceAll("July 21, 2025","July 22, 2025");
  bundle.documents.push({...notice,url:notice.url.replace("ttoodelistreason.txt","other-notice.txt"),text:conflictText,sha256:sha(conflictText),charCount:conflictText.length});
  assert.ok(evaluateStoredForm25({raw,scope,asOf:"2026-09-30"}).reasons.includes("notice_removal_date_conflict"));
});

test("Form25-only capture does not add original-source fields to other filing families",()=>{
  for(const form of ["3","5","4","144","SC 13G","8-K"])assert.equal(captureForm25Document(form,{url:"https://www.sec.gov/source",type:form,description:null,isPrimary:true},"source"),undefined);
});

test("HTML scope requires matching submission identity, exact primary and unique labelled fields", async () => {
  const original = await collect(fixtures.find(f => f.name === "PLTR")!);
  const checks: Array<[string, (docs: Form25OriginalDocument[]) => void]> = [
    ["missing SEC header", docs => { docs[1].text = docs[1].text.replace(/<SEC-HEADER>[\s\S]*?<\/SEC-HEADER>/, ""); }],
    ["wrong accession header", docs => { docs[1].text = docs[1].text.replace(/ACCESSION NUMBER:[^\r\n]+/, "ACCESSION NUMBER: 0001321655-24-000999"); }],
    ["wrong form header", docs => { docs[1].text = docs[1].text.replace(/CONFORMED SUBMISSION TYPE:[^\r\n]+/, "CONFORMED SUBMISSION TYPE: 8-K"); }],
    ["wrong issuer header", docs => { docs[1].text = docs[1].text.replace(/COMPANY CONFORMED NAME:[^\r\n]+/, "COMPANY CONFORMED NAME: Other Issuer"); }],
    ["header CIK differs from source directory", docs => { docs[1].text = docs[1].text.replace(/CENTRAL INDEX KEY:[^\r\n]+/, "CENTRAL INDEX KEY: 0001234567"); }],
    ["different primary security", docs => { docs[0].text = docs[0].text.replace("Class A common stock", "Class B common stock"); }],
    ["unlabelled venue", docs => { for (const doc of docs) doc.text = doc.text.replace("Exact name of Issuer as specified in its charter, and name of Exchange", "Unlabelled information"); }],
    ["multiple checked rules", docs => { for (const doc of docs) doc.text = doc.text.replace("&#9744;", "&#9746;"); }],
    ["no checked issuer-filed rule", docs => { for (const doc of docs) doc.text = doc.text.replaceAll("&#9746;", "&#9744;"); }],
    ["conflicting labelled exchange", docs => { docs.push({...docs[1], url:docs[1].url.replace(/[^/]+$/, "venue-notice.txt"), text:"Exchange: Different Exchange", isPrimary:false}); }],
  ];
  for (const [name, change] of checks) {
    const raw = structuredClone(original);
    const docs = (raw.raw_payload.form25_source as Bundle).documents;
    change(docs);
    // Synthetic source-integrity boundary cases, not additional real filings.
    for (const doc of docs) { doc.sha256 = sha(doc.text); doc.charCount = doc.text.length; }
    raw.raw_payload.primary_document_html = docs.find(doc => doc.isPrimary)!.text;
    const source = readStoredForm25Source(raw);
    assert.equal(source.status, "available", name);
    if (source.status === "available") assert.equal(source.scopeVerified, false, name);
    const result = evaluateStoredForm25({raw,scope:{issuerCik:"0001321655",securityTitle:"Class A common stock, par value $0.001 per share",exchange:"New York Stock Exchange"},asOf:"2026-09-30"});
    assert.equal(result.listing, "unresolved", name);
    assert.ok(result.reasons.includes("html_identity_unavailable"), name);
  }
});
