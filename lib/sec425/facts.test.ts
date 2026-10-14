import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {locateProof,assessFacts,companyReferences,buildFactPrompt,type Output} from "./facts.ts";
import {conditionErrors} from "./conditions.ts";
import {match425} from "./consumer.ts";
import {validateCanonicalListingConditions} from "../monitor/listingMonitorPersistence.ts";

test("whitespace comparison returns exact source offsets without changing model quote or field",()=>{
 const b={block_id:"one",heading:null,text:"A submitted\n  a proposal."},p={block_id:"one",source_field:"text" as const,quote:"submitted a proposal"};
 const before=JSON.stringify(p),span=locateProof(p,[b]);assert.equal(span?.sourceQuote,"submitted\n  a proposal");assert.equal(b.text.slice(span!.start,span!.end),span!.sourceQuote);assert.equal(JSON.stringify(p),before);
 assert.equal(locateProof({...p,source_field:"heading"},[b]),null);assert.equal(locateProof({...p,block_id:"other"},[b]),null);
 assert.equal(locateProof(p,[b,b]),null);assert.equal(locateProof({...p,quote:"a"},[{...b,text:"a a"}]),null);
});
test("425 constraints cannot silently drop another family, a negative tag or unsupported operator",()=>{
 assert.deepEqual(conditionErrors([{key:"sec425.target_ticker",operator:"eq",value:"GNK"}]),[]);
 for(const c of [{key:"market.price",operator:"lt",value:4},{key:"sec425.transaction.merger",operator:"eq",value:false},{key:"sec425.target_ticker",operator:"in",value:["GNK"]}])assert.ok(conditionErrors([{key:"sec425.announcement_type",operator:"eq",value:"revised_acquisition_proposal"},c]).length);
});
const evidence=process.env.SEC425_SOURCE_EVIDENCE;

test("malformed425 conditions return validation errors rather than throwing before shared validation",()=>{
 const result=validateCanonicalListingConditions([{key:"sec425.target_ticker",operator:"eq",value:"GNK"},null]);
 assert.equal(result.ok,false);assert.ok(result.errors.includes("conditions[1]:condition_invalid"));
});
test("retained genuine source: official GNK/DSX refs, unresolved field isolation, same-announcement AND and original-output preservation",{skip:!evidence},()=>{
 const pkg=JSON.parse(fs.readFileSync(evidence+"/diana-package.json","utf8")),input={filing_package:pkg},before=JSON.stringify(input),refs=companyReferences(input);
 assert.ok(refs.some(r=>r.cik==="0001326200"&&r.ticker==="GNK"));assert.ok(refs.some(r=>r.cik==="0001318885"&&r.ticker==="DSX"));
 const rawBlocks=pkg.hard_parsers['425'].raw.cleaned_source_blocks;
 const proof={block_id:"425_primary_011",source_field:"text" as const,quote:rawBlocks.find((b:any)=>b.block_id==="425_primary_011").text};
 // Clearly synthetic contract fixture over preserved original source. Never a new LLM result.
 const fixture:Output={decision:"confirmed",reason:"synthetic test",context:"current_announcement",evidence:[proof],announcement:{announcement_type:"revised_acquisition_proposal",transaction_types:["acquisition","tender_offer"],statement:"synthetic test",parties:refs.filter(r=>['DSX','GNK'].includes(r.ticker)).map(r=>({name:r.sourceName,role:r.ticker==='DSX'?'acquirer':'target',company_ref:r.ref,evidence:[proof]})),key_terms:[{value:"unsupported synthetic term",evidence:[{...proof,source_field:"heading"}]}]}};
 const unchanged=JSON.stringify(fixture),a=assessFacts(fixture,input);assert.equal(a.status,"available");assert.equal(a.announcement?.terms[0].available,false);assert.equal(JSON.stringify(fixture),unchanged);
 const conditions=[{key:"sec425.announcement_type",operator:"eq",value:"revised_acquisition_proposal"},{key:"sec425.target_ticker",operator:"eq",value:"GNK"},{key:"sec425.acquirer_ticker",operator:"eq",value:"DSX"}];
 assert.equal(match425(a,conditions),true);assert.equal(match425(a,[...conditions,{key:"sec425.target_ticker",operator:"eq",value:"ACLS"}]),false);
 for(const context of ["prior_background","unclear"] as const)assert.equal(match425(assessFacts({...fixture,context},input),conditions),false);
 for(const decision of ["not_applicable","uncertain"] as const)assert.equal(match425(assessFacts({...fixture,decision,announcement:null},input),conditions),false);
 const wrong=structuredClone(fixture);wrong.announcement!.parties.find(p=>p.role==="target")!.company_ref=refs.find(r=>r.ticker==="DSX")!.ref;
 assert.equal(match425(assessFacts(wrong,input),conditions),false);
 assert.equal(JSON.stringify(input),before);assert.equal(JSON.parse(buildFactPrompt(input).user).cleaned_source_blocks.length,72);
});
test("source-confirmed third party Veeco remains in official references, without making filing role its transaction role",{skip:!evidence},()=>{
 const p=JSON.parse(fs.readFileSync(evidence+"/axcelis-package.json","utf8"));const refs=companyReferences({filing_package:p});
 assert.ok(refs.some(r=>r.ticker==="VECO"&&r.cik==="0000103145"));
});
