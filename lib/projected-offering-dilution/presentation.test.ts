import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require=createRequire(import.meta.url),ts=require('typescript'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function component(path:string,exportName:string){
 const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS}}).outputText;
 const module={exports:{} as Record<string,any>};
 new Function('require','module','exports',compiled)((name:string)=>name.endsWith('.module.css')?{default:{}}:require(name),module,module.exports);
 return (props:unknown)=>renderToStaticMarkup(React.createElement(module.exports[exportName],props));
}
const historyRender=component('components/monitor/ProjectedOfferingImpact.tsx','ProjectedOfferingHistory');
const planRender=component('components/admin/OfferingPlanCard.tsx','OfferingPlanCard');
const archive={createdAt:'2026-10-09T10:00:00Z',retired:true,current:false,evidenceAvailable:true,
 decisions:[{domain:'os',id:null,approvedAt:null},{domain:'offering',id:'decision',approvedAt:'2026-10-09T10:00:00Z'}],
 recorded:{sourceUrl:'https://www.sec.gov/Archives/local-only',evidence:[{id:'e1',text:'Pré-funded £ — original evidence'}],facts:{
  accession:'0000000001-26-991100',os_run_id:'os',offering_run_id:'offering',pre_offering_os:[{quantity:'1000000',share_class:'Ordinary Pré shares',as_of_text:'as of this prospectus'}],
  issuer_new_shares_base:0,resale_shares:50000,calculated_post_os_base:1000000,projected_increase_percent_base:0,
  issuer_new_shares_full_overallotment:230000,calculated_post_os_full_overallotment:1230000,projected_increase_percent_full_overallotment:23.123456789,
  potential_warrant_shares:null,resale_components:[],unavailable_reason:['warrant_underlying_relationship_unavailable'],direct_post_offering_os:[],calculation_status:'PARTIAL',
 }}};

test('production history component labels archived zero and unrounded values without asserting current accuracy',()=>{
 const before=JSON.stringify(archive),html=historyRender({history:archive});
 for(const text of ['Historical calculation record','Retired — not used for current calculations or new alerts.','may be incomplete or incorrect','0%','23.123456789%','Not recorded','No administrator approval recorded','Administrator approval recorded','Pré-funded £','0000000001-26-991100'])assert.ok(html.includes(text),text);
 assert.doesNotMatch(html,/accepted without candidate selection|threshold alert|currently eligible/);
 assert.equal(JSON.stringify(archive),before);
});
test('unverifiable historical evidence is hidden without substituting sources or discarding saved values',()=>{
 const html=historyRender({history:{...archive,evidenceAvailable:false}});
 assert.ok(html.includes('original evidence cannot currently be verified'));assert.ok(html.includes('0%'));
 assert.ok(!html.includes('Pré-funded £'));assert.ok(!html.includes('https://www.sec.gov/Archives/local-only'));
});

const cases=JSON.parse(readFileSync('lib/sec-offering-plan/fixtures/atm-regressions.json','utf8'));
for(const item of cases)test(`production Offering card retains direct ATM values and evidence: ${item.id}`,()=>{
 const before=JSON.stringify(item),html=planRender({plan:item.plan,blocks:item.atmEvidence??[]});
 for(const term of item.plan.atm_terms){assert.ok(html.includes(term.amount));assert.ok(html.includes(term.currency));assert.ok(html.includes(term.status==='current'?'현재 조건':'이전 조건'));if(term.as_of_date)assert.ok(html.includes(term.as_of_date));}
 for(const c of item.plan.components){if(c.quantity.value!==null)assert.ok(html.includes(c.quantity.value));assert.ok(html.includes(c.quantity.unit));}
 assert.ok(html.includes('ATM 직접 기재 조건'));assert.doesNotMatch(html,/Projected offering impact|예상 증가율/);
 assert.equal(JSON.stringify(item),before);
});
test('r2 absence, explicit empty ATM, blank, null and zero retain different meanings',()=>{
 const plan=structuredClone(cases[0].plan);delete plan.atm_terms;
 assert.ok(planRender({plan}).includes('ATM 여부는 이 항목으로 확인할 수 없습니다'));
 plan.atm_terms=[];assert.ok(planRender({plan}).includes('기록된 ATM 전용 항목이 없습니다'));
 for(const [status,value] of [['blank',null],['not_stated',null],['stated','0']] as const){
  plan.components[0].quantity={status,value,unit:'ADS'};
  const html=planRender({plan});assert.ok(html.includes(status==='blank'?'공시의 빈칸':status==='not_stated'?'미기재':'0 ADS'));
  assert.ok(html.includes('원문 근거를 확인할 수 없습니다'));
 }
});
test('conditional warrant, pre-funded and resale labels/scenarios keep their original units and individual references',()=>{
 const plan=structuredClone(cases[0].plan);plan.atm_terms=[];
 plan.components=['warrants','prefunded_warrants','common_stock'].map((security_type,i)=>({...plan.components[0],id:`c${i}`,security_type,seller_type:i===2?'selling_shareholders':'issuer',security_label:`Pré £ ${security_type}`,scenario:`Only upon exercise — original scenario ${i}`,quantity:{status:'stated',value:String(i+1),unit:i===2?'shares':'warrants'},evidence_blocks:[`e${i}`]}));
 const blocks=plan.components.map((c:any,i:number)=>({id:`e${i}`,text:`Separate source ${i}`,document_id:'doc',line_start:i+1,line_end:i+1}));
 const before=JSON.stringify(plan),html=planRender({plan,blocks});
 for(let i=0;i<3;i++){assert.ok(html.includes(`Only upon exercise — original scenario ${i}`));assert.ok(html.includes(`Separate source ${i}`));}
 assert.ok(html.includes('기존 주주 재판매'));assert.ok(html.includes('1 warrants'));assert.ok(html.includes('2 warrants'));assert.ok(html.includes('3 shares'));
 assert.equal(JSON.stringify(plan),before);
});
test('depositary, over-allotment, stated post-O/S and proceeds keep their own literal values and evidence',()=>{
 const plan=structuredClone(cases[0].plan);plan.atm_terms=[];
 plan.components[0].depositary={underlying_share_class:'Ordinary Pré',underlying_shares_per_security:'0',evidence_blocks:['depositary']};
 plan.over_allotment=[{seller_type:'issuer',security_label:'Ordinary Pré',quantity:{status:'stated',value:'0',unit:'ADS'},scenario:'Original over-allotment condition',evidence_blocks:['overallotment']}];
 plan.post_offering_os=[{security_label:'Class B only',quantity:'356624444',unit:'shares',scenario:'Original Class B scenario',evidence_blocks:['post']}];
 plan.proceeds=[{kind:'gross',recipient:'issuer',amount:'0',currency:'£',scenario:'Original conditional proceeds',evidence_blocks:['proceeds']}];
 const blocks=['depositary','overallotment','post','proceeds'].map(id=>({id,text:`Evidence only for ${id}`,document_id:'local',line_start:1,line_end:1}));
 const before=JSON.stringify(plan),html=planRender({plan,blocks});
 for(const item of blocks)assert.equal(html.split(item.text).length-1,1);
 for(const text of ['증권 1개당 0주','0 ADS','356624444 shares','Class B only','£ 0','Original Class B scenario','Original conditional proceeds'])assert.ok(html.includes(text),text);
 assert.equal(JSON.stringify(plan),before);
});
test('retired calculation stays detached from Primary and administrator current-result surfaces',()=>{
 for(const path of ['app/filings/[id]/page.tsx','app/filings/archive/[id]/page.tsx','components/filing-analysis-v2/GenericFilingAnalysis.tsx','lib/secFilingAnalysisIngest.ts','app/admin/data/offering-plans/page.tsx','app/admin/data/os-snapshots/page.tsx']){
  assert.doesNotMatch(readFileSync(path,'utf8'),/ProjectedOfferingImpact|readProjectedFacts|readOfferingImpact|filingFactsRenderer|conditionFamily:\s*['"]projected['"]/,path);
 }
});
