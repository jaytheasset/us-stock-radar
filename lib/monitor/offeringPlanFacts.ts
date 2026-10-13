import {z} from 'zod';
import type {Offering,Component,Source} from '../sec-offering-plan/contract.ts';
import {directDecimal,decimalAtLeast,offeringPlanConditionErrors,LEGACY_OFFERING_QUANTITY_KEY,OFFERING_PLAN_KEYS,type PlanCondition} from './offeringPlanConditions.ts';

const uuid=z.string().uuid(), hash=z.string().regex(/^[a-f0-9]{64}$/), decimal=z.string().max(80).refine(directDecimal);
const condition=z.object({key:z.string(),operator:z.enum(['eq','gte']),value:z.string().max(100)}).strict();
const ref=z.object({blockId:z.string().min(1).max(200),sha256:hash,url:z.string().refine(secUrl),lineStart:z.number().int().positive(),lineEnd:z.number().int().positive()}).strict();
const component=z.object({id:z.string().min(1).max(200),seller:z.enum(['issuer','selling_shareholders']),security:z.enum(['common_stock','ordinary_shares','ads']),label:z.string().min(1).max(2000),quantity:decimal,unit:z.string().min(1).max(100),scenario:z.string().min(1).max(2000).nullable(),references:z.array(ref).min(1).max(100)}).strict();
export const offeringPlanEvidenceSchema=z.object({version:z.literal('offering_plan_match_v1'),meaning:z.enum(['stated_current_plan_component_not_execution','stated_plan_component_not_execution']),runId:uuid,rawId:uuid,eventId:uuid,accession:z.string().regex(/^\d{10}-\d{2}-\d{6}$/),sourceFingerprint:hash,outputHash:hash,contractVersion:z.string().min(1).max(100),filedAt:z.string().min(10).max(40).refine(v=>Number.isFinite(Date.parse(v))),decisionId:uuid.nullable(),candidateIndex:z.number().int().nonnegative().nullable(),conditions:z.array(condition).length(4),component}).strict().superRefine((v,ctx)=>{
 const historical=v.meaning==='stated_current_plan_component_not_execution';
 // Legacy readback validation only. Never used to select a new component.
 if(historical&&v.component.scenario!==null&&/\b(if|assuming|exercise|conversion|option|conditional|up to)\b/i.test(v.component.scenario))ctx.addIssue({code:'custom',message:'Invalid legacy evidence'});
 if(!v.conditions.some(c=>c.key===(historical?LEGACY_OFFERING_QUANTITY_KEY:OFFERING_PLAN_KEYS[0])))ctx.addIssue({code:'custom',message:'Meaning and condition key differ'});
 if((v.decisionId===null)!==(v.candidateIndex===null)||offeringPlanConditionErrors(v.conditions,historical).length||!componentMatches(v.component,v.conditions,historical))ctx.addIssue({code:'custom',message:'Invalid match scope'});
});
export type OfferingPlanEvidence=z.infer<typeof offeringPlanEvidenceSchema>;
export type PlanComponent=OfferingPlanEvidence['component'];
export type OfferingPlanFacts={status:'not_ready';reason:string}|{status:'available';eventId:string;sourceExecutionId:string;persistedAt:string;filedAt:string;identity:Omit<OfferingPlanEvidence,'conditions'|'component'>;components:PlanComponent[]};
export function secUrl(value:string){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='www.sec.gov'&&u.pathname.startsWith('/Archives/edgar/data/')&&!u.username&&!u.password;}catch{return false;}}
function componentMatches(c:PlanComponent,conditions:readonly PlanCondition[],historical=false){
 const v=Object.fromEntries(conditions.map(c=>[c.key,c.value]));
 return !offeringPlanConditionErrors(conditions,historical).length&&c.seller===v['offering_plan.seller_type']&&c.security===v['offering_plan.security_type']&&c.unit===v['offering_plan.quantity_unit']&&decimalAtLeast(c.quantity,String(v[historical?LEGACY_OFFERING_QUANTITY_KEY:OFFERING_PLAN_KEYS[0]]));
}
export function matchOfferingPlan(facts:OfferingPlanFacts|undefined,conditions:readonly PlanCondition[]){
 if(offeringPlanConditionErrors(conditions).length||facts?.status!=='available')return 'ineligible' as const;
 if(!facts.components.length)return 'ineligible' as const;
 return facts.components.some(c=>componentMatches(c,conditions))?'match' as const:'no_match' as const;
}
export function offeringPlanEvidence(facts:OfferingPlanFacts|undefined,conditions:readonly PlanCondition[]):OfferingPlanEvidence|null{
 if(facts?.status!=='available'||facts.identity.meaning!=='stated_plan_component_not_execution')return null;
 const c=facts.components.find(c=>componentMatches(c,conditions));
 const parsed=offeringPlanEvidenceSchema.safeParse({...facts.identity,conditions,component:c});return parsed.success?parsed.data:null;
}
/** Project verified typed fields. Source prose is evidence, never a second extractor.
 * Linked option/ATM components remain outside this condition's scope. */
export function eligibleComponent(c:Component,plan:Offering['plan'],source:Source):PlanComponent|null{
 if(c.quantity.status!=='stated'||!directDecimal(c.quantity.value)
  ||!['issuer','selling_shareholders'].includes(c.seller_type)||!['common_stock','ordinary_shares','ads'].includes(c.security_type)
  ||plan.over_allotment.some(o=>o.component_ids.includes(c.id))||(plan.atm_terms??[]).some(a=>a.component_ids.includes(c.id)))return null;
 const blocks=c.evidence_blocks.map(id=>source.blocks.find(b=>b.id===id));if(blocks.some(b=>!b))return null;
 const references=blocks.map(b=>{const d=source.documents.find(d=>d.id===b!.document_id)!;return {blockId:b!.id,sha256:b!.sha256,url:d.url,lineStart:b!.line_start,lineEnd:b!.line_end};});
 const parsed=component.safeParse({id:c.id,seller:c.seller_type,security:c.security_type,label:c.security_label,quantity:c.quantity.value,unit:c.quantity.unit,scenario:c.scenario,references});return parsed.success?parsed.data:null;
}
/** Allowlisted user projection: never serialize the stored administrative selection identifiers. */
export function publicOfferingPlanEvidence(value:unknown){const p=offeringPlanEvidenceSchema.safeParse(value);if(!p.success)return null;const {decisionId,candidateIndex,sourceFingerprint,outputHash,...safe}=p.data;return safe;}
