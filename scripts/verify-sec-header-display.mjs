// Actual Next/React/CSS with synthetic transport only. No SEC or database access.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, connect } from 'node:net';
import { resolve } from 'node:path';
import { normalizeMainSubmissions } from '../lib/sec-structured-data/mainSubmissions.ts';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH ?? 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const phase = process.argv.find(x => x.startsWith('--phase='))?.slice(8);
const output = process.argv.find(x => x.startsWith('--output='))?.slice(9);
assert.ok(['before', 'after'].includes(phase)); assert.ok(output);
const baseline = process.argv.find(x => x.startsWith('--baseline='))?.slice(11);
if (phase === 'after') assert.ok(baseline);
await mkdir(output, { recursive: true });
const stateFile = resolve(output, 'fixture.json'), traceFile = resolve(output, 'trace.jsonl');
const confirmedAt = '2026-10-07T02:03:04.567Z';
const fixture = { unavailableCik: '9000001702', recovered: false, rows: {}, catalog: {} };
for (const [index, ticker] of ['MSFT', 'SYNOK', 'SYNERR'].entries()) {
  const cik = String(9000001700 + index), sourceUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const payload = { cik, name: 'Synthetic Header Fixture Incorporated', tickers: [ticker], exchanges: ['Nasdaq'], filings: { recent: { accessionNumber: [], form: [], filingDate: [] } } };
  fixture.catalog[index] = { cik_str: Number(cik), ticker, title: payload.name };
  if (ticker === 'MSFT') continue; // Synthetic catalog mapping, no current row.
  const batch = normalizeMainSubmissions([{ cik, sourceKind: 'submissions', sourceUrl, sourceIdentity: sourceUrl,
    rawBody: JSON.stringify(payload), rawBodyKind: 'injected_exact_body', payload, fetchedAt: '2026-10-01T00:00:00Z' }], cik, confirmedAt);
  const raw = batch.rawSources[0];
  fixture.rows[cik] = { issuer_cik: cik, source_raw_id: raw.id, current_kind: 'submissions', refresh_sequence: '1', confirmed_at: confirmedAt,
    id: raw.id, cik, source_kind: 'submissions', source_url: sourceUrl, source_identity: sourceUrl, content_hash: raw.contentHash,
    raw_content: raw.rawContent, payload, fetched_at: raw.fetchedAt,
    names: [{ cik, name: payload.name, kind: 'submissions' }], listings: [{ cik, ticker, exchange: 'Nasdaq', kind: 'submissions' }] };
}
await writeFile(stateFile, JSON.stringify(fixture)); await writeFile(traceFile, '');
const report = { phase, fixtureOnly: true, runs: [], externalRequests: 0, databaseAccess: 0 };
const saved = new Map(); for (const file of ['next-env.d.ts', 'tsconfig.json']) saved.set(file, await readFile(file));
let child, logFile, browser;
const port = 3118, base = `http://127.0.0.1:${port}`;
const headerName = 'Stock company and quote';
try {
  const probe = createServer(); probe.listen(port, '127.0.0.1'); await once(probe, 'listening'); await new Promise(r => probe.close(r));
  const env = {};
  for (const key of ['PATH','Path','SystemRoot','SYSTEMROOT','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','COMSPEC']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env, { NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', APP_BASE_URL: base,
    SUPABASE_URL: 'http://fixture.invalid', SUPABASE_SECRET_KEY: 'synthetic-not-a-key',
    SUPABASE_DB_URL: 'postgresql://fixture:fixture@127.0.0.1:1/fixture', SEC_USER_AGENT: 'display-fixture test@example.invalid',
    ALLOW_DEV_FALLBACK_USER: 'false', SEC_HEADER_DISPLAY_FIXTURE: stateFile, SEC_HEADER_DISPLAY_TRACE: traceFile });
  logFile = openSync(resolve(output, 'next.log'), 'a');
  child = spawn(process.execPath, ['--require', resolve('scripts/sec-header-display-fixture-guard.cjs'), 'node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { env, windowsHide: true, stdio: ['ignore', logFile, logFile] });
  report.server = { pid: child.pid, port };
  let ready = false;
  for (let i = 0; i < 60; i++) {
    assert.equal(child.exitCode, null);
    ready = await new Promise(r => { const s = connect(port, '127.0.0.1', () => { s.end(); r(true); }); s.on('error', () => r(false)); });
    if (ready) break; await new Promise(r => setTimeout(r, 500));
  }
  assert.ok(ready); browser = await chromium.launch({ headless: true, channel: 'msedge' });
  async function run(ticker, width, capture, label, watchlist = false) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(120000);
    const result = { ticker, width, capture, label, watchlist, console: [], pageerrors: [], excluded: [] }; report.runs.push(result);
    page.on('console', m => result.console.push({ type: m.type(), text: m.text() }));
    page.on('pageerror', e => result.pageerrors.push(e.message));
    await page.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== base || !['GET', 'HEAD'].includes(req.method())) { result.excluded.push({ path: url.pathname, method: req.method(), action: 'abort' }); return route.abort(); }
      if(watchlist&&url.pathname==='/api/watchlist') {
        // Explicit client-side view-model fixture; no login or save action.
        result.watchlistFixture=true;
        return route.fulfill({status:200,json:{ok:true,data:{guestMode:true,plan:'free',planLabel:'Free',limit:5,usage:1,
          items:[{id:'fixture-row',ticker,companyName:'Synthetic Watchlist Company',createdAt:null,updatedAt:null}]}}});
      }
      if (url.pathname.startsWith('/api/')) { result.excluded.push({ path: url.pathname, action: '503' }); return route.fulfill({ status: 503, json: { ok: false, error: 'Excluded display fixture dependency' } }); }
      return route.continue();
    });
    try {
      await page.goto(watchlist ? `${base}/watchlist?ticker=${ticker}` : `${base}/stocks/${ticker}`, { waitUntil: 'domcontentloaded' });
      const h = page.getByLabel(headerName, { exact: true }); await h.waitFor();
      if(label==='recovered') {
        result.recoveryBefore=await h.getAttribute('data-company-identity-state'); assert.equal(result.recoveryBefore,'unavailable');
        fixture.recovered=true; await writeFile(stateFile,JSON.stringify(fixture));
        await page.reload({waitUntil:'domcontentloaded'}); await h.waitFor();
      }
      // Readiness is established by actual React event handlers, not sleep/DOM alone.
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: 'Search stocks', exact: true }).click();
      await page.getByRole('dialog', { name: 'Search stocks' }).waitFor();
      await page.getByRole('button', { name: 'Close stock search', exact: true }).click();
      await page.getByRole('dialog', { name: 'Search stocks' }).waitFor({ state: 'hidden' });
      // Ordinary Watchlist intentionally hides this badge at narrow widths.
      // Only stock mode promises a visible quote-status badge.
      await h.getByText(watchlist?'TICKER UNAVAILABLE':'QUOTE UNAVAILABLE', { exact: true }).waitFor({state:watchlist?'attached':'visible'});
      const inputs = () => page.locator('input').evaluateAll(es => es.map(e => ({ id: e.id, style: e.getAttribute('style') })));
      const hydration = () => result.console.filter(m => /hydrat|server rendered HTML|server-rendered HTML/i.test(m.text));
      result.readyInteraction = 'search opened and closed';
      result.hydrationBeforeCapture = hydration(); result.stylesBeforeCapture = await inputs();
      result.measure = await h.evaluate(e => {
        const p = e.querySelector('p'), s = getComputedStyle(p), range = document.createRange(); range.selectNodeContents(p);
        const rect = r => ({ x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom });
        const box = rect(p.getBoundingClientRect());
        const children = [...e.children].map(n => rect(n.getBoundingClientRect()));
        const overlaps = children.flatMap((a,i) => children.slice(i+1).filter(b => Math.min(a.right,b.right)-Math.max(a.x,b.x)>1 && Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)>1));
        return { state: e.dataset.companyIdentityState ?? null, text: p.textContent, time: e.querySelector('time')?.getAttribute('datetime') ?? null,
          timeText: e.querySelector('time')?.textContent ?? null, css: { whiteSpace:s.whiteSpace,overflow:s.overflow,textOverflow:s.textOverflow,lineClamp:s.webkitLineClamp,fontSize:s.fontSize },
          paragraph:box,clientWidth:p.clientWidth,scrollWidth:p.scrollWidth,clientHeight:p.clientHeight,scrollHeight:p.scrollHeight,
          textRects:[...range.getClientRects()].map(rect), header:rect(e.getBoundingClientRect()),overlaps:overlaps.length,
          pageOverflow:document.documentElement.scrollWidth>innerWidth+1,
          heading:{ text:e.querySelector('h2')?.textContent,css:getComputedStyle(e.querySelector('h2')).whiteSpace },
          headerText:e.innerText };
      });
      if (capture) await page.screenshot({ path: resolve(output, `${label}-${width}.png`), caret: 'initial' });
      result.stylesAfterCapture = await inputs(); result.hydrationAfterCapture = hydration();
      assert.deepEqual(result.stylesAfterCapture, result.stylesBeforeCapture); assert.deepEqual(result.pageerrors, []);
      assert.deepEqual(result.hydrationBeforeCapture, []); assert.deepEqual(result.hydrationAfterCapture, []);
      const m = result.measure;
      assert.equal(m.overlaps, 0); assert.equal(m.pageOverflow, false);
      if (!watchlist && ['MSFT', 'SYNERR'].includes(ticker) && !fixture.recovered) {
        assert.equal(m.state, ticker === 'MSFT' ? 'not-confirmed' : 'unavailable'); assert.equal(m.time, null);
        assert.equal(m.text, ticker === 'MSFT' ? 'Company information not yet confirmed' : 'Company information temporarily unavailable');
        if (phase === 'before' && width === 390) { assert.equal(m.css.whiteSpace, 'nowrap'); assert.ok(m.scrollWidth > m.clientWidth); }
        if (phase === 'after') {
          assert.equal(m.css.whiteSpace, 'normal'); assert.equal(m.css.textOverflow, 'clip');
          assert.ok(m.scrollWidth <= m.clientWidth + 1 && m.scrollHeight <= m.clientHeight + 1);
          assert.ok(m.textRects.every(r => r.x >= m.paragraph.x - 1 && r.right <= m.paragraph.right + 1 && r.bottom <= m.paragraph.bottom + 1));
        }
      } else if (!watchlist) {
        assert.equal(m.state, 'available'); assert.equal(m.time, confirmedAt); assert.match(m.timeText, /UTC$/);
        assert.equal(m.text, 'Synthetic Header Fixture Incorporated'); assert.equal(m.css.whiteSpace, 'nowrap'); assert.equal(m.css.textOverflow, 'ellipsis');
      } else { assert.equal(m.state, null); assert.equal(m.css.whiteSpace, 'nowrap'); assert.equal(m.time, null); }
      result.pass = true; console.log(JSON.stringify({ label, width, state:m.state, pass:true }));
    } finally { await context.close(); }
  }
  // B-D: entire navigation before any screenshot; E-F: a fresh context, initial caret.
  for (const ticker of ['MSFT','SYNERR']) {
    await run(ticker,390,false,`${ticker}-no-capture`);
    for (const width of phase === 'before' ? [390] : [390,900,1440]) await run(ticker,width,true,ticker);
  }
  for (const width of [390,900,1440]) { await run('SYNOK',width,true,'available'); await run('SYNOK',width,true,'watchlist',true); }
  if (phase === 'after') {
    await run('SYNERR',390,true,'recovered');
    const before = JSON.parse(await readFile(baseline,'utf8'));
    for (const run of report.runs.filter(r=>['available','watchlist'].includes(r.label))) {
      const previous=before.runs.find(r=>r.label===run.label&&r.width===run.width);
      for(const field of ['css','text','time','heading','clientWidth','clientHeight']) assert.deepEqual(run.measure[field],previous.measure[field]);
    }
  }
  const trace=(await readFile(traceFile,'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(trace.every(row=>row.transmitted===false)); report.fixtureBoundaryCalls=trace.length;
  report.pass=true;
} catch(error) { report.pass=false; report.failure=error.message; process.exitCode=1; }
finally {
  if(browser)await browser.close();
  if(child&&child.exitCode===null){child.kill();await once(child,'exit');}
  if(logFile!==undefined)closeSync(logFile);
  for(const [file,bytes] of saved)if(!(await readFile(file)).equals(bytes)){await writeFile(file,bytes);(report.generatedRestored??=[]).push(file);}
  report.ownedResourcesClosed=true;
  await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pass:report.pass,failure:report.failure,runs:report.runs.length,receipt:resolve(output,'report.json')}));
}
