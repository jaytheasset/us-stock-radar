// Actual owned PostgreSQL and native localhost HTTP; all issuer/time data synthetic.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Client } from 'pg';
import { runSubmissionsRefresh, SUBMISSIONS_REFRESH_AGE_MS } from '../lib/sec-structured-data/submissionsRefreshRunner.ts';
import { readCurrentIssuerSubmissions } from '../lib/sec-structured-data/currentSubmissionsReader.ts';
import { SecSubmissionsRefreshService } from '../lib/sec-structured-data/submissionsRefresh.ts';
import { PostgresSecStructuredRepository } from '../lib/sec-structured-data/repository.ts';
import { syntheticDocument } from './sec-submissions-conflict-cases.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
export async function verifySubmissionsRunner(ctx,target) {
  ctx.report.phase='runner';
  const checks=ctx.report.runner={tests:[],runs:[],http:[],transactionChecks:[],realSecCalls:0};
  const control=await ctx.connect('postgres'),reader=await ctx.connect();
  const clients=new Set(),pending=new Map(),sockets=new Set();let request=0,time=Date.parse('2026-10-07T00:00:00Z');
  const now=()=>new Date(time),day=()=>{time+=SUBMISSIONS_REFRESH_AGE_MS;};
  const docs=Array.from({length:12},(_,i)=>syntheticDocument(1300+i));
  const [A,B,C,D,E,F,G,H,I,J]=docs.map(d=>d.cik);
  const payloads=new Map(docs.map(d=>[d.cik,d.payload]));
  const server=createServer(async(req,res)=>{
    const job=pending.get(req.url);assert.ok(job);
    if(job.stream) {res.writeHead(200,{'content-type':'application/json'});res.write('{');}
    job.started?.resolve();
    if(job.gate) await job.gate.promise;
    if(res.destroyed) return;
    if(!job.stream)res.writeHead(job.status??200,{'content-type':'application/json','connection':'close'});
    res.end(job.body);
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const nativeFetch=fetch;
  const read=cik=>readCurrentIssuerSubmissions(reader,{cik});
  const snapshot=async()=>({...await ctx.snapshot(reader),
    current:(await reader.query("select coalesce(jsonb_agg(to_jsonb(c) order by issuer_cik),'[]')::text value from public.sec_submissions_current c")).rows[0].value,
    sequence:(await control.query('select last_value::text,is_called from public.sec_submissions_refresh_sequence')).rows[0]});
  const record=(name,result={})=>{checks.tests.push({name,pass:true,...result});console.log(JSON.stringify({check:name,pass:true}));};
  function start(ciks,{apply=true,jobs=new Map(),expectedDatabase=target.database,onClient,queryHook}={}) {
    const trace={ciks,apply,sequence:0,writes:0,locks:0,http:0,starts:[],commands:[]};checks.runs.push(trace);
    let owned;
    const operation=runSubmissionsRefresh({ciks,apply,expectedDatabase},{
      environment:{SUPABASE_DB_URL:target.connectionString,SEC_USER_AGENT:'Synthetic localhost runner test@example.invalid'},now,
      createClient:config=>{
        assert.equal(config.connectionString,target.connectionString);
        owned=new Client(config);clients.add(owned);
        const connect=owned.connect.bind(owned),query=owned.query.bind(owned),end=owned.end.bind(owned);
        owned.connect=async()=>{
          await connect();
          const identity=(await query("select current_database() db,d.oid::text oid,pg_get_userbyid(d.datdba) owner,shobj_description(d.oid,'pg_database') marker from pg_database d where datname=current_database()")).rows[0];
          assert.deepEqual(identity,{db:target.database,oid:target.databaseOid,owner:'postgres',marker:target.marker});
          await query('set role service_role');trace.pid=owned.processID;onClient?.(owned);
        };
        owned.query=async(sql,values)=>{
          trace.commands.push(sql.trim().split(/\s+/)[0].toLowerCase());
          if(sql.includes('nextval')){trace.sequence++;trace.starts.push(performance.now());}
          if(/^(insert|update|delete)/i.test(sql.trim()))trace.writes++;
          if(sql.includes('pg_try_advisory_lock'))trace.locks++;
          if(queryHook)await queryHook(sql);
          return query(sql,values);
        };
        owned.end=async()=>{await end();clients.delete(owned);trace.closed=true;};
        return owned;
      },
      fetchImplementation:async(url,init)=>{
        const match=/^https:\/\/data\.sec\.gov\/submissions\/CIK(\d{10})\.json$/.exec(url);
        assert.ok(match,'Only main Submissions requests may reach localhost');assert.ok(ciks.includes(match[1]));
        const state=(await control.query('select state,xact_start from pg_stat_activity where pid=$1',[owned.processID])).rows[0];
        assert.equal(state.state,'idle');assert.equal(state.xact_start,null);
        checks.transactionChecks.push({pid:owned.processID,...state});
        const job={body:JSON.stringify(payloads.get(match[1])),...jobs.get(match[1])};
        const key=`/${++request}`;pending.set(key,job);trace.http++;
        checks.http.push({cik:match[1],transport:'localhost',key});
        return nativeFetch(base+key,init);
      },
    }).then(result=>{trace.result=result;return result;});
    return {operation,trace};
  }
  const run=async(ciks,options)=>start(ciks,options).operation;
  async function assertClosed() {
    assert.equal(clients.size,0);
    assert.equal((await control.query("select count(*)::int n from pg_stat_activity where datname=current_database() and application_name='sec_submissions_refresh_runner_v1'")).rows[0].n,0);
    assert.equal((await control.query("select count(*)::int n from pg_locks where locktype='advisory' and database=(select oid from pg_database where datname=current_database())")).rows[0].n,0);
  }
  try {
    const before=await snapshot();const dry=await run([A,B,C],{apply:false});
    assert.deepEqual(dry.items.map(x=>x.status),['planned','planned','planned']);assert.deepEqual(await snapshot(),before);
    assert.deepEqual([checks.runs[0].sequence,checks.runs[0].http,checks.runs[0].writes,checks.runs[0].locks],[0,0,0,0]);
    record('dry-run reads official current only; sequence/HTTP/write/lock zero');

    const first=await run([A,B,C]);assert.equal(first.status,'completed');
    const firstTrace=checks.runs.at(-1);
    for(let i=1;i<firstTrace.starts.length;i++)assert.ok(firstTrace.starts[i]-firstTrace.starts[i-1]>=999, '1ms measurement tolerance');
    for(const item of first.items){
      const current=await read(item.cik);assert.equal(current.status,'available');
      assert.equal(current.sourceRawId,item.result.confirmation.sourceRawId);assert.equal(current.confirmedAt,item.result.confirmation.confirmedAt);
      assert.equal(item.result.publication,'published');assert.equal(item.result.counts.rawSourcesInserted,1);
    }
    await assertClosed();record('initial sequential refresh and official readback',{startIntervalsMs:firstTrace.starts.slice(1).map((v,i)=>v-firstTrace.starts[i]),first});

    day();const oldA=await read(A);const same=await run([A]);const sameA=await read(A);
    assert.equal(same.items[0].result.counts.rawSourcesInserted,0);assert.equal(sameA.firstFetchedAt,oldA.firstFetchedAt);
    assert.equal(sameA.sourceRawId,oldA.sourceRawId);assert.equal(sameA.confirmedAt,now().toISOString());assert.notEqual(sameA.confirmedAt,oldA.confirmedAt);
    record('same response keeps raw ID/first fetch and advances confirmedAt',{before:oldA,after:sameA,counts:same.items[0].result.counts});

    assert.equal((await run([B],{apply:false})).items[0].plan,'due');await run([B]);
    const skipBefore=await snapshot(),skipped=await run([B]);assert.equal(skipped.items[0].status,'skipped');assert.deepEqual(await snapshot(),skipBefore);
    assert.deepEqual([checks.runs.at(-1).http,checks.runs.at(-1).sequence,checks.runs.at(-1).writes],[0,0,0]);
    record('apply rereads a now-completed dry-run target; skipped zero work');

    day();const started=deferred(),gate=deferred(),visible=await read(A);
    const winner=start([A],{jobs:new Map([[A,{started,gate}]])});await started.promise;
    const during=(await control.query('select state,xact_start from pg_stat_activity where pid=$1',[winner.trace.pid])).rows[0];
    assert.deepEqual(during,{state:'idle',xact_start:null});assert.deepEqual(await read(A),visible);
    const busyBefore=await snapshot();const busy=await run([A,C]);assert.equal(busy.status,'busy');assert.deepEqual(await snapshot(),busyBefore);
    assert.notEqual(winner.trace.pid,busy.backendPid);assert.deepEqual([checks.runs.at(-1).sequence,checks.runs.at(-1).http,checks.runs.at(-1).writes],[0,0,0]);
    gate.resolve();assert.equal((await winner.operation).status,'completed');await assertClosed();
    record('two independent runner sessions: one busy; HTTP idle transaction and old reader visible',{winnerPid:winner.trace.pid,busyPid:busy.backendPid,during});

    const oldB=await read(B),oldC=await read(C);
    await control.query(`create function public.runner_test_fail() returns trigger language plpgsql as $$
      begin if new.issuer_cik='${C}' then raise exception 'synthetic failure'; end if; return new; end $$;
      create trigger runner_test_fail before insert or update on public.sec_submissions_current for each row execute function public.runner_test_fail()`);
    payloads.set(C,{...payloads.get(C),name:'Synthetic rollback new body'});
    const partial=await run([A,B,C,D],{jobs:new Map([[B,{body:'{'}]])});
    assert.deepEqual(partial.items.map(x=>x.status),['skipped','failed','failed','attempted']);
    assert.deepEqual(await read(B),oldB);assert.deepEqual(await read(C),oldC);assert.equal((await read(D)).status,'available');
    assert.ok(checks.runs.at(-1).commands.includes('rollback'));
    assert.equal((await reader.query('select count(*)::int n from public.sec_structured_raw_sources where cik=$1',[C])).rows[0].n,1);
    await control.query('drop trigger runner_test_fail on public.sec_submissions_current; drop function public.runner_test_fail()');
    await assertClosed();const recovered=await run([A,B,C,D]);assert.deepEqual(recovered.items.map(x=>x.status),['skipped','attempted','attempted','skipped']);
    const completeBefore=await snapshot();const repeat=await run([A,B,C,D]);assert.ok(repeat.items.every(x=>x.status==='skipped'));assert.deepEqual(await snapshot(),completeBefore);
    assert.deepEqual([checks.runs.at(-1).sequence,checks.runs.at(-1).http,checks.runs.at(-1).writes],[0,0,0]);
    record('HTTP/SQL partial failures preserve old current; healthy rollback continues; rerun only unfinished',{partial,recovered});

    const blocked=await run([E,F],{jobs:new Map([[E,{status:403}]])});
    assert.deepEqual(blocked.items.map(x=>x.status),['failed','not-run']);assert.equal(blocked.httpAttempts,1);await assertClosed();
    assert.equal((await run([E,F])).status,'completed');record('SEC final 403 stops remaining batch, releases lock, next run recovers');

    const bodyStarted=deferred(),bodyGate=deferred();let closingClient;
    const lost=start([G,H],{jobs:new Map([[G,{stream:true,started:bodyStarted,gate:bodyGate}]]),onClient:c=>{closingClient=c;}});
    await bodyStarted.promise;await closingClient.end();
    const lostResult=await lost.operation;assert.equal(lostResult.items[0].error,'session_unusable');assert.equal(lostResult.items[1].status,'not-run');
    assert.equal(lost.trace.http,1);assert.equal(lost.trace.sequence,1);assert.equal(lost.trace.writes,0);
    assert.deepEqual(await read(G),{status:'not-confirmed'});bodyGate.resolve();await assertClosed();
    assert.equal((await run([G,H])).status,'completed');record('owned connection ends during body: abort/no store/no reconnect; next session acquires',{lostResult});

    // Other refresh callers are outside this runner lock. Existing sequence guard still wins.
    const oldStarted=deferred(),oldGate=deferred();
    const older=start([I],{jobs:new Map([[I,{started:oldStarted,gate:oldGate}]])});await oldStarted.promise;
    const other=await ctx.connect();
    try {
      const newer=await new SecSubmissionsRefreshService(new PostgresSecStructuredRepository(other),'Synthetic test test@example.invalid',{
        now,fetchImplementation:async(url,init)=>{
          assert.equal(url,`https://data.sec.gov/submissions/CIK${I}.json`);const key=`/${++request}`;
          pending.set(key,{body:JSON.stringify({...payloads.get(I),name:'Synthetic newer independent refresh'})});
          checks.http.push({cik:I,transport:'localhost',key});return nativeFetch(base+key,init);
        },
      }).refreshIssuerSubmissions({cik:I});
      oldGate.resolve();const superseded=await older.operation;
      assert.equal(superseded.items[0].result.publication,'superseded');assert.equal((await read(I)).sourceRawId,newer.confirmation.sourceRawId);
      record('superseded receipt stays superseded; runner does not replace newer current',{superseded});
    } finally {oldGate.resolve();await ctx.close(other);}

    const rollbackFailure=await run([J],{queryHook:async sql=>{
      if(sql.trim().startsWith('insert')||sql==='rollback')throw Object.assign(Error('synthetic rollback unavailable'),{code:'P0001'});
    }});
    assert.equal(rollbackFailure.items[0].error,'session_unusable');await assertClosed();
    assert.equal((await run([J])).status,'completed');record('failed transaction cleanup closes dedicated session; next run succeeds');

    const mismatchBefore=await snapshot();const mismatch=await run([A],{expectedDatabase:'wrong_owned_test_name'});
    assert.deepEqual(mismatch.errors,['database_mismatch']);assert.deepEqual(await snapshot(),mismatchBefore);await assertClosed();
    record('expected DB mismatch performs no lock/HTTP/sequence/store');
    checks.pass=true;
  } finally {
    for(const job of pending.values())job.gate?.resolve();
    for(const socket of sockets)socket.destroy();
    await new Promise(resolve=>server.close(resolve));checks.httpServerClosed=true;
    for(const client of [...clients]){try{await client.end();}catch{}}
    await ctx.close(reader);await ctx.close(control);checks.ownedRunnerConnections=clients.size;
  }
}
