import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { SecSubmissionsRefreshService } from '../lib/sec-structured-data/submissionsRefresh.ts';
import { readCurrentIssuerSubmissions } from '../lib/sec-structured-data/currentSubmissionsReader.ts';
import { readStockHeaderSecIdentity } from '../lib/watchlist/stockHeaderSecIdentity.ts';
import { readStockHeaderCurrent, STOCK_HEADER_DB_LIMITS } from '../lib/watchlist/stockHeaderCurrentReader.ts';
import { createServerPostgresPool } from '../lib/serverPostgres.ts';
import { readSecCompanyCatalog } from '../lib/sources/sec/tickerCatalog.ts';
import { syntheticDocument } from './sec-submissions-conflict-cases.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export async function verifyCurrentHeader(ctx,{connectionString,output}) {
  const report=ctx.report.header={samples:[],limits:[],browser:[],realSubmissionsAttempts:0};
  const control=await ctx.connect('postgres'),reader=await ctx.connect();
  const directory=output+'.artifacts';await mkdir(directory,{recursive:true});
  const trace=resolve(directory,'next-trace.jsonl');await writeFile(trace,'');
  let child;let logFile;const saved=new Map();
  for(const file of ['next-env.d.ts','tsconfig.json'])saved.set(file,await readFile(file));
  const catalog=await readSecCompanyCatalog(true);
  const catalogFor=ticker=>({ok:true,data:catalog.rows.filter(row=>row.ticker===ticker)});
  // Resolve and exercise REST credentials BEFORE consuming any real SEC calls.
  // Read-only CLI status, no container or role changes. Values stay in memory.
  const localStatus=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  const restUrl=localStatus.API_URL;const rest=new URL(restUrl);assert.equal(rest.hostname,'127.0.0.1');assert.equal(rest.port,'56321');
  const restProbe=await fetch(`${restUrl}/rest/v1/tickers?select=symbol&limit=1`,{headers:{apikey:localStatus.SERVICE_ROLE_KEY,Authorization:`Bearer ${localStatus.SERVICE_ROLE_KEY}`}});
  assert.equal(restProbe.status,200);assert.ok(Array.isArray(await restProbe.json()));
  report.restPreflight={source:'local CLI status legacy service key, process-only',status:200,readOnly:true,sqlTarget:'owned temporary DB',restTarget:'existing development postgres via PostgREST'};
  try {
    const smoke=process.argv.includes('--header-smoke');
    if(smoke){const current=await readCurrentIssuerSubmissions(reader,{cik:'0000320193'});assert.equal(current.status,'available');const identity=await readStockHeaderSecIdentity('AAPL',{readCatalog:async()=>catalogFor('AAPL'),readCurrent:async()=>current});assert.equal(identity.status,'available');report.samples.push({current,pairs:[identity],fixtureOnly:true});}
    for(const cik of smoke?[]:['0000320193','0001652044','0001853138']) {
      const writer=await ctx.connect();let received;
      const service=new SecSubmissionsRefreshService(ctx.repository(writer,'header-live'),process.env.SEC_USER_AGENT,{
        fetchImplementation:async(url,init)=>{
          assert.equal(url,`https://data.sec.gov/submissions/CIK${cik}.json`);
          assert.ok(++report.realSubmissionsAttempts<=3,'at most three real main requests');
          const response=await fetch(url,init);received=await response.clone().json();return response;
        },
      });
      const result=await service.refreshIssuerSubmissions({cik});await ctx.close(writer);
      const current=await readCurrentIssuerSubmissions(reader,{cik});assert.equal(current.status,'available');
      assert.equal(current.entityName,received.name);
      const pairs=[];
      for(const pair of current.listings) {
        const identity=await readStockHeaderSecIdentity(pair.ticker,{readCatalog:async()=>catalogFor(pair.ticker),readCurrent:cik=>readCurrentIssuerSubmissions(reader,{cik})});
        if(identity.status==='available') {assert.equal(identity.exchange,pair.exchange);pairs.push(identity);}
      }
      assert.ok(pairs.length);report.samples.push({cik,result,current,pairs});
    }
    // A separate synthetic issuer tests missing exact listing and adapter ABA.
    const doc=syntheticDocument(1500);doc.payload.name='Synthetic Header Verification';doc.payload.tickers=['SYNHDR'];
    let payload=doc.payload;let clock=Date.parse('2026-10-07T01:00:00Z');
    const synth=()=>new SecSubmissionsRefreshService(ctx.repository(control,'header-synthetic'),'test test@example.invalid',{
      now:()=>new Date(clock),fetchImplementation:async()=>Response.json(payload),
    }).refreshIssuerSubmissions({cik:doc.cik});
    const a=await synth();payload={...payload,name:'Synthetic Header B'};clock+=1000;await synth();payload=doc.payload;clock+=1000;await synth();
    const aba=await readStockHeaderSecIdentity('SYNHDR',{readCatalog:async()=>({ok:true,data:[{ticker:'SYNHDR',cik_str:doc.cik}]}),readCurrent:cik=>readCurrentIssuerSubmissions(reader,{cik})});
    assert.equal(aba.companyName,doc.payload.name);assert.equal(aba.confirmedAt,new Date(clock).toISOString());
    assert.equal((await reader.query('select count(*)::int n from public.sec_structured_raw_sources where cik=$1',[doc.cik])).rows[0].n,2);
    assert.equal((await readCurrentIssuerSubmissions(reader,{cik:doc.cik})).sourceRawId,a.confirmation.sourceRawId);
    report.aba={boundary:'actual SQL -> header adapter; synthetic HTTP',identity:aba,rawCount:2};
    payload={...doc.payload,tickers:[],exchanges:[]};clock+=1000;await synth();
    if(smoke){
      const classes=syntheticDocument(1501);classes.payload.name='Synthetic Header Classes';
      classes.payload.tickers=['SYNHDA','SYNHDB'];classes.payload.exchanges=['Synthetic Common Exchange','Synthetic Warrant Exchange'];
      await new SecSubmissionsRefreshService(ctx.repository(control,'fixture-classes'),'test test@example.invalid',{
        fetchImplementation:async()=>Response.json(classes.payload),
      }).refreshIssuerSubmissions({cik:classes.cik});
      const current=await readCurrentIssuerSubmissions(reader,{cik:classes.cik});assert.equal(current.status,'available');
      report.samples.push({current,fixtureOnly:true,pairs:current.listings.map(p=>({ticker:p.ticker,status:'available',companyName:current.entityName,exchange:p.exchange,confirmedAt:current.confirmedAt}))});
    }
    const pool=createServerPostgresPool({SUPABASE_DB_URL:connectionString},STOCK_HEADER_DB_LIMITS);
    try {
      const held=await pool.connect();let start=performance.now();
      assert.equal((await readStockHeaderCurrent(doc.cik,pool)).status,'unavailable');
      const acquisitionMs=performance.now()-start;assert.ok(acquisitionMs>=4800&&acquisitionMs<7000);held.release();
      report.limits.push({case:'acquisition queue',ms:acquisitionMs});
      await control.query('begin');await control.query('lock public.sec_submissions_current in access exclusive mode');start=performance.now();
      assert.equal((await readStockHeaderCurrent(doc.cik,pool)).status,'unavailable');
      const sqlMs=performance.now()-start;assert.ok(sqlMs>=4800&&sqlMs<7000);await control.query('rollback');
      report.limits.push({case:'actual SQL lock timeout',ms:sqlMs});
      assert.equal((await readStockHeaderCurrent(doc.cik,pool)).status,'available');
    } finally {await pool.end();}
    const refused=new URL(connectionString);refused.port='1';
    const refusedPool=createServerPostgresPool({SUPABASE_DB_URL:refused.href},STOCK_HEADER_DB_LIMITS);
    try{const start=performance.now();assert.equal((await readStockHeaderCurrent(doc.cik,refusedPool)).status,'unavailable');report.limits.push({case:'connection refused',ms:performance.now()-start});}finally{await refusedPool.end();}
    const originalDb=process.env.SUPABASE_DB_URL;delete process.env.SUPABASE_DB_URL;
    assert.equal((await readStockHeaderCurrent(doc.cik)).status,'unavailable');
    if(originalDb)process.env.SUPABASE_DB_URL=originalDb;
    report.limits.push({case:'missing configuration',result:'unavailable'});
    const state=async()=>({raw:await ctx.snapshot(reader),current:(await reader.query('select jsonb_agg(to_jsonb(c) order by issuer_cik)::text v from public.sec_submissions_current c')).rows[0].v,
      sequence:(await control.query('select last_value::text,is_called from public.sec_submissions_refresh_sequence')).rows[0]});
    const before=await state();
    const expected={pairs:report.samples.flatMap(s=>s.pairs),syntheticCik:doc.cik,syntheticTicker:'SYNHDR',missingTicker:'MSFT'};
    const expectedFile=resolve(directory,'expected.json');await writeFile(expectedFile,JSON.stringify(expected));
    const port=Number(process.env.SEC_HEADER_PORT??3118);assert.ok(port>=3111);
    const env={};for(const k of ['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC'])if(process.env[k])env[k]=process.env[k];
    Object.assign(env,{NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',SUPABASE_DB_URL:connectionString,
      SUPABASE_URL:restUrl,SUPABASE_SECRET_KEY:localStatus.SERVICE_ROLE_KEY,
      SEC_USER_AGENT:process.env.SEC_USER_AGENT,SEC_HEADER_TRACE:trace,SEC_HEADER_SYNTHETIC_CIK:doc.cik,
      SEC_HEADER_FIXTURE_ONLY:String(smoke),
      APP_BASE_URL:`http://127.0.0.1:${port}`,ALLOW_DEV_FALLBACK_USER:'false'});
    const fs=await import('node:fs');logFile=fs.openSync(resolve(directory,'next.log'),'a');
    child=spawn(process.execPath,['--require',resolve('scripts/sec-current-header-next-guard.cjs'),'node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{env,windowsHide:true,stdio:['ignore',logFile,logFile]});
    report.server={pid:child.pid,port};console.log(JSON.stringify({phase:'header-next-start',...report.server,artifacts:directory}));
    // Wait only for the listening socket; the first rendered request is the browser check.
    const net=await import('node:net');let listening=false;
    for(let i=0;i<90;i++){if(child.exitCode!==null)throw Error('Next exited before ready');listening=await new Promise(resolve=>{const s=net.connect(port,'127.0.0.1',()=>{s.end();resolve(true);});s.on('error',()=>resolve(false));});if(listening)break;await sleep(1000);}
    assert.ok(listening);
    const browserEnv={...env,PLAYWRIGHT_MODULE_PATH:'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
      SEC_HEADER_BASE:`http://127.0.0.1:${port}`,SEC_HEADER_EXPECTED:expectedFile,SEC_HEADER_OUTPUT:resolve(directory),SEC_HEADER_PHASE:'normal'};
    async function browser(phase){
      const run=spawn(process.execPath,['scripts/sec-current-header-browser.cjs'],{env:{...browserEnv,SEC_HEADER_PHASE:phase},windowsHide:true,stdio:['ignore','pipe','pipe']});
      run.stdout.on('data',b=>process.stdout.write(b));run.stderr.on('data',b=>process.stderr.write(b));
      return (await once(run,'exit'))[0];
    }
    let code=await browser('normal');
    while(code!==0&&process.argv.includes('--pause-header')){
      console.log(JSON.stringify({phase:'header-browser-paused',control:output+'.continue'}));
      while(true){try{await access(output+'.continue');break;}catch{}await sleep(1000);}
      const command=(await readFile(output+'.continue','utf8')).trim();await unlink(output+'.continue');
      if(command!=='retry')throw Error('Header verification stopped');code=await browser('normal');
    }
    assert.equal(code,0,'browser normal flow');
    await control.query('alter table public.sec_submissions_current rename to sec_submissions_current_test_hidden');
    try{assert.equal(await browser('db-failure'),0);}finally{await control.query('alter table public.sec_submissions_current_test_hidden rename to sec_submissions_current');}
    assert.equal(await browser('recovery'),0);
    assert.deepEqual(await state(),before);report.repeatedGet={rawObservationsCurrentSequenceUnchanged:true,submissionsRequestsAfterInitial:0};
    const traceRows=(await readFile(trace,'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(traceRows.some(x=>x.kind==='sql'&&x.readCurrent));
    assert.ok(traceRows.filter(x=>x.kind==='sql').every(x=>x.database===new URL(connectionString).pathname.slice(1)));
    assert.ok(!traceRows.some(x=>x.kind==='http'&&x.path.startsWith('/submissions/')));
    report.trace={currentSql:traceRows.filter(x=>x.readCurrent).length,blockedHttp:traceRows.filter(x=>x.kind==='http'&&!x.allowed),
      readOnlyRest:traceRows.filter(x=>x.kind==='http'&&x.host===rest.host&&x.allowed).length};
    report.pass=true;
  } finally {
    if(child&&child.exitCode===null){child.kill();await once(child,'exit');}if(logFile!==undefined)(await import('node:fs')).closeSync(logFile);
    for(const [file,bytes] of saved){const after=await readFile(file);if(!after.equals(bytes)){report.generatedRestored??=[];report.generatedRestored.push(file);await writeFile(file,bytes);}}
    await ctx.close(reader);await ctx.close(control);report.ownedNextStopped=true;
  }
}
