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
  let mainBody, eventBody;
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
      if (mainBody !== undefined) return new Response(mainBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
      return Response.json(local);
    }
    if (path.endsWith('/event_tickers')) {
      if (eventFail) return new Response('PRIVATE-EVENT-SECRET', { status: 503 });
      if (eventBody !== undefined) return new Response(eventBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
      return Response.json(events);
    }
    if (path.endsWith('/sec_ticker_resolution_decisions')) return projectionFail ? new Response('PRIVATE-PROJECTION-SECRET', { status: 503 }) : Response.json([]);
    if (path.endsWith('/user_plan_subscriptions')) return Response.json([{ plan: 'pro', status: 'active' }]);
    if (path.endsWith('/user_alert_tickers')) return Response.json([]);
    throw Error(`Unexpected memory read: ${path}`);
  });
  const reset = () => { now += 900001; local = []; events = []; mainBody = eventBody = undefined; secMode = 'good'; mainFail = eventFail = projectionFail = false; };
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
  // Explicit reproduction mode only, run before the product fix. This cannot
  // be used to claim the ordinary regression suite passed.
  if (process.env.F2_DB_SHAPE_BEFORE === '1') {
    await t.test('BEFORE: malformed primary HTTP 200 becomes empty/null or SEC success', async () => {
      reset(); mainBody = '{PRIVATE-BROKEN-DB';
      const empty = await request('ABSENT'); assert.deepEqual(empty.payload, { ok: true, data: [] });
      assert.equal(await findTickerBySymbol('ABSENT'), null);
      const bypass = await request('SYN'); assert.equal(bypass.status, 200); assert.equal(bypass.payload.data[0].ticker, 'SYN');
      assert.equal((await findTickerBySymbol('SYN')).ticker, 'SYN');
      t.diagnostic(`BEFORE primary: absent=${JSON.stringify(empty.payload)}, exact=${bypass.payload.data[0].ticker}, SEC attempts=${secCalls}`);
    });
    await t.test('BEFORE: malformed supplemental HTTP 200 loses partial status', async () => {
      reset(); eventBody = '{"PRIVATE-ERROR":"bad-list"}'; local = [localRow('SYN')];
      const r = await request(); assert.equal(r.status, 200); assert.equal(r.payload.partial, undefined);
      t.diagnostic(`BEFORE event: ${JSON.stringify(r.payload)}`);
    });
    return;
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
  const invalidLists = [
    ['object', '{"message":"PRIVATE-DB-SECRET https://memory-repository.example.test","data":[]}'],
    ['null', 'null'],
    ['broken JSON', '{PRIVATE-BROKEN-JSON'],
    ['JSON string', '"PRIVATE-DB-STRING"'],
  ];
  await t.test('non-array primary HTTP 200 fails before SEC (including cached exact match)', async () => {
    for (const [kind, body] of invalidLists) {
      reset(); mainBody = body; let n = secCalls;
      for (const research of [false, true]) {
        for (const query of ['ABSENT', 'SYN']) {
          const r = await request(query, research);
          assert.equal(r.status, 503, kind); assert.equal(r.payload.error, 'TICKER_SEARCH_UNAVAILABLE');
          assert.equal(r.observation.status, 'unavailable');
          await assert.rejects(findTickerBySymbol(query), TickerSearchUnavailableError);
        }
      }
      assert.equal(secCalls, n, `${kind}: no SEC fallback`);
      mainBody = undefined;
      const recovered = await request(); assert.equal(recovered.status, 200); assert.equal(recovered.payload.partial, undefined);
      assert.equal(secCalls, n + 1); // exact SYN is now in the warm company cache
      mainBody = body; n = secCalls;
      assert.equal((await request()).status, 503);
      await assert.rejects(findTickerBySymbol('SYN'), TickerSearchUnavailableError);
      assert.equal(secCalls, n, `${kind}: warm SEC cache cannot bypass malformed primary`);
      mainBody = undefined;
      assert.equal((await request()).observation.responseStatus, 'success');
      t.diagnostic(`${kind} primary: both API branches 503/unavailable; exact+missing lookup rejected; SEC calls while malformed=0; cold/warm recovery PASS.`);
    }
  });
  await t.test('non-array event HTTP 200 preserves local/SEC rows, marks partial, and never forces SEC when full', async () => {
    for (const [kind, body] of invalidLists) {
      for (const research of [false, true]) {
        reset(); local = [localRow('SYNZ'), localRow('SYN', 'Local precedence')];
        const expected = (await request('SYN', research)).payload.data;
        eventBody = body;
        const partial = await request('SYN', research);
        assert.deepEqual(partial.payload.data, expected, kind); assert.equal(partial.payload.partial, true);
        assert.equal(partial.observation.responseStatus, 'partial');
        assert.equal((await findTickerBySymbol('SYN')).companyName, 'Local precedence');
        await assert.rejects(findTickerBySymbol('ABSENT'), TickerSearchUnavailableError);
        eventBody = undefined;
        const recovered = await request('SYN', research);
        assert.deepEqual(recovered.payload.data, expected); assert.equal(recovered.payload.partial, undefined);

        reset(); eventBody = body; let n = secCalls;
        const secOnly = await request('SYN', research);
        assert.deepEqual(secOnly.payload.data.map(r => r.ticker), ['SYN', 'SYNA']);
        assert.equal(secOnly.payload.partial, true); assert.equal(secCalls, n + 1);
        assert.equal((await findTickerBySymbol('SYN')).ticker, 'SYN');
        const absent = await request('ABSENT', research);
        assert.equal(absent.status, 503); assert.equal(absent.observation.status, 'unavailable');
        await assert.rejects(findTickerBySymbol('ABSENT'), TickerSearchUnavailableError);

        reset(); local = Array.from({ length: 8 }, (_, i) => localRow(`SYN${i}`)); eventBody = body; n = secCalls;
        const full = await request('SYN', research);
        assert.equal(full.payload.partial, true); assert.deepEqual(full.payload.data.map(r => r.ticker), local.map(r => r.symbol));
        assert.equal(secCalls, n, `${kind}: event shape failure cannot force supplemental SEC lookup`);
      }
      t.diagnostic(`${kind} event: both API branches preserve local/SEC values+order with partial; no-match=503; full local rows add 0 SEC calls; exact-match usable; recovery clears partial.`);
    }
  });
  await t.test('valid empty arrays remain complete and existing per-row exclusions are unchanged', async () => {
    reset();
    for (const research of [false, true]) {
      const empty = await request('ABSENT', research);
      assert.deepEqual(empty.payload, { ok: true, data: [] }); assert.equal(empty.status, 200); assert.equal(empty.observation.status, 'empty');
    }
    assert.equal(await findTickerBySymbol('ABSENT'), null);
    local = [null, {}, { symbol: 'NO_NAME' }, localRow('VALID')];
    events = [null, {}, { symbol: 'NO_NAME' }, { symbol: 'EVENT', metadata: { company_name: 'Synthetic Event' } }];
    const filtered = await request('ABSENT');
    assert.deepEqual(filtered.payload.data.map(r => r.ticker), ['EVENT', 'VALID']);
    assert.equal(filtered.payload.partial, undefined); assert.equal(filtered.observation.responseStatus, 'success');
  });
  await t.test('malformed primary HTTP 200 stops actual Watchlist/Alert handlers before storage', async () => {
    for (const [kind, body] of invalidLists) {
      reset(); mainBody = body; const n = secCalls;
      for (const [path, handler] of [['watchlist', watchlistPost], ['alerts/tickers', alertPost]]) {
        const r = await handler(new NextRequest(`http://local.test/api/${path}`, {
          method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://local.test' }, body: JSON.stringify({ ticker: 'SYN' }),
        }));
        const payload = await r.json();
        assert.equal(r.status, 503, kind); assert.equal(payload.error, 'TICKER_SEARCH_UNAVAILABLE');
        assert.doesNotMatch(JSON.stringify(payload), /PRIVATE-|memory-repository|TICKER_NOT_FOUND/);
        assert.equal(writes, 0); assert.equal(secCalls, n);
      }
      t.diagnostic(`${kind} primary: Watchlist+Alert 503; persistence attempts=0; SEC calls=0.`);
    }
  });
  t.diagnostic(`Synthetic only; SEC attempts=${secCalls}; persistence calls=${writes}; real network/DB/delivery=0. Timeout error transport is auxiliary; real F1 streaming runs separately.`);
});
