// Native fetch + native Response against an ephemeral loopback HTTP server only.
// --before reproduces the header-only timeout weakness before the F1 fix.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { registerHooks } from 'node:module';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { NextRequest } from 'next/server.js';

const before = process.argv.includes('--before');
const output = process.argv.find((s) => s.startsWith('--output='))?.slice(9);
// Read-only inspection of the *actual* cache closure; no get/load/timer branch is
// replaced. Accessors exist only in this test process, never in product files.
const hooks = registerHooks({
  resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); },
  load(url, c, next) {
    const loaded = next(url, c);
    if (!url.endsWith('/tickerCatalog.ts') && !url.endsWith('/tickerCatalogCache.ts')) return loaded;
    let source = readFileSync(new URL(url), 'utf8');
    if (url.endsWith('/tickerCatalogCache.ts')) {
      assert.ok(source.includes('    state() {'));
      source = source.replace('    state() {', '    snapshotForTest() { return structuredClone(snapshot); },\n    state() {');
    } else source += '\nexport const inspectCompanyCacheForTest = () => ({ ...companyCache.state(), snapshot: companyCache.snapshotForTest() });\n';
    return { ...loaded, format: 'module-typescript', source };
  },
});
const reader = await import('../lib/sources/sec/tickerCatalog.ts');
const { fetchSecCompanyTickers, probeSec } = await import('../lib/integrations.ts');
const { GET } = await import('../app/api/sec/company-tickers/route.ts');
const nativeFetch = globalThis.fetch, oldAgent = process.env.SEC_USER_AGENT;
process.env.SEC_USER_AGENT = 'Synthetic loopback test contact@example.test';
const company = (ticker) => JSON.stringify({ 0: { cik_str: 1234567, ticker, title: 'Synthetic Streaming Company' } });
let mode = 'good', value = 'OLD', companyRequests = 0, exchangeRequests = 0;
let activeResponse, start = 0, flight = null;
const resources = new Set(), sockets = new Set();
const server = createServer((req, res) => {
  res.on('error', () => {});
  if (req.url === '/exchange') {
    exchangeRequests++; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [[1234567, 'Synthetic Exchange Company', 'XSYN', 'NYSE']] })); return;
  }
  assert.equal(req.url, '/company'); companyRequests++;
  activeResponse = res;
  if (flight) {
    flight.serverStartedMs = performance.now() - start;
    res.on('close', () => { flight.serverClosedMs = performance.now() - start; });
  }
  const schedule = (fn, ms) => { const timer = setTimeout(() => { resources.delete(timer); fn(); }, ms); resources.add(timer); return timer; };
  if (mode === 'headers-stall') return;
  res.writeHead(200, { 'Content-Type': 'application/json' }); res.flushHeaders();
  if (mode === 'good') { res.end(company(value)); return; }
  if (mode === 'invalid') { res.end('{bad json'); return; }
  if (mode === 'broken') { res.write('{'); schedule(() => res.destroy(), 50); return; }
  if (mode === 'complete-stream') {
    const body = company(value); res.write(body.slice(0, 12)); schedule(() => res.end(body.slice(12)), 150); return;
  }
  res.write('{');
  if (mode === 'drip') {
    const timer = setInterval(() => { if (flight) flight.chunks++; res.write(' '); }, 500);
    resources.add(timer); res.on('close', () => { clearInterval(timer); resources.delete(timer); });
  }
});
server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
assert.ok(port > 3110);
globalThis.fetch = async (url, init) => {
  const isCompany = String(url) === reader.SEC_COMPANY_CATALOG_URL;
  assert.ok(isCompany || String(url) === reader.SEC_EXCHANGE_CATALOG_URL, 'No external request permitted');
  assert.ok(init.signal);
  const observation = isCompany ? flight : null;
  if (observation) {
    observation.httpAttempts++;
    init.signal.addEventListener('abort', () => { observation.abortMs = performance.now() - start; }, { once: true });
  }
  const response = await nativeFetch(`http://127.0.0.1:${port}/${isCompany ? 'company' : 'exchange'}`, init);
  assert.ok(response instanceof Response);
  if (observation) observation.headersMs = performance.now() - start;
  return response;
};

const reports = [];
async function streamingCase(kind) {
  mode = 'good'; value = 'OLD'; await reader.readSecCompanyCatalog(true);
  await reader.readSecExchangeCatalog(true);
  const prior = reader.inspectCompanyCacheForTest();
  mode = kind; start = performance.now();
  flight = { kind, httpAttempts: 0, chunks: 0, waiters: [], forcedCleanup: false };
  const record = flight, countBefore = companyRequests, exchangeBefore = exchangeRequests;
  const track = (name, promise) => promise.then(async (result) => {
    const status = name === 'api' ? result.status : result.status;
    const payload = name === 'api' ? await result.json() : result;
    record.waiters.push({ name, settlement: 'fulfilled', ok: payload.ok, status, error: payload.error, ms: performance.now() - start });
  }, (error) => { record.waiters.push({ name, settlement: 'rejected', error: error.name, ms: performance.now() - start }); });
  const tasks = [track('reader-fresh', reader.readSecCompanyCatalog(true)), track('reader-cached', reader.readSecCompanyCatalog(false)),
    track('fresh', fetchSecCompanyTickers('')), track('cached', fetchSecCompanyTickers('', { fresh: false })),
    track('api', GET(new NextRequest('http://local.test/api/sec/company-tickers?q=OLD'))), track('probe', probeSec())];
  // Safety only. If it fires this test FAILS; it cannot manufacture a timeout PASS.
  const watchdog = setTimeout(() => { record.forcedCleanup = true; server.closeAllConnections(); }, 22_000);
  resources.add(watchdog);
  try {
    if (before) {
      await delay(16_300);
      record.observedAtMs = performance.now() - start;
      assert.equal(record.waiters.length, 0); assert.equal(record.abortMs, undefined);
      assert.ok(record.headersMs < 2000); assert.equal(record.httpAttempts, 1);
      assert.equal(reader.inspectCompanyCacheForTest().refreshing, true);
      record.pendingAtObservation = tasks.length;
      record.forcedCleanup = true; server.closeAllConnections();
    }
    await Promise.all(tasks);
    if (!before) {
      assert.equal(record.forcedCleanup, false, 'Product abort must precede cleanup');
      assert.ok(record.abortMs >= 14_500 && record.abortMs <= 17_000, JSON.stringify(record));
      for (const w of record.waiters) {
        assert.ok(w.ms >= 14_500 && w.ms <= 17_000, JSON.stringify(w));
        if (w.name.startsWith('reader')) assert.equal(w.settlement, 'rejected');
        else { assert.equal(w.settlement, 'fulfilled'); assert.equal(w.ok, false); assert.equal(w.status, w.name === 'api' ? 502 : 0); }
      }
      if (kind !== 'headers-stall') assert.ok(record.headersMs < 2000);
      else assert.equal(record.headersMs, undefined);
      if (kind === 'drip') assert.ok(record.chunks >= 20);
    }
    assert.equal(record.httpAttempts, 1); assert.equal(companyRequests - countBefore, 1);
    const after = reader.inspectCompanyCacheForTest();
    assert.deepEqual(after.snapshot, prior.snapshot, 'Last complete snapshot and timestamp must survive failure');
    assert.equal(after.lastSuccessAt, prior.lastSuccessAt); assert.equal(after.refreshing, false); assert.equal(after.refreshFailed, true);
    record.snapshotPreserved = true; record.lastSuccessAtPreserved = true;
    for (let i = 0; i < 20 && record.serverClosedMs === undefined; i++) await delay(25);
    assert.ok(record.serverClosedMs !== undefined, 'Native abort/explicit before-test cleanup closes server response');
    const oldResponse = activeResponse;
    assert.ok(oldResponse.destroyed);
    const exchange = await reader.readSecExchangeCatalog();
    assert.equal(exchange.get('1234567')[0].ticker, 'XSYN'); assert.equal(exchangeRequests, exchangeBefore);
    // Disable flight logging for recovery; the old socket is already cancelled.
    flight = null; mode = 'good'; value = 'NEW';
    const recovered = await fetchSecCompanyTickers('', { fresh: false });
    assert.equal(recovered.ok, true); assert.equal(recovered.data[0].ticker, 'NEW'); assert.equal(companyRequests - countBefore, 2);
    record.recovery = { ticker: 'NEW', httpAttempts: 1 };
    oldResponse.end('"0":{"cik_str":1234567,"ticker":"LATEOLD","title":"Synthetic Old"}}');
    await delay(50);
    assert.equal((await fetchSecCompanyTickers('', { fresh: false })).data[0].ticker, 'NEW');
    assert.equal(companyRequests - countBefore, 2);
    record.lateOldBlocked = true;
    reports.push(record); console.log(JSON.stringify(record));
  } finally { clearTimeout(watchdog); resources.delete(watchdog); }
}

try {
  await streamingCase('body-stall');
  if (!before) {
    await streamingCase('headers-stall');
    await streamingCase('drip');
    for (const kind of ['broken', 'invalid', 'complete-stream']) {
      mode = kind; value = 'COMPLETE'; const prior = reader.inspectCompanyCacheForTest(), countBefore = companyRequests;
      const at = performance.now(); const result = await fetchSecCompanyTickers('');
      assert.equal(result.ok, kind === 'complete-stream'); assert.equal(companyRequests - countBefore, 1);
      if (kind === 'complete-stream') assert.equal(result.data[0].ticker, 'COMPLETE');
      else {
        assert.deepEqual(reader.inspectCompanyCacheForTest().snapshot, prior.snapshot);
        mode = 'good'; value = 'RECOVERED';
        assert.equal((await fetchSecCompanyTickers('', { fresh: false })).data[0].ticker, 'RECOVERED');
        assert.equal(companyRequests - countBefore, 2);
      }
      const record = { kind, ok: result.ok, status: result.status, ms: performance.now() - at, httpAttempts: companyRequests - countBefore };
      reports.push(record); console.log(JSON.stringify(record));
    }
  }
} finally {
  globalThis.fetch = nativeFetch;
  if (oldAgent === undefined) delete process.env.SEC_USER_AGENT; else process.env.SEC_USER_AGENT = oldAgent;
  for (const timer of resources) { clearTimeout(timer); clearInterval(timer); } resources.clear();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  for (const socket of sockets) socket.destroy();
  hooks.deregister();
}
const receipt = { before, toleranceMs: [14500, 17000], nativeFetch: true, loopbackOnly: true, reports, resourcesClosed: true };
if (output) writeFileSync(output, JSON.stringify(receipt, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ pass: true, before, scenarios: reports.length, resourcesClosed: true }));
