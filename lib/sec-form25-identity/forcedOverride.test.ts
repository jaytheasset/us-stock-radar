import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { activeForm25IdentityDecision, clearForm25SecurityConflict, form25ReferenceAccession, normalizeForm25OverrideReference } from "./forcedOverride.ts";
import { applySecForm25ForcedOverride, readEffectiveSecForm25Identity } from "./persistence.ts";
import { buildForm25IdentityEvidence, SEC_TICKER_CATALOG, sha } from "./canonical.ts";

const rawId="10000000-0000-4000-8000-000000000001",identityId="10000000-0000-4000-8000-000000000002";
const raw={id:rawId,source_unique_id:"0001354457-25-000637",source_url:"https://www.sec.gov/Archives/edgar/data/1354457/000135445725000637/primary_doc.xml",body_text:"<edgarSubmission><exchange><cik>1354457</cik><entityName>Nasdaq</entityName></exchange><issuer><cik>1492674</cik><entityName>T2 Biosystems</entityName></issuer><descriptionClassSecurity>Common Stock</descriptionClassSecurity></edgarSubmission>",raw_payload:{form_type:"25-NSE",filing_date:"2025-07-11",cik:"1492674"}};
const base=buildForm25IdentityEvidence(raw,{rows:[],available:true});
const forced={id:"forced-1",identity_id:identityId,revision:1,previous_decision_id:null,action:"forced_approved",override_ticker:"TTOO",override_reference:raw.source_unique_id};
function repository({source=raw,evidence=base,history=[] as Record<string,unknown>[],references=[raw] as Record<string,unknown>[],known=[] as Record<string,unknown>[]}={}) {
  const writes:Record<string,unknown>[]=[];
  return {writes,select:async(table:string,q:Record<string,string>)=>{
    if(table==="raw_items")return {ok:true,status:200,data:q.id?[source]:references};
    if(table==="sec_form25_identity_human_decisions")return {ok:true,status:200,data:history};
    if(table==="sec_form25_identity_evidence")return {ok:true,status:200,data:q.raw_item_id?[{id:identityId,evidence,evidence_sha256:sha(evidence)}]:known};
    throw new Error(`Unexpected proof dependency ${table}`);
  },rpc:async(name:string,payload:Record<string,unknown>)=>{writes.push({name,...payload});return {ok:true,status:200,data:{status:"inserted"}};}};
}
const input={rawItemId:rawId,actorUserId:rawId,action:"forced_approved",ticker:"TTOO",reference:raw.source_unique_id,reason:"Administrator independently confirms the issuer.",expectedEvidenceSha256:sha(base),expectedRevision:0,requestId:"forced-test"};

test("forced approval accepts zero candidates and own Form25 reference with no TradingSymbol",async()=>{
  assert.equal(base.candidates.length,0);const r=repository();await applySecForm25ForcedOverride({...input,repository:r});
  assert.equal(r.writes.length,1);assert.equal(r.writes[0].p_ticker,"TTOO");assert.equal(r.writes[0].name,"admin_apply_sec_form25_forced_override");
  const effective=await readEffectiveSecForm25Identity({rawItemId:rawId,repository:repository({history:[forced]})});
  assert.equal(effective.status,"available");if(effective.status==="available"){assert.equal(effective.state,"HUMAN_APPROVED");assert.equal(effective.ticker,"TTOO");assert.equal(effective.reason,"forced_manual_override");}
});
test("optional, unretained and unparseable reference never require parser ticker support",async()=>{
  for(const reference of [undefined,"0000000000-26-999999","https://www.sec.gov/Archives/edgar/data/1354457/unknown.htm"]){
    const r=repository({references:[]});await applySecForm25ForcedOverride({...input,reference,repository:r});assert.equal(r.writes.length,1);
  }
  const r=repository({references:[{...raw,body_text:"Retained unreadable source",raw_payload:{form_type:"25-NSE"}}]});await applySecForm25ForcedOverride({...input,repository:r});assert.equal(r.writes.length,1);
});
test("missing subject/security extraction is not a new positive proof requirement",async()=>{
  const source={...raw,body_text:"Unparseable retained Form25 source",raw_payload:{form_type:"25-NSE",filing_date:"2025-07-11",cik:""}};
  const evidence=buildForm25IdentityEvidence(source,{rows:[],available:true});assert.equal(evidence.subjectCik,null);assert.equal(evidence.security,null);const r=repository({source,evidence,references:[],history:[{...forced,override_reference:null}]});
  const read=await readEffectiveSecForm25Identity({rawItemId:rawId,repository:r});assert.equal(read.status,"available");assert.equal(read.ticker,"TTOO");
});
test("known foreign issuer reference and different security block forced approval",async()=>{
  for(const body of [raw.body_text.replace("1492674","1321655"),raw.body_text.replace("Common Stock","Warrants to purchase Common Stock")]){
    const r=repository({references:[{...raw,body_text:body}]});await assert.rejects(applySecForm25ForcedOverride({...input,repository:r}),/conflicts with known/);assert.equal(r.writes.length,0);
  }
});
test("known retained official catalog attribution blocks a different issuer ticker",async()=>{
  const proof={...base,status:"AUTO",subjectCik:"1321655",candidates:[{ticker:"PLTR",cik:"1321655",exchange:"Nasdaq",source:SEC_TICKER_CATALOG}]};
  const r=repository({known:[{evidence:proof,evidence_sha256:sha(proof)}]});await assert.rejects(applySecForm25ForcedOverride({...input,ticker:"PLTR",repository:r}),/conflicts with known/);assert.equal(r.writes.length,0);
});
test("forced reader rechecks positive reference conflict without mutating decisions",async()=>{
  const history=[forced];const original=JSON.stringify(history);const r=repository({history,references:[{...raw,body_text:raw.body_text.replace("1492674","1321655")}]});
  const result=await readEffectiveSecForm25Identity({rawItemId:rawId,repository:r});assert.equal(result.status,"available");if(result.status==="available")assert.equal(result.state,"REVIEW");assert.equal(result.ticker,null);assert.equal(JSON.stringify(history),original);
});
test("forced withdrawal restores prior approval, nested overrides and hold; ordinary withdrawal stays reset",()=>{
  const approved={id:"a",action:"approved"},one={id:"f1",action:"forced_approved"},two={id:"f2",action:"forced_approved"};
  const stack=[approved,one,two,{id:"w2",action:"forced_withdrawn",withdraws_decision_id:"f2"}];
  assert.equal(activeForm25IdentityDecision(stack)?.id,"f1");assert.equal(activeForm25IdentityDecision([...stack,{action:"forced_withdrawn",withdraws_decision_id:"f1"}])?.id,"a");
  assert.equal(activeForm25IdentityDecision([approved,{action:"withdrawn"}]),undefined);
  assert.equal(activeForm25IdentityDecision([{id:"h",action:"held"},one,{action:"forced_withdrawn",withdraws_decision_id:"f1"}])?.id,"h");
  assert.throws(()=>activeForm25IdentityDecision([one,{action:"forced_withdrawn",withdraws_decision_id:"wrong"}]),/history_invalid/);
});
test("SEC archive filer CIK is not issuer evidence and unsafe URLs are rejected",()=>{
  assert.equal(form25ReferenceAccession(raw.source_url),raw.source_unique_id);
  assert.equal(normalizeForm25OverrideReference(""),null);assert.equal(normalizeForm25OverrideReference(raw.source_url),raw.source_url);
  for(const url of ["http://www.sec.gov/x","https://evil.test/x","javascript:alert(1)","https://user:password@www.sec.gov/x"])assert.throws(()=>normalizeForm25OverrideReference(url));
});
test("only positively different security categories or explicit classes conflict",()=>{
  assert.equal(clearForm25SecurityConflict("Common Stock","Ordinary shares"),false);assert.equal(clearForm25SecurityConflict("Common Stock","Class A Common Stock"),false);
  assert.equal(clearForm25SecurityConflict("Class A Common Stock","Class B Common Stock"),true);assert.equal(clearForm25SecurityConflict("Common Stock","Preferred Stock"),true);assert.equal(clearForm25SecurityConflict(null,"Warrants"),false);
});
test("new evidence/version invalidates an old forced approval",async()=>{
  const r=repository({history:[{...forced,identity_id:"older-evidence"}]});const read=await readEffectiveSecForm25Identity({rawItemId:rawId,repository:r});assert.equal(read.status,"available");if(read.status==="available")assert.equal(read.state,"REVIEW");assert.equal(read.ticker,null);
});
test("forced API retains existing permission and CSRF barriers",()=>{
  const route=readFileSync(new URL("../../app/api/admin/data/form25-identity/[rawItemId]/route.ts",import.meta.url),"utf8");assert.match(route,/assertSameOriginAuthRequest\(request\)/);assert.match(route,/resolveAdminApiAccess\(request,"data.run"\)/);assert.match(route,/applySecForm25ForcedOverride/);
});
test("forced SQL is append-only, actor checked, replay-safe and revision/source locked",()=>{
  const sql=readFileSync(new URL("../../supabase/migrations/20260914061702_form25_forced_human_override_v1.sql",import.meta.url),"utf8");
  assert.doesNotMatch(sql,/\b(?:update|delete from|insert into)\s+public\.(events|event_tickers|raw_items|ai_outputs)/i);
  for(const expected of ["ADMIN_PERMISSION_REQUIRED","FORM25_OVERRIDE_REPLAY_CONFLICT","FORM25_IDENTITY_STALE","FORM25_IDENTITY_SOURCE_CHANGED","FORM25_OVERRIDE_REFERENCE_CHANGED","forced_withdrawn","withdraws_decision_id"])assert.ok(sql.includes(expected));
  assert.match(sql,/from public,anon,authenticated/);assert.match(sql,/to service_role/);
});
