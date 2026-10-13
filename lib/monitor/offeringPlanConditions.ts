/** Direct, literal component comparison. No security conversion or totals. */
export const LEGACY_OFFERING_QUANTITY_KEY = 'offering_plan.component_quantity';
export const OFFERING_PLAN_KEYS = ['offering_plan.stated_component_quantity', 'offering_plan.seller_type', 'offering_plan.security_type', 'offering_plan.quantity_unit'] as const;
export type PlanCondition = {key:string;operator:string;value:unknown};
export const hasOfferingPlan = (conditions:readonly PlanCondition[]) => Array.isArray(conditions) && conditions.some(c=>c && typeof c.key==='string' && c.key.startsWith('offering_plan.'));
export const directDecimal = (v:unknown):v is string => typeof v==='string' && v.length<=80 && /^(0|[1-9]\d*)(\.\d+)?$/.test(v);
export function offeringPlanConditionErrors(conditions:readonly PlanCondition[],historical=false):string[]{
 if(!hasOfferingPlan(conditions))return [];
 // Historical readback only. Never turn an old saved condition into a new match.
 const keys=historical&&conditions.some(c=>c?.key===LEGACY_OFFERING_QUANTITY_KEY)
  ?[LEGACY_OFFERING_QUANTITY_KEY,...OFFERING_PLAN_KEYS.slice(1)]:OFFERING_PLAN_KEYS;
 // One scoped condition set only. Mixed families cannot silently change row semantics.
 if(conditions.some(c=>!c || typeof c.key!=='string') || conditions.length!==4 || keys.some(key=>conditions.filter(c=>c.key===key).length!==1))return ['offering_plan_requires_quantity_seller_security_unit'];
 const values=Object.fromEntries(conditions.map(c=>[c.key,c]));
 if(conditions.some(c=>c.operator!==(c.key===keys[0]?'gte':'eq'))
  ||!directDecimal(values[keys[0]].value)
  ||!['issuer','selling_shareholders'].includes(String(values[OFFERING_PLAN_KEYS[1]].value))
  ||!['common_stock','ordinary_shares','ads'].includes(String(values[OFFERING_PLAN_KEYS[2]].value))
  ||typeof values[OFFERING_PLAN_KEYS[3]].value!=='string'||!String(values[OFFERING_PLAN_KEYS[3]].value).trim()
  ||String(values[OFFERING_PLAN_KEYS[3]].value).length>100)return ['offering_plan_scope_invalid'];
 return [];
}
export function decimalAtLeast(actual:string,threshold:string){
 const [a,af='']=actual.split('.'),[b,bf='']=threshold.split('.');
 return a.length!==b.length?a.length>b.length:a!==b?a>b:af.padEnd(Math.max(af.length,bf.length),'0')>=bf.padEnd(Math.max(af.length,bf.length),'0');
}
