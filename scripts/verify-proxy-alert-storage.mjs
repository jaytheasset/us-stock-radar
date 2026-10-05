// Verify the production alert writer against local PostgreSQL, then roll back every insert.
// This proves the storage/dedupe contract, not historical Monitor activation or live delivery.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {registerHooks} from 'node:module';
import pg from 'pg';

const out=resolve(process.argv[2]);
const cli=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(new URL(cli.DB_URL).hostname,'127.0.0.1');
assert.equal(new URL(cli.DB_URL).port,'56322');
const db=new pg.Client({connectionString:cli.DB_URL});
await db.connect();
const slot='__proxyAlertRollbackRepository';
const hooks=registerHooks({resolve(s,c,next){
  if(s==='server-only')return {shortCircuit:true,url:'data:text/javascript,export{}'};
  if(s==='../supabase.ts'&&c.parentURL?.endsWith('/monitor/listingMonitorAlertConsumer.ts')){
    return {shortCircuit:true,url:'data:text/javascript,'+encodeURIComponent(
      `export const supabaseUpsert=(...args)=>globalThis.${slot}.upsert(...args);export const supabaseSelect=(...args)=>globalThis.${slot}.select(...args);`)};
  }
  return next(s,c);
}});
try{
  assert.equal((await db.query('select system_identifier::text id from pg_control_system()')).rows[0].id,'7678429483712069671');
  const report=JSON.parse(readFileSync(resolve(out,'fresh-report.json'),'utf8'));
  const seed=JSON.parse(readFileSync(resolve(out,'seed.json'),'utf8')).find(c=>c.name==='Alternus');
  const monitor=(await db.query('select id,user_id from listing_monitors where id=$1',[report.monitorId])).rows[0];
  assert.ok(monitor);
  const count=async()=>Number((await db.query('select count(*) n from user_alert_deliveries where listing_monitor_id=$1',[monitor.id])).rows[0].n);
  const before=await count();
  await db.query('begin');
  globalThis[slot]={
    async upsert(table,row,options){
      assert.equal(table,'user_alert_deliveries');assert.equal(options.onConflict,'listing_monitor_id,alert_event_id');
      const keys=Object.keys(row);assert.ok(keys.every(k=>/^[a-z_]+$/.test(k)));
      const result=await db.query(`insert into public.user_alert_deliveries (${keys.join(',')}) values (${keys.map((_,i)=>'$'+(i+1)).join(',')}) on conflict (listing_monitor_id,alert_event_id) do nothing returning *`,Object.values(row));
      return {ok:true,data:result.rows};
    },
    async select(table,query){
      assert.equal(table,'user_alert_deliveries');
      const result=await db.query('select id from public.user_alert_deliveries where listing_monitor_id=$1 and alert_event_id=$2',[query.listing_monitor_id.slice(3),query.alert_event_id.slice(3)]);
      return {ok:true,data:result.rows};
    },
  };
  const {createListingMonitorAlert}=await import('../lib/monitor/listingMonitorAlertConsumer.ts');
  const input={eventId:seed.eventId,monitorId:monitor.id,userId:monitor.user_id,
    sourceExecutionId:report.cases.find(c=>c.name==='Alternus').executionId,createdAt:new Date().toISOString(),proxyAlert:true};
  const first=await createListingMonitorAlert(input);assert.equal(first.status,'created');
  const duplicate=await createListingMonitorAlert(input);assert.equal(duplicate.status,'existing');assert.equal(duplicate.alertId,first.alertId);
  assert.equal(await count(),before+1);
  const row=(await db.query('select category,source_label,listing_source_execution_id from user_alert_deliveries where id=$1',[first.alertId])).rows[0];
  assert.equal(row.category,'listing_risk');assert.equal(row.source_label,'Proxy Monitor');assert.equal(row.listing_source_execution_id,input.sourceExecutionId);
  await db.query('rollback');assert.equal(await count(),before);
  const result={passed:true,productionWriter:true,transport:'transaction-bound PostgreSQL adapter',insertedWithinRollback:1,deduplicated:true,remainingRows:before,externalDeliveries:0,liveActivationVerified:false};
  writeFileSync(resolve(out,'alert-storage-report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{
  await db.query('rollback').catch(()=>{});delete globalThis[slot];hooks.deregister();await db.end();
}
