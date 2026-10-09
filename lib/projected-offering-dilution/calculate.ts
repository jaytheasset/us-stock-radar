import type { Snapshot, OsRecord } from '../sec-os-snapshot/contract.ts';
import type { Offering, Plan, Component } from '../sec-offering-plan/contract.ts';
import {isCombinedForm} from '../sec-combined-offering/eligibility.ts';

export const VERSION = 'projected_offering_dilution_v1' as const;
export const CALCULATION_REVISION = 'projected_offering_dilution_v1-calc-r2' as const;
export type Decision = { id: string; action: string; candidate_indexes: number[] };
export type Published<T> = { runId: string; value: T; fingerprint: string; currentFingerprint: string; decision?: Decision };
export type Fact = {
  version: typeof VERSION; calculation_contract_version?: string; accession: string; os_run_id: string; offering_run_id: string;
  ineligible_numeric_fields?: string[];
  pre_offering_os: OsRecord[]; issuer_new_shares_base: number|null; issuer_new_shares_full_overallotment: number|null;
  resale_shares: number|null; resale_components: {quantity:string|null;unit:string;security_label:string}[];
  potential_warrant_shares: number|null; has_warrants: boolean; has_prefunded_warrants: boolean;
  calculated_post_os_base: number|null; calculated_post_os_full_overallotment: number|null;
  projected_increase_percent_base: number|null; projected_increase_percent_full_overallotment: number|null;
  direct_post_offering_os: Plan['post_offering_os']; calculation_status: 'CALCULATED'|'RESALE_ONLY'|'PARTIAL'|'UNAVAILABLE'|'CONFLICT';
  unavailable_reason: string[]; share_class: string|null; resale_only: boolean; calculation_issue: boolean;
  provenance: {os_fingerprint:string;offering_fingerprint:string;os_decision_id:string|null;offering_decision_id:string|null;evidence_blocks:string[]};
};
export function publicSelection<T extends Snapshot|Offering>(input:Published<T>): OsRecord[]|Plan|null {
  const v=input.value;
  if (!input.fingerprint || input.fingerprint!==input.currentFingerprint || ['hold','reject'].includes(input.decision?.action??'')) return null;
  if(v.status==='PASS') return 'current_os' in v?v.current_os:v.plan;
  if(v.status!=='REVIEW_REQUIRED'||input.decision?.action!=='approve')return null;
  const candidates=v.review?.candidates??[], indexes=input.decision.candidate_indexes;
  if(!indexes.length||new Set(indexes).size!==indexes.length||indexes.some(i=>!Number.isInteger(i)||i<0||i>=candidates.length))return null;
  if('current_os' in v)return indexes.map(i=>candidates[i]) as OsRecord[];
  return indexes.length===1?candidates[indexes[0]] as Plan:null;
}
const number=(v:string|null|undefined):number|null=>v!=null&&/^\d+(?:\.\d+)?$/.test(v)&&Number.isFinite(Number(v))&&Number(v)<=Number.MAX_SAFE_INTEGER?Number(v):null;
const sum=(values:(number|null)[])=>values.some(v=>v===null)?null:safe(values.reduce<number>((a,b)=>a+b!,0));
const safe=(n:number)=>Number.isSafeInteger(n)&&n>=0?n:null;
const shares=new Set(['ordinary_shares','common_stock','ads']);
const warrants=new Set(['warrants','prefunded_warrants']);
/** Negative evidence only: never derive quantities or relationships from prose. */
function nonImmediate(c:Component){return /underlying|upon exercise|registered for issuance|fee.table|authorized|previously issued|historical/i.test(`${c.security_label} ${c.scenario??''}`);}
function quantity(c:Component):number|null {
  const n=c.quantity.status==='stated'?number(c.quantity.value):null;
  if(n===null)return null;
  if(c.security_type==='ads'){
    const ratio=number(c.depositary?.underlying_shares_per_security);
    return ratio!==null&&ratio>0&&c.depositary?.underlying_share_class&&c.depositary.evidence_blocks.length?safe(n*ratio):null;
  }
  return shares.has(c.security_type)?safe(n):null;
}
const shareClass=(c:Component)=>c.security_type==='ads'?c.depositary?.underlying_share_class??null:c.security_label;

/** Separate deterministic planning fact. Never mutates, fills, repairs or canonicalizes either extraction. */
export function calculate(os:Published<Snapshot>, offering:Published<Offering>):Fact|null {
  if(os.value.version!=='os_snapshot_v1'||offering.value.version!=='offering_plan_v1'
    ||os.value.filing.accession!==offering.value.filing.accession||os.value.filing.cik!==offering.value.filing.cik
    ||os.value.filing.form!==offering.value.filing.form||(!['F-1','F-1/A'].includes(os.value.filing.form)&&!isCombinedForm(os.value.filing.form)))return null;
  const pre=publicSelection(os) as OsRecord[]|null,plan=publicSelection(offering) as Plan|null;
  if(!pre?.length||!plan)return null;
  const reasons:string[]=[];
  const issuer=plan.components.filter(c=>c.seller_type==='issuer');
  const resale=plan.components.filter(c=>c.seller_type==='selling_shareholders');
  const immediate=issuer.filter(c=>shares.has(c.security_type)&&!nonImmediate(c));
  const warrant=issuer.filter(c=>warrants.has(c.security_type));
  const uncertainSeller=plan.components.some(c=>!['issuer','selling_shareholders'].includes(c.seller_type));
  const uncertainType=issuer.some(c=>!shares.has(c.security_type)&&!warrants.has(c.security_type));
  const resaleOnly=plan.components.length>0&&resale.length===plan.components.length&&resale.every(c=>shares.has(c.security_type)&&!nonImmediate(c));
  const warrantOnly=issuer.length>0&&issuer.every(c=>warrants.has(c.security_type));
  let base=resaleOnly||warrantOnly&&!uncertainSeller?0:immediate.length&&!uncertainSeller&&!uncertainType?sum(immediate.map(quantity)):null;
  if(base===null)reasons.push('issuer_quantity_or_role_unavailable');
  // Distinct exact labels remain distinct classes. No case folding, suffix stripping or fuzzy match.
  const classes=[...new Set(immediate.map(shareClass))];
  if(classes.length>1||classes.includes(null)){base=null;reasons.push('share_classes_not_comparable');}
  const cls=classes.length===1?classes[0]:null;
  const over=plan.over_allotment.filter(o=>o.seller_type==='issuer');
  const unknownOver=plan.over_allotment.some(o=>!['issuer','selling_shareholders'].includes(o.seller_type));
  const seen=new Set<string>();
  const additional=sum(over.map(o=>{
    if(o.component_ids.length!==1||seen.has(o.component_ids[0]))return null;
    seen.add(o.component_ids[0]);const c=immediate.find(c=>c.id===o.component_ids[0]);
    if(!c||o.security_label!==c.security_label||o.quantity.unit!==c.quantity.unit)return null;
    return quantity({...c,quantity:o.quantity});
  }));
  const full=base!==null&&additional!==null&&!unknownOver?safe(base+additional):null;
  if(full===null)reasons.push('overallotment_unavailable');
  const resaleClasses=[...new Set(resale.map(shareClass))];
  const resaleCount=resaleClasses.length<=1&&!resaleClasses.includes(null)&&resale.every(c=>shares.has(c.security_type)&&!nonImmediate(c))?sum(resale.map(quantity)):null;
  // Frozen v1 has no typed warrant-to-underlying component relationship. Never guess from labels or prose.
  const potential=warrant.length?null:0;
  if(warrant.length)reasons.push('warrant_underlying_relationship_unavailable');
  if(warrant.some(c=>c.security_type==='prefunded_warrants'))reasons.push('base_assumes_no_prefunded_substitution');
  const matched=pre.filter(p=>p.share_class!==null&&p.share_class===cls);
  const baseline=matched.length===1?number(matched[0].quantity):null;
  // Resale cannot increase any class; retain one directly stated baseline without inventing a class total.
  const denominator=resaleOnly&&pre.length===1?number(pre[0].quantity):baseline;
  if(denominator===null||denominator<=0)reasons.push('exact_os_class_or_baseline_unavailable');
  const post=(increment:number|null)=>denominator!==null&&increment!==null?safe(denominator+increment):null;
  const percent=(increment:number|null)=>denominator!==null&&denominator>0&&increment!==null?increment/denominator*100:null;
  const postBase=post(base),postFull=post(full);
  // Only exact scenario names are comparable. Never interpret free prose as base/full.
  // null is retained for historical unqualified records; current extraction schema requires text.
  const direct=plan.post_offering_os.filter(d=>d.security_label===cls&&
    (d.unit==='shares'||immediate.some(c=>c.security_type!=='ads'&&c.quantity.unit===d.unit)));
  const baseConflict=postBase!==null&&direct.some(d=>(d.scenario===null||d.scenario==='base')&&number(d.quantity)!==postBase);
  const fullConflict=postFull!==null&&direct.some(d=>d.scenario==='full_overallotment'&&number(d.quantity)!==postFull);
  const conflict=baseConflict||fullConflict;
  const ineligible=[...(baseConflict?['calculated_post_os_base','projected_increase_percent_base']:[]),
    ...(fullConflict?['calculated_post_os_full_overallotment','projected_increase_percent_full_overallotment']:[])];
  if(conflict)reasons.push('direct_post_os_conflict');
  if(plan.post_offering_os.some(d=>d.scenario!==null&&!['base','full_overallotment'].includes(d.scenario)))reasons.push('direct_post_scenario_not_comparable');
  const status=conflict?'CONFLICT':resaleOnly?'RESALE_ONLY':base===null?'UNAVAILABLE':reasons.length?'PARTIAL':'CALCULATED';
  return {version:VERSION,calculation_contract_version:CALCULATION_REVISION,ineligible_numeric_fields:ineligible,
    accession:os.value.filing.accession,os_run_id:os.runId,offering_run_id:offering.runId,
    pre_offering_os:structuredClone(pre),issuer_new_shares_base:base,issuer_new_shares_full_overallotment:full,
    resale_shares:resaleCount,resale_components:resale.map(c=>({quantity:c.quantity.value,unit:c.quantity.unit,security_label:c.security_label})),
    potential_warrant_shares:potential,has_warrants:warrant.some(c=>c.security_type==='warrants'),has_prefunded_warrants:warrant.some(c=>c.security_type==='prefunded_warrants'),
    calculated_post_os_base:postBase,calculated_post_os_full_overallotment:postFull,
    projected_increase_percent_base:percent(base),projected_increase_percent_full_overallotment:percent(full),
    direct_post_offering_os:structuredClone(plan.post_offering_os),calculation_status:status,unavailable_reason:reasons,
    share_class:cls,resale_only:resaleOnly,calculation_issue:reasons.length>0,
    provenance:{os_fingerprint:os.fingerprint,offering_fingerprint:offering.fingerprint,os_decision_id:os.decision?.id??null,offering_decision_id:offering.decision?.id??null,
      evidence_blocks:[...new Set([...pre.flatMap(p=>p.evidence_blocks),...plan.components.flatMap(c=>[...c.evidence_blocks,...c.depositary?.evidence_blocks??[]]),...plan.over_allotment.flatMap(o=>o.evidence_blocks),...plan.post_offering_os.flatMap(d=>d.evidence_blocks)])]}};
}
