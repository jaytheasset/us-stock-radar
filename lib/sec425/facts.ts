import Ajv from "ajv";
import {sec425OfficialCompanies,sec425SourceCompanies} from "../sources/sec/forms/425/verification.ts";
import {findSourceBackedSecTradingPairs} from "../sources/sec/sourceTickerSelection.ts";
import {buildSec425FactInput} from "../ai/sec425FactInput.ts";
import type {SecFilingAnalysisInput} from "../prompts/secFilingAnalysis.ts";
import {announcementLabels,transactionLabels} from "./conditions.ts";
export const VERSION="sec425_facts_v1";
export type Block={block_id:string;heading?:string|null;text:string};
export type Sec425Proof={block_id:string;source_field:"text"|"heading";quote:string};
export type Output={decision:"confirmed"|"not_applicable"|"uncertain";reason:string;context:"current_announcement"|"prior_background"|"unclear";evidence:Sec425Proof[];announcement:null|{announcement_type:keyof typeof announcementLabels|null;transaction_types:(keyof typeof transactionLabels)[]|null;statement:string|null;parties:{name:string|null;role:"acquirer"|"target"|"merger_sub"|"adviser"|"partner"|"other"|null;company_ref:string|null;evidence:Sec425Proof[]}[];key_terms:{value:string|null;evidence:Sec425Proof[]}[]}};
const obj=(properties:Record<string,unknown>)=>({type:"object",additionalProperties:false,required:Object.keys(properties),properties});
const str={type:"string",minLength:1},nullable=(values?:string[])=>({type:["string","null"],...(values?{enum:[...values,null]}:{minLength:1})});
const proof=obj({block_id:str,source_field:{type:"string",enum:["text","heading"]},quote:str}),proofs={type:"array",items:proof};
export const FACT_SCHEMA=obj({decision:{type:"string",enum:["confirmed","not_applicable","uncertain"]},reason:str,context:{type:"string",enum:["current_announcement","prior_background","unclear"]},evidence:proofs,
 announcement:{...obj({announcement_type:nullable(Object.keys(announcementLabels)),transaction_types:{type:["array","null"],items:{type:"string",enum:Object.keys(transactionLabels)}},statement:nullable(),
 parties:{type:"array",items:obj({name:nullable(),role:nullable(["acquirer","target","merger_sub","adviser","partner","other"]),company_ref:nullable(),evidence:proofs})},key_terms:{type:"array",items:obj({value:nullable(),evidence:proofs})}}),type:["object","null"]}});
const validate=new Ajv({strict:false,allErrors:true}).compile(FACT_SCHEMA);
const norm=(s:string)=>s.replace(/\s+/g," ").trim();
const nameKey=(s:string)=>norm(s).toUpperCase().replace(/[.,]/g,"");

/** Comparison-only whitespace mapping. Coordinates always refer to the exact supplied field. */
export function locateProof(p:Sec425Proof,blocks:readonly Block[]) {
 const matches=blocks.filter(b=>b.block_id===p?.block_id);
 if(matches.length!==1||!["text","heading"].includes(p?.source_field)||typeof p?.quote!=="string"||!p.quote.trim())return null;
 const field=matches[0][p.source_field];if(typeof field!=="string")return null;
 let compact="";const starts:number[]=[],ends:number[]=[];
 for(let i=0;i<field.length;){const start=i;let c=field[i++];if(/\s/.test(c)){while(i<field.length&&/\s/.test(field[i]))i++;c=" ";}compact+=c;starts.push(start);ends.push(i);}
 const q=norm(p.quote),at=compact.indexOf(q);if(at<0||compact.indexOf(q,at+1)>=0)return null;
 const start=starts[at],end=ends[at+q.length-1];
 return{blockId:p.block_id,sourceField:p.source_field,start,end,sourceQuote:field.slice(start,end),modelQuote:p.quote,comparison:field.slice(start,end)===p.quote?"exact" as const:"whitespace_equivalent" as const};
}

/** Official index role/CIK + catalog + exact original source trading pair, not a name-only alias. */
export function companyReferences(input:SecFilingAnalysisInput) {
 const filing=input.filing_package as Record<string,any>,parser=filing.hard_parsers["425"],blocks=parser.raw.cleaned_source_blocks as Block[];
 const indexed=sec425OfficialCompanies(filing).flatMap(c=>{
  if(c.status!=="identified")return[];
  const sourceName=c.filingRole==="filed_by"?parser.facts.filed_by:parser.facts.subject_company;
  const label=c.filingRole==="filed_by"?"Filed by":"Subject Company";
  const labeled=typeof sourceName==="string"&&blocks.some(b=>norm([b.heading,b.text].filter(Boolean).join(" ")).includes(`${label}: ${sourceName}`));
  if(!labeled)return[];
  return c.listings.flatMap(row=>{
   // Name is taken from that explicit filing-role header, not from a model guess.
   const pairs=findSourceBackedSecTradingPairs(blocks,[{...row,name:sourceName}]).filter(p=>p.status==="corroborated");
   if(!pairs.length)return[];
   return[{ref:`cik:${c.cik}:${row.ticker}`,cik:c.cik,ticker:row.ticker,exchange:row.exchange,companyName:row.name,sourceName,
    filingRole:c.filingRole,indexSha256:c.indexSha256,catalogSource:c.catalogSource,evidence:pairs.map(p=>p.evidence),historicalTickerVerified:false}];
  });
 });
 const source=sec425SourceCompanies(filing,blocks).flatMap(c=>c.status==="corroborated"?[{ref:`cik:${c.cik}:${c.ticker}`,cik:c.cik,ticker:c.ticker,exchange:c.exchange,companyName:c.companyName,sourceName:c.companyName??"",filingRole:null,indexSha256:null,catalogSource:c.catalogSource,evidence:[c.evidence],historicalTickerVerified:false}]:[]);
 const refs=new Map<string,(typeof indexed)[number]|(typeof source)[number]>();for(const r of [...source,...indexed])refs.set(r.ref,r);return [...refs.values()];
}
export function buildFactPrompt(input:SecFilingAnalysisInput) {
 const prior=buildSec425FactInput(input),user=JSON.parse(prior.user);
 return{key:VERSION,version:VERSION,system:[
 "Extract only the current acquisition/merger announcement in these SEC425 source blocks. Return the JSON schema. This FACT extraction is independent of Primary, Router, investment score and summaries.",
 "One filing yields at most one current announcement: new_acquisition_proposal, revised_acquisition_proposal or definitive_agreement_signed. Revised consideration belongs to the same revised proposal. For no supported announcement return not_applicable with announcement null; this does not prove absence beyond supplied source. For ambiguity return uncertain. Never pick arbitrarily among distinct transactions.",
 "context records whether that action is newly announced here, prior background or unclear. Determine this from actual action/context, not comparison of filing and action dates. A submitted non-binding proposal is an actual proposal; it is not a signed definitive agreement or completed acquisition. Prior agreements, meeting/vote/proxy filing, board approval or own-share buybacks do not establish a new announcement of these types.",
 "Transaction tags are non-exclusive and separate from announcement type. Preserve source-supported acquisition, merger, tender/exchange offer or SPAC types; unknown remains null. Do not infer SPAC from Form425.",
 "For each relevant party keep the source name and action role separately from FILED BY/SUBJECT filing roles. company_ref must be an exact supplied official_company_references.ref with that party's original source trading-pair proof. Do not invent CIK/ticker or copy the filer to other parties. Unresolved parties keep company_ref null. Other official source-confirmed parties are not limited to filing roles.",
 "statement briefly explains the action. key_terms records concise substantive consideration and important qualifications such as non-binding status, valuation basis or conditions when stated. Do not compute prices, turn proposed dates into completion, strip a material alternative/ownership exclusion or fill missing values. Avoid copying full legal paragraphs or enumerating every procedural detail.",
 "Use concise contiguous original spans in evidence for action, each party and each key term. Exact block_id and source_field must be supplied. Line wrapping may differ but punctuation/wording/block/field must not be changed. Multiple short quotes may be used. Missing support stays null/uncertain; source linkage does not itself prove semantic accuracy. No publication, ticker-change or Alert authority is granted by this model."
 ].join("\n"),
 user:JSON.stringify({...user,official_company_references:companyReferences(input)}),
 responseFormat:{type:"json_schema",json_schema:{name:VERSION,strict:true,schema:FACT_SCHEMA}}};
}
export function assessFacts(value:unknown,input:SecFilingAnalysisInput) {
 const before=JSON.stringify(value),schemaPass=validate(value),schemaErrors=structuredClone(validate.errors);
 if(!schemaPass)return{status:"invalid" as const,schemaErrors,rawOutput:value,announcement:null,reasons:["invalid_json_structure"]};
 const output=value as Output,filing=input.filing_package as Record<string,any>,blocks=filing.hard_parsers["425"].raw.cleaned_source_blocks as Block[];
 const diagnostics:{proof:Sec425Proof;status:string}[]=[];
 const locate=(proofs:readonly Sec425Proof[]|undefined)=>(proofs??[]).map(p=>{const located=locateProof(p,blocks);diagnostics.push({proof:p,status:located?located.comparison:"unresolved_original_field"});return located;}).filter((p):p is NonNullable<typeof p>=>p!==null);
 const rootEvidence=locate(output.evidence),context=output.context;
 const current=output.decision==="confirmed"&&context==="current_announcement";
 const references=companyReferences(input),announcement=output.announcement;
 const parties=announcement?.parties.map(p=>{
  const evidence=locate(p.evidence),refs=references.filter(r=>r.ref===p.company_ref),ref=refs.length===1?refs[0]:null;
  const linked=ref&&[ref.sourceName,ref.companyName].some(n=>typeof n==="string"&&nameKey(n)===nameKey(p.name??""))
   &&evidence.some(e=>ref.evidence.some(proof=>proof.block_id===e.blockId&&proof.source_field===e.sourceField&&norm(e.sourceQuote).includes(norm(proof.quote))));
  const conflict=!!ref&&!linked;
  return{claim:p,identity:linked&&!conflict?ref:null,evidence,status:conflict?"conflict":linked?"corroborated":"unresolved"};
 })??[];
 const terms=announcement?.key_terms.map(t=>({claim:t.value,evidence:locate(t.evidence),available:t.value!==null&&locate(t.evidence).length>0}))??[];
 assertUnchanged();
 return{status:current&&rootEvidence.length&&announcement?.announcement_type&&announcement.statement?"available" as const:"not_ready" as const,
  schemaErrors,rawOutput:output,reasons:current?[]:[output.decision==="not_applicable"?"no_supported_current_announcement_in_supplied_source":"current_announcement_unconfirmed"],
  announcement:announcement?{type:announcement.announcement_type,transactionTypes:announcement.transaction_types,statement:announcement.statement,parties,terms,evidence:rootEvidence}:null,
  currentness:{claim:context,sourceLinked:current&&rootEvidence.length>0},proofDiagnostics:diagnostics,semanticAccuracy:"model_claim_not_independently_proven" as const};
 function assertUnchanged(){if(JSON.stringify(value)!==before)throw Error("sec425_output_mutated");}
}
