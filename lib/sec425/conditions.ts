export const announcementLabels={new_acquisition_proposal:"New acquisition proposal",revised_acquisition_proposal:"Revised acquisition proposal",definitive_agreement_signed:"Definitive agreement signed"};
export const transactionLabels={acquisition:"Acquisition",merger:"Merger",tender_offer:"Tender offer",exchange_offer:"Exchange offer",spac_business_combination:"SPAC business combination",asset_acquisition:"Asset acquisition"};
export const conditionCatalog=[
 {key:"sec425.announcement_type",label:"425 announcement",type:"text" as const,values:Object.keys(announcementLabels),description:"New current acquisition proposal, revised proposal or signed definitive agreement in an SEC425. Not prior background or completed acquisition."},
 ...Object.entries(transactionLabels).map(([tag,label])=>({key:`sec425.transaction.${tag}`,label:`425 transaction includes ${label.toLowerCase()}`,type:"boolean" as const,values:undefined,description:`Current announced transaction includes ${label}. True only; absence is unknown. Tags may coexist.`})),
 ...["acquirer","target"].map(role=>({key:`sec425.${role}_ticker`,label:`425 ${role} ticker`,type:"text" as const,values:undefined,description:`Explicit user ticker of the ${role}, verified using collected SEC company references. Unknown company names or roles need clarification; do not guess symbols.`})),
];
export const has425=(conditions:readonly {key?:unknown}[])=>conditions.some(c=>typeof c?.key==="string"&&c.key.startsWith("sec425."));
export function conditionErrors(conditions:readonly {key?:unknown;operator?:unknown;value?:unknown}[]){
 if(!has425(conditions))return[];
 return conditions.flatMap(c=>{
  if(!c||typeof c!=="object")return["425_condition_value_unavailable"];
  const def=conditionCatalog.find(d=>d.key===c.key);
  if(!def||c.operator!=="eq")return["425_conditions_cannot_mix_families_or_operators"];
  const valid=def.values?def.values.includes(String(c.value)):def.type==="boolean"?c.value===true:typeof c.value==="string"&&/^[A-Z][A-Z0-9.-]{0,9}$/.test(c.value);
  return valid?[]:["425_condition_value_unavailable"];
 });
}
