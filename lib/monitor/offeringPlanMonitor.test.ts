import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {buildSource,bindingFor,compactBinding} from '../sec-offering-plan/source.ts';
import {sha,validateOutput,type Component,type Offering} from '../sec-offering-plan/contract.ts';
import {offeringPlanConditionErrors,decimalAtLeast} from './offeringPlanConditions.ts';
import {eligibleComponent,matchOfferingPlan,offeringPlanEvidence,offeringPlanEvidenceSchema,publicOfferingPlanEvidence} from './offeringPlanFacts.ts';
import {readOfferingPlanFacts} from './offeringPlanReader.ts';
import {validateCanonicalListingConditions} from './listingMonitorPersistence.ts';
import {evaluateMonitorConditions} from '../listingMonitorMatcher.ts';
import {getMonitorPresetCatalog,createMonitorPresetDraft,getMonitorPresetConditionSummary} from './monitorPresets.ts';
import {createListingMonitorDraftReview,getListingMonitorDraftCreateGate} from './listingMonitorDraftReview.ts';
import {offeringPlanRunSaved} from './offeringPlanTrigger.ts';
import {consumeListingMonitorAlertsForEvent} from './listingMonitorAlertConsumer.ts';

const id='12345678-1234-4234-8234-123456789012',eventId='22345678-1234-4234-8234-123456789012';
const conditions=[{key:'offering_plan.component_quantity',operator:'gte' as const,value:'100000'},{key:'offering_plan.seller_type',operator:'eq' as const,value:'issuer'},{key:'offering_plan.security_type',operator:'eq' as const,value:'common_stock'},{key:'offering_plan.quantity_unit',operator:'eq' as const,value:'shares'}];
function fixture(){
 const raw={id,source_code:'sec_edgar',source_unique_id:'0000000001-26-991199',source_url:'https://www.sec.gov/Archives/edgar/data/1/000000000126991199/local-only.htm',raw_payload:{accession_number:'0000000001-26-991199',company_name:'LOCAL ONLY direct plan fixture',cik:'0000000001',form_type:'F-1',filing_date:'2026-10-10',primary_document_html_truncated:false,primary_document_html:'<p>LOCAL ONLY verification fixture. We are offering 200,000 common shares — Pré £.</p><p>Selling shareholders are offering 50,000 common shares — Pré £.</p>'}};
 const source=buildSource(raw),binding=bindingFor(id,source),plan={components:[{id:'c1',seller_type:'issuer',security_type:'common_stock',security_label:'common shares — Pré £',quantity:{status:'stated',value:'200000',unit:'shares'},price:{status:'not_stated',qualification:'not_stated',value:null,low:null,high:null,currency:null,per_unit:null},scenario:null,depositary:null,evidence_blocks:[source.blocks[0].id]},{id:'c2',seller_type:'selling_shareholders',security_type:'common_stock',security_label:'common shares — Pré £',quantity:{status:'stated',value:'50000',unit:'shares'},price:{status:'not_stated',qualification:'not_stated',value:null,low:null,high:null,currency:null,per_unit:null},scenario:null,depositary:null,evidence_blocks:[source.blocks[0].id]}] as Component[],over_allotment:[],post_offering_os:[],proceeds:[],atm_terms:[]};
 const value:Offering={version:'offering_plan_v1',filing:source.filing,status:'PASS',plan,review:null};
 const serialized=JSON.stringify(value),validation=validateOutput(serialized,source,binding.contractVersion);assert.equal(validation.ok,true);
 const cp={status:'PASS',raw:serialized,rawHash:sha(serialized),validated:value,validation,provider:{}};
 const run={id:binding.id,raw_item_id:id,prompt_key:'sec_offering_plan',status:'succeeded',finished_at:'2026-10-10T12:00:00Z',metadata:{binding:compactBinding(binding),offeringStatus:'PASS',offeringCheckpoint:cp}};
 const decisions:Record<string,unknown>[]=[];
 const repo={select:async(table:string)=>({ok:true,data:table==='events'?[{id:eventId,raw_item_id:id}]:table==='raw_items'?[raw]:table==='ai_runs'?[run]:table==='ai_outputs'?[{payload:cp}]:table==='sec_offering_plan_decisions'?decisions:[]}),rpc:async()=>({ok:false})};
 return {raw,source,plan,cp,run,decisions,repo};
}
test('four scoped literal conditions; partial, negative, mixed-family and duplicated scopes rejected',()=>{
 assert.equal(validateCanonicalListingConditions(conditions).ok,true);
 for(const c of [conditions.slice(1),[...conditions,conditions[0]],[...conditions,{key:'market.price',operator:'gte',value:1}],conditions.map((c,i)=>i?c:{...c,value:'-1'})])assert.ok(offeringPlanConditionErrors(c).length);
 assert.equal(decimalAtLeast('9007199254740993','9007199254740992'),true);assert.equal(decimalAtLeast('0.01','0.0101'),false);
});
test('source-backed reader, same row AND, no resale/issuer cross-row matching and Unicode unchanged',async()=>{
 const f=fixture(),before=JSON.stringify(f.cp),facts=await readOfferingPlanFacts(eventId,f.repo);
 assert.equal(facts.status,'available');assert.equal(matchOfferingPlan(facts,conditions),'match');
 const resale=conditions.map(c=>c.key==='offering_plan.seller_type'?{...c,value:'selling_shareholders'}:c);
 assert.equal(matchOfferingPlan(facts,resale),'no_match');
 const evidence=offeringPlanEvidence(facts,conditions)!;assert.equal(evidence.component.quantity,'200000');assert.match(evidence.component.label,/Pré £/);
 assert.equal('decisionId' in publicOfferingPlanEvidence(evidence)!,false);assert.equal(JSON.stringify(f.cp),before);
 assert.equal(evaluateMonitorConditions({offeringPlan:facts,listing:{status:'not_ready',reason:'reader_unavailable'},corporateAction:{status:'not_ready',reason:'reader_unavailable'},ownership:{status:'not_ready',reason:'reader_unavailable'}},conditions,{evaluationDate:'2026-10-11'}).status,'match');
});
test('blank, unknown, conditions, historical, ATM and over-allotment rows are unavailable',()=>{
 const f=fixture(),c=f.plan.components[0];
 for(const changed of [{...c,quantity:{...c.quantity,status:'blank' as const,value:null}},{...c,seller_type:'unclear'},{...c,scenario:'Assuming warrant exercise'},{...c,security_type:'warrant'}])assert.equal(eligibleComponent(changed,f.plan,f.source),null);
 assert.equal(eligibleComponent(c,{...f.plan,over_allotment:[{component_ids:['c1'],seller_type:'issuer',security_label:c.security_label,quantity:c.quantity,scenario:null,evidence_blocks:c.evidence_blocks}]},f.source),null);
 const historic=structuredClone(f.source);historic.blocks[0].text='We previously offered 200,000 common shares — Pré £.';assert.equal(eligibleComponent(c,f.plan,historic),null);
 const unrelated=structuredClone(f.source);unrelated.blocks[0].text='We are offering securities. There are 200,000 common shares — Pré £ authorized.';assert.equal(eligibleComponent(c,f.plan,unrelated),null);
 const conditional=structuredClone(f.source);conditional.blocks[0].text='Selling shareholders may offer and sell up to 200,000 common shares — Pré £ under this prospectus.';assert.equal(eligibleComponent({...c,seller_type:'selling_shareholders'},f.plan,conditional),null);
});
test('unapproved review, hold/reject, source mismatch and malformed evidence fail closed',async()=>{
 for(const action of ['hold','reject','retry']){const f=fixture();f.decisions.push({id,action,candidate_indexes:[]});assert.equal((await readOfferingPlanFacts(eventId,f.repo)).status,'not_ready');}
 const f=fixture();f.raw.raw_payload.primary_document_html+='changed';assert.equal((await readOfferingPlanFacts(eventId,f.repo)).status,'not_ready');
 const evidence=offeringPlanEvidence(await readOfferingPlanFacts(eventId,fixture().repo),conditions)!;
 for(const key of Object.keys(evidence)){const broken={...evidence};delete broken[key as keyof typeof broken];assert.equal(offeringPlanEvidenceSchema.safeParse(broken).success,false,key);}
 assert.equal(publicOfferingPlanEvidence({...evidence,reason:'private'}),null);
});
test('exact approved candidate only; changing approval or source never falls back to PASS',async()=>{
 const f=fixture();const v={...f.cp.validated,status:'REVIEW_REQUIRED' as const,plan:{components:[],over_allotment:[],post_offering_os:[],proceeds:[],atm_terms:[]},review:{code:'conflicting_quantity',evidence_blocks:[f.source.blocks[0].id],candidates:[f.plan]}};
 const raw=JSON.stringify(v),validation=validateOutput(raw,f.source,f.run.metadata.binding.contractVersion);assert.equal(validation.ok,true);
 Object.assign(f.cp,{status:'REVIEW_REQUIRED',raw,rawHash:sha(raw),validated:v,validation});f.run.metadata.offeringStatus='REVIEW_REQUIRED';
 assert.equal((await readOfferingPlanFacts(eventId,f.repo)).status,'not_ready');
 f.decisions.push({id,action:'approve',candidate_indexes:[0]});const facts=await readOfferingPlanFacts(eventId,f.repo);
 assert.equal(matchOfferingPlan(facts,conditions),'match');assert.equal(offeringPlanEvidence(facts,conditions)?.decisionId,id);
 f.decisions[0].action='hold';assert.equal((await readOfferingPlanFacts(eventId,f.repo)).status,'not_ready');

});
test('real blank Birkenstock F-1 is not synthesized into a quantity',()=>{
 const raw=JSON.parse(readFileSync('lib/sec-offering-plan/fixtures/birkenstock-f1.json','utf8'));
 const source=JSON.parse(gunzipSync(readFileSync('lib/sec-offering-plan/fixtures/birkenstock-f1.source.json.gz')).toString());
 assert.ok(raw.plan.components.every((c:Component)=>eligibleComponent(c,raw.plan,source)===null));
});
test('existing saved-run and event-later entries both evaluate; replay remains owned by existing consumer',async()=>{
 let calls=0;await offeringPlanRunSaved(id,fixture().repo,async()=>{calls++;return {} as never;});assert.equal(calls,1);
 const workflow=readFileSync('workflows/source-ingest.ts','utf8');assert.match(workflow,/analysis.eventId\) await evaluateOfferingPlanEventStep\(analysis.eventId\)/);
 assert.match(readFileSync('lib/offeringMonitorJobStarter.ts','utf8'),/evaluateOfferingPlan \?\? consumeOfferingPlanEvent/);
});
test('activation preserved and matching consumer writes immutable evidence via existing writer dependency',async()=>{
 const facts=await readOfferingPlanFacts(eventId,fixture().repo);let createdAt='2026-10-11T00:00:00Z',writes=0;const keys=new Set<string>();
 const deps={now:()=>new Date('2026-10-12'),readOfferingPlanFacts:async()=>facts,listActiveMonitors:async()=>({monitors:[{id,userId:id,domain:'listing' as const,kind:'condition_set' as const,isActive:true,createdAt,updatedAt:createdAt,conditions}],diagnostics:[]}),createAlert:async(input:Record<string,unknown>)=>{assert.ok(input.offeringPlanEvidence);const key=String(input.monitorId)+input.eventId;const prior=keys.has(key);keys.add(key);if(!prior)writes++;return {status:prior?'existing' as const:'created' as const,monitorId:id,alertId:id};}};
 assert.equal((await consumeListingMonitorAlertsForEvent({eventId,conditionFamily:'offering_plan'},deps)).createdCount,0);
 createdAt='2026-10-09T00:00:00Z';assert.equal((await consumeListingMonitorAlertsForEvent({eventId,conditionFamily:'offering_plan'},deps)).createdCount,1);
 assert.equal((await consumeListingMonitorAlertsForEvent({eventId,conditionFamily:'offering_plan'},deps)).existingCount,1);assert.equal(writes,1);
});
test('preset uses existing review/save path without LLM calls',()=>{
 const p=getMonitorPresetCatalog().find(p=>p.id==='offering-plan-shares')!;assert.ok(p);assert.equal(validateCanonicalListingConditions(p.conditions).ok,true);
 assert.ok(getMonitorPresetConditionSummary(p).includes('100000'));assert.equal(getListingMonitorDraftCreateGate(createListingMonitorDraftReview(createMonitorPresetDraft(p.id))).ready,true);
});
