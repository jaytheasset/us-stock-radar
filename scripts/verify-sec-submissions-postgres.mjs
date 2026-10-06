// Explicit opt-in only. Creates/drops ONE owned database on a verified dev cluster.
// Never run the old shared-database verification script as a substitute.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';
import { SecStructuredDataService } from '../lib/sec-structured-data/service.ts';
import { SecStructuredHttpClient } from '../lib/sec-structured-data/httpClient.ts';
import { PostgresSecStructuredRepository } from '../lib/sec-structured-data/repository.ts';
import { normalizeSecStructuredDocuments } from '../lib/sec-structured-data/normalization.ts';
import { readCurrentIssuerSubmissions } from '../lib/sec-structured-data/currentSubmissionsReader.ts';
import { readStockHeaderSecIdentity } from '../lib/watchlist/stockHeaderSecIdentity.ts';
import { readSecCompanyCatalog, SEC_COMPANY_CATALOG_URL } from '../lib/sources/sec/tickerCatalog.ts';
import { verifySubmissionsCurrent } from './sec-submissions-current-cases.mjs';
import { verifyCurrentHeader } from './sec-current-header-verification.mjs';
import { rawRaces, rawGuards } from './sec-submissions-conflict-cases.mjs';

assert.ok(process.argv.includes('--run'), 'Explicit --run is required');
const expectedSystem = process.argv.find(arg => arg.startsWith('--system-id='))?.slice(12);
assert.match(expectedSystem ?? '', /^\d+$/, 'Verified development system ID required');
const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9);
assert.ok(output, 'External receipt path required');
const adminUrl = new URL(process.env.SEC_VERIFY_ADMIN_DB_URL ?? '');
assert.equal(adminUrl.hostname, '127.0.0.1'); assert.equal(adminUrl.port, '56322');
assert.equal(adminUrl.pathname, '/postgres');
const headerOnly = process.argv.includes('--header-only');
const currentOnly = process.argv.includes('--current-only') || headerOnly;
if (!currentOnly) assert.ok(process.env.SEC_USER_AGENT, 'Existing SEC_USER_AGENT required; never invent a contact');
const runId = randomUUID();
const database = `sec_submissions_eeb4_${runId.replaceAll('-', '')}`;
const marker = `eeb4 submissions verification ${runId}`;
const tables = ['sec_structured_raw_sources', 'sec_issuers', 'sec_issuer_source_observations',
  'sec_issuer_ticker_observations', 'sec_filing_ledger', 'sec_company_facts'];
const ciks = ['0000320193', '0001652044', '0001853138'];
const sourceUrls = ciks.map(cik => `https://data.sec.gov/submissions/CIK${cik}.json`);
const report = { runId, database, startedAt: new Date().toISOString(), phase: 'preflight',
  http: [], replayCalls: [], sql: {}, samples: [], cleanup: {}, forbiddenCalls: 0 };
const clients = new Set();
let databaseOid;
let created = false;
const admin = new Client({ connectionString: adminUrl.href, connectionTimeoutMillis: 5000,
  application_name: 'eeb4_submissions_verify_admin' });
const nativeFetch = globalThis.fetch;
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => `"${value.replaceAll('"', '""')}"`;
const tempUrl = new URL(adminUrl); tempUrl.pathname = `/${database}`;
const captures = new Map();
const sqlTrace = [];
let Repository = PostgresSecStructuredRepository;
report.sqlTrace = sqlTrace; // Preserve partial evidence even when a later assertion stops the run.
function countQueries(client, kind) {
  const query = client.query.bind(client);
  client.query = (...args) => {
    report.sql[kind] = (report.sql[kind] ?? 0) + 1;
    report.sql.total = (report.sql.total ?? 0) + 1;
    return query(...args);
  };
}
countQueries(admin, 'admin');

async function adminIdentity() {
  const result = (await admin.query(`select current_database() db,current_user,
    inet_server_addr()::text address,inet_server_port() port,version(),
    system_identifier::text from pg_control_system()`)).rows[0];
  assert.equal(result.db, 'postgres'); assert.equal(result.system_identifier, expectedSystem);
  assert.equal(result.current_user, 'postgres');
  return result;
}
async function databaseIdentity(client) {
  const row = (await client.query(`select current_database() db,current_user,session_user,
    d.oid::text oid,pg_get_userbyid(d.datdba) owner,shobj_description(d.oid,'pg_database') marker
    from pg_database d where d.datname=current_database()`)).rows[0];
  assert.equal(row.db, database); assert.equal(row.oid, databaseOid);
  assert.equal(row.owner, 'postgres'); assert.equal(row.marker, marker);
  assert.equal(client.host, '127.0.0.1'); assert.equal(client.port, 56322);
  return row;
}
async function connect(role = 'service_role') {
  const client = new Client({ connectionString: tempUrl.href, connectionTimeoutMillis: 5000,
    application_name: `eeb4_submissions_${runId}` });
  clients.add(client);
  countQueries(client, 'temporaryDatabase');
  await client.connect();
  await databaseIdentity(client);
  if (role !== 'postgres') {
    assert.ok(['service_role', 'anon', 'authenticated'].includes(role));
    await client.query(`set role ${quote(role)}`);
  }
  const identity = await databaseIdentity(client);
  assert.equal(identity.current_user, role);
  await client.query("set statement_timeout='30s'");
  return client;
}
async function close(client) { await client.end(); clients.delete(client); }
function repository(client, label, beforeQuery) {
  return new Repository({ async query(sql, values) {
    // A failed transaction rejects SELECT too. The connection was verified
    // before BEGIN and PostgreSQL cannot switch databases within that session.
    if (sql.trim().toLowerCase() !== 'rollback') await databaseIdentity(client);
    if (beforeQuery) await beforeQuery(sql);
    const item = { label, command: sql.trim().split(/\s+/)[0].toLowerCase(),
      table: /insert into public\.(\w+)/i.exec(sql)?.[1] ?? null };
    sqlTrace.push(item);
    try { const result = await client.query(sql, values); item.rowCount = result.rowCount; return result; }
    catch (error) { item.error = error.code; throw error; }
  } }); // Default managed transaction; never external transaction mode.
}
function replay(document, label, companyFacts) {
  return {
    async fetchSubmissions(cik, mode) {
      assert.equal(cik, document.cik); assert.equal(mode, 'incremental');
      report.replayCalls.push({ label, source: 'submissions' });
      return [{ ...document, fetchedAt: new Date().toISOString() }];
    },
    async fetchCompanyFacts() {
      assert.ok(companyFacts, 'CompanyFacts is forbidden outside fixture compatibility');
      report.replayCalls.push({ label, source: 'companyfacts_fixture' }); return companyFacts;
    },
  };
}
async function snapshot(client) {
  const state = {};
  for (const table of tables) {
    // Database-side canonical row serialization avoids pg timestamp/JSON mapping loss.
    state[table] = (await client.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text value from public.${table} t`)).rows[0].value;
  }
  return state;
}
async function readBack(document, expected) {
  const client = await connect();
  try {
    const raw = (await client.query('select * from public.sec_structured_raw_sources where id=$1', [expected.rawSources[0].id])).rows;
    assert.equal(raw.length, 1);
    assert.equal(raw[0].cik, document.cik); assert.equal(raw[0].source_identity, document.sourceIdentity);
    assert.equal(raw[0].source_url, document.sourceUrl);
    assert.ok(raw[0].raw_content === document.rawBody, 'original body round-trip mismatch');
    assert.equal(raw[0].content_hash, hash(document.rawBody));
    assert.equal(raw[0].id, expected.rawSources[0].id);
    assert.equal(raw[0].fetched_at.toISOString(), new Date(document.fetchedAt).toISOString());
    const names = (await client.query('select * from public.sec_issuer_source_observations where source_raw_id=$1', [raw[0].id])).rows;
    assert.equal(names.length, 1); assert.equal(names[0].entity_name, document.payload.name.trim());
    const tickerRows = (await client.query('select ticker,exchange,issuer_cik,source_raw_id from public.sec_issuer_ticker_observations where source_raw_id=$1 order by id', [raw[0].id])).rows;
    assert.deepEqual(tickerRows.map(row => [row.ticker, row.exchange]), expected.tickerObservations.map(row => [row.ticker, row.exchange]));
    assert.ok(tickerRows.every(row => row.source_raw_id === raw[0].id && row.issuer_cik === document.cik));
    const ledger = (await new PostgresSecStructuredRepository(client).readFilings(document.cik, 10000))
      .filter(row => row.sourceRawId === raw[0].id);
    // The public reader has a bounded limit, so verify ALL recent ledger rows directly too.
    const storedLedger = (await client.query(`select accession_number,issuer_cik,form,filed_date::text,accepted_at,
      report_date::text,primary_document,is_xbrl,is_inline_xbrl,source_raw_id,source_kind
      from public.sec_filing_ledger where source_raw_id=$1 order by accession_number`, [raw[0].id])).rows;
    const expectedLedger = expected.filings.map(row => ({ accession_number: row.accessionNumber, issuer_cik: row.issuerCik,
      form: row.form, filed_date: row.filedDate, accepted_at: row.acceptedAt,
      report_date: row.reportDate, primary_document: row.primaryDocument, is_xbrl: row.isXbrl,
      is_inline_xbrl: row.isInlineXbrl, source_raw_id: row.sourceRawId, source_kind: row.sourceKind }));
    storedLedger.forEach(row => { row.accepted_at = row.accepted_at?.toISOString() ?? null; });
    assert.deepEqual(storedLedger, expectedLedger.sort((a,b) => a.accession_number.localeCompare(b.accession_number)));
    assert.ok(ledger.length > 0 || expected.filings.length === 0);
    assert.equal((await client.query('select count(*)::int n from public.sec_company_facts where issuer_cik=$1', [document.cik])).rows[0].n, 0);
    return { sourceId: raw[0].id, hash: raw[0].content_hash, bytes: Buffer.byteLength(document.rawBody),
      name: names[0].entity_name, tickers: tickerRows.map(row => ({ ticker: row.ticker, exchange: row.exchange })),
      filings: storedLedger.length, fetchedAt: raw[0].fetched_at.toISOString(), readBack: 'PASS' };
  } finally { await close(client); }
}
function selectRows(client) {
  const allowed = {
    sec_structured_raw_sources: ['id','fetched_at','cik','source_kind','source_identity'],
    sec_issuer_source_observations: ['entity_name','issuer_cik','source_raw_id'],
    sec_issuer_ticker_observations: ['ticker','exchange','issuer_cik','source_raw_id'],
  };
  return async (table, search) => {
    assert.ok(allowed[table]);
    const columns = search.select.split(','); columns.forEach(c => assert.ok(allowed[table].includes(c)));
    const values = []; const where = [];
    for (const [key,value] of Object.entries(search)) {
      if (['select','order','limit'].includes(key)) continue;
      assert.ok(allowed[table].includes(key)); assert.ok(value.startsWith('eq.'));
      values.push(value.slice(3)); where.push(`${quote(key)}=$${values.length}`);
    }
    const order = search.order ? search.order.split(',').map(item => {
      const [key,direction] = item.split('.'); assert.ok(allowed[table].includes(key)); assert.equal(direction,'desc');
      return `${quote(key)} desc`;
    }).join(',') : '';
    const limit = Number(search.limit); assert.ok(Number.isInteger(limit) && limit > 0 && limit <= 2);
    const rows = (await client.query(`select ${columns.map(quote).join(',')} from public.${quote(table)}
      where ${where.join(' and ')} ${order ? `order by ${order}` : ''} limit ${limit}`, values)).rows;
    return { ok: true, data: rows };
  };
}

try {
  await admin.connect();
  report.engine = await adminIdentity();
  const roles = (await admin.query("select rolname,rolcreatedb,rolbypassrls,rolsuper,rolcanlogin from pg_roles where rolname in ('postgres','service_role','anon','authenticated') order by rolname")).rows;
  assert.equal(roles.length,4); assert.ok(roles.find(row=>row.rolname==='postgres').rolcreatedb);
  assert.ok(roles.find(row=>row.rolname==='service_role').rolbypassrls);
  for (const role of ['anon','authenticated']) assert.equal(roles.find(row=>row.rolname===role).rolbypassrls,false);
  report.roles = roles;
  assert.equal((await admin.query('select oid from pg_database where datname=$1',[database])).rowCount,0);
  await admin.query(`create database ${quote(database)} template template0`); created = true;
  databaseOid = (await admin.query('select oid::text from pg_database where datname=$1',[database])).rows[0].oid;
  await admin.query(`comment on database ${quote(database)} is '${marker}'`);
  report.databaseOid = databaseOid;
  await writeFile(`${output}.identity.json`, JSON.stringify({database,databaseOid,marker,systemId:expectedSystem,createdAt:new Date().toISOString()}), {flag:'wx'});
  console.log(JSON.stringify({phase:'database-created',database,databaseOid,systemId:expectedSystem}));
  report.phase = 'schema';
  const schemaClient = await connect('postgres');
  report.writeTarget = await databaseIdentity(schemaClient);
  assert.equal((await schemaClient.query("select count(*)::int n from pg_tables where schemaname='public'")).rows[0].n,0);
  const migration = 'supabase/migrations/20260821140512_sec_structured_data_foundation_v1.sql';
  const ddl = await readFile(migration,'utf8');
  await schemaClient.query(ddl); report.schema = {migration,sha256:hash(ddl)};
  report.rls = (await schemaClient.query("select relname,relrowsecurity from pg_class where relnamespace='public'::regnamespace and relkind='r' order by relname")).rows;
  assert.equal(report.rls.length,6); assert.ok(report.rls.every(row=>row.relrowsecurity));
  await close(schemaClient);

  const conflictContext={connect,close,repository,snapshot,report};
  if (currentOnly) {
    await verifySubmissionsCurrent(conflictContext);
    if (headerOnly) await verifyCurrentHeader(conflictContext,{connectionString:tempUrl.href,output});
  } else {
  const currentSchema=await connect('postgres');
  await currentSchema.query(await readFile('supabase/migrations/20261006140457_sec_submissions_current.sql','utf8'));
  await close(currentSchema);
  if(process.argv.includes('--pause-for-repair')){
    report.phase='before-races';
    const races=await rawRaces(conflictContext,4,100,false);
    assert.ok(races.some(r=>r.outcomes.some(x=>x.code==='23505')), 'Original defect not reproduced');
    await writeFile(`${output}.before.json`,JSON.stringify(report,null,2),{flag:'wx'});
    console.log(JSON.stringify({phase:'before-reproduced-awaiting-repair',failures:races.filter(r=>r.outcomes.some(x=>x.status==='rejected')).length,continueFile:`${output}.continue`}));
    const deadline=Date.now()+15*60_000;
    while(true){
      try{if((await readFile(`${output}.continue`,'utf8')).trim()==='continue')break;}catch(error){if(error.code!=='ENOENT')throw error;}
      assert.ok(Date.now()<deadline,'Repair pause expired');
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    Repository=(await import(new URL(`../lib/sec-structured-data/repository.ts?repair=${runId}`,import.meta.url).href)).PostgresSecStructuredRepository;
  }
  report.phase='after-races';await rawRaces(conflictContext,10,200,true);
  report.phase='raw-guards';await rawGuards(conflictContext);

  globalThis.fetch = async (input, init) => {
    const url = String(input); assert.ok([...sourceUrls,SEC_COMPANY_CATALOG_URL].includes(url), 'Unapproved network request');
    const attempts = report.http.filter(item=>item.url===url).length;
    assert.ok(attempts < (url===SEC_COMPANY_CATALOG_URL ? 1 : 3), 'Bounded sample request cap');
    const entry = {url,startedAt:new Date().toISOString()}; report.http.push(entry);
    const response = await nativeFetch(input,init); entry.status=response.status; return response;
  };
  const http = new SecStructuredHttpClient(process.env.SEC_USER_AGENT,125,globalThis.fetch);
  const originalSubmissions = http.fetchSubmissions.bind(http);
  http.fetchSubmissions = async (cik,mode) => {
    const docs = await originalSubmissions(cik,mode); assert.equal(docs.length,1); captures.set(cik,docs[0]); return docs;
  };
  http.fetchCompanyFacts = async () => { report.forbiddenCalls++; throw new Error('CompanyFacts forbidden'); };
  report.phase = 'live-ingestion';
  for (const [index,cik] of ciks.entries()) {
    const writer = await connect();
    let result; let concurrent;
    if (index !== ciks.length-1) {
      result = await new SecStructuredDataService(http,repository(writer,`live-${cik}`)).ingestIssuerSubmissions({cik});
      await close(writer);
    } else {
      const second = await connect();
      const pids = await Promise.all([writer,second].map(async c=>(await c.query('select pg_backend_pid() pid')).rows[0].pid));
      assert.notEqual(pids[0],pids[1]);
      let release; const barrier = new Promise(resolve=>{release=resolve;}); let arrived=0;
      const rendezvous = async sql => { if (sql==='begin') { if (++arrived===2) release(); await barrier; } };
      // Second execution reuses the first HTTP body; both managed transactions
      // start together against the previously absent source.
      let publish, rejectDoc;
      const captured = new Promise((resolve,reject)=>{publish=resolve;rejectDoc=reject;});
      const live = { fetchSubmissions: async (...args) => { try {const docs=await http.fetchSubmissions(...args); publish(docs[0]);return docs;}catch(e){rejectDoc(e);throw e;} }, fetchCompanyFacts:http.fetchCompanyFacts };
      const copy = { fetchSubmissions: async () => { report.replayCalls.push({label:'concurrent',source:'submissions'}); return [await captured]; }, fetchCompanyFacts:http.fetchCompanyFacts };
      const settled = await Promise.allSettled([
        new SecStructuredDataService(live,repository(writer,'concurrent-live',rendezvous)).ingestIssuerSubmissions({cik}),
        new SecStructuredDataService(copy,repository(second,'concurrent-replay',rendezvous)).ingestIssuerSubmissions({cik}),
      ]);
      const raceDoc = captures.get(cik);
      report.concurrentAttempt = { cik, pids,
        sourceIdentity: raceDoc?.sourceIdentity,
        hash: raceDoc?.rawBody ? hash(raceDoc.rawBody) : null,
        outcomes: settled.map(item => item.status === 'fulfilled'
          ? { status: item.status, result: item.value }
          : { status: item.status, code: item.reason?.code, constraint: item.reason?.constraint }),
      };
      await close(writer); await close(second);
      for (const item of settled) if(item.status==='rejected') throw item.reason;
      const results = settled.map(item=>item.value); result=results[0]; concurrent={pids,results};
      assert.equal(results.reduce((sum,row)=>sum+row.rawSourcesInserted,0),1);
      assert.equal(results.reduce((sum,row)=>sum+row.issuerObservationsInserted,0),1);
    }
    const doc = captures.get(cik); const batch=normalizeSecStructuredDocuments([doc]);
    assert.equal(batch.rejections.length,0);
    const read = await readBack(doc,batch);
    const attempted = 3 + batch.tickerObservations.length + batch.filings.length;
    const results = concurrent?.results ?? [result];
    assert.equal(results.reduce((sum,row)=>sum+row.inserted,0),attempted);
    assert.equal(results.reduce((sum,row)=>sum+row.updated,0),0);
    assert.equal(results.reduce((sum,row)=>sum+row.deduped,0),concurrent ? attempted : 0);
    report.samples.push({cik,...read,result,concurrent});
    console.log(JSON.stringify({phase:'live-read-back',cik,name:read.name,tickers:read.tickers,filings:read.filings,concurrent:!!concurrent}));
  }
  report.phase = 'detail-reader';
  const catalog = await readSecCompanyCatalog(true);
  report.catalog = {source:SEC_COMPANY_CATALOG_URL,checkedAt:new Date().toISOString(),rows:catalog.rows.length};
  const reader = await connect();
  report.detailReader = [];
  for (const sample of report.samples) for (const pair of sample.tickers) {
    const matches=catalog.rows.filter(row=>row.ticker.toUpperCase()===pair.ticker);
    const result=await readStockHeaderSecIdentity(pair.ticker,{
      readCatalog:async(ticker,options)=>{assert.equal(options.exactTicker,true);assert.equal(ticker,pair.ticker);return{ok:true,data:matches};},
      readCurrent:cik=>readCurrentIssuerSubmissions(reader,{cik}),
    });
    report.detailReader.push({cik:sample.cik,...pair,catalogMatches:matches.map(row=>({ticker:row.ticker,cik:row.cik_str})),result});
    assert.deepEqual(result,{ticker:pair.ticker,status:'not-confirmed',reason:'no-current'});
  }
  report.phase = 'sequential-replay';
  const beforeReplay=await snapshot(reader);
  for (const [cik,doc] of captures) {
    const writer=await connect();
    const result=await new SecStructuredDataService(replay(doc,'live-body-replay'),repository(writer,'live-body-replay')).ingestIssuerSubmissions({cik});
    assert.equal(result.inserted,0); assert.equal(result.updated,0);
    assert.deepEqual(result.sourceUpdates.submissions,{fetched:1,updated:0,unchanged:1});
    await close(writer);
  }
  assert.deepEqual(await snapshot(reader),beforeReplay); report.sequentialReplay='PASS';

  report.phase='fixture-cross-replay';
  const fixture=JSON.parse(await readFile(new URL('../lib/sec-structured-data/fixtures/three-issuer-minimal.json',import.meta.url),'utf8'));
  function fixtureDoc(sample,kind) {
    const url=kind==='submissions'?`https://data.sec.gov/submissions/CIK${sample.cik}.json`:`https://data.sec.gov/api/xbrl/companyfacts/CIK${sample.cik}.json`;
    const rawBody=JSON.stringify(sample[kind]);
    return{sourceKind:kind,sourceUrl:url,sourceIdentity:url,cik:sample.cik,fetchedAt:sample.fetched_at,payload:JSON.parse(rawBody),rawBody,rawBodyKind:'injected_exact_body'};
  }
  const fixtureSample=fixture.issuers[1]; assert.ok(!ciks.includes(fixtureSample.cik));
  const sub=fixtureDoc(fixtureSample,'submissions'), facts=fixtureDoc(fixtureSample,'companyfacts');
  const fixtureWriter=await connect();
  const fixtureService=new SecStructuredDataService(replay(sub,'fixture-cross',facts),repository(fixtureWriter,'fixture-cross'));
  const fixtureResults=[];
  fixtureResults.push(await fixtureService.ingestIssuerSubmissions({cik:sub.cik}));
  fixtureResults.push(await fixtureService.ingestIssuer({cik:sub.cik,mode:'incremental'}));
  const withFacts=await snapshot(reader);
  fixtureResults.push(await fixtureService.ingestIssuerSubmissions({cik:sub.cik}));
  fixtureResults.push(await fixtureService.ingestIssuer({cik:sub.cik,mode:'incremental'}));
  assert.deepEqual(await snapshot(reader),withFacts);
  assert.equal(fixtureResults[1].factsInserted,2);assert.equal(fixtureResults[2].inserted,0);assert.equal(fixtureResults[3].inserted,0);
  assert.equal(fixtureResults[1].sourceUpdates.submissions.unchanged,1);
  await close(fixtureWriter); report.fixtureCross={cik:sub.cik,results:fixtureResults,financialRowsPreserved:true};

  report.phase='sql-rollback';
  const failureSample=fixture.issuers[2]; assert.ok(!ciks.includes(failureSample.cik));
  const failureDoc=fixtureDoc(failureSample,'submissions');
  const control=await connect('postgres');
  const beforeFailure=await snapshot(reader);
  // Existing constraints stay intact. An extra task-only trigger rejects the
  // name insert after raw+issuer inserts have genuinely completed.
  await control.query(`create function public.eeb4_injected_failure() returns trigger language plpgsql as $$
    begin if NEW.issuer_cik = '${failureDoc.cik}' then raise exception 'eeb4 injected failure' using errcode='P0001'; end if; return NEW; end $$;
    create trigger eeb4_injected_failure before insert on public.sec_issuer_source_observations
    for each row execute function public.eeb4_injected_failure()`);
  const failedWriter=await connect();
  await assert.rejects(new SecStructuredDataService(replay(failureDoc,'failure'),repository(failedWriter,'failure')).ingestIssuerSubmissions({cik:failureDoc.cik}),error=>error.code==='P0001');
  await close(failedWriter);
  assert.ok(sqlTrace.some(row=>row.label==='failure'&&row.table==='sec_structured_raw_sources'&&row.rowCount===1));
  assert.ok(sqlTrace.some(row=>row.label==='failure'&&row.table==='sec_issuers'&&row.rowCount===1));
  assert.ok(sqlTrace.some(row=>row.label==='failure'&&row.command==='rollback'));
  assert.deepEqual(await snapshot(reader),beforeFailure);
  await control.query('drop trigger eeb4_injected_failure on public.sec_issuer_source_observations; drop function public.eeb4_injected_failure()');
  await close(control);
  const recovery=await connect();
  const recovered=await new SecStructuredDataService(replay(failureDoc,'recovery'),repository(recovery,'recovery')).ingestIssuerSubmissions({cik:failureDoc.cik});
  assert.equal(recovered.rawSourcesInserted,1);await close(recovery);
  report.rollback={errorCode:'P0001',rawInsertBeforeFailure:1,issuerInsertBeforeFailure:1,entirePriorStatePreserved:true,recovered,triggerRemoved:true};

  report.phase='role-boundaries';
  report.permissions=[];
  for(const role of ['anon','authenticated']){
    const restricted=await connect(role);
    for(const table of tables){
      for(const statement of [`select * from public.${table} limit 1`,`insert into public.${table} default values`]){
        await assert.rejects(restricted.query(statement),error=>error.code==='42501');
        report.permissions.push({role,table,operation:statement.startsWith('select')?'select':'insert',code:'42501'});
      }
    }
    await close(restricted);
  }
  report.finalRowCounts=Object.fromEntries(await Promise.all(tables.map(async table=>[table,(await reader.query(`select count(*)::int n from public.${table}`)).rows[0].n])));
  report.sqlTrace=sqlTrace; report.sql.repositoryStatements=sqlTrace.length;
  assert.equal(report.forbiddenCalls,0);
  await close(reader);
  }
  report.phase='complete'; report.pass=true;
} catch(error) {
  report.pass=false; report.failure={phase:report.phase,name:error.name,code:error.code??null,
    message:error.name==='AssertionError'?'Assertion failed; inspect the recorded phase and inputs':error.message};
  process.exitCode=1;
} finally {
  globalThis.fetch=nativeFetch;
  for(const client of [...clients]) { try{await close(client);}catch{report.cleanup.clientCloseFailure=true;} }
  if(created){
    try{
      await adminIdentity();
      const row=(await admin.query("select oid::text,pg_get_userbyid(datdba) owner,shobj_description(oid,'pg_database') marker from pg_database where datname=$1",[database])).rows[0];
      assert.equal(row.oid,databaseOid);assert.equal(row.owner,'postgres');assert.equal(row.marker,marker);
      assert.match(database,/^sec_submissions_eeb4_[a-f0-9]{32}$/);
      // A just-stopped Next process can take a moment to close its pooled socket.
      // Wait for natural teardown; never terminate another backend or FORCE DROP.
      for(let i=0;i<20;i++) {
        if((await admin.query('select count(*)::int n from pg_stat_activity where datid=$1',[databaseOid])).rows[0].n===0)break;
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      assert.equal((await admin.query('select count(*)::int n from pg_stat_activity where datid=$1',[databaseOid])).rows[0].n,0);
      await admin.query(`drop database ${quote(database)}`); // No FORCE and no terminate_backend.
      assert.equal((await admin.query('select oid from pg_database where datname=$1',[database])).rowCount,0);
      report.cleanup.databaseDropped=true;
    }catch(error){report.cleanup.databaseDropped=false;report.cleanup.errorCode=error.code??error.name;process.exitCode=1;}
  }
  await admin.end();report.cleanup.ownedConnections=clients.size;
  report.finishedAt=new Date().toISOString();
  await writeFile(output,JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify({pass:report.pass,phase:report.phase,failure:report.failure,http:report.http,
    database,cleanup:report.cleanup,receipt:output}));
}
