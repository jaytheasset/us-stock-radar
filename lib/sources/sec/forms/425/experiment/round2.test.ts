import test from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { preserveLocalContext, round2EventsSchema, inspectRound2Evidence, buildRound2Prompt } from "./round2.ts";
const block=(n:number)=>({block_id:`neutral-${n*11}`,source_ref:"doc-a",text:`Synthetic paragraph ${n}`,heading:n===7?"Synthetic headline":null,is_boilerplate:n===4});
const all=Array.from({length:12},(_,n)=>block(n));
const proof={block_id:all[7].block_id,source_field:"heading" as const,quote:"Synthetic headline"};
const value=()=>({coverage:"supplied_current_filing_blocks_only",empty_events_meaning:"not_a_finding_of_no_event",events:[{kind:"acquisition_proposal",action:"proposal_made",event_state:"occurred",disclosure_context:"current_announcement",statement:"A non-binding proposal was submitted; no agreement was signed.",date_literal:null,decision_scope_literal:null,evidence:[proof]}],unresolved:[]});
test("generic document-order window preserves original blocks, including mixed boilerplate context",()=>{
 const original=JSON.stringify(all),result=preserveLocalContext(all,[all[6],all[7],all[8]],[all[7].block_id]);
 assert.deepEqual(result.blocks,all.slice(4,11));assert.equal(result.blocks[0].is_boilerplate,true);assert.equal(JSON.stringify(all),original);
 const other=all.map((b,n)=>({...b,source_ref:n<7?"doc-b":"doc-a"}));assert.ok(preserveLocalContext(other,[other[7]],[other[7].block_id]).blocks.every(b=>b.source_ref==="doc-a"));
});
test("context budget overflow fails without silent evidence truncation",()=>{
 assert.throws(()=>preserveLocalContext(all.map(b=>({...b,text:"x".repeat(4000)})),[],[all[7].block_id]),/budget/);
});
test("occurred non-binding proposal allowed; scheduled vote result is not an event",()=>{
 const valid=new Ajv({strict:false}).compile(round2EventsSchema),v=value();assert.equal(valid(v),true);
 v.events[0].kind="shareholder_vote_result";v.events[0].action="vote_result";v.events[0].event_state="proposed";assert.equal(valid(v),false);
 assert.equal(valid({...value(),events:[],unresolved:[]}),true);
});
test("heading is an explicit evidence field, not a guessed repair of body quote",()=>{
 const v=value();assert.equal(inspectRound2Evidence(v,all).exactPass,true);
 const textProof={...proof,source_field:"text" as const};v.events[0].evidence=[textProof];assert.equal(inspectRound2Evidence(v,all).exactPass,false);
});
test("whitespace mismatch classified separately; wrong ID stays failure and unmodified",()=>{
 const v=value(),blocks=[{...all[7],heading:"Synthetic\nheadline"}];const before=JSON.stringify(v);
 const result=inspectRound2Evidence(v,blocks);assert.equal(result.exactPass,false);assert.equal(result.proofs[0].diagnosticWhitespaceOnlyMatch,true);assert.equal(JSON.stringify(v),before);
 v.events[0].evidence=[{...proof,block_id:"missing"}];assert.equal(inspectRound2Evidence(v,blocks).proofs[0].missingBlock,true);
});
test("primary user context and experiment instructions change explicitly, never source values",()=>{
 const primary={key:"sec_425_analysis_draft",version:"v9",system:"Original Primary instructions",user:JSON.stringify({cleaned_source_blocks:[all[7]],analysis_source_selection:{mode:"old"},router_result:{display_type:"generic"}}),responseFormat:{type:"json_schema",json_schema:{name:"prior",strict:true,schema:{type:"object",additionalProperties:false,required:["analysis_output"],properties:{analysis_output:{type:"object"}}}}}};
 const old=JSON.stringify(primary),r=buildRound2Prompt(primary,all,[all[7].block_id]);assert.equal(JSON.stringify(primary),old);assert.ok(r.prompt.system.startsWith(primary.system));assert.ok(r.prompt.system.includes("do not automatically put them in unresolved"));assert.ok(r.prompt.system.includes("snapshot_items is []"));assert.ok(r.prompt.system.includes("non-binding"));
 assert.deepEqual(JSON.parse(r.prompt.user).cleaned_source_blocks,r.selection.blocks);assert.deepEqual(r.prompt.responseFormat.json_schema.schema.properties.analysis_output,primary.responseFormat.json_schema.schema.properties.analysis_output);
});
