// Experiment only: do not import from production ingest, Primary, Monitor or persistence.
import Ajv from 'ajv';
import {isDeepStrictEqual} from 'node:util';
import {inspectRound2Evidence} from './round2.ts';

const marker = 'Opt-in experiment extension:';
export const ROUND4_INSTRUCTIONS = [
  'Round 4 event classification contract (filing_events only): identify the actual actor and its role, the target of that action, and whether that action occurred before assigning one of the seven kinds. actor is the acting party, not merely the company publishing or reporting another party\'s action. target.description describes the object of that action, not just the issuer name.',
  'event_state describes the action only. Only occurred actions belong in events. scheduled, conditional_future and unknown are available to express uncertainty honestly, but an event with those states fails the occurred-event contract; do not relabel it occurred just to satisfy the validator. Clearly scheduled or hypothetical actions may simply be omitted, without forced unresolved items.',
  'Corporate board approval is not a regulator or court decision, even if it approved a merger agreement. A company buying its own shares is not an acquisition proposal for another entity. Future merger mechanics following a signed agreement do not independently establish a submitted acquisition proposal. A filed proxy or scheduled meeting is not a shareholder voting result. Classify the action itself, not a nearby transaction word.',
  'transaction_status is independent of action occurrence: binding = binding / non_binding / not_stated; completion = completed / not_completed / not_stated; conditions is a concise source-grounded description or null. A submitted non-binding offer or announced revision can have occurred while the acquisition remains non-binding and uncompleted. A regulator/court may have issued a conditional or partial decision even when future closing still depends on conditions. Do not turn an issued conditional decision into a future action, or a conditional future closing into an occurred closing.',
  'Keep statement as a concise event explanation preserving parties and qualifications. Do not replace it mechanically with a quotation. In evidence, purpose=action supports actor, target and actual action; purpose=transaction_qualification supports binding/completion/conditions; purpose=both supports both. Keep exact short source spans as separate evidence. Explicit transaction_status assertions require qualification evidence; every event requires action evidence. not_stated/null means not established in supplied source, not an inferred legal status.',
  'For each current event, including a consideration revision, preserve applicable non-binding/conditional qualifiers with its own qualification evidence; do not leave them only on another event. Do not infer binding from signing language alone or completed acquisition from a proposal submission. Do not copy current qualifiers onto a historical proposal unless the source supports them for that historical action.',
  'disclosure_context remains independent: prior_background is a historical action described here, never a newly announced current event. Do not relabel earlier submissions or price revisions as current because they appear in the current filing. Preserve action=agreement_terminated versus proposal_withdrawn; neither requires a completed acquisition. decision_scope_literal preserves partial/conditional approval scope, never all approvals by inference.',
  'The validator reports structural contradictions and citation format only; it does not establish source meaning or repair your answer. Return source-supported classifications and quotations yourself. Empty events is allowed but omitting a supported positive event is not a successful extraction.',
].join('\n');

function extendEventSchema(original, wire) {
  const schema = structuredClone(original);
  const event = schema.properties.events.items;
  const string = {type:'string', minLength:1};
  const enumeration = values => ({type:'string', enum:values});
  const object = properties => ({type:'object', ...(wire ? {} : {additionalProperties:false}), required:Object.keys(properties), properties});
  event.properties.event_state = enumeration(['occurred','scheduled','conditional_future','unknown']);
  event.required.push('actor','target','transaction_status');
  event.properties.actor = object({
    name: string,
    role: enumeration(['transaction_party','corporate_board','shareholders','regulator','court','other','unknown']),
  });
  event.properties.target = object({
    description:string,
    category:enumeration(['business_combination','own_share_repurchase','meeting_or_proxy_process','other','unknown']),
  });
  event.properties.transaction_status = object({
    binding:enumeration(['binding','non_binding','not_stated']),
    completion:enumeration(['completed','not_completed','not_stated']),
    conditions:wire ? {type:'string',nullable:true} : {type:['string','null']},
  });
  const evidence = event.properties.evidence.items;
  evidence.required.push('purpose');
  evidence.properties.purpose = enumeration(['action','transaction_qualification','both']);
  // Preserve old local/wire citation limits, unresolved contract and all Primary fields.
  return schema;
}

export function buildRound4Combined(oldPrompt, oldRequest) {
  if (oldRequest.systemInstruction.parts.length!==1 || oldRequest.contents.length!==1 || oldRequest.contents[0].parts.length!==1 || oldRequest.systemInstruction.parts[0].text!==oldPrompt.system || oldRequest.contents[0].parts[0].text!==oldPrompt.user) throw Error('round2_actual_payload_mismatch');
  if (oldPrompt.system.indexOf(marker)<0 || oldPrompt.system.indexOf(marker)!==oldPrompt.system.lastIndexOf(marker) || !oldPrompt.responseFormat.json_schema.schema.properties.analysis_output) throw Error('combined_Primary_boundary_missing');
  const prompt = structuredClone(oldPrompt), request = structuredClone(oldRequest);
  // Append classification instructions without rewriting any original Primary/event instructions.
  prompt.key='sec425_primary_events_experiment_v4';
  prompt.system += '\n'+ROUND4_INSTRUCTIONS;
  prompt.responseFormat.json_schema.name='sec425_primary_events_experiment_v4';
  prompt.responseFormat.json_schema.schema.properties.filing_events=extendEventSchema(oldPrompt.responseFormat.json_schema.schema.properties.filing_events,false);
  request.systemInstruction.parts[0].text=prompt.system;
  request.generationConfig.responseSchema.properties.filing_events=extendEventSchema(oldRequest.generationConfig.responseSchema.properties.filing_events,true);
  const audit=auditRound4Diff(oldPrompt,oldRequest,prompt,request);
  return {prompt,request,audit};
}

export function auditRound4Diff(oldPrompt,oldRequest,prompt,request) {
  const restored=structuredClone(request);
  restored.systemInstruction.parts[0].text=oldRequest.systemInstruction.parts[0].text;
  restored.generationConfig.responseSchema.properties.filing_events=oldRequest.generationConfig.responseSchema.properties.filing_events;
  const restoredLocal=structuredClone(prompt.responseFormat.json_schema.schema);
  restoredLocal.properties.filing_events=oldPrompt.responseFormat.json_schema.schema.properties.filing_events;
  if (!isDeepStrictEqual(restored,oldRequest) || !isDeepStrictEqual(restoredLocal,oldPrompt.responseFormat.json_schema.schema) || prompt.user!==oldPrompt.user || prompt.system!==oldPrompt.system+'\n'+ROUND4_INSTRUCTIONS || request.systemInstruction.parts[0].text!==prompt.system) throw Error('change_outside_event_contract');
  return {combinedPrimaryPreserved:true,originalSystemPrefixByteIdentical:true,userPayloadByteIdentical:true,localPrimarySchemaIdentical:true,wirePrimarySchemaIdentical:true,generationSettingsIdentical:true,allowedWireChanges:['systemInstruction.parts[0].text: append event instructions only','generationConfig.responseSchema.properties.filing_events'],addedInstructions:ROUND4_INSTRUCTIONS};
}

const actions = {
  agreement_signed:['signed'], acquisition_proposal:['proposal_made'], consideration_changed:['consideration_revised'],
  shareholder_vote_result:['vote_result'], regulator_or_court_decision:['regulatory_decision','court_decision'],
  transaction_closed:['closed'], agreement_terminated_or_proposal_withdrawn:['agreement_terminated','proposal_withdrawn'],
};

/** Call only on structurally valid output. Report enum/reference contradictions, never infer from text. */
export function inspectClassification(events) {
  const errors=[];
  for (const [index,event] of events.entries()) {
    const add=reason=>errors.push({index,reason});
    if (!actions[event.kind]?.includes(event.action)) add('kind_action_conflict');
    if (event.event_state!=='occurred') add('action_not_occurred');
    const requiredRole={regulatory_decision:'regulator',court_decision:'court',vote_result:'shareholders'}[event.action];
    if (requiredRole && event.actor.role==='unknown') add('action_actor_role_unconfirmed');
    else if (requiredRole && event.actor.role!==requiredRole) add('action_actor_role_conflict');
    if (['proposal_made','consideration_revised'].includes(event.action) && event.target.category==='own_share_repurchase') add('own_share_repurchase_not_acquisition_proposal_or_consideration_change');
    if (event.action==='vote_result' && event.target.category==='meeting_or_proxy_process') add('meeting_or_proxy_process_not_voting_result');
    if (event.action==='closed' && event.transaction_status.completion==='not_completed') add('closing_completion_conflict');
    if (!event.evidence.some(p=>['action','both'].includes(p.purpose))) add('action_evidence_missing');
    const status=event.transaction_status;
    if ((status.binding!=='not_stated'||status.completion!=='not_stated'||status.conditions!==null) && !event.evidence.some(p=>['transaction_qualification','both'].includes(p.purpose))) add('transaction_qualification_evidence_missing');
  }
  return {pass:errors.length===0,errors,semanticAccuracy:'UNREVIEWED_REQUIRES_DIRECT_SEC_SOURCE',corrected:false};
}

export function validateRound4Output(parsed, localSchema, blocks) {
  const ajv=new Ajv({strict:false,allErrors:true});
  const full=ajv.compile(localSchema),schemaPass=full(parsed),schemaErrors=structuredClone(full.errors);
  // A length/whitespace formatting failure must not conceal classification diagnostics.
  // The actual response/schema stay unchanged; this second diagnostic schema removes quote maxLength only.
  const diagnostic=structuredClone(localSchema);
  for (const branch of ['events','unresolved']) delete diagnostic.properties.filing_events.properties[branch].items.properties.evidence.items.properties.quote.maxLength;
  const structural=ajv.compile(diagnostic),structuralSchemaPass=structural(parsed);
  const eventStructural=ajv.compile(diagnostic.properties.filing_events),eventStructuralSchemaPass=eventStructural(parsed?.filing_events);
  const primarySchema=structuredClone(localSchema);
  delete primarySchema.properties.filing_events;
  primarySchema.required=primarySchema.required.filter(key=>key!=='filing_events');
  const primary=ajv.compile(primarySchema),primaryValue=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?Object.fromEntries(Object.entries(parsed).filter(([key])=>key!=='filing_events')):parsed;
  const primarySchemaPass=primary(primaryValue);
  const classification=eventStructuralSchemaPass?inspectClassification(parsed.filing_events.events):null;
  const evidence=eventStructuralSchemaPass?inspectRound2Evidence(parsed.filing_events,blocks):null;
  const quoteLengthErrors=eventStructuralSchemaPass?[...parsed.filing_events.events,...parsed.filing_events.unresolved].flatMap((event,index)=>event.evidence.flatMap((p,proofIndex)=>[...p.quote].length>240?[{index,proofIndex,length:[...p.quote].length}]:[])):null;
  return {ok:schemaPass&&classification?.pass===true&&evidence?.exactPass===true,schemaPass,schemaErrors,primarySchemaPass,primarySchemaErrors:primary.errors,structuralSchemaPass,structuralSchemaErrors:structural.errors,eventStructuralSchemaPass,eventStructuralSchemaErrors:eventStructural.errors,classification,citation:{pass:evidence?.exactPass===true&&quoteLengthErrors?.length===0,evidence,quoteLengthErrors},semanticPass:'UNREVIEWED_REQUIRES_DIRECT_SEC_SOURCE',primaryQuality:'UNREVIEWED',primaryImportantConditions:'UNREVIEWED',positiveRecall:'UNREVIEWED_EMPTY_IS_NOT_SUCCESS',rawOutputUnmodified:true,adapterApplied:false};
}
