// Isolated DB constraint tests. All writes roll back; not browser E2E evidence.
import assert from 'node:assert/strict';
import {Client} from 'pg';
const url=new URL(process.env.SUPABASE_DB_URL||'');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'56462');
const db=new Client({connectionString:url.href});await db.connect();let checks=0;
try{
 await db.query('begin');
 const row=(await db.query('select user_id,alert_event_id,listing_source_execution_id from user_alert_deliveries where alert_event_id is not null and listing_source_execution_id is not null limit 1')).rows[0];assert.ok(row);
 const evidence={version:'offering_plan_match_v1',meaning:'stated_current_plan_component_not_execution',runId:row.listing_source_execution_id,rawId:'12345678-1234-4234-8234-123456789012',eventId:row.alert_event_id,accession:'0000000001-26-991199',sourceFingerprint:'a'.repeat(64),outputHash:'b'.repeat(64),contractVersion:'offering_plan_v1-output-r3',filedAt:'2026-10-10',decisionId:null,candidateIndex:null,conditions:[{key:'offering_plan.component_quantity',operator:'gte',value:'100000'},{key:'offering_plan.seller_type',operator:'eq',value:'issuer'},{key:'offering_plan.security_type',operator:'eq',value:'common_stock'},{key:'offering_plan.quantity_unit',operator:'eq',value:'shares'}],component:{id:'c1',seller:'issuer',security:'common_stock',label:'LOCAL ONLY Pré £',quantity:'200000',unit:'shares',scenario:null,references:[{blockId:'block1',sha256:'c'.repeat(64),url:'https://www.sec.gov/Archives/edgar/data/1/local-only.htm',lineStart:1,lineEnd:1}]}};
 async function valid(value,expected){assert.equal((await db.query('select public.valid_offering_plan_match_evidence($1::jsonb) as valid',[JSON.stringify(value)])).rows[0].valid,expected);checks++;}
 await valid(evidence,true);
 for(const key of Object.keys(evidence)){const v=structuredClone(evidence);delete v[key];await valid(v,false);const n=structuredClone(evidence);n[key]=null; if(!['decisionId','candidateIndex'].includes(key))await valid(n,false);}
 for(const key of Object.keys(evidence.component)){const v=structuredClone(evidence);delete v.component[key];await valid(v,false);}
 for(const key of Object.keys(evidence.component.references[0])){const v=structuredClone(evidence);delete v.component.references[0][key];await valid(v,false);}
 for(const edit of [v=>v.conditions[0].value='999999',v=>v.conditions[1].value='selling_shareholders',v=>v.conditions[0].value=null,v=>v.conditions[2]=v.conditions[1],v=>v.conditions[3].value='ADSs',v=>v.decisionId=row.user_id,v=>v.component.references[0].url='https://evil.test',v=>v.component.scenario='conditional',v=>v.reason='private',v=>v.outputHash=123]){const v=structuredClone(evidence);edit(v);await valid(v,false);}
 const monitor=(await db.query("insert into listing_monitors(user_id,domain,conditions,is_active) values($1,'listing',$2,true) returning id",[row.user_id,JSON.stringify(evidence.conditions)])).rows[0].id;
 const params=[row.user_id,row.alert_event_id,monitor,row.listing_source_execution_id,JSON.stringify(evidence)];
 const sql="insert into user_alert_deliveries(user_id,alert_event_id,listing_monitor_id,listing_source_execution_id,offering_plan_match_evidence,alert_lane,alert_domain,category,title,source_type,source_label,delivery_status,delivered_channels) values($1,$2,$3,$4,$5,'listing_monitor','listing','dilution_risk','LOCAL ONLY DB test','other','Offering Plan Monitor','queued','{}') on conflict(listing_monitor_id,alert_event_id) do nothing returning id";
 const alert=(await db.query(sql,params)).rows[0].id;checks++;assert.equal((await db.query(sql,params)).rowCount,0);checks++;
 await db.query('savepoint missing_monitor');let missingMonitorRejected=false;try{await db.query(sql,[params[0],params[1],null,params[3],params[4]]);}catch{missingMonitorRejected=true;}await db.query('rollback to missing_monitor');assert.equal(missingMonitorRejected,true);checks++;
 for(const update of ["offering_plan_match_evidence='{}'","offering_plan_match_evidence=null","effect_match_evidence='{}'","listing_match_evidence='{}'","category='listing_risk'","sent_at=now()","projected_scenario='base'"]){await db.query('savepoint negative');let rejected=false;try{await db.query(`update user_alert_deliveries set ${update} where id=$1`,[alert]);}catch{rejected=true;}await db.query('rollback to negative');assert.equal(rejected,true,update);checks++;}
 await db.query('delete from listing_monitors where id=$1',[monitor]);
 const retained=(await db.query('select listing_monitor_id,offering_plan_match_evidence from user_alert_deliveries where id=$1',[alert])).rows[0];
 assert.equal(retained.listing_monitor_id,null);assert.deepEqual(retained.offering_plan_match_evidence,evidence);checks++;
 await db.query('rollback');console.log(JSON.stringify({checks,pass:true,committedRows:0,dbPort:56462}));
}finally{await db.query('rollback');await db.end();}
