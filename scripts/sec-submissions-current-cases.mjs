// Synthetic localhost HTTP + actual PostgreSQL. Never calls SEC or product APIs.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { SecSubmissionsRefreshService } from '../lib/sec-structured-data/submissionsRefresh.ts';
import { readCurrentIssuerSubmissions } from '../lib/sec-structured-data/currentSubmissionsReader.ts';
import { SecStructuredDataService } from '../lib/sec-structured-data/service.ts';
import { normalizeSecStructuredDocuments } from '../lib/sec-structured-data/normalization.ts';
import { syntheticDocument, rawRaces, rawGuards } from './sec-submissions-conflict-cases.mjs';

const migration = 'supabase/migrations/20261006140457_sec_submissions_current.sql';
const deferred = () => { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; };
const clone = value => structuredClone(value);

export async function verifySubmissionsCurrent(ctx) {
  const {report}=ctx; report.phase='current';
  const checks=report.current={tests:[],http:[],transactionChecks:[],realSecCalls:0};
  const control=await ctx.connect('postgres'), writer=await ctx.connect(), reader=await ctx.connect();
  const repo=ctx.repository(writer,'current-writer');
  const read=cik=>readCurrentIssuerSubmissions(reader,{cik});
  const document=syntheticDocument(700), cik=document.cik;
  const A=document.payload, B={...clone(A),name:'Synthetic changed B',tickers:['SYNB']};
  let time=Date.parse('2026-10-06T15:00:00Z'); const now=()=>new Date(time);
  const tick=()=>{time+=1000;};
  const pending = new Map(); let request=0;
  const server=createServer(async(req,res)=>{
    const job=pending.get(req.url); assert.ok(job); job.started?.resolve();
    if(job.gate) await job.gate.promise;
    if(res.destroyed) return;
    if(job.disconnect){res.destroy();return;}
    res.writeHead(job.status??200,{'content-type':'application/json','connection':'close'});
    res.end(job.body);
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  const sockets=new Set();server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});
  async function refresh(client, payload, extra={}) {
    const job={body:typeof payload==='string'?payload:JSON.stringify(payload),...extra};
    const key=`/${++request}`;pending.set(key,job);
    const repository=ctx.repository(client,`refresh-${request}`,extra.beforeQuery);
    const service=new SecSubmissionsRefreshService(repository,'isolated localhost verification test@example.invalid',{
      now,fetchImplementation:async(url,init)=>{
        assert.equal(url,`https://data.sec.gov/submissions/CIK${extra.cik??cik}.json`);
        const state=(await control.query('select state,xact_start from pg_stat_activity where pid=$1',[client.processID])).rows[0];
        assert.equal(state.state,'idle'); assert.equal(state.xact_start,null);
        checks.transactionChecks.push({pid:client.processID,state:state.state,xactStart:state.xact_start});
        checks.http.push({url,transport:'localhost',request:key});
        return fetch(base+key,init);
      },
    });
    return service.refreshIssuerSubmissions({cik:extra.cik??cik});
  }
  async function snapshot() {
    return {...await ctx.snapshot(reader),current:(await reader.query(
      "select coalesce(jsonb_agg(to_jsonb(c) order by issuer_cik),'[]')::text value from public.sec_submissions_current c")).rows[0].value};
  }
  async function countRaw() {return (await reader.query('select count(*)::int n from public.sec_structured_raw_sources where cik=$1',[cik])).rows[0].n;}
  const record=(name,result={})=>{checks.tests.push({name,pass:true,...result});console.log(JSON.stringify({check:name,pass:true}));};
  try {
    // Seed only archival raw/observations before migration: no fabricated freshness.
    const archived=normalizeSecStructuredDocuments([document]); await repo.ingestBatch(archived);
    await control.query(await readFile(migration,'utf8'));report.currentMigration={migration,target:'owned temporary database only',backfill:false};
    assert.deepEqual(await read(cik),{status:'not-confirmed'});
    record('raw-only migration has no current');

    // Another issuer's first refresh proves all tables plus current insert atomically.
    const firstDoc=syntheticDocument(701);
    const firstNew=await refresh(writer,firstDoc.payload,{cik:firstDoc.cik});
    const firstRead=await read(firstDoc.cik);
    assert.equal(firstNew.counts.rawSourcesInserted,1);assert.equal(firstNew.publication,'published');
    assert.equal(firstRead.sourceRawId,firstNew.confirmation.sourceRawId);
    assert.equal(firstRead.entityName,firstDoc.payload.name);
    assert.deepEqual(firstRead.listings,[{ticker:'SYN',exchange:'Synthetic Exchange'}]);
    assert.equal(firstRead.confirmedAt,now().toISOString());
    record('first refresh independent reader',{writerPid:writer.processID,readerPid:reader.processID,result:firstRead,counts:firstNew.counts});

    const first=await refresh(writer,A); const initial=await read(cik); tick();
    const again=await refresh(writer,A);const repeated=await read(cik);
    assert.equal(again.counts.inserted,0);assert.equal(again.counts.updated,0);
    assert.equal(again.publication,'published');assert.equal(repeated.sourceRawId,initial.sourceRawId);
    assert.notEqual(repeated.confirmedAt,initial.confirmedAt);assert.equal(repeated.firstFetchedAt,'2026-10-06T00:00:00.000Z');
    assert.equal(await countRaw(),1);
    record('same A advances confirmation only',{initial,repeated,counts:again.counts});
    tick();const b=await refresh(writer,B);tick();const a=await refresh(writer,A);const aba=await read(cik);
    assert.equal(await countRaw(),2);assert.equal(aba.sourceRawId,first.confirmation.sourceRawId);
    assert.notEqual(aba.sourceRawId,b.confirmation.sourceRawId);assert.equal(aba.confirmedAt,now().toISOString());
    record('A B A two raws last A',{rawCount:2,sourceA:a.confirmation.sourceRawId,sourceB:b.confirmation.sourceRawId,current:aba});

    // Different bodies; old request remains on HTTP while a later sequence commits.
    const oldClient=await ctx.connect(),newClient=await ctx.connect();
    assert.notEqual(oldClient.processID,newClient.processID);
    const gate=deferred(),started=deferred();tick();
    const oldPromise=refresh(oldClient,{...clone(A),name:'Synthetic slow old'},{gate,started});
    await started.promise;assert.deepEqual(await read(cik),aba);tick();
    const newer=await refresh(newClient,{...clone(B),name:'Synthetic fast newer'});const currentNew=await read(cik);
    tick();gate.resolve();const older=await oldPromise;
    assert.equal(older.publication,'superseded');assert.equal(older.counts.rawSourcesInserted,1);
    assert.ok(BigInt(newer.confirmation.refreshSequence)>BigInt(older.confirmation.refreshSequence));
    assert.ok(older.confirmation.confirmedAt>newer.confirmation.confirmedAt);
    assert.deepEqual(await read(cik),currentNew);
    record('different-source reversed completion',{pids:[oldClient.processID,newClient.processID],older,newer,current:currentNew});
    await ctx.close(oldClient);await ctx.close(newClient);

    // Failures leave both raw/observations/current unchanged, followed by recovery.
    for(const [name,payload,extra] of [
      ['network',A,{disconnect:true}],['HTTP',A,{status:400}],['JSON','{',{}],['validation',{...A,tickers:null},{}],
    ]) {
      const before=await snapshot();tick();await assert.rejects(refresh(writer,payload,extra));
      assert.deepEqual(await snapshot(),before);tick();const recovered=await refresh(writer,A);
      assert.equal(recovered.publication,'published');record(`${name} failure/recovery`,{current:await read(cik)});
    }
    // Corrupt stored raw under test-owner privileges. Product guard must reject
    // identical incoming ID rather than quietly attach observations/current.
    await control.query('update public.sec_structured_raw_sources set payload=$2::jsonb where id=$1',
      [a.confirmation.sourceRawId,JSON.stringify({...A,name:'Synthetic corrupted stored payload'})]);
    const beforeGuard=await snapshot();tick();await assert.rejects(refresh(writer,A),/sec_raw_source_identity_mismatch/);
    assert.deepEqual(await snapshot(),beforeGuard);assert.equal((await read(cik)).status,'unavailable');
    await control.query('update public.sec_structured_raw_sources set payload=$2::jsonb where id=$1',[a.confirmation.sourceRawId,JSON.stringify(A)]);
    tick();await refresh(writer,A);record('raw guard rollback and recovery');

    await control.query(`create function public.eeb4_current_failure() returns trigger language plpgsql as $$
      begin raise exception 'injected current failure'; end $$;
      create trigger eeb4_current_failure before insert or update on public.sec_submissions_current
      for each row execute function public.eeb4_current_failure()`);
    const beforeSql=await snapshot();tick();
    await assert.rejects(refresh(writer,{...A,name:'Synthetic SQL rollback new raw'}),e=>e.code==='P0001');
    assert.deepEqual(await snapshot(),beforeSql);
    assert.ok(report.sqlTrace.some(t=>t.table==='sec_submissions_current'&&t.error==='P0001'));
    const failedLabel=report.sqlTrace.find(t=>t.table==='sec_submissions_current'&&t.error==='P0001').label;
    for(const table of ['sec_structured_raw_sources','sec_issuer_source_observations','sec_issuer_ticker_observations'])
      assert.ok(report.sqlTrace.some(t=>t.label===failedLabel&&t.table===table&&t.rowCount===1));
    await control.query('drop trigger eeb4_current_failure on public.sec_submissions_current; drop function public.eeb4_current_failure()');
    tick();const recovered=await refresh(writer,{...A,name:'Synthetic SQL rollback new raw'});
    assert.equal(recovered.counts.rawSourcesInserted,1);record('actual publication SQL error rolls back raw/observations/current',{recovered});

    // Same receipt is idempotent. No fresh now() for a re-save.
    const stored=(await reader.query('select * from public.sec_structured_raw_sources where id=$1',[recovered.confirmation.sourceRawId])).rows[0];
    const storedDoc={sourceKind:'submissions',cik,sourceUrl:stored.source_url,sourceIdentity:stored.source_identity,
      fetchedAt:stored.fetched_at.toISOString(),payload:stored.payload,rawBody:stored.raw_content,rawBodyKind:'authoritative_http_body'};
    const batch=normalizeSecStructuredDocuments([storedDoc]);
    const beforeRepeat=await snapshot();tick();
    const unchanged=await repo.ingestSubmissionsRefresh(batch,recovered.confirmation);
    assert.equal(unchanged.publication,'unchanged');assert.equal(unchanged.counts.inserted,0);assert.deepEqual(await snapshot(),beforeRepeat);
    await assert.rejects(repo.ingestSubmissionsRefresh(batch,{...recovered.confirmation,confirmedAt:now().toISOString()}),/conflicting_submissions_confirmation/);
    const other=normalizeSecStructuredDocuments([{...document,payload:B,rawBody:JSON.stringify(B)}]);
    await assert.rejects(repo.ingestSubmissionsRefresh(other,{...recovered.confirmation,sourceRawId:other.rawSources[0].id}),/conflicting_submissions_confirmation/);
    assert.deepEqual(await snapshot(),beforeRepeat);record('same receipt no-op; contradictory time/source rejected');

    const archivedSource={async fetchSubmissions(){return [{...storedDoc,fetchedAt:now().toISOString()}];},async fetchCompanyFacts(){throw Error('forbidden');}};
    const archivedService=new SecStructuredDataService(archivedSource,repo,now);
    await archivedService.ingestIssuerSubmissions({cik});assert.deepEqual(await snapshot(),beforeRepeat);
    const fixture=JSON.parse(await readFile(new URL('../lib/sec-structured-data/fixtures/three-issuer-minimal.json',import.meta.url),'utf8'));
    const sample=fixture.issuers[0];
    const fixtureDoc=(kind,payload)=>({sourceKind:kind,cik:sample.cik,
      sourceUrl:kind==='submissions'?`https://data.sec.gov/submissions/CIK${sample.cik}.json`:`https://data.sec.gov/api/xbrl/companyfacts/CIK${sample.cik}.json`,
      sourceIdentity:kind==='submissions'?`https://data.sec.gov/submissions/CIK${sample.cik}.json`:`https://data.sec.gov/api/xbrl/companyfacts/CIK${sample.cik}.json`,
      fetchedAt:now().toISOString(),payload,rawBody:JSON.stringify(payload),rawBodyKind:'authoritative_http_body'});
    const full=new SecStructuredDataService({fetchSubmissions:async()=>[fixtureDoc('submissions',sample.submissions)],
      fetchCompanyFacts:async()=>fixtureDoc('companyfacts',sample.companyfacts)},repo,now);
    const currentBeforeFull=(await snapshot()).current;
    const fullResult=await full.ingestIssuer({cik:sample.cik,mode:'bootstrap'});
    assert.equal(fullResult.factsInserted,2);assert.equal((await snapshot()).current,currentBeforeFull);
    assert.deepEqual(await read(sample.cik),{status:'not-confirmed'});
    record('authoritative replay/full do not publish',{fullResult,currentUnchanged:true,liveCompanyFactsCalls:0});
    for(const sample of fixture.issuers) {
      tick();const result=await refresh(writer,sample.submissions,{cik:sample.cik});const observed=await read(sample.cik);
      assert.equal(observed.status,'available');assert.equal(observed.sourceRawId,result.confirmation.sourceRawId);
      assert.equal(observed.entityName,sample.submissions.name);
      assert.deepEqual(observed.listings,sample.submissions.tickers.map((ticker,i)=>({ticker,exchange:sample.submissions.exchanges[i]})));
      record('preserved fixture through HTTP refresh and SQL reader',{cik:sample.cik,result:observed});
    }

    tick();const empty=await refresh(writer,{...A,tickers:[],exchanges:[]});
    assert.deepEqual((await read(cik)).listings,[]);assert.equal((await read(cik)).sourceRawId,empty.confirmation.sourceRawId);
    record('empty listings remain empty');

    // Hold immediately before publication, after raw/observations INSERTs.
    const during=await read(cik), beforePublish=deferred(), releasePublish=deferred();tick();
    const inProgress=refresh(writer,{...B,name:'Synthetic atomic visible'},{beforeQuery:async sql=>{
      if(/insert into public.sec_submissions_current/.test(sql)){beforePublish.resolve();await releasePublish.promise;}
    }});
    await beforePublish.promise;assert.deepEqual(await read(cik),during);
    releasePublish.resolve();const afterPublish=await inProgress;const afterRead=await read(cik);
    assert.equal(afterRead.sourceRawId,afterPublish.confirmation.sourceRawId);assert.equal(afterRead.entityName,'Synthetic atomic visible');
    assert.deepEqual(afterRead.listings,[{ticker:'SYNB',exchange:'Synthetic Exchange'}]);
    record('reader during transaction sees previous whole snapshot',{before:during,after:afterRead});

    const beforeBad=await snapshot();
    await assert.rejects(control.query('update public.sec_submissions_current set source_raw_id=$1 where issuer_cik=$2',[firstNew.confirmation.sourceRawId,cik]),e=>e.code==='23503');
    await assert.rejects(control.query("update public.sec_submissions_current set source_kind='companyfacts' where issuer_cik=$1",[cik]),e=>e.code==='23514');
    assert.deepEqual(await snapshot(),beforeBad);
    await control.query('begin');
    await control.query('update public.sec_structured_raw_sources set source_identity=source_identity||\'?bad\' where id=$1',[afterRead.sourceRawId]);
    assert.equal((await readCurrentIssuerSubmissions(control,{cik})).status,'unavailable');await control.query('rollback');
    await control.query('begin');
    await control.query("update public.sec_issuer_source_observations set entity_name='Synthetic wrong name' where source_raw_id=$1",[afterRead.sourceRawId]);
    assert.equal((await readCurrentIssuerSubmissions(control,{cik})).status,'unavailable');await control.query('rollback');
    await control.query('begin');
    await control.query('delete from public.sec_issuer_ticker_observations where source_raw_id=$1',[afterRead.sourceRawId]);
    assert.equal((await readCurrentIssuerSubmissions(control,{cik})).status,'unavailable');await control.query('rollback');
    assert.deepEqual(await snapshot(),beforeBad);record('invalid CIK/kind FK blocked; bad identity/name/listing unavailable');

    checks.permissions=[];
    for(const role of ['anon','authenticated']) {
      const client=await ctx.connect(role);
      for(const sql of ['select * from public.sec_submissions_current','insert into public.sec_submissions_current default values',
        'update public.sec_submissions_current set confirmed_at=now()','delete from public.sec_submissions_current',
        "select nextval('public.sec_submissions_refresh_sequence')","select * from public.sec_submissions_refresh_sequence"]) {
        await assert.rejects(client.query(sql),e=>e.code==='42501');checks.permissions.push({role,sql,code:'42501'});
      }
      assert.equal((await readCurrentIssuerSubmissions(client,{cik})).status,'unavailable');await ctx.close(client);
    }
    for(const sql of ['update public.sec_structured_raw_sources set fetched_at=now()','delete from public.sec_structured_raw_sources',
      "select setval('public.sec_submissions_refresh_sequence',1)"]) await assert.rejects(writer.query(sql),e=>e.code==='42501');
    const sequence=(await control.query("select seqcache::text,seqcycle from pg_sequence where seqrelid='public.sec_submissions_refresh_sequence'::regclass")).rows[0];
    assert.equal(sequence.seqcache,'1');assert.equal(sequence.seqcycle,false);
    // Real bigint above JS precision must survive allocation, publication and reader.
    await control.query("select setval('public.sec_submissions_refresh_sequence',9007199254740992)");tick();
    const large=await refresh(writer,A);assert.equal(large.confirmation.refreshSequence,'9007199254740993');
    assert.equal((await read(cik)).refreshSequence,'9007199254740993');
    record('permissions/cache1/no-cycle/bigint exact',{denials:checks.permissions.length+3,sequence,bigint:large.confirmation.refreshSequence});

    // Existing actual-SQL race + identity regressions, unchanged helpers.
    await rawRaces(ctx,3,900,true);await rawGuards(ctx);
    record('existing actual raw concurrency and guard regressions',{races:3,guardCases:7});
    checks.pass=true;
  } finally {
    for(const job of pending.values())job.gate?.resolve();
    for(const s of sockets)s.destroy();
    await new Promise(resolve=>server.close(resolve));checks.httpServerClosed=true;
    for(const client of [control,writer,reader]){try{await client.query('rollback');}catch{}await ctx.close(client);}
  }
}
