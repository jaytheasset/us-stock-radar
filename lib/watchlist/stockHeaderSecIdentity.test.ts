import assert from "node:assert/strict";
import test from "node:test";
import { readStockHeaderSecIdentity } from "./stockHeaderSecIdentity.ts";
import { stockHeaderIdentityPresentation } from "./stockHeaderIdentityPresentation.ts";
import { readStockHeaderCurrent } from "./stockHeaderCurrentReader.ts";
import type { SecCurrentSubmissionsResult } from "../sec-structured-data/types.ts";
const current: Extract<SecCurrentSubmissionsResult, {status:"available"}> = { status:"available",cik:"0001840317",entityName:"Synthetic issuer",listings:[
  {ticker:"SYN",exchange:"Synthetic Common Exchange"},{ticker:"SYNW",exchange:"Synthetic Warrant Exchange"}],
  sourceRawId:"11111111-1111-4111-8111-111111111111",sourceKind:"submissions",sourceUrl:"https://data.sec.gov/test",
  sourceIdentity:"internal",contentHash:"0".repeat(64),refreshSequence:"4",confirmedAt:"2026-10-07T01:02:03Z",firstFetchedAt:"2026-01-01T00:00:00Z" };
function deps(value: SecCurrentSubmissionsResult = current) { return {
  readCatalog: async (ticker: string, options: {exactTicker:true;fresh:true})=>{
    assert.deepEqual(options,{exactTicker:true,fresh:true});return {ok:true,data:[{ticker,cik_str:1840317}]};},
  readCurrent:async(cik:string)=>{assert.equal(cik,current.cik);return value;},
}; }
test("fresh exact catalog/current/unique listing use same source and allowlisted DTO",async()=>{
  const identity=await readStockHeaderSecIdentity("synw",deps());
  assert.deepEqual(identity,{ticker:"SYNW",status:"available",companyName:"Synthetic issuer",exchange:"Synthetic Warrant Exchange",confirmedAt:current.confirmedAt});
  assert.equal(stockHeaderIdentityPresentation("SYNW",identity).confirmationLabel,"SEC checked 2026-10-07 01:02:03 UTC");
});
test("catalog duplicate/conflict/failure never reaches current or borrows another issuer",async()=>{
  for(const data of [[{ticker:"SYNW",cik_str:1},{ticker:"SYNW",cik_str:2}],[{ticker:"SYNW",cik_str:1},{ticker:"SYNW",cik_str:1}],[{ticker:"SYNW",cik_str:0}],null]){
    const r=await readStockHeaderSecIdentity("SYNW",{readCatalog:async()=>({ok:true,data}),readCurrent:async()=>assert.fail("ambiguous catalog")});
    assert.equal(r.status,"unavailable");
  }
  assert.equal((await readStockHeaderSecIdentity("SYNW",{readCatalog:async()=>{throw Error("private error");}})).status,"unavailable");
  assert.equal((await readStockHeaderSecIdentity("SYNW",{readCatalog:async()=>({ok:true,data:[]})})).status,"not-confirmed");
});
test("no current, empty listing, absent ticker and unavailable remain distinct without fallback",async()=>{
  assert.deepEqual(await readStockHeaderSecIdentity("SYNW",deps({status:"not-confirmed"})),{ticker:"SYNW",status:"not-confirmed",reason:"no-current"});
  for(const listings of [[],[{ticker:"SYN",exchange:"NYSE"}]]) {
    assert.deepEqual(await readStockHeaderSecIdentity("SYNW",deps({...current,listings})),{ticker:"SYNW",status:"not-confirmed",reason:"ticker-not-listed"});
  }
  assert.equal((await readStockHeaderSecIdentity("SYNW",deps({status:"unavailable"}))).status,"unavailable");
});
test("different CIK, duplicate listing and blank exchange fail closed",async()=>{
  for(const value of [{...current,cik:"0000000001"},{...current,listings:[{ticker:"SYNW",exchange:"NYSE"},{ticker:"SYNW",exchange:"Nasdaq"}]},{...current,listings:[{ticker:"SYNW",exchange:""}]}])
    assert.equal((await readStockHeaderSecIdentity("SYNW",deps(value))).status,"unavailable");
});
test("a later failure and ticker navigation cannot retain previous identity or time",async()=>{
  const good=await readStockHeaderSecIdentity("SYNW",deps());
  const failed=await readStockHeaderSecIdentity("SYNW",deps({status:"unavailable"}));
  assert.equal(stockHeaderIdentityPresentation("SYN",good).confirmedAt,null);
  assert.equal(stockHeaderIdentityPresentation("SYNW",failed).confirmedAt,null);
  assert.match(stockHeaderIdentityPresentation("SYNW",failed).companyName,/temporarily unavailable/);
});
test("SQL adapter releases successful reads and destroys failed connections; no writes",async()=>{
  for(const fail of [false,true]) {const releases:boolean[]=[];let calls=0;
    const pool={end:async()=>{},connect:async()=>({release:(destroy?:boolean)=>{releases.push(Boolean(destroy));},
      query:async(sql:string)=>{calls++;assert.match(sql,/^select/);if(fail)throw Error("private DB error");return {rows:[],rowCount:0};}})};
    assert.equal((await readStockHeaderCurrent(current.cik,pool)).status,fail?"unavailable":"not-confirmed");
    assert.deepEqual(releases,[fail]);assert.equal(calls,1);
  }
  assert.deepEqual(await readStockHeaderCurrent(current.cik,{end:async()=>{},connect:async()=>{throw Error("refused");}}),{status:"unavailable"});
});
