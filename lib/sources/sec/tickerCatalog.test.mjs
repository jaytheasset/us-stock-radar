import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fetchSecCompanyTickers, probeSec } from '../../integrations.ts';
import { fetchTickerLookup } from './parser.ts';
import { readSecCompanyCatalog, SEC_COMPANY_CATALOG_URL as companyUrl, SEC_EXCHANGE_CATALOG_URL as exchangeUrl } from './tickerCatalog.ts';
import { SEC_TICKER_CATALOG_TTL_MS as TTL } from './tickerCatalogCache.ts';
import { readStockHeaderSecIdentity } from '../../watchlist/stockHeaderSecIdentity.ts';
import { readIssuerBoundPublicStockTickerProjection } from '../../sec-ticker-resolution/publicTickerSearch.ts';
import { searchTickerCatalog } from '../../alerts/tickers/getAlertTickersViewModel.ts';
import { NextRequest } from 'next/server.js';
// Plain Node needs Next's explicit file suffix; the application bundler does not.
registerHooks({ resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); } });
const { GET } = await import('../../../app/api/sec/company-tickers/route.ts');

// Synthetic identities, both HTTP sources and repository data. No real network/DB.
const company = (cik = 1000011) => ({
  0: { cik_str: cik, ticker: 'SYN', title: 'Synthetic Company Alpha' },
  1: { cik_str: 1000022, ticker: 'BETA', title: 'Synthetic Company Beta' },
  2: { cik_str: cik, ticker: 'SYN.B', title: 'Synthetic Company Alpha B' },
});
const exchange = () => ({ fields: ['cik', 'name', 'ticker', 'exchange'], data: [
  [1000033, 'Exchange Only Name', 'ONLYX', 'NYSE'],
  [1000011, 'Different Exchange Name', 'XSYN', 'Nasdaq'],
] });
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
const companyTicker = (r) => r.data.map((x) => x.ticker);

test('source-specific readers preserve search contracts and live verification callers', async (t) => {
  let now = 1000, companyCalls = 0, exchangeCalls = 0, memoryReads = 0;
  let companyResponse = async () => Response.json(company());
  let exchangeResponse = async () => Response.json(exchange());
  const priorEnv = Object.fromEntries(['SEC_USER_AGENT', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'].map((key) => [key, process.env[key]]));
  process.env.SEC_USER_AGENT = 'Synthetic catalog tests contact@example.test';
  process.env.SUPABASE_URL = 'https://memory-repository.example.test';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_synthetic_test_only';
  t.after(() => { for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } });
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (url === companyUrl) { companyCalls++; assert.ok(init.signal); return companyResponse(init); }
    if (url === exchangeUrl) { exchangeCalls++; assert.ok(init.signal); return exchangeResponse(init); }
    if (url.startsWith('https://memory-repository.example.test/rest/v1/')) {
      memoryReads++;
      const parsed = new URL(url); assert.equal(init?.method ?? 'GET', 'GET');
      assert.ok(['/rest/v1/tickers', '/rest/v1/event_tickers'].includes(parsed.pathname));
      if (parsed.pathname.endsWith('/tickers')) assert.equal(parsed.searchParams.get('is_active'), 'eq.true');
      const local = parsed.pathname.endsWith('/tickers') && parsed.searchParams.get('or')?.includes('LOCAL');
      return Response.json(local ? [{ symbol: 'LOCAL', name: 'Local First', exchange: 'NYSE', asset_type: 'stock', market_cap: 100 }] : []);
    }
    throw Error(`Unexpected external request blocked: ${url}`);
  });

  await t.test('cold concurrent queries share one full download; full-body completion starts TTL', async () => {
    const body = deferred(); companyResponse = async () => ({ ok: true, status: 200, json: () => body.promise });
    const reads = [fetchSecCompanyTickers('Alpha', { fresh: false }), fetchSecCompanyTickers('BETA', { fresh: false }), fetchSecCompanyTickers('')];
    await Promise.resolve(); await Promise.resolve(); assert.equal(companyCalls, 1);
    now = 9000; body.resolve(company());
    const results = await Promise.all(reads);
    assert.deepEqual(results.map(companyTicker), [['SYN', 'SYN.B'], ['BETA'], ['SYN', 'BETA', 'SYN.B']]);
    companyResponse = async () => Response.json(company());
    now += TTL - 1; await fetchSecCompanyTickers('', { fresh: false }); assert.equal(companyCalls, 1);
    now++; await fetchSecCompanyTickers('', { fresh: false }); assert.equal(companyCalls, 2);
    now += TTL - 1; await fetchSecCompanyTickers('BETA', { fresh: false }); assert.equal(companyCalls, 2);
    now++; await fetchSecCompanyTickers('', { fresh: false }); assert.equal(companyCalls, 3);
    t.diagnostic('3 cold queries -> 1 HTTP; pending body completes at t=9000; TTL expiry +1 HTTP; identical-content refresh resets TTL; hits do not move the timestamp.');
  });

  await t.test('fresh defaults refresh, cached readers join, mutation cannot leak', async () => {
    const before = companyCalls, body = deferred();
    companyResponse = async () => ({ ok: true, status: 200, json: () => body.promise });
    const fresh = fetchSecCompanyTickers('SYN', { exactTicker: true });
    const cached = fetchSecCompanyTickers('', { fresh: false });
    let done = false; void cached.then(() => { done = true; });
    await Promise.resolve(); await Promise.resolve(); assert.equal(done, false); assert.equal(companyCalls - before, 1);
    body.resolve(company(2000011)); const [a, b] = await Promise.all([fresh, cached]);
    assert.equal(a.data[0].cik_str, 2000011); assert.equal(b.data[0].cik_str, 2000011);
    a.data[0].ticker = 'CORRUPT'; b.data.splice(0, 3);
    const next = await fetchSecCompanyTickers('', { fresh: false });
    assert.deepEqual(companyTicker(next), ['SYN', 'BETA', 'SYN.B']); assert.equal(companyCalls - before, 1);
    const source = await readSecCompanyCatalog(false); source.rows[0].title = 'CORRUPT'; source.rows.length = 0;
    assert.equal((await fetchSecCompanyTickers('SYN', { fresh: false })).data[0].title, 'Synthetic Company Alpha');
    companyResponse = async () => Response.json(company());
    await fetchSecCompanyTickers(''); await fetchSecCompanyTickers(''); assert.equal(companyCalls - before, 3);
  });

  await t.test('different source rows/order/names stay separate and failures never substitute sources', async () => {
    await fetchSecCompanyTickers(''); const beforeCompany = companyCalls;
    const map = await fetchTickerLookup(true);
    assert.deepEqual([...map.values()].flat().map((x) => x.ticker), ['ONLYX', 'XSYN']);
    assert.equal(map.get('1000011')[0].name, 'Different Exchange Name');
    const search = await fetchSecCompanyTickers('', { fresh: false });
    assert.deepEqual(companyTicker(search), ['SYN', 'BETA', 'SYN.B']);
    assert.equal(search.data[0].title, 'Synthetic Company Alpha'); assert.equal(companyCalls, beforeCompany);
    assert.equal((await fetchSecCompanyTickers('ONLYX', { fresh: false })).data.length, 0);
    assert.equal([...map.values()].flat().find((x) => x.ticker === 'BETA'), undefined);
    companyResponse = async () => new Response('unavailable', { status: 503, statusText: 'Synthetic outage' });
    const beforeExchange = exchangeCalls, bad = await fetchSecCompanyTickers('');
    assert.deepEqual(bad, { ok: false, status: 503, data: [], count: 0, error: 'Synthetic outage' });
    assert.equal(companyCalls, beforeCompany + 1); // no company retry
    assert.equal((await fetchTickerLookup()).get('1000011')[0].ticker, 'XSYN'); assert.equal(exchangeCalls, beforeExchange);
    companyResponse = async () => Response.json(company()); await fetchSecCompanyTickers('', { fresh: false });
    const restoredCompany = companyCalls;
    exchangeResponse = async () => new Response('down', { status: 503, headers: { 'Retry-After': '0' } });
    await assert.rejects(fetchTickerLookup(true), /503/); assert.equal(exchangeCalls - beforeExchange, 3);
    assert.equal((await fetchSecCompanyTickers('', { fresh: false })).ok, true); assert.equal(companyCalls, restoredCompany);
    exchangeResponse = async () => Response.json(exchange()); await fetchTickerLookup();
    t.diagnostic('Independent data/order and failure states: company 503=1 attempt; exchange 503=3 existing retry attempts; opposite cache stays intact with 0 additional downloads.');
  });

  await t.test('network/JSON/schema failures are not empty-success; every next cached request retries', async () => {
    const invalid = [() => { throw Error('Synthetic network error'); }, () => new Response('{bad'), () => Response.json(null),
      () => Response.json([]), () => Response.json({}), () => Response.json({ 0: { cik_str: 1, ticker: 'SYN' } }),
      () => Response.json({ ...company(), 9: { cik_str: 'invalid', ticker: 'BAD', title: 'Bad row' } })];
    for (const make of invalid) {
      const before = companyCalls; companyResponse = async () => make();
      const bad = await fetchSecCompanyTickers('');
      assert.equal(bad.ok, false); assert.equal(bad.status, 0); assert.deepEqual(bad.data, []); assert.equal(bad.count, 0);
      companyResponse = async () => Response.json(company());
      const recovered = await fetchSecCompanyTickers('missing', { fresh: false });
      assert.equal(recovered.ok, true); assert.deepEqual(recovered.data, []); assert.equal(recovered.count, 3);
      assert.equal(companyCalls - before, 2);
    }
    t.diagnostic('7 malformed/transport failures each followed by cached-mode recovery: 1 failed HTTP + 1 successful HTTP; valid no-match ok=true/count=3.');
  });

  await t.test('missing User-Agent cannot be bypassed by warm cache', async () => {
    const before = companyCalls; delete process.env.SEC_USER_AGENT;
    assert.deepEqual(await fetchSecCompanyTickers('', { fresh: false }), { ok: false, status: 0, data: [], count: 0, error: 'SEC_USER_AGENT is missing' });
    await assert.rejects(readSecCompanyCatalog(false), /SEC_USER_AGENT/);
    assert.equal(companyCalls, before); process.env.SEC_USER_AGENT = 'Synthetic catalog tests contact@example.test';
    assert.equal((await fetchSecCompanyTickers('', { fresh: false })).ok, true); assert.equal(companyCalls, before);
  });

  await t.test('company timeout stays 15 seconds and one attempt', async (c) => {
    c.mock.timers.enable({ apis: ['setTimeout'] });
    const before = companyCalls;
    companyResponse = async ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    const pending = fetchSecCompanyTickers(''); let done = false; void pending.then(() => { done = true; });
    await Promise.resolve(); await Promise.resolve(); assert.equal(companyCalls - before, 1);
    c.mock.timers.tick(14_999); await Promise.resolve(); assert.equal(done, false);
    c.mock.timers.tick(1); const result = await pending;
    assert.equal(result.ok, false); assert.equal(result.status, 0); assert.equal(companyCalls - before, 1);
    c.mock.timers.reset(); companyResponse = async () => Response.json(company());
    assert.equal((await fetchSecCompanyTickers('', { fresh: false })).ok, true);
  });

  await t.test('stock header rechecks current issuer despite warm search cache', async () => {
    companyResponse = async () => Response.json(company()); await fetchSecCompanyTickers('SYN');
    companyResponse = async () => Response.json(company(2000011)); const before = companyCalls;
    const queries = [], sourceId = '11111111-1111-4111-8111-111111111111';
    const result = await readStockHeaderSecIdentity('SYN', {
      selectRows: async (table, query) => {
        queries.push({ table, query });
        if (table === 'sec_structured_raw_sources') {
          assert.equal(query.cik, 'eq.0002000011'); return { ok: true, data: [{ id: sourceId, fetched_at: '2026-10-06' }] };
        }
        assert.equal(query.issuer_cik, 'eq.0002000011');
        return { ok: true, data: table === 'sec_issuer_source_observations' ? [{ entity_name: 'New Synthetic Issuer' }] : [{ ticker: 'SYN', exchange: 'NYSE' }] };
      }, readCanonicalExchange: async () => { throw Error('Unexpected fallback'); },
    });
    assert.deepEqual(result, { companyName: 'New Synthetic Issuer', exchange: 'NYSE' });
    assert.equal(queries.length, 3); assert.equal(companyCalls - before, 1);
    t.diagnostic('Warm search issuer 1000011 changed to 2000011: actual stockHeader function made 1 fresh HTTP, all 3 memory reads scoped to 0002000011.');
  });

  await t.test('historical projection rechecks issuer; conflicting/duplicate candidates remain blocked', async () => {
    const projection = { status: 'available', currentTicker: 'SYN', historicalTickers: ['PREV'], issuerCik: '0001000011', sourceFilings: [] };
    companyResponse = async () => Response.json(company()); await fetchSecCompanyTickers('SYN');
    const before = companyCalls; companyResponse = async () => Response.json(company(2000011));
    const result = await readIssuerBoundPublicStockTickerProjection('PREV', { readProjection: async () => projection });
    assert.deepEqual(result, { status: 'unavailable', reason: 'projection_current_issuer_not_confirmed' }); assert.equal(companyCalls - before, 1);
    for (const secondCik of [1000011, 2000011]) {
      companyResponse = async () => Response.json({ 0: company()[0], 1: { ...company()[0], cik_str: secondCik } });
      const duplicate = await readIssuerBoundPublicStockTickerProjection('PREV', { readProjection: async () => projection });
      assert.equal(duplicate.status, 'unavailable');
      const header = await readStockHeaderSecIdentity('SYN', { selectRows: async () => { throw Error('Ambiguity must stop before repository'); } });
      assert.deepEqual(header, { companyName: '', exchange: '' });
    }
    t.diagnostic('Projection rejects changed issuer after 1 fresh HTTP; equal duplicate and conflicting issuer rows are preserved and fail closed in both consumers.');
  });

  await t.test('probe and public company API retain live default with warm cache', async () => {
    companyResponse = async () => Response.json(company()); await fetchSecCompanyTickers(''); const before = companyCalls;
    companyResponse = async () => new Response('down', { status: 503, statusText: 'Synthetic outage' });
    const probe = await probeSec(); assert.equal(probe.ok, false); assert.equal(probe.status, 503); assert.equal(companyCalls - before, 1);
    companyResponse = async () => Response.json(company()); await fetchSecCompanyTickers('');
    companyResponse = async () => Response.json(company(2000011)); const apiBefore = companyCalls;
    const response = await GET(new NextRequest('http://local.test/api/sec/company-tickers?q=SYN'));
    assert.equal(response.status, 200); assert.equal((await response.json()).data[0].cik_str, 2000011); assert.equal(companyCalls - apiBefore, 1);
  });

  await t.test('actual exploratory fallback opts in; local-first merge/sort policy unchanged', async () => {
    now += TTL; companyResponse = async () => Response.json(company()); const before = companyCalls;
    const alpha = await searchTickerCatalog('Alpha'), beta = await searchTickerCatalog('Beta');
    assert.deepEqual(alpha.map((r) => r.ticker), ['SYN', 'SYN.B']); assert.deepEqual(beta.map((r) => r.ticker), ['BETA']);
    assert.equal(companyCalls - before, 1); // two queries, one entire company catalog
    const local = await searchTickerCatalog('LOCAL', 1);
    assert.equal(local[0].companyName, 'Local First'); assert.equal(companyCalls - before, 1);
    assert.equal(memoryReads, 6);
    t.diagnostic('Actual fallback Alpha/Beta -> 1 full company HTTP; local-complete search -> 0 extra SEC HTTP. 6 in-memory HTTP repository reads, actual DB=0.');
  });
});

test('common reader cannot depend back on parser/integrations; other migration paths stay separate', () => {
  const source = readFileSync(new URL('./tickerCatalog.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:parser|integrations)[^"']*["']/);
  const integrations = readFileSync(new URL('../../integrations.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(integrations, /from\s+["'][^"']*sec\/parser/);
});
