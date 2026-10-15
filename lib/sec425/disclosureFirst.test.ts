import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {FACT_SCHEMA,assessFacts} from "./facts.ts";
import {sourceInput} from "./storage.ts";

const sources=process.env.SEC425_SOURCE_EVIDENCE;
const prior=process.env.SEC425_PRODUCT_EVIDENCE;
const retained={skip:!sources||!prior};
const parse=(b:any)=>JSON.parse(b.candidates[0].content.parts.filter((p:any)=>!p.thought).map((p:any)=>p.text??"").join(""));
function fixture(label:string){
 const raw=JSON.parse(fs.readFileSync(`${sources}/${label}-fresh-raw.json`,"utf8"));
 const request=JSON.parse(fs.readFileSync(`${prior}/budget/${label}-request.json`,"utf8"));
 const output=parse(JSON.parse(fs.readFileSync(`${prior}/budget/${label}-response.json`,"utf8")));
 return{raw,request,output,source:sourceInput(raw)};
}
test("disclosure-first keeps the existing five-field output contract without an additional classifier",()=>{
 assert.deepEqual(Object.keys(FACT_SCHEMA.properties),["decision","reason","context","evidence","announcement"]);
});
test("retained product inputs keep schema/settings/source/identity; only system instructions change",retained,()=>{
 for(const label of ["diana","axcelis"]){
  const f=fixture(label),before=JSON.stringify(f.raw),current=f.source.request;
  assert.deepEqual(current.generationConfig,f.request.generationConfig);
  const now=JSON.parse(current.contents[0].parts[0].text),old=JSON.parse(f.request.contents[0].parts[0].text);
  // PostgREST normalizes the envelope timestamp string; do not modify raw to imitate it.
  for(const key of ["source","cleaned_source_blocks","official_company_references","filing_roles","official_company_observations","source_company_observations"])
   assert.deepEqual(now[key],old[key],key);
  assert.notEqual(current.systemInstruction.parts[0].text,f.request.systemInstruction.parts[0].text);
  assert.equal(JSON.stringify(f.raw),before);
 }
});
test("prior Axcelis semantic false positive remains unchanged and mechanically available, not silently corrected",retained,()=>{
 const f=fixture("axcelis"),before=JSON.stringify(f.output),a=assessFacts(f.output,f.source.input);
 assert.equal(f.output.announcement.announcement_type,"definitive_agreement_signed");
 assert.equal(a.status,"available");assert.equal(JSON.stringify(f.output),before);
 assert.equal(a.announcement?.parties.find(p=>p.claim.company_ref==="cik:0001113232:ACLS")?.identity,null);
});
test("not_applicable with current-disclosure source proof preserves the model result and yields no announcement",retained,()=>{
 const f=fixture("axcelis");
 // Synthetic transport-contract example, not the new provider result or an automated semantic fix.
 const value={decision:"not_applicable",reason:"Synthetic disclosure decision",context:"prior_background",evidence:f.output.evidence,announcement:null};
 const before=JSON.stringify(value),a=assessFacts(value,f.source.input);
 assert.equal(a.status,"not_ready");assert.equal(a.announcement,null);assert.equal(JSON.stringify(value),before);
});
