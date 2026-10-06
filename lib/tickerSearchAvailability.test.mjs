import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server.js';
// Isolated authenticated actor for mutation-handler tests only. No product gate
// changes, auth traffic, real repository, persistence or external delivery.
const hooks = registerHooks({
  resolve(s, c, next) { return next(['next/server', 'next/headers', 'next/cache'].includes(s) ? `${s}.js` : s, c); },
  load(url, c, next) {
    const result = next(url, c);
    if (!url.endsWith('/lib/currentUser.ts')) return result;
    const source = readFileSync(new URL(url), 'utf8').replace(
      /export async function getOptionalCurrentUserId\(\) \{[\s\S]*?\n\}/,
      'export async function getOptionalCurrentUserId() { return "00000000-0000-4000-8000-000000000099"; }',
    );
    return { ...result, format: 'module-typescript', source };
  },
});
const { GET } = await import('../app/api/tickers/search/route.ts');
const { POST: watchlistPost } = await import('../app/api/watchlist/route.ts');
const { POST: alertPost } = await import('../app/api/alerts/tickers/route.ts');
const { readTickerCatalogSearch, findTickerBySymbol, searchTickerCatalog } = await import('./alerts/tickers/getAlertTickersViewModel.ts');
const { readTickerSearchResponse, TickerSearchUnavailableError } = await import('./tickerSearchContract.ts');
const { resolveTickerSearchRequestSnapshot, resolveTickerSearchObservation, createTickerSearchSelectionSnapshot,
  parseTickerSearchSelectionSnapshot, buildTickerSearchReadout, resolveTickerSearchToStockDetailReadout } = await import('./tickerSearchFlowObservation.ts');
const { executeTelegramConnectedCommand } = await import('./telegram/telegramCommandRuntime.ts');

const localRow = (symbol, name = `Synthetic ${symbol}`) => ({ symbol, name, exchange: 'NYSE', asset_type: 'stock', market_cap: 42 });
const secRows = { 0: { cik_str: 1000011, ticker: 'SYN', title: 'Synthetic SEC' }, 1: { cik_str: 1000012, ticker: 'SYNA', title: 'Synthetic A' } };
test('F2 actual services, routes, client contract and mutation boundaries (isolated)', async (t) => {
  const envKeys = ['SEC_USER_AGENT', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
  const priorEnv = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
  process.env.SEC_USER_AGENT = 'Synthetic F2 contact@example.test';
  process.env.SUPABASE_URL = 'https://memory-repository.example.test';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_synthetic_test_only';
  t.after(() => { for (const k of envKeys) { if (priorEnv[k] === undefined) delete process.env[k]; else process.env[k] = priorEnv[k]; } hooks.deregister(); });
  let now = 1, local = [], events = [], secMode = 'good', mainFail = false, eventFail = false, projectionFail = false;
  let secCalls = 0, writes = 0, snapshotReads = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (url === 'https://www.sec.gov/files/company_tickers.json') {
      secCalls++;
      if (secMode === '503') return new Response('PRIVATE-UPSTREAM-SECRET', { status: 503 });
      if (secMode === 'invalid') return new Response('{broken');
      if (secMode === 'timeout') throw new DOMException('PRIVATE-UPSTREAM-SECRET', 'AbortError');
      return Response.json(secRows);
    }
    assert.ok(url.startsWith('https://memory-repository.example.test/rest/v1/'), 'All non-memory requests blocked');
    const parsed = new URL(url), path = parsed.pathname;
    if (path.endsWith('/rpc/watchlist_projection_snapshot')) { snapshotReads++; return Response.json('synthetic-snapshot'); }
    if ((init?.method ?? 'GET') !== 'GET') { writes++; throw Error('Unexpected persistence call'); }
    if (path.endsWith('/tickers')) {
      assert.equal(parsed.searchParams.get('is_active'), 'eq.true');
      if (mainFail) return Response.json({ message: 'PRIVATE-DB-SECRET' }, { status: 503 });
      return Response.json(local);
    }
    if (path.endsWith('/event_tickers')) return eventFail ? new Response('PRIVATE-EVENT-SECRET', { status: 503 }) : Response.json(events);
    if (path.endsWith('/sec_ticker_resolution_decisions')) return projectionFail ? new Response('PRIVATE-PROJECTION-SECRET', { status: 503 }) : Response.json([]);
    if (path.endsWith('/user_plan_subscriptions')) return Response.json([{ plan: 'pro', status: 'active' }]);
    if (path.endsWith('/user_alert_tickers')) return Response.json([]);
    throw Error(`Unexpected memory read: ${path}`);
  });
  const reset = () => { now += 900001; local = []; events = []; secMode = 'good'; mainFail = eventFail = projectionFail = false; };
  async function request(query = 'SYN', stockResearch = false) {
    const response = await GET(new NextRequest(`http://local.test/api/tickers/search?q=${encodeURIComponent(query)}`, {
      headers: stockResearch ? { 'x-stock-radar-search-surface': 'stock-research' } : {},
    }));
    assert.match(response.headers.get('cache-control'), /no-store/);
    const payload = await response.clone().json();
    assert.doesNotMatch(JSON.stringify(payload), /PRIVATE-|memory-repository|stack/i);
    const observation = resolveTickerSearchObservation({ activeIndex: 0, query, payload,
      request: resolveTickerSearchRequestSnapshot({ httpStatus: response.status, payload, requestState: 'received' }) });
    if (response.ok) {
      const parsed = await readTickerSearchResponse(response);
      assert.deepEqual(parsed.data, payload.data); assert.equal(parsed.partial, payload.partial);
    } else await assert.rejects(readTickerSearchResponse(response), TickerSearchUnavailableError);
    return { payload, status: response.status, observation };
  }
  await t.test('sufficient local rows skip SEC; normal merge/rank/dedupe/limit stay intact', async () => {
    reset(); local = Array.from({ length: 8 }, (_, i) => localRow(`SYN${i}`));
    let n = secCalls; const full = await request(); assert.equal(full.payload.data.length, 8); assert.equal(full.payload.partial, undefined); assert.equal(secCalls, n);
    reset(); local = [localRow('SYN', 'Local precedence'), localRow('SYNZ')]; events = [{ symbol: 'SYNE', metadata: { company_name: 'Event E' } }];
    const merged = await request(); assert.deepEqual(merged.payload.data.map(r => r.ticker), ['SYN', 'SYNA', 'SYNE', 'SYNZ']);
    assert.equal(merged.payload.data[0].companyName, 'Local precedence'); assert.equal(merged.payload.data[0].marketCap, 42);
    assert.equal(merged.payload.partial, undefined); assert.equal(secCalls - n, 1);
  });
  await t.test('SEC failure => partial with usable local results; empty => unavailable; recovery clears state', async () => {
    for (const failure of ['503', 'invalid', 'timeout']) {
      reset(); secMode = failure; local = [localRow('SYN')]; const n = secCalls;
      const partial = await request(); assert.equal(partial.status, 200); assert.equal(partial.payload.partial, true); assert.equal(partial.observation.responseStatus, 'partial');
      assert.equal(partial.observation.results[0].ticker, 'SYN'); assert.equal(secCalls - n, 1);
      local = []; const unavailable = await request(); assert.equal(unavailable.status, 503); assert.equal(unavailable.payload.error, 'TICKER_SEARCH_UNAVAILABLE'); assert.equal(unavailable.observation.status, 'unavailable');
      secMode = 'good'; const restored = await request(); assert.equal(restored.status, 200); assert.equal(restored.payload.partial, undefined); assert.equal(restored.observation.responseStatus, 'success');
    }
  });
  await t.test('successful no-match is empty; event failure is partial/unavailable; primary DB failure never calls SEC', async () => {
    reset(); const empty = await request('ABSENT'); assert.equal(empty.status, 200); assert.deepEqual(empty.payload, { ok: true, data: [] }); assert.equal(empty.observation.status, 'empty');
    reset(); eventFail = true; const partial = await request(); assert.equal(partial.payload.partial, true); assert.equal(partial.payload.data.length, 2);
    const missing = await request('ABSENT'); assert.equal(missing.status, 503);
    reset(); eventFail = true; local = Array.from({ length: 8 }, (_, i) => localRow(`SYN${i}`));
    const skippedBefore = secCalls; assert.equal((await request()).payload.partial, true); assert.equal(secCalls, skippedBefore);
    reset(); mainFail = true; local = [localRow('SYN')]; const n = secCalls; const fail = await request(); assert.equal(fail.status, 503); assert.equal(secCalls, n);
  });
  await t.test('stock-research propagates base/projection failure and adds no unverified history', async () => {
    reset(); local = [localRow('SYN')]; secMode = '503'; let r = await request('SYN', true); assert.equal(r.payload.partial, true);
    reset(); projectionFail = true; r = await request('SYN', true); assert.equal(r.payload.partial, true); assert.ok(r.payload.data.every(x => !x.isHistoricalTicker));
    r = await request('ABSENT', true); assert.equal(r.status, 503);
    projectionFail = false; r = await request('ABSENT', true); assert.equal(r.status, 200); assert.deepEqual(r.payload.data, []);
  });
  await t.test('partial selections remain navigable and partial in selection/detail readout', async () => {
    reset(); eventFail = true; const { observation } = await request();
    assert.match(buildTickerSearchReadout(observation).summary, /Some results/);
    const selection = createTickerSearchSelectionSnapshot({ observation, selectedTicker: 'SYN', selectionHref: '/stocks/SYN' });
    assert.equal(selection.responseStatus, 'partial');
    const parsed = parseTickerSearchSelectionSnapshot(JSON.stringify(selection), 'SYN', '/stocks/SYN');
    assert.equal(parsed.responseStatus, 'partial');
    const readout = resolveTickerSearchToStockDetailReadout({ selection: parsed, routeHref: '/stocks/SYN', routeTicker: 'SYN', detailRenderState: 'ready' });
    assert.equal(readout.responseStatus, 'partial'); assert.equal(readout.routeMatchesSelection, true); assert.match(readout.summary, /Some results/);
  });
  await t.test('exact matches usable in partial; incomplete absence throws; complete absence is null; wrappers fail closed', async () => {
    reset(); eventFail = true; assert.equal((await findTickerBySymbol('SYN')).ticker, 'SYN');
    await assert.rejects(findTickerBySymbol('ABSENT'), TickerSearchUnavailableError);
    local = [localRow('OTHER')]; await assert.rejects(findTickerBySymbol('ABSENT'), TickerSearchUnavailableError);
    await assert.rejects(searchTickerCatalog('SYN'), TickerSearchUnavailableError);
    reset(); assert.equal(await findTickerBySymbol('ABSENT'), null);
  });
  await t.test('actual Watchlist/Alert handlers stop before persistence; Telegram presents temporary failure', async () => {
    reset(); secMode = '503';
    for (const [path, handler] of [['watchlist', watchlistPost], ['alerts/tickers', alertPost]]) {
      const r = await handler(new NextRequest(`http://local.test/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://local.test' }, body: JSON.stringify({ ticker: 'ABSENT' }) }));
      const body = await r.json(); assert.equal(r.status, 503, JSON.stringify(body)); assert.equal(body.error, 'TICKER_SEARCH_UNAVAILABLE'); assert.equal(writes, 0);
    }
    assert.equal(snapshotReads, 1);
    const result = await executeTelegramConnectedCommand({ baseUrl: 'https://local.test', destination: 'synthetic', command: { name: 'stock', ticker: 'ABSENT' } }, {
      resolveOwner: async () => 'synthetic', isTelegramAllowed: async () => true, findStock: findTickerBySymbol,
      readWatchlist: async () => [], listRooms: async () => ({ items: [], hasMore: false }), readRoomMembership: async () => { throw Error('Must not reach membership'); },
    });
    assert.match(result.text, /could not complete/); assert.doesNotMatch(result.text, /not an active/);
  });
  await t.test('malformed responses never become empty or expose error text', async () => {
    for (const body of [null, {}, { data: [] }, { ok: true }, { ok: true, data: {} }, { ok: true, data: [null] }, { ok: true, data: [{ ticker: 'SYN' }] }, { ok: true, data: [], partial: true }, { ok: true, data: [], partial: 'yes' }, { ok: false, message: 'PRIVATE-SECRET' }]) {
      await assert.rejects(readTickerSearchResponse(Response.json(body)), { message: 'Ticker search is temporarily unavailable. Please try again.' });
      const r = resolveTickerSearchRequestSnapshot({ httpStatus: 200, payload: body, requestState: 'received' }); assert.equal(r.responseStatus, 'failure');
    }
    await assert.rejects(readTickerSearchResponse(new Response('{bad')));
    await assert.rejects(readTickerSearchResponse(Response.json({ ok: true, data: [] }, { status: 503 })));
    const internal = await GET({ get nextUrl() { throw Error('PRIVATE-INTERNAL-SECRET'); } });
    assert.equal(internal.status, 500); assert.match(internal.headers.get('cache-control'), /no-store/);
    const body = await internal.json(); assert.equal(body.error, 'TICKER_SEARCH_FAILED'); assert.doesNotMatch(JSON.stringify(body), /PRIVATE-/);
  });
  t.diagnostic(`Synthetic only; SEC attempts=${secCalls}; persistence calls=${writes}; real network/DB/delivery=0. Timeout error transport is auxiliary; real F1 streaming runs separately.`);
});
