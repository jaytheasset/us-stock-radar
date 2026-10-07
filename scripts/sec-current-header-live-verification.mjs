// Verification only. Same owned DB from browser preflight through live read-back.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access, unlink } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createServer, connect as connectSocket } from 'node:net';
import { resolve } from 'node:path';
import { SecSubmissionsRefreshService } from '../lib/sec-structured-data/submissionsRefresh.ts';
import { readCurrentIssuerSubmissions } from '../lib/sec-structured-data/currentSubmissionsReader.ts';
import { readSecCompanyCatalog, SEC_COMPANY_CATALOG_URL } from '../lib/sources/sec/tickerCatalog.ts';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const hash = value => createHash('sha256').update(value).digest('hex');
const ciks = ['0000320193', '0001652044', '0001853138'];

export async function verifyLiveCurrentHeader(ctx, { connectionString, output }) {
  assert.ok(process.env.SEC_USER_AGENT, 'Existing SEC user agent required');
  const report = ctx.report.header = { mode: 'live-completion', samples: [], http: [], browserAttempts: [], realSubmissionsAttempts: 0 };
  const directory = output + '.artifacts';
  await mkdir(directory, { recursive: true });
  const trace = resolve(directory, 'next-trace.jsonl');
  const expectedFile = resolve(directory, 'expected.json');
  await writeFile(trace, '');
  // One external preservation file; never reconstruct a source from a DTO.
  const preservation = { mode: 'original live acquisition', samples: [] };
  const preservedFile = resolve(directory, 'acquisition.json');
  await writeFile(preservedFile, JSON.stringify(preservation), { flag: 'wx' });
  const saved = new Map();
  for (const file of ['next-env.d.ts', 'tsconfig.json']) saved.set(file, await readFile(file));
  let child, logFile, reader, control;
  const nativeFetch = globalThis.fetch;
  const attempted = new Set();
  let allowSubmissions = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    const method = (init?.method ?? input.method ?? 'GET').toUpperCase();
    assert.equal(method, 'GET');
    const cik = /^https:\/\/data\.sec\.gov\/submissions\/CIK(\d{10})\.json$/.exec(url.href)?.[1];
    assert.ok(url.href === SEC_COMPANY_CATALOG_URL || (allowSubmissions && ciks.includes(cik)), 'Unexpected external request');
    if (cik) {
      assert.ok(!attempted.has(cik) && attempted.size < 3, 'External attempt cap; no repeat CIK');
      attempted.add(cik); report.realSubmissionsAttempts++;
    }
    const call = { url: url.href, startedAt: new Date().toISOString(), kind: cik ? 'submissions' : 'catalog' };
    report.http.push(call);
    const response = await nativeFetch(input, init); call.status = response.status;
    return response;
  };
  try {
    control = await ctx.connect('postgres'); reader = await ctx.connect();
    await control.query('begin');
    await control.query('create temporary table header_preflight_probe (value integer) on commit drop');
    await control.query('insert into header_preflight_probe values (1)');
    assert.equal((await control.query('select value from header_preflight_probe')).rows[0].value, 1);
    await control.query('commit');
    report.dbPreflight = { temporaryWriteRead: true, currentRows: (await reader.query('select count(*)::int n from public.sec_submissions_current')).rows[0].n };
    assert.equal(report.dbPreflight.currentRows, 0);

    // Existing CLI status is read-only. Never print returned credentials.
    const local = JSON.parse(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    const rest = new URL(local.API_URL);
    assert.equal(rest.hostname, '127.0.0.1'); assert.equal(rest.port, '56321');
    const probe = await nativeFetch(`${rest.origin}/rest/v1/tickers?select=symbol&limit=1`, { headers: { apikey: local.SERVICE_ROLE_KEY, Authorization: `Bearer ${local.SERVICE_ROLE_KEY}` }, signal: AbortSignal.timeout(5000) });
    assert.equal(probe.status, 200); assert.ok(Array.isArray(await probe.json()));
    report.restPreflight = { source: 'existing local CLI status', status: 200, target: 'development PostgREST postgres, read-only GET', sqlTarget: ctx.report.database };
    const port = Number(process.env.SEC_HEADER_PORT ?? 3118); assert.ok(port >= 3111);
    const portProbe = createServer(); portProbe.listen(port, '127.0.0.1'); await once(portProbe, 'listening');
    await new Promise((r, j) => portProbe.close(e => e ? j(e) : r()));
    const env = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC']) if (process.env[key]) env[key] = process.env[key];
    Object.assign(env, { NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', SUPABASE_DB_URL: connectionString,
      SUPABASE_URL: rest.origin, SUPABASE_SECRET_KEY: local.SERVICE_ROLE_KEY, SEC_USER_AGENT: process.env.SEC_USER_AGENT,
      SEC_HEADER_TRACE: trace, APP_BASE_URL: `http://127.0.0.1:${port}`, ALLOW_DEV_FALLBACK_USER: 'false' });
    logFile = openSync(resolve(directory, 'next.log'), 'a');
    child = spawn(process.execPath, ['--require', resolve('scripts/sec-current-header-next-guard.cjs'), 'node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], { env, windowsHide: true, stdio: ['ignore', logFile, logFile] });
    report.server = { pid: child.pid, port };
    console.log(JSON.stringify({ phase: 'live-header-preflight-next', ...report.server }));
    let listening = false;
    for (let i = 0; i < 60; i++) {
      assert.equal(child.exitCode, null, 'Owned Next exited');
      listening = await new Promise(r => { const socket = connectSocket(port, '127.0.0.1', () => { socket.end(); r(true); }); socket.on('error', () => r(false)); });
      if (listening) break; await sleep(1000);
    }
    assert.ok(listening);
    const browserEnv = { ...env, PLAYWRIGHT_MODULE_PATH: 'C:/Users/PC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
      SEC_HEADER_BASE: env.APP_BASE_URL, SEC_HEADER_EXPECTED: expectedFile, SEC_HEADER_OUTPUT: directory };
    async function browser(phase) {
      const run = spawn(process.execPath, ['scripts/sec-current-header-browser.cjs'], { env: { ...browserEnv, SEC_HEADER_PHASE: phase }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      run.stdout.on('data', b => process.stdout.write(b)); run.stderr.on('data', b => process.stderr.write(b));
      const code = (await once(run, 'exit'))[0]; report.browserAttempts.push({ phase, code }); return code;
    }
    const catalog = await readSecCompanyCatalog(true);
    const first = catalog.rows.find(row => String(row.cik_str).padStart(10, '0') === ciks[0]); assert.ok(first);
    await writeFile(expectedFile, JSON.stringify({ pairs: [{ ticker: first.ticker }] }));
    assert.equal(await browser('preflight'), 0, 'Public browser/search must pass before live refresh');
    const preflightTrace = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(preflightTrace.some(row => row.readCurrent));
    assert.equal(report.realSubmissionsAttempts, 0);
    report.preflightCompletedAt = new Date().toISOString();
    console.log(JSON.stringify({ phase: 'live-header-environment-pass', submissions: 0 }));

    allowSubmissions = true;
    for (const cik of ciks) {
      const writer = await ctx.connect(); let capture;
      try {
        const service = new SecSubmissionsRefreshService(ctx.repository(writer, 'header-live-completion'), process.env.SEC_USER_AGENT, {
          fetchImplementation: async (url, init) => {
            assert.equal(url, `https://data.sec.gov/submissions/CIK${cik}.json`);
            const response = await globalThis.fetch(url, init);
            const rawBody = await response.clone().text();
            capture = { cik, sourceUrl: url, status: response.status, acquiredAt: new Date().toISOString(), rawBody, sha256: hash(rawBody) };
            preservation.samples.push(capture); await writeFile(preservedFile, JSON.stringify(preservation));
            return response;
          },
        });
        const result = await service.refreshIssuerSubmissions({ cik });
        const current = await readCurrentIssuerSubmissions(reader, { cik }); assert.equal(current.status, 'available');
        const raw = (await reader.query('select * from public.sec_structured_raw_sources where id=$1', [current.sourceRawId])).rows[0];
        const payload = JSON.parse(capture.rawBody);
        assert.equal(raw.raw_content, capture.rawBody); assert.equal(raw.content_hash, capture.sha256);
        assert.equal(current.contentHash, capture.sha256); assert.equal(raw.source_url, capture.sourceUrl);
        assert.equal(current.entityName, payload.name.trim());
        assert.deepEqual(current.listings, payload.tickers.map((ticker, i) => ({ ticker: ticker.trim().toUpperCase(), exchange: payload.exchanges[i].trim() })));
        assert.equal(current.confirmedAt, result.confirmation.confirmedAt);
        assert.equal(current.firstFetchedAt, raw.fetched_at.toISOString());
        capture.current = current; capture.refreshResult = result; capture.firstFetchedAt = current.firstFetchedAt;
        await writeFile(preservedFile, JSON.stringify(preservation));
        const pairs = current.listings.filter(pair => catalog.rows.some(row => row.ticker === pair.ticker && String(row.cik_str).padStart(10, '0') === cik))
          .map(pair => ({ ...pair, companyName: current.entityName, confirmedAt: current.confirmedAt }));
        assert.ok(pairs.length); report.samples.push({ cik, current, pairs, independentReadBack: 'PASS' });
        console.log(JSON.stringify({ phase: 'live-header-stored', cik, tickers: pairs.map(p => p.ticker), confirmedAt: current.confirmedAt }));
      } finally { await ctx.close(writer); }
    }
    allowSubmissions = false;
    // Keep the actual raw order. Two exact listings from each multi-listing issuer
    // are representative identity checks, not a security-class inference engine.
    const pairs = report.samples.flatMap((sample, i) => sample.pairs.slice(0, i === 0 ? 1 : 2));
    assert.equal(pairs.length, 5, 'Need one single and two multi-listing representatives');
    const missing = catalog.rows.find(row => row.ticker === 'MSFT' && !ciks.includes(String(row.cik_str).padStart(10, '0')));
    assert.ok(missing); assert.deepEqual(await readCurrentIssuerSubmissions(reader, { cik: String(missing.cik_str) }), { status: 'not-confirmed' });
    report.representatives = pairs;
    await writeFile(expectedFile, JSON.stringify({ pairs, missingTicker: missing.ticker }));
    const state = async () => ({ rawAndObservations: await ctx.snapshot(reader),
      current: (await reader.query('select jsonb_agg(to_jsonb(c) order by issuer_cik)::text v from public.sec_submissions_current c')).rows[0].v,
      sequence: (await control.query('select last_value::text,is_called from public.sec_submissions_refresh_sequence')).rows[0] });
    const before = await state(); const attemptsBefore = report.realSubmissionsAttempts;
    report.initialStateHash = hash(JSON.stringify(before));
    let code = await browser('live');
    // At most two explicit harness retries, each with a ten-minute control deadline.
    for (let retry = 0; code !== 0 && retry < 2 && process.argv.includes('--pause-header'); retry++) {
      const deadline = Date.now() + 600000;
      console.log(JSON.stringify({ phase: 'live-header-browser-paused', control: output + '.continue', deadline: new Date(deadline).toISOString() }));
      let command;
      while (Date.now() < deadline) {
        try { await access(output + '.continue'); command = (await readFile(output + '.continue', 'utf8')).trim(); await unlink(output + '.continue'); break; } catch { await sleep(1000); }
      }
      assert.equal(command, 'retry', 'Bounded browser retry ended; original bodies preserved');
      code = await browser('live');
    }
    assert.equal(code, 0, 'Same live samples in browser');
    const after = await state(); assert.deepEqual(after, before);
    assert.equal(report.realSubmissionsAttempts, attemptsBefore);
    report.repeatedGet = { stateHashBefore: report.initialStateHash, stateHashAfter: hash(JSON.stringify(after)), unchanged: true, submissionsAfterInitial: 0, sequence: after.sequence };
    const rows = (await readFile(trace, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(rows.filter(r => r.kind === 'sql').every(r => r.database === ctx.report.database));
    assert.ok(!rows.some(r => r.kind === 'http' && r.path.startsWith('/submissions/')));
    report.trace = { currentReads: rows.filter(r => r.readCurrent).length, catalogAttempts: rows.filter(r => r.kind === 'http' && r.path === '/files/company_tickers.json').length,
      restGets: rows.filter(r => r.kind === 'http' && r.host === rest.host && r.allowed).length, blocked: rows.filter(r => r.kind === 'http' && !r.allowed) };
    report.pass = true;
  } finally {
    globalThis.fetch = nativeFetch;
    if (child && child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    if (logFile !== undefined) closeSync(logFile);
    for (const [file, bytes] of saved) if (!(await readFile(file)).equals(bytes)) { await writeFile(file, bytes); (report.generatedRestored ??= []).push(file); }
    if (reader) await ctx.close(reader); if (control) await ctx.close(control);
    report.ownedNextStopped = true; report.preservationFile = preservedFile;
  }
}
