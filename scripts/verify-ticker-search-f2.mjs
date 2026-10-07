// Synthetic identities; all HTTP is intercepted in-process. No real DB/SEC.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { NextRequest } from 'next/server.js';
const normal = process.argv.includes('--normal');
const baseline = process.argv.includes('--baseline');
const base = '08fa71addc332d9a994375d19d97e3365f1560bc';
const originalModules = ['app/api/tickers/search/route.ts', 'lib/alerts/tickers/getAlertTickersViewModel.ts', 'lib/sec-ticker-resolution/publicTickerSearch.ts', 'lib/tickerSearchContract.ts'];
const hooks = registerHooks({
  resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); },
  load(url, c, next) {
    const loaded = next(url, c);
    if (!baseline || !url.startsWith('file:')) return loaded;
    const path = relative(process.cwd(), fileURLToPath(url)).replaceAll('\\', '/');
    if (!originalModules.includes(path)) return loaded;
    // Read the preserved base in memory only, without touching worktree/branches.
    return { ...loaded, format: 'module-typescript', source: execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' }) };
  },
});
const { GET: search } = await import('../app/api/tickers/search/route.ts');
const { GET: company } = await import('../app/api/sec/company-tickers/route.ts');
const originalFetch = globalThis.fetch;
const keys = ['SEC_USER_AGENT', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
const env = Object.fromEntries(keys.map(k => [k, process.env[k]]));
process.env.SEC_USER_AGENT = 'Synthetic F2 contact@example.test';
process.env.SUPABASE_URL = 'https://memory-repository.example.test';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_synthetic_test_only';
let secCalls = 0;
let scenario = 'full';
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://www.sec.gov/files/company_tickers.json') {
    secCalls++;
    return normal ? Response.json({ 0: { cik_str: 1000011, ticker: 'SYN', title: 'Synthetic SEC' }, 1: { cik_str: 1000012, ticker: 'SYNA', title: 'Synthetic A' } })
      : new Response('Synthetic private upstream error', { status: 503 });
  }
  assert.ok(url.startsWith('https://memory-repository.example.test/rest/v1/'));
  assert.equal(init?.method ?? 'GET', 'GET');
  const path = new URL(url).pathname;
  assert.ok(['/rest/v1/tickers', '/rest/v1/event_tickers', '/rest/v1/sec_ticker_resolution_decisions'].includes(path));
  if (normal && path.endsWith('/tickers')) {
    const row = symbol => ({ symbol, name: `Local ${symbol}`, exchange: 'NYSE', asset_type: 'stock', market_cap: 42 });
    return Response.json(scenario === 'full' ? Array.from({ length: 8 }, (_, i) => row(`SYN${i}`)) : scenario === 'merge' ? [row('SYN'), row('SYNZ')] : []);
  }
  if (normal && path.endsWith('/event_tickers') && scenario === 'merge') return Response.json([{ symbol: 'SYNE', metadata: { company_name: 'Event E' } }]);
  return Response.json([]);
};
try {
  if (normal) {
    const reports = [];
    for (scenario of ['full', 'merge', 'empty']) {
      for (const research of [false, true]) {
        const n = secCalls;
        const response = await search(new NextRequest(`http://local.test/api/tickers/search?q=${scenario === 'empty' ? 'ABSENT' : 'SYN'}`, { headers: research ? { 'x-stock-radar-search-surface': 'stock-research' } : {} }));
        reports.push({ scenario, research, status: response.status, payload: await response.json(), secCalls: secCalls - n });
      }
    }
    console.log(JSON.stringify(reports));
  } else {
  const direct = await company(new NextRequest('http://local.test/api/sec/company-tickers?q=SYN'));
  const result = await search(new NextRequest('http://local.test/api/tickers/search?q=SYN'));
  const payload = await result.json();
  assert.equal(direct.status, 503);
  assert.equal((await direct.json()).ok, false);
  if (process.argv.includes('--before')) {
    assert.equal(result.status, 200); assert.deepEqual(payload, { ok: true, data: [] });
  } else {
    assert.equal(result.status, 503); assert.equal(payload.ok, false);
    assert.equal(payload.error, 'TICKER_SEARCH_UNAVAILABLE');
  }
  console.log(JSON.stringify({ before: process.argv.includes('--before'), direct: 503, search: result.status, payload, secCalls }));
  }
} finally {
  globalThis.fetch = originalFetch;
  for (const k of keys) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  hooks.deregister();
}
