import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculate,type Published} from './calculate.ts';
import type {Snapshot} from '../sec-os-snapshot/contract.ts';
import type {Offering,Component} from '../sec-offering-plan/contract.ts';
const fixture=(name:string):Offering=>JSON.parse(readFileSync(`lib/sec-offering-plan/fixtures/${name}.json`,'utf8'));
function input(value:Offering){
 const os:Snapshot={version:'os_snapshot_v1',filing:value.filing,status:'PASS',current_os:[{scope:'share_class',share_class:value.plan.components[0]?.depositary?.underlying_share_class??value.plan.components[0]?.security_label??'ordinary shares',quantity:'100000000',as_of_date:null,as_of_text:'As of this prospectus',evidence_blocks:['source']}],review:null};
 return {os:{runId:'os',value:os,fingerprint:'os-fp',currentFingerprint:'os-fp'} as Published<Snapshot>,offering:{runId:'offering',value,fingerprint:'off-fp',currentFingerprint:'off-fp'} as Published<Offering>};
}
test('ARM: 95,500,000 ADS resale, no issuer issuance; originals unchanged',()=>{
 const v=fixture('arm-f1a'),before=JSON.stringify(v),i=input(v),f=calculate(i.os,i.offering)!;
 assert.equal(f.issuer_new_shares_base,0);assert.equal(f.projected_increase_percent_base,0);assert.equal(f.calculation_status,'RESALE_ONLY');
 assert.equal(f.resale_components[0].quantity,'95500000');assert.ok(v.plan.proceeds.some(p=>p.recipient==='issuer'&&p.kind==='no_proceeds'));
 assert.equal(JSON.stringify(v),before);
});
test('Birkenstock F-1 stays blank; F-1/A separates issuer and resale; no accession carry forward',()=>{
 const a=input(fixture('birkenstock-f1')),b=input(fixture('birkenstock-f1a'));
 assert.equal(calculate(a.os,a.offering)!.issuer_new_shares_base,null);
 assert.equal(calculate(a.os,a.offering)!.calculation_status,'UNAVAILABLE');
 const f=calculate(b.os,b.offering)!;assert.equal(f.issuer_new_shares_base,10752688);assert.equal(f.resale_shares,21505376);
 assert.equal(f.issuer_new_shares_full_overallotment,10752688);assert.equal(calculate(a.os,b.offering),null);
});
test('NuCana: immediate ADS 12,497,768 × 25; registered underlying excluded; ambiguous warrant link unavailable; Unicode retained',()=>{
 const v=fixture('nucana-f1a'),i=input(v),before=JSON.stringify(v),f=calculate(i.os,i.offering)!;
 assert.equal(f.issuer_new_shares_base,312444200);assert.equal(f.potential_warrant_shares,null);
 assert.equal(f.has_warrants,true);assert.equal(f.has_prefunded_warrants,true);
 assert.equal(f.calculation_status,'PARTIAL');assert.equal(JSON.stringify(v),before);assert.match(before,/“zero exercise price”/);
});
test('Canaan-shaped blank ADS and ratio never zero; Class B direct never total',()=>{
 const i=input(fixture('birkenstock-f1'));i.offering.value.plan.components=[{...i.offering.value.plan.components[0],security_type:'ads',depositary:{underlying_share_class:'Class A',underlying_shares_per_security:null,evidence_blocks:['source']}}];
 i.offering.value.plan.post_offering_os=[{security_label:'Class B',quantity:'356624444',unit:'shares',scenario:'after offering',evidence_blocks:['source']}];
 const f=calculate(i.os,i.offering)!;assert.equal(f.issuer_new_shares_base,null);assert.equal(f.calculated_post_os_base,null);assert.equal(f.direct_post_offering_os[0].quantity,'356624444');
});
test('both REVIEW approvals, failures, holds, fingerprints and identity are fail closed',()=>{
 for(const side of ['os','offering'] as const){
  const i=input(fixture('birkenstock-f1a')),p=i[side];
  if(side==='os'){i.os.value.review={code:'ambiguous',candidates:i.os.value.current_os};i.os.value.current_os=[];}else{i.offering.value.review={code:'ambiguous',evidence_blocks:[],candidates:[i.offering.value.plan]};}
  p.value.status='REVIEW_REQUIRED';assert.equal(calculate(i.os,i.offering),null);
  p.decision={id:'approval',action:'approve',candidate_indexes:[0]};assert.ok(calculate(i.os,i.offering));
  p.decision.action='hold';assert.equal(calculate(i.os,i.offering),null);p.decision.action='reject';assert.equal(calculate(i.os,i.offering),null);
  p.decision.action='approve';p.currentFingerprint='changed';assert.equal(calculate(i.os,i.offering),null);
 }
 for(const status of ['NO_DIRECT_CURRENT_OS','VALIDATION_FAILED','TECHNICAL_FAILED']){const i=input(fixture('arm-f1a'));i.os.value.status=status as Snapshot['status'];assert.equal(calculate(i.os,i.offering),null);}
});
test('exact class only; base and issuer overallotment separate; direct conflict retained',()=>{
 const i=input(fixture('birkenstock-f1a'));const c=i.offering.value.plan.components[0];
 i.offering.value.plan.over_allotment=[{component_ids:[c.id],seller_type:'issuer',security_label:c.security_label,quantity:{status:'stated',value:'100',unit:c.quantity.unit},scenario:null,evidence_blocks:['s']}];
 let f=calculate(i.os,i.offering)!;assert.equal(f.issuer_new_shares_full_overallotment,10752788);assert.equal(f.calculated_post_os_base,110752688);
 i.offering.value.plan.post_offering_os=[{security_label:c.security_label,quantity:'777',unit:c.quantity.unit,scenario:null,evidence_blocks:['s']}];
 f=calculate(i.os,i.offering)!;assert.equal(f.calculation_status,'CONFLICT');assert.equal(f.calculated_post_os_base,110752688);assert.equal(f.direct_post_offering_os[0].quantity,'777');
 i.os.value.current_os[0].share_class='Ordinary shares';assert.equal(calculate(i.os,i.offering)!.calculated_post_os_base,null);
});
test('mixed sellers/classes and unsafe integers cannot produce a misleading zero or total',()=>{
 const i=input(fixture('birkenstock-f1a'));i.offering.value.plan.components.push({...i.offering.value.plan.components[0],id:'mixed',seller_type:'mixed'});
 assert.equal(calculate(i.os,i.offering)!.issuer_new_shares_base,null);
 i.offering.value.plan.components.pop();i.offering.value.plan.components[0].quantity.value='9007199254740992';assert.equal(calculate(i.os,i.offering)!.issuer_new_shares_base,null);
});
test('warrant-only offer has zero immediate issuance and unavailable potential, never two additive bases',()=>{
 const i=input(fixture('nucana-f1a'));i.offering.value.plan.components=i.offering.value.plan.components.filter(c=>c.security_type==='warrants'||c.security_type==='prefunded_warrants');
 const f=calculate(i.os,i.offering)!;assert.equal(f.issuer_new_shares_base,0);assert.equal(f.potential_warrant_shares,null);assert.equal(f.resale_only,false);
});
