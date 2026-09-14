import assert from "node:assert/strict";
import test from "node:test";
import { readForm25StockEventView } from "./stockEvents.ts";
import type { Form25IdentityGate } from "./consumption.ts";

const rawId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const nullEvent={id:"event-null",raw_item_id:rawId,ticker:null,source_group:"filings",detected_at:"2025-07-12T00:00:00Z",metadata:{form_type:"25-NSE"}};
const wrongEvent={...nullEvent,id:"event-wrong",ticker:"TTWO"};
const approved=async()=>({status:"available" as const,ticker:"TTOO",exchange:"Nasdaq",reason:"human_approved"});
const blocked=async()=>({status:"blocked" as const,ticker:null,exchange:null,reason:"review_required"});
function readers(events:Record<string,unknown>[],identity:()=>Promise<Form25IdentityGate>=approved){return{identity,select:async(table:string)=>({ok:true,data:table==="sec_form25_identity_evidence"?[{raw_item_id:rawId}]:events})};}

test("approved originally-null and wrong-ticker filings are read without rewriting historical rows",async()=>{
 const before=JSON.stringify([nullEvent,wrongEvent]);
 const result=await readForm25StockEventView({ticker:"TTOO",limit:50},[],readers([nullEvent,wrongEvent]));
 assert.equal(result.status,"available");if(result.status!=="available")return;
 assert.deepEqual(result.data.map(row=>row.id),["event-null","event-wrong"]);
 assert.ok(result.data.every(row=>row.ticker==="TTOO"));
 assert.equal((result.data[1].form25_identity_view as Record<string,unknown>).storedTicker,"TTWO");
 assert.equal(JSON.stringify([nullEvent,wrongEvent]),before);
});
test("wrong original ticker listing excludes an event approved for a different ticker",async()=>{
 const result=await readForm25StockEventView({ticker:"TTWO",limit:50},[wrongEvent],readers([]));
 assert.deepEqual(result,{status:"available",data:[]});
});
test("withdrawal blocks both requested symbols and stored AUTO metadata is not authority",async()=>{
 const forged={...wrongEvent,metadata:{form_type:"25-NSE",form25_ticker_identity:{status:"available",state:"AUTO",ticker:"TTOO"}}};
 for(const ticker of ["TTOO","TTWO"]){
  const result=await readForm25StockEventView({ticker,limit:50},[forged],readers([nullEvent],blocked));
  assert.deepEqual(result,{status:"available",data:[]});
 }
});
test("existing verified current/historical security chain remains connected without rewriting the filing ticker",async()=>{
 const event={...nullEvent,ticker:"GGRP"};
 const identity=async()=>({status:"available" as const,ticker:"GGRP",exchange:"Nasdaq",reason:"official",subjectCik:"0000000001",security:"Common Stock"});
 const deps={...readers([event],identity),projection:async()=>({status:"available",currentTicker:"BTLN",historicalTickers:["VRAR","GGRP"],issuerCik:"0000000001",sourceFilings:[{securityTitle:"Common Stock, $0.01 par value"}]})};
 const result=await readForm25StockEventView({ticker:"BTLN",limit:50},[event],deps);
 assert.equal(result.status,"available");if(result.status==="available"){assert.equal(result.data.length,1);assert.equal(result.data[0].ticker,"GGRP");}
 const rejected={...deps,projection:async()=>({status:"not_found"})};
 assert.deepEqual(await readForm25StockEventView({ticker:"BTLN",limit:50},[event],rejected),{status:"available",data:[]});
 for(const mismatch of [{subjectCik:"0000000002",security:"Common Stock"},{subjectCik:"0000000001",security:"Warrants"},{subjectCik:"0000000001",security:"Class A Common Stock"}]){
  const result=await readForm25StockEventView({ticker:"BTLN",limit:50},[event],{...deps,identity:async()=>({...await identity(),...mismatch})});
  assert.deepEqual(result,{status:"available",data:[]});
 }
});
test("issuer sibling or warrant identity never enters another security's stock feed",async()=>{
 const deps=readers([nullEvent],async()=>({status:"available",ticker:"VEEAW",exchange:"Nasdaq",reason:"official_warrant"}));
 assert.deepEqual(await readForm25StockEventView({ticker:"VEEA",limit:50},[nullEvent],deps),{status:"available",data:[]});
});
test("existing route filters, default ordering, limits and non-Form25 rows are retained",async()=>{
 const queries:Record<string,string>[]=[];
 const normal={id:"news",ticker:"TTOO",source_group:"news",detected_at:"2025-07-13T00:00:00Z"};
 const deps={identity:approved,select:async(table:string,query:Record<string,string>)=>{queries.push(query);return{ok:true,data:table==="sec_form25_identity_evidence"?[{raw_item_id:rawId}]:[nullEvent]};}};
 const result=await readForm25StockEventView({ticker:"TTOO",limit:1,impact:"high",eventType:"listing_risk",marketScope:"company",signal:"bearish",excludeDeliveryLevel:"archive"},[normal],deps);
 assert.deepEqual(result,{status:"available",data:[normal]});
 assert.equal(queries[0]["evidence->candidates"],'cs.[{"ticker":"TTOO"}]');
 assert.equal(queries[1].raw_item_id,`in.(${rawId})`);assert.equal(queries[1].source_group,"eq.filings");
 assert.equal(queries[1].impact,"eq.high");assert.equal(queries[1].event_type,"eq.listing_risk");assert.equal(queries[1].market_scope,"eq.company");assert.equal(queries[1].signal,"eq.bearish");assert.equal(queries[1].delivery_level,"neq.archive");
 assert.equal(queries[1].order,"detected_at.desc");
 const feed=await readForm25StockEventView({ticker:"TTOO",limit:50,sourceGroup:"news"},[normal],{identity:approved,select:async()=>{throw Error("filing lookup must not run for news-only filter");}});
 assert.deepEqual(feed,{status:"available",data:[normal]});
});
test("candidate/event overflow and failed reads report unavailable, never a complete empty result",async()=>{
 const overflow={identity:approved,select:async()=>({ok:true,data:Array.from({length:101},()=>({raw_item_id:rawId}))})};
 assert.deepEqual(await readForm25StockEventView({ticker:"TTOO",limit:50},[],overflow),{status:"unavailable",reason:"form25_identity_candidate_limit"});
 const failure={identity:approved,select:async()=>({ok:false,data:null})};
 assert.equal((await readForm25StockEventView({ticker:"TTOO",limit:50},[],failure)).status,"unavailable");
});
test("duplicate stored/projected events appear once and missing Form25 contract cannot be added",async()=>{
 const result=await readForm25StockEventView({ticker:"TTOO",limit:50},[wrongEvent],readers([wrongEvent,{...nullEvent,id:"not-form25",metadata:{form_type:"8-K"}}]));
 assert.equal(result.status,"available");if(result.status==="available")assert.deepEqual(result.data.map(row=>row.id),[wrongEvent.id]);
});
