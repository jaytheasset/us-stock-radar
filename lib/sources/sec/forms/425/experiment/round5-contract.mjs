// Opt-in standalone experiment. No Primary task, seven-kind event schema or transaction-state framework.
import Ajv from 'ajv';
import {isDeepStrictEqual} from 'node:util';

export const ROUND5_SYSTEM = [
  'Read the supplied cleaned_source_blocks from this SEC filing and return only strict JSON matching the schema. This is a standalone extraction task, not Primary analysis or scoring. Other payload fields, including router_result, are retained input metadata, not authority for a decision, parties, conditions or evidence. Use only the actual block heading/text.',
  'Identify at most ONE newly announced acquisition/merger action of exactly TWO supported kinds: acquisition_proposal_announced = an actual announcement or submission of a new or revised proposal to acquire another entity; definitive_agreement_signed = actual execution/entry into a final definitive acquisition or merger agreement. A revised offer with changed consideration is ONE proposal, with the revised consideration in key_terms, not a second event.',
  'decision=confirmed only when the supplied source clearly supports this current announcement and its kind, parties and target. decision=not_applicable means neither supported announcement is established by these supplied blocks; it never establishes that no event exists in the complete filing, elsewhere, or the whole transaction history. decision=uncertain means a potentially relevant current action is ambiguous, conflicting or missing necessary support. Do not use not_applicable to disguise uncertainty. Give the source-based reason for every decision.',
  'Return announcement=null for not_applicable or uncertain. For confirmed, return one announcement with kind, parties, target, statement and key_terms. If distinct potential transactions or ambiguous parties/targets prevent identifying one supported announcement, return uncertain rather than selecting an arbitrary transaction. Several statements about the SAME announcement can be combined into one record.',
  'The announcement must be newly reported here, not merely a description of a prior agreement, prior offer or historical price revision. A current filing date alone does not make an old agreement new. Do not create announcements from existing merger mechanics, a reference to a proposed merger, board approvals, own-share repurchase programs, a proxy filing or a future shareholder vote. Such facts may be context but are not either supported announcement.',
  'A non-binding proposal can actually have been made. Keep its non-binding nature and major conditions in key_terms. It is not a signed definitive agreement or a completed acquisition. Negotiations, an LOI, an intention to sign or an expected signing are not execution of a final definitive agreement. A signed definitive agreement is not proof that future closing has occurred. Preserve conditions on closing and limited-purpose party participation.',
  'parties contains the source-supported named participants with their relevant involvement; target identifies the entity/securities being acquired or merged, retaining ownership/scope qualifications. statement is a concise explanation of the newly announced action, not a forced literal quotation. key_terms contains source-supported important terms, including stated consideration, non-binding qualifications, material conditions and explicit absence of important conditions. Preserve stated implied values and components; do not calculate, normalize or fill missing values. Keep historical terms out of the current terms unless explicitly explained as historical context.',
  'Root evidence supports the decision and current action (or the stated reason for not_applicable/uncertain). Each key_terms item has its own evidence supporting that term. Cite source_field=heading or text from the exact block_id. Copy short exact contiguous spans, at most 240 characters each, preserving punctuation, whitespace and newlines. Use multiple spans where necessary to support parties, action and qualifiers. Do not reconstruct a paragraph, move a quote to another block/field or rely on a nearby unrelated quote. Missing evidence must remain missing; never invent it to confirm.',
  'Mechanical validation cannot establish semantic correctness. Do not automatically rewrite classifications or quotations. coverage is supplied_current_filing_blocks_only. No alert dispatch, transaction approval, ticker change or product authority is granted by this experiment.',
].join('\n');

function schema(wire){
  const string={type:'string',minLength:1};
  const object=(properties,nullable=false)=>({type:wire?'object':nullable?['object','null']:'object',...(wire?(nullable?{nullable:true}:{}):{additionalProperties:false}),required:Object.keys(properties),properties});
  const proof=object({block_id:string,source_field:{type:'string',enum:['heading','text']},quote:{...string,...(wire?{description:'Copy an exact contiguous span of at most 240 characters from the specified source_field. Preserve whitespace and newlines.'}:{maxLength:240})}});
  const evidence=minItems=>({type:'array',minItems,items:proof});
  return object({
    coverage:{type:'string',enum:['supplied_current_filing_blocks_only']},
    decision:{type:'string',enum:['confirmed','not_applicable','uncertain']},
    reason:string,
    announcement:object({
      kind:{type:'string',enum:['acquisition_proposal_announced','definitive_agreement_signed']},
      parties:{type:'array',minItems:1,items:string},
      target:string,
      statement:string,
      key_terms:{type:'array',items:object({term:string,evidence:evidence(1)})},
    },true),
    evidence:evidence(0),
  });
}
export const round5LocalSchema=schema(false);
export const round5WireSchema=schema(true);

export function buildRound5Standalone(oldPrompt,oldRequest){
  if(oldRequest.systemInstruction.parts.length!==1||oldRequest.contents.length!==1||oldRequest.contents[0].parts.length!==1||oldRequest.systemInstruction.parts[0].text!==oldPrompt.system||oldRequest.contents[0].parts[0].text!==oldPrompt.user)throw Error('prior_actual_payload_mismatch');
  const prompt={key:'sec425_two_announcements_experiment_v5',version:'v1',system:ROUND5_SYSTEM,user:oldPrompt.user,responseFormat:{type:'json_schema',json_schema:{name:'sec425_two_announcements_experiment_v5',strict:true,schema:structuredClone(round5LocalSchema)}}};
  const request=structuredClone(oldRequest);
  request.systemInstruction.parts[0].text=prompt.system;
  request.generationConfig.responseSchema=structuredClone(round5WireSchema);
  return {prompt,request,audit:auditRound5Diff(oldPrompt,oldRequest,prompt,request)};
}
export function auditRound5Diff(oldPrompt,oldRequest,prompt,request){
  const restored=structuredClone(request);
  restored.systemInstruction=oldRequest.systemInstruction;
  restored.generationConfig.responseSchema=oldRequest.generationConfig.responseSchema;
  if(!isDeepStrictEqual(restored,oldRequest)||prompt.user!==oldPrompt.user||prompt.system!==ROUND5_SYSTEM||request.systemInstruction.parts[0].text!==ROUND5_SYSTEM||!isDeepStrictEqual(prompt.responseFormat.json_schema.schema,round5LocalSchema)||!isDeepStrictEqual(request.generationConfig.responseSchema,round5WireSchema))throw Error('change_outside_standalone_task');
  return {userContentsByteIdentical:true,metadataAndRouterIdentical:true,generationSettingsIdentical:true,allowedWireChanges:['systemInstruction.parts[0].text','generationConfig.responseSchema'],standaloneTwoKindsOnly:true,noPrimaryOutput:true,noSevenKindSchema:true,noNewExtractionStage:true};
}

export function validateRound5Output(parsed,blocks){
  const ajv=new Ajv({strict:false,allErrors:true});
  const full=ajv.compile(round5LocalSchema),schemaPass=full(parsed),schemaErrors=structuredClone(full.errors);
  const diagnostic=structuredClone(round5LocalSchema);
  delete diagnostic.properties.evidence.items.properties.quote.maxLength;
  delete diagnostic.properties.announcement.properties.key_terms.items.properties.evidence.items.properties.quote.maxLength;
  const structural=ajv.compile(diagnostic),structuralSchemaPass=structural(parsed);
  const consistencyErrors=[],proofs=[];
  if(structuralSchemaPass){
    if(parsed.decision==='confirmed'&&parsed.announcement===null)consistencyErrors.push('confirmed_announcement_missing');
    if(parsed.decision!=='confirmed'&&parsed.announcement!==null)consistencyErrors.push('nonconfirmed_announcement_must_be_null');
    if(parsed.decision==='confirmed'&&parsed.evidence.length===0)consistencyErrors.push('confirmed_action_evidence_missing');
    const groups=[{location:'decision',evidence:parsed.evidence},...(parsed.announcement?.key_terms??[]).map((term,index)=>({location:`key_terms/${index}`,evidence:term.evidence}))];
    const normalize=s=>s.replace(/\s+/g,' ').trim();
    for(const group of groups)for(const [index,p]of group.evidence.entries()){
      const block=blocks.find(b=>b.block_id===p.block_id),field=block?.[p.source_field];
      const exact=typeof field==='string'&&field.includes(p.quote);
      proofs.push({location:group.location,index,...p,exact,missingBlock:!block,quoteLength:[...p.quote].length,lengthPass:[...p.quote].length<=240,diagnosticWhitespaceOnlyMatch:!exact&&typeof field==='string'&&normalize(field).includes(normalize(p.quote))});
    }
  }
  const confirmationShapePass=structuralSchemaPass&&consistencyErrors.length===0,citationPass=structuralSchemaPass&&proofs.every(p=>p.exact&&p.lengthPass);
  return {ok:schemaPass&&confirmationShapePass&&citationPass,schemaPass,schemaErrors,structuralSchemaPass,structuralSchemaErrors:structural.errors,confirmationShapePass,consistencyErrors,citation:{pass:citationPass,proofs},semanticAccuracy:'UNREVIEWED_REQUIRES_DIRECT_SEC_SOURCE',notApplicableIsNotWholeFilingAbsence:true,uncertainIsNotConfirmedCandidate:true,rawOutputUnmodified:true,correctionApplied:false,productAuthority:'none'};
}
