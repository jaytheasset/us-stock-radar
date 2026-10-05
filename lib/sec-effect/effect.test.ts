import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { captureEffectSource, readEffectNotice } from "./source.ts";
import { effectConditionErrors, targetConditions } from "./conditions.ts";
import { matchEffect, readEffectFacts } from "./reader.ts";
import { findRegistrationTargets, verifyRegistrationTarget } from "./registration.ts";
import { buildNaturalLanguageMonitorDraft } from "../monitor/naturalLanguageMonitorDraft.ts";
import { validateNaturalLanguageConditionCompilerOutput } from "../monitor/naturalLanguageConditionCompiler.ts";
import { resolveEffectDraft, confirmEffectDraft } from "./draft.ts";
import { getListingMonitorDraftCreateGate, createListingMonitorDraftReview } from "../monitor/listingMonitorDraftReview.ts";
import { collectEffectFixture } from "./fixtures.ts";
import { evaluateMonitorConditions } from "../listingMonitorMatcher.ts";

export function fixture(name: string) {
  const f = JSON.parse(readFileSync(new URL(`../sources/sec/forms/effect/fixtures/${name}.json`, import.meta.url), "utf8"));
  const issuer = /<cik>(\d+)<\/cik>/.exec(f.filing.text)![1];
  const accession = f.filing.accessionNumber;
  const url = `https://www.sec.gov/Archives/edgar/data/${Number(issuer)}/${accession.replaceAll("-", "")}/primary_doc.xml`;
  return { ...f, issuer, accession, url };
}
export function rawEffect(name: string) {
  const f = fixture(name);
  return { id: "00000000-0000-4000-8000-000000000001", source_code: "sec_edgar", source_unique_id: f.accession,
    source_url: f.url, published_at: "2026-10-06T00:00:00Z", raw_payload: { form_type: "EFFECT", cik: f.issuer,
      accession_number: f.accession, documents: [{ effectOriginalSource: captureEffectSource("EFFECT", { url: f.url, type: "EFFECT" }, f.filing.text) }] } };
}
export function registration(accession = "0001538379-24-000025", form = "S-1", file = "333-278172") {
  return { source_code: "sec_edgar", source_unique_id: accession,
    source_url: `https://www.sec.gov/Archives/edgar/data/1538379/${accession.replaceAll("-", "")}/${accession}-index.html`,
    published_at: "2024-03-22T00:00:00Z", raw_payload: { accession_number: accession, cik: "0001538379", file_number: file, form_type: form, company_name: "Ibotta, Inc.", ticker: "IBTA" } };
}
for (const name of ["s1-effective", "pos-am-effective", "f4-multiple-filers"]) {
  test(`${name}: existing SEC fetch/clean/serialize path preserves original XML`, async () => {
    const {raw,requests} = await collectEffectFixture(name);
    assert.deepEqual(readEffectNotice(raw),readEffectNotice(rawEffect(name)));
    assert.equal(requests.filter(url=>url.endsWith("primary_doc.xml")).length,1);
  });
  test(`${name}: original XML retains each exact filer pair and explicit reference without parent`, () => {
    const raw = rawEffect(name), notice = readEffectNotice(raw);
    assert.ok(notice);
    assert.equal(notice.accession, raw.source_unique_id);
    if (name === "pos-am-effective") assert.equal(notice.referenceAccession, "0001477932-22-009165");
    if (name === "f4-multiple-filers") assert.deepEqual(notice.filers.map(f => [f.cik,f.fileNumber]), [
      ["0001547456","333-277848"], ["0001547307","333-277848-07"], ["0001547093","333-277848-06"],
    ]);
    raw.raw_payload.documents[0].effectOriginalSource!.xml += " ";
    assert.equal(readEffectNotice(raw), null);
  });
}
test("same registration amendments collapse, distinct registrations do not; failure is not absence", async () => {
  const data = [registration(),registration("0001538379-24-000026","S-1/A")];
  const select = async () => ({ok:true,data});
  const targets = await findRegistrationTargets("IBTA","S-1",select);
  assert.equal(targets.length,1); assert.equal(targets[0].filingCount,2);
  data.push(registration("0001538379-24-000027","S-1","333-999999"));
  assert.equal((await findRegistrationTargets("IBTA","S-1",select)).length,2);
  await assert.rejects(findRegistrationTargets("IBTA","S-1",async()=>({ok:false,data:null})));
});
test("natural-language ledger → unresolved review → explicit target selection → validated conditions", async () => {
  const text = "Ibotta S-1 등록 건에 EFFECT가 나오면 알려줘";
  const compiled = validateNaturalLanguageConditionCompilerOutput({requirements:[{source_text:text,decision:"mapped",conditions:[
    {key:"effect.observed",operator:"eq",value:true},{key:"effect.target_query",operator:"eq",value:"IBTA"},
    {key:"effect.registration_form",operator:"eq",value:"S-1"}],reason:null,question:null}]},text);
  const select = async () => ({ok:true,data:[registration()]});
  const draft = await resolveEffectDraft(buildNaturalLanguageMonitorDraft(compiled,text),select);
  assert.equal(getListingMonitorDraftCreateGate(createListingMonitorDraftReview(draft)).ready,false);
  const confirmed = await confirmEffectDraft({draft,registrationAccession:registration().source_unique_id},select);
  assert.equal(getListingMonitorDraftCreateGate(createListingMonitorDraftReview(confirmed)).ready,true);
  assert.deepEqual(effectConditionErrors(confirmed.conditions),[]);
  assert.ok(effectConditionErrors(confirmed.conditions.filter(c=>c.key!=="effect.file_number")).length);
  await assert.rejects(verifyRegistrationTarget(confirmed.conditions,async()=>({ok:true,data:[registration(undefined,undefined,"333-123456")]})));
});
test("reader matches exact identity, rejects cross-registration and missing source; no parent fallback", async () => {
  const raw = rawEffect("s1-effective"), event = {id:"e",source_code:"sec_edgar",raw_item_id:raw.id,detected_at:raw.published_at,metadata:{accession_number:raw.source_unique_id}};
  const current = await readEffectFacts("e",async table=>({ok:true,data:table==="events"?[event]:[raw]}));
  const target = (await findRegistrationTargets("IBTA","S-1",async()=>({ok:true,data:[registration()]})))[0];
  assert.equal(matchEffect(current,targetConditions(target)),"match");
  assert.equal(matchEffect(current,targetConditions({...target,fileNumber:"333-999999"})),"no_match");
  assert.equal(matchEffect({status:"not_ready",reason:"reader_unavailable"},targetConditions(target)),"ineligible");
  raw.raw_payload.documents=[];
  assert.equal((await readEffectFacts("e",async table=>({ok:true,data:table==="events"?[event]:[raw]}))).status,"not_ready");
});

test("original source ambiguity, invalid dates, partial filers and unsupported fund targets stay unresolved", () => {
  const raw = rawEffect("s1-effective"), original = raw.raw_payload.documents[0].effectOriginalSource!;
  for (const xml of [
    original.xml.replace('</effectiveData>','<form>S-3</form></effectiveData>'),
    original.xml.replace('2024-04-17','2024-02-31'),
    original.xml.replace('</filer>','<fileNumber>333-999999</fileNumber></filer>'),
    original.xml.replace('</effectiveData>','<filer><cik>0001234567</cik></filer></effectiveData>'),
    original.xml.replace('</filer>','<seriesClassContractData/></filer>'),
  ]) {
    raw.raw_payload.documents[0].effectOriginalSource=captureEffectSource('EFFECT',{url:original.url,type:'EFFECT'},xml);
    assert.equal(readEffectNotice(raw),null);
  }
});

test("POS AM requires verified explicit reference; accession anchor may be another amendment of same registration", async () => {
  const raw=rawEffect('pos-am-effective');
  const notice=readEffectNotice(raw)!;
  const event={id:'e',source_code:'sec_edgar',raw_item_id:raw.id,metadata:{accession_number:raw.source_unique_id}};
  const reference={...registration(notice.referenceAccession!,'POS AM','333-261062'),raw_payload:{accession_number:notice.referenceAccession,cik:'0001324736',form_type:'POS AM',file_number:'333-261062'}};
  const select=async (table:string,query:Record<string,string>)=>({ok:true,data:table==='events'?[event]:query.id?[raw]:[reference]});
  const facts=await readEffectFacts('e',select);
  const target={cik:'0001324736',fileNumber:'333-261062',form:'S-1',accession:'0001324736-21-000001',company:'Hero',filedAt:'2021-01-01',sourceUrl:'',filingCount:3};
  assert.equal(matchEffect(facts,targetConditions(target)),'match');
  reference.raw_payload.file_number='333-999999';
  assert.equal((await readEffectFacts('e',select)).status,'not_ready');
  assert.equal((await readEffectFacts('e',async()=>({ok:false,data:null}))).status,'not_ready');
});

test("S-3 matching uses exact CIK/full file suffix and rejects incomplete or mixed conditions", () => {
  // Synthetic S-3 variant tests the contract without treating it as a new real SEC example.
  const raw=rawEffect('s1-effective'), source=raw.raw_payload.documents[0].effectOriginalSource!;
  source.xml=source.xml.replace('<form>S-1</form>','<form>S-3</form>').replace('333-278172','333-278172-07');
  raw.raw_payload.documents[0].effectOriginalSource=captureEffectSource('EFFECT',{url:source.url,type:'EFFECT'},source.xml);
  const notice=readEffectNotice(raw)!;
  assert.equal(notice.form,'S-3');
  const facts={status:'available' as const,eventId:'e',sourceExecutionId:raw.id,persistedAt:raw.published_at,notice,reference:null};
  const target={cik:'0001538379',fileNumber:'333-278172-07',form:'S-3',accession:'0001538379-24-000025',company:'Ibotta',filedAt:'',sourceUrl:'',filingCount:2};
  const conditions=targetConditions(target);
  assert.equal(evaluateMonitorConditions({effect:facts} as any,conditions,{evaluationDate:'2026-10-06'}).status,'match');
  assert.equal(matchEffect(facts,targetConditions({...target,fileNumber:'333-278172'})),'no_match');
  assert.equal(matchEffect(facts,targetConditions({...target,cik:'0001234567'})),'no_match');
  assert.equal(matchEffect(facts,conditions.slice(1)),'ineligible');
  assert.equal(matchEffect(facts,[...conditions,{key:'market.price',operator:'lt',value:1}]),'ineligible');
});
