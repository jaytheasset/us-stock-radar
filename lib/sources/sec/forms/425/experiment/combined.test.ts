import assert from "node:assert/strict";
import test from "node:test";
import Ajv from "ajv";
import { combineWithFilingEvents, eventsSchema, validateEvidenceBindings, EVENT_KINDS } from "./combined.ts";
const prompt = { key: "sec_425_analysis_draft", version: "v9", system: "Existing Primary policy", user: '{"cleaned_source_blocks":[]}', responseFormat: { type: "json_schema", json_schema: { name: "existing", strict: true, schema: { type: "object", additionalProperties: false, required: ["analysis_output"], properties: { analysis_output: { type: "object" } } } } } };
const validate = new Ajv({ strict: false }).compile(eventsSchema);
const empty = () => ({ coverage: "supplied_current_filing_blocks_only", empty_events_meaning: "not_a_finding_of_no_event", events: [], unresolved: [] });
const block = { block_id: "b1", text: "On June 1, Acquirer made a proposal. Closing is expected in December." };
const event = () => ({kind:"acquisition_proposal",action:"proposal_made",event_state:"occurred",disclosure_context:"current_announcement",statement:"Acquirer made a proposal.",date_literal:"June 1",decision_scope_literal:null,evidence:[{block_id:"b1",quote:block.text}]});
test("opt-in extension preserves original prompt, exact user source and Primary schema",()=>{
 const before=JSON.stringify(prompt),result=combineWithFilingEvents(prompt);
 assert.equal(JSON.stringify(prompt),before);assert.equal(result.user,prompt.user);assert.ok(result.system.startsWith(prompt.system));
 assert.deepEqual(result.responseFormat.json_schema.schema.properties.analysis_output,prompt.responseFormat.json_schema.schema.properties.analysis_output);
 assert.deepEqual(result.responseFormat.json_schema.schema.required,["analysis_output","filing_events"]);
 assert.equal(result.key,prompt.key);assert.equal(EVENT_KINDS.length,7);
});
test("empty extraction explicitly cannot establish no event",()=>{
 assert.equal(validate(empty()),true);assert.equal(validate({...empty(),empty_events_meaning:"no_events"}),false);
});
test("source reference and exact quote required; absent block and invented quote rejected",()=>{
 const value={...empty(),events:[event()]};assert.equal(validate(value),true);assert.equal(validateEvidenceBindings(value,[block]).ok,true);
 value.events[0].evidence[0].block_id="missing";assert.equal(validateEvidenceBindings(value,[block]).ok,false);
 value.events[0].evidence[0]={block_id:"b1",quote:"The transaction closed."};assert.equal(validateEvidenceBindings(value,[block]).ok,false);
});
test("literal date cannot be supplied by normalization or unrelated source",()=>{
 const value={...empty(),events:[{...event(),date_literal:"2026-06-01"}]};assert.equal(validateEvidenceBindings(value,[block]).ok,false);
});
test("proposed, historical, unresolved and null are retained without promotion",()=>{
 const value={...empty(),events:[{...event(),event_state:"proposed",disclosure_context:"prior_background",date_literal:null}],unresolved:[{reason:"Closing has not been established",evidence:[{block_id:"b1",quote:block.text}]}]};
 const before=JSON.stringify(value);assert.equal(validate(value),true);assert.equal(validateEvidenceBindings(value,[block]).ok,true);assert.equal(JSON.stringify(value),before);
});
test("unknown kinds and ungrounded missing evidence fail schema",()=>{
 assert.equal(validate({...empty(),events:[{...event(),kind:"deal_latest_state"}]}),false);
 assert.equal(validate({...empty(),events:[{...event(),evidence:[]}]}),false);
});
test("quote containment is not semantic approval: a wrong closing claim needs human review",()=>{
 const value={...empty(),events:[{...event(),kind:"transaction_closed",action:"closed",statement:"The transaction closed."}]};
 assert.equal(validate(value),true);const checked=validateEvidenceBindings(value,[block]);assert.equal(checked.ok,true);assert.equal(checked.semanticAccuracy,"requires_source_review");
});
