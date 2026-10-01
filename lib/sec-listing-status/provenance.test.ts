import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sameRetainedListingEvidence } from "./provenance.ts";
import { buildObservation, unattached, type Row } from "./observation.ts";
import { readSecListingHistory } from "./persistence.ts";

const source=JSON.parse(readFileSync(new URL("./fixtures/follow-up.json",import.meta.url),"utf8"))["scpx-before"];
const id="25000000-0000-4000-8000-000000000090";
function fixture() {
  const html=`<p>${source.quote}</p>`;
  const raw={id,source_code:"sec_edgar",source_unique_id:"0001079973-24-000891",source_url:source.url,
    published_at:"2024-06-17T00:00:00Z",fetched_at:"2026-09-30",raw_payload:{cik:"1476963",form_type:"8-K",
      primary_document_url:source.url,primary_document_html:html}};
  const o=buildObservation({raw,scope:{issuerCik:"0001476963",securityTitle:"common stock",exchange:"NYSE American"},asOf:"2024-06-17",attachment:unattached("fixture"),sourceEvent:{
    version:"listing_source_event_v1",kind:"removal_decision",date:"2024-06-14",dateText:"June 14, 2024",
    documentUrl:source.url,documentHash:createHash("sha256").update(html).digest("hex"),quote:source.quote,
    securityText:"common stock",exchangeText:"NYSE American",issue:"Section 1003(f)(v)"}});
  return {raw:structuredClone(raw),o};
}
test("unchanged cited SEC bytes survive refreshed fetch/index metadata; history never mutates",async()=>{
  const {raw,o}=fixture(), original=structuredClone(o);
  raw.fetched_at="2026-10-01";raw.published_at="2024-06-17T12:44:57Z";raw.raw_payload.cik="0001476963";
  raw.source_url=source.url.replace("scpx_8k.htm","0001079973-24-000891-index.html");
  assert.equal(sameRetainedListingEvidence(o,raw),true);
  const repository={select:async(table:string)=>({ok:true,status:200,data:table==="raw_items"?[raw]:[{id,raw_item_id:id,observation:o}]}),rpc:async()=>{throw Error("no writes");}};
  const [read]=await readSecListingHistory({rawItemId:id,repository});
  assert.equal(read.usable,true);assert.equal(read.provenance?.source,"wrapper_refreshed");assert.deepEqual(o,original);
});
test("different bytes, missing/truncated citation, changed filing date/issuer and tampered hash remain invalid",async()=>{
  for(const variant of ["bytes","missing","truncated","day","issuer","hash"]) {
    const {raw,o}=fixture();raw.fetched_at="new fetch";
    if(variant==="bytes") raw.raw_payload.primary_document_html+="different SEC evidence";
    if(variant==="missing") raw.raw_payload.primary_document_url+="missing";
    if(variant==="truncated") (raw.raw_payload as Row).primary_document_html_truncated=true;
    if(variant==="day") raw.published_at="2024-06-18";
    if(variant==="issuer") raw.raw_payload.cik="1111111";
    if(variant==="hash") o.sourceHash="a".repeat(64);
    const repository={select:async(table:string)=>({ok:true,status:200,data:table==="raw_items"?[raw]:[{id,raw_item_id:id,observation:o}]}),rpc:async()=>{throw Error("no writes");}};
    const [read]=await readSecListingHistory({rawItemId:id,repository});
    assert.equal(read.usable,false,variant);assert.equal(read.reason,"stale_or_missing_sec_source",variant);
    assert.equal(read.revalidationFailure,undefined);
  }
});
