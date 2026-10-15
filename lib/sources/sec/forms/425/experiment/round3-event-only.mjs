import Ajv from 'ajv';
const marker='Opt-in experiment extension:';

/** Remove the Primary task, keeping the exact event contract and user bytes. */
export function buildEventOnly(round2Prompt,round2Request){
 if(round2Request.systemInstruction.parts.length!==1||round2Request.contents.length!==1||round2Request.contents[0].parts.length!==1||round2Request.systemInstruction.parts[0].text!==round2Prompt.system||round2Request.contents[0].parts[0].text!==round2Prompt.user)throw Error('round2_actual_payload_mismatch');
 const lines=round2Prompt.system.split('\n'),start=lines.findIndex(s=>s.startsWith(marker));
 if(start<0)throw Error('event_instruction_boundary_missing');
 const diff=lines.slice(0,start).map((before,index)=>({index,before,after:null,reason:'remove_original_Primary_task'}));
 const kept=[];
 for(const [offset,before]of lines.slice(start).entries()){
  let after=before,reason='unchanged_event_instruction';
  if(before.startsWith(marker)){
   after='Return only strict JSON containing filing_events, matching the supplied schema.';reason='event_only_root';
  }else if(before.startsWith('Keep all existing Primary instructions,')){
   after='This area is independently source-grounded; do not derive it from router event_type/routing_reason, parser facts or candidates. Read the actual cleaned_source_blocks directly.';reason='remove_Primary_writing_and_BOTH_reference';
  }else if(before.startsWith('The seven filing_events kinds are independent of Primary event_type.')){
   after=before.replace('The seven filing_events kinds are independent of Primary event_type.','The seven filing_events kinds are defined by the supplied schema.');reason='remove_Primary_event_type_reference';
  }else if(before.startsWith('Round 2: events contains occurred actions only.')){
   after=before.replace('Round 2: ','').replace('in BOTH the Primary analysis and event statements','in event statements');reason='remove_Primary_qualifier_output_target_only';
  }else if(before.startsWith('The existing Primary generic-display rule still applies:')){
   after=null;reason='remove_Primary_snapshot_and_score_output_requirements';
  }
  if(after!==null)kept.push(after);diff.push({index:start+offset,before,after,reason});
 }
 if(kept.some(s=>/Primary|BOTH/.test(s)))throw Error('unexpected_remaining_Primary_instruction');
 const local={type:'object',additionalProperties:false,required:['filing_events'],properties:{filing_events:structuredClone(round2Prompt.responseFormat.json_schema.schema.properties.filing_events)}};
 const provider={type:'object',required:['filing_events'],properties:{filing_events:structuredClone(round2Request.generationConfig.responseSchema.properties.filing_events)}};
 const prompt={key:'sec425_events_only_experiment_v3',version:'v1',system:kept.join('\n'),user:round2Prompt.user,responseFormat:{type:'json_schema',json_schema:{name:'sec425_events_only_experiment_v3',strict:true,schema:local}}};
 const request=structuredClone(round2Request);request.systemInstruction.parts[0].text=prompt.system;request.generationConfig.responseSchema=provider;
 return {prompt,request,instructionDiff:diff};
}

export function auditEmptyEventContract(local,provider){
 const empty={filing_events:{coverage:'supplied_current_filing_blocks_only',empty_events_meaning:'not_a_finding_of_no_event',events:[],unresolved:[]}};
 const ajv=new Ajv({strict:false,allErrors:true}),localCheck=ajv.compile(local),providerCheck=ajv.compile(provider);
 const result={localEmptyPass:localCheck(empty),localErrors:localCheck.errors,actualProviderSchemaEmptyPass:providerCheck(empty),providerErrors:providerCheck.errors,arrays:['events','unresolved'].map(name=>({name,localMinItems:local.properties.filing_events.properties[name].minItems??null,providerMinItems:provider.properties.filing_events.properties[name].minItems??null,requiredFieldsApplyToExistingItemOnly:true})),evidenceMinItemsAppliesOnlyToExistingEventOrUnresolvedItem:true};
 if(!result.localEmptyPass||!result.actualProviderSchemaEmptyPass||result.arrays.some(a=>(a.localMinItems??0)>0||(a.providerMinItems??0)>0))throw Error('empty_output_contract_conflict');
 return result;
}
