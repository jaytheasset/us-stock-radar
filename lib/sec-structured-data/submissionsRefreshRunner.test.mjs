import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { runSubmissionsRefresh, planSubmissionsRefresh, validateRefreshCiks,
  SUBMISSIONS_REFRESH_AGE_MS } from './submissionsRefreshRunner.ts';
import { normalizeMainSubmissions } from './mainSubmissions.ts';
import { parseRefreshArguments, runRefreshCli } from '../../scripts/run-sec-submissions-refresh.mjs';

// All company names, tickers, CIKs, credentials and times here are synthetic.
const environment={SUPABASE_DB_URL:'postgres://synthetic:SECRET@localhost/test',SEC_USER_AGENT:'Synthetic test test@example.invalid'};
const at=new Date('2026-10-07T12:00:00Z');
const payload=cik=>({cik,name:'Synthetic Runner',tickers:['SYN'],exchanges:['Synthetic'],filings:{recent:{accessionNumber:[],form:[],filingDate:[]}}});
function row(cik,confirmed=at.toISOString()) {
  const data=payload(cik),url=`https://data.sec.gov/submissions/CIK${cik}.json`,rawBody=JSON.stringify(data);
  const raw=normalizeMainSubmissions([{cik,sourceKind:'submissions',sourceUrl:url,sourceIdentity:url,
    fetchedAt:at.toISOString(),rawBody,rawBodyKind:'injected_exact_body',payload:data}],cik,at.toISOString()).rawSources[0];
  return {issuer_cik:cik,cik,id:raw.id,source_raw_id:raw.id,current_kind:'submissions',source_kind:'submissions',
    refresh_sequence:'1',confirmed_at:confirmed,fetched_at:at.toISOString(),source_url:url,source_identity:url,
    content_hash:raw.contentHash,raw_content:rawBody,payload:data,names:[{cik,name:data.name,kind:'submissions'}],
    listings:[{cik,ticker:'SYN',exchange:'Synthetic',kind:'submissions'}]};
}
function setup({rows=new Map(),busy=false,queryHook,transport}={}) {
  const queries=[],calls={clients:0,http:0,connect:0,end:0}; let sequence=0,mono=0;
  const client=new EventEmitter();
  client.connect=async()=>{calls.connect++;};
  client.end=async()=>{calls.end++;client.emit('end');};
  client.query=async(sql,values)=>{
    queries.push(sql);if(queryHook) await queryHook(sql,values,client);
    let result=[];
    if(sql.includes('current_database()')) result=[{database:'test',pid:123}];
    else if(sql.includes('pg_try_advisory_lock')) result=[{acquired:!busy}];
    else if(sql.includes('pg_advisory_unlock')) result=[{released:true}];
    else if(sql.includes('left join public.sec_structured_raw_sources')) result=rows.has(values[0])?[rows.get(values[0])]:[];
    else if(sql.includes('nextval')) result=[{sequence:String(++sequence)}];
    return {rows:result,rowCount:result.length};
  };
  const options={environment,now:()=>at,monotonicNow:()=>mono,sleep:async ms=>{mono+=ms;},
    createClient:config=>{calls.clients++;assert.equal(config.connectionTimeoutMillis,5000);assert.equal(config.statement_timeout,30000);return client;},
    fetchImplementation:async(...args)=>{calls.http++;return transport?transport(...args):new Response('',{status:404});}};
  return {options,calls,queries,rows,client,sequence:()=>sequence,mono:()=>mono};
}
const apply=ciks=>({ciks,apply:true,expectedDatabase:'test'});

test('CIKs normalize/dedupe in order; invalid/empty/>20 reject before any I/O',async()=>{
  assert.deepEqual(validateRefreshCiks(['2','0000000001',2]),['0000000002','0000000001']);
  const s=setup();
  for(const ciks of [[],['0'],['abc'],['1',null],Array.from({length:21},(_,i)=>i+1)])
    await assert.rejects(runSubmissionsRefresh({ciks},s.options));
  assert.equal(s.calls.clients,0);assert.equal(s.calls.http,0);
});
test('planner uses confirmedAt only; exact 24h due, invalid/future error',()=>{
  assert.deepEqual(planSubmissionsRefresh({status:'not-confirmed'},at),{plan:'initial'});
  assert.deepEqual(planSubmissionsRefresh({status:'unavailable'},at),{error:'current_unavailable'});
  for(const [age,expected] of [[0,'recent'],[SUBMISSIONS_REFRESH_AGE_MS-1,'recent'],[SUBMISSIONS_REFRESH_AGE_MS,'due']])
    assert.deepEqual(planSubmissionsRefresh({status:'available',confirmedAt:new Date(+at-age).toISOString(),firstFetchedAt:'bad'},at),{plan:expected});
  for(const date of ['bad',new Date(+at+1).toISOString()])
    assert.deepEqual(planSubmissionsRefresh({status:'available',confirmedAt:date},at),{error:'invalid_confirmed_at'});
});
test('dry-run uses official reader, distinguishes unavailable, and never locks/allocates/writes/HTTP',async()=>{
  const rows=new Map([['0000000002',row('0000000002')],['0000000003',row('0000000003',new Date(+at-SUBMISSIONS_REFRESH_AGE_MS).toISOString())],
    ['0000000004',row('0000000004','invalid')],['0000000005',row('0000000005',new Date(+at+1).toISOString())]]);
  const s=setup({rows}),r=await runSubmissionsRefresh({ciks:['1','2','3','4','5','1']},s.options);
  assert.deepEqual(r.items.map(x=>[x.status,x.plan,x.error]),[
    ['planned','initial',undefined],['skipped','recent',undefined],['planned','due',undefined],
    ['failed',undefined,'current_unavailable'],['failed',undefined,'invalid_confirmed_at']]);
  assert.equal(s.calls.http,0);assert.equal(s.sequence(),0);assert.equal(s.calls.end,1);
  assert.ok(s.queries.every(q=>/^select /i.test(q)));assert.ok(!s.queries.some(q=>/advisory|nextval/i.test(q)));
});
test('apply rereads after lock: a former initial dry-run plan can become skipped',async()=>{
  const s=setup();const first=await runSubmissionsRefresh({ciks:['1']},s.options);
  assert.equal(first.items[0].plan,'initial');s.rows.set('0000000001',row('0000000001'));
  const second=await runSubmissionsRefresh(apply(['1']),s.options);
  assert.equal(second.items[0].status,'skipped');assert.equal(s.sequence(),0);assert.equal(s.calls.http,0);
  const lock=s.queries.findIndex(q=>q.includes('pg_try_advisory_lock'));
  assert.ok(s.queries.slice(lock+1).some(q=>q.includes('left join')));
});
test('configuration and expected DB guards never collect or allocate',async()=>{
  const s=setup();
  await assert.rejects(runSubmissionsRefresh(apply(['1']),{...s.options,environment:{}}),/database_url_required/);
  await assert.rejects(runSubmissionsRefresh({ciks:['1'],apply:true},s.options),/expected_database_required/);
  await assert.rejects(runSubmissionsRefresh(apply(['1']),{...s.options,environment:{SUPABASE_DB_URL:'synthetic'}}),/sec_user_agent_required/);
  assert.equal(s.calls.clients,0);
  const r=await runSubmissionsRefresh({...apply(['1']),expectedDatabase:'other'},s.options);
  assert.deepEqual(r.errors,['database_mismatch']);assert.equal(s.calls.end,1);
  assert.equal(s.calls.http,0);assert.equal(s.sequence(),0);assert.ok(!s.queries.some(q=>/advisory/.test(q)));
});
test('busy has no reader/sequence/HTTP and never unlocks someone else',async()=>{
  const s=setup({busy:true}),r=await runSubmissionsRefresh(apply(['1']),s.options);
  assert.equal(r.status,'busy');assert.equal(r.items[0].status,'not-run');assert.equal(s.calls.end,1);
  assert.equal(s.calls.http,0);assert.equal(s.sequence(),0);assert.ok(!s.queries.some(q=>/pg_advisory_unlock|left join/.test(q)));
});
test('ordinary company failure continues sequentially with >=1sec start spacing, no outer retry',async()=>{
  const s=setup(),r=await runSubmissionsRefresh(apply(['1','2','1']),s.options);
  assert.deepEqual(r.items.map(x=>x.error),['refresh_failed','refresh_failed']);
  assert.equal(r.refreshInvocations,2);assert.equal(r.httpAttempts,2);assert.equal(s.sequence(),2);
  assert.equal(s.mono(),1000);assert.equal(s.calls.clients,1);assert.ok(r.lockReleased&&r.connectionClosed);
});
for(const [status,attempts] of [[403,1],[429,3]]) test(`final SEC ${status} stops batch; inner HTTP attempts=${attempts}`,async()=>{
  const s=setup({transport:async()=>new Response('SECRET',{status,headers:{'retry-after':'0'}})});
  const r=await runSubmissionsRefresh(apply(['1','2']),s.options);
  assert.equal(r.items[0].error,'sec_access_blocked');assert.equal(r.items[1].status,'not-run');
  assert.equal(r.refreshInvocations,1);assert.equal(r.httpAttempts,attempts);assert.equal(s.sequence(),1);
  assert.ok(!JSON.stringify(r).includes('SECRET'));assert.ok(r.lockReleased&&r.connectionClosed);
});
test('SQL rollback failure stops before next company and closes owned connection',async()=>{
  const s=setup({transport:async url=>new Response(JSON.stringify(payload(/CIK(\d+)/.exec(url)[1]))),queryHook:async sql=>{
    if(sql.startsWith('insert')||sql==='rollback') throw Object.assign(Error('SECRET'),{code:'P0001'});
  }});
  const r=await runSubmissionsRefresh(apply(['1','2']),s.options);
  assert.equal(r.items[0].error,'session_unusable');assert.equal(r.items[1].status,'not-run');
  assert.equal(r.refreshInvocations,1);assert.ok(s.queries.includes('rollback'));assert.ok(r.connectionClosed);
});
test('session loss in official read is not mistaken for an initial refresh',async()=>{
  const s=setup({queryHook:async(sql,_values,client)=>{if(sql.includes('left join')) client.emit('error',Error('SECRET'));}});
  const r=await runSubmissionsRefresh(apply(['1','2']),s.options);
  assert.equal(r.items[0].error,'session_unusable');assert.equal(r.items[1].status,'not-run');
  assert.equal(s.calls.http,0);assert.equal(s.sequence(),0);assert.ok(r.connectionClosed);
});
test('CLI defaults dry-run; unknown/duplicate flags fail before runner, failures are sanitized and nonzero',async()=>{
  assert.deepEqual(parseRefreshArguments(['--ciks=1,2,1']),{ciks:['0000000001','0000000002'],apply:false});
  let calls=0;const output=[];
  for(const args of [[],['--ciks=1','--force'],['--ciks=1','--apply'],['--ciks=1','--ciks=2']])
    assert.equal(await runRefreshCli(args,{write:x=>output.push(x),run:async()=>{calls++;}}),1);
  assert.equal(calls,0);
  for(const [status,code] of [['completed',0],['failed',1],['busy',2]])
    assert.equal(await runRefreshCli(['--ciks=1'],{write:x=>output.push(x),run:async()=>({status})}),code);
  assert.equal(await runRefreshCli(['--ciks=1'],{write:x=>output.push(x),run:async()=>{throw Error(environment.SUPABASE_DB_URL);}}),1);
  assert.ok(!output.join('').includes('SECRET'));
});
