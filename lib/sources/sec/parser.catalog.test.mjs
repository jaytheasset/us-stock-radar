import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchTickerLookup, fetchSecEdgarRawItems } from './parser.ts';
import { SEC_TICKER_CATALOG_TTL_MS as TTL } from './tickerCatalogCache.ts';
import { ensureSecForm25Identity } from '../../sec-form25-identity/persistence.ts';

// Synthetic companies/tickers/documents throughout. HTTP and repository doubles
// never delegate to a real network, database, provider, or server.
const url = 'https://www.sec.gov/files/company_tickers_exchange.json';
const fields = ['cik', 'name', 'ticker', 'exchange'];
const catalog = (ticker = 'NEW', cik = 1234567) => ({ fields, data: [[cik, 'Synthetic Cache Company', ticker, 'Nasdaq']] });
const ticker = (map) => map.get('1234567')?.[0]?.ticker;
const base = 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000001/';
const accession = '0001234567-26-000001';
const form25Xml = '<edgarSubmission><exchange><cik>7654321</cik><entityName>Synthetic Exchange</entityName></exchange>'
  + '<issuer><cik>1234567</cik><entityName>Synthetic Cache Company</entityName></issuer><descriptionClassSecurity>Common Stock</descriptionClassSecurity></edgarSubmission>';
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

test('exported catalog + actual collection/Form25 callers with isolated HTTP and fake clock', async (t) => {
  let now = 1_000_000, attempts = 0, fixtureForm = '8-K';
  let respond = async () => Response.json(catalog('OLD'));
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const address = String(input);
    assert.ok(init?.signal, 'existing SEC HTTP policy supplies timeout signals');
    if (address === url) { attempts++; return respond(init); }
    if (address === base + 'index.json') return Response.json({ directory: { item: [] } });
    if (address === base + accession + '-index.html') return new Response(
      `<html><div class="companyInfo"><span class="companyName">Synthetic Cache Company (Filer)</span></div>`
      + '<div class="infoHead">Filing Date</div><div class="info">2026-10-06</div>'
      + `<table summary="Document Format Files"><tr><td>1</td><td>Primary</td><td><a href="primary.htm">primary.htm</a></td><td>${fixtureForm}</td><td>1000</td></tr></table></html>`,
      { headers: { 'content-type': 'text/html' } });
    if (address === base + 'primary.htm') return new Response(fixtureForm === '25-NSE' ? form25Xml : '<html><p>Synthetic filing source body remains available.</p></html>',
      { headers: { 'content-type': 'text/html' } });
    throw Error(`Unexpected HTTP call blocked: ${address}`);
  });
  const collect = () => fetchSecEdgarRawItems({ accessionNumber: accession, cik: '1234567', formTypes: [fixtureForm], includeDocuments: true });

  await t.test('initial failure recovers; fresh replaces ordinary cache; TTL and equal-content success extend validity', async () => {
    respond = async () => new Response('initial failure', { status: 404 });
    await assert.rejects(fetchTickerLookup(), /HTTP 404/); assert.equal(attempts, 1);
    respond = async () => Response.json(catalog('OLD'));
    assert.equal(ticker(await fetchTickerLookup()), 'OLD');
    assert.equal(ticker(await fetchTickerLookup()), 'OLD'); assert.equal(attempts, 2);
    respond = async () => Response.json(catalog('NEW'));
    assert.equal(ticker(await fetchTickerLookup(true)), 'NEW');
    assert.equal(ticker(await fetchTickerLookup()), 'NEW'); assert.equal(attempts, 3);
    now += TTL - 1; assert.equal(ticker(await fetchTickerLookup()), 'NEW'); assert.equal(attempts, 3);
    now++; assert.equal(ticker(await fetchTickerLookup()), 'NEW'); assert.equal(attempts, 4);
    now += TTL - 1; await fetchTickerLookup(); assert.equal(attempts, 4);
    now++; respond = async () => Response.json(catalog('LATER'));
    assert.equal(ticker(await fetchTickerLookup()), 'LATER'); assert.equal(attempts, 5);
    t.diagnostic('Initial HTTP 404 -> next ordinary OLD. Then OLD, fresh NEW, NEW; TTL 899999ms hit, 900000ms refresh; same-content success resets TTL; 5 refreshes / 5 HTTP attempts including initial failure.');
  });

  await t.test('ordinary and fresh callers wait for the same fully read response', async () => {
    const before = attempts, body = deferred();
    respond = async () => ({ ok: true, status: 200, json: () => body.promise });
    const fresh = fetchTickerLookup(true), ordinary = fetchTickerLookup(), again = fetchTickerLookup(true);
    let settled = false; void ordinary.then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(attempts - before, 1); assert.equal(settled, false);
    body.resolve(catalog('LATEST'));
    assert.deepEqual((await Promise.all([fresh, ordinary, again])).map(ticker), ['LATEST', 'LATEST', 'LATEST']);
    assert.equal(ticker(await fetchTickerLookup()), 'LATEST'); assert.equal(attempts - before, 1);
    t.diagnostic('3 overlapping callers -> 1 refresh / 1 HTTP attempt; all LATEST; no old response can overwrite a second refresh because it never starts.');
  });

  await t.test('returned Maps, arrays and row objects do not contaminate ordinary or concurrent callers', async () => {
    const a = await fetchTickerLookup(), b = await fetchTickerLookup();
    a.get('1234567')[0].ticker = 'CORRUPT'; a.get('1234567').push({ ticker: 'EXTRA' }); a.clear();
    assert.equal(ticker(b), 'LATEST'); assert.equal(b.get('1234567').length, 1);
    assert.equal(ticker(await fetchTickerLookup()), 'LATEST');
  });

  await t.test('HTTP refresh failure rejects all waiters; ordinary retry recovers, never stale success', async () => {
    const before = attempts;
    respond = async () => new Response('synthetic service failure', { status: 503, headers: { 'Retry-After': '0' } });
    const results = await Promise.allSettled([fetchTickerLookup(true), fetchTickerLookup(), fetchTickerLookup(true)]);
    assert.ok(results.every((r) => r.status === 'rejected' && /HTTP 503/.test(r.reason.message)));
    assert.equal(attempts - before, 3); // one coalesced refresh, existing secFetch retries three HTTP attempts
    respond = async () => Response.json(catalog('RECOVERED'));
    assert.equal(ticker(await fetchTickerLookup()), 'RECOVERED'); assert.equal(attempts - before, 4);
    t.diagnostic('failed refresh: 3 waiters rejected, 1 refresh / 3 HTTP attempts; next ordinary request RECOVERED, +1 refresh / +1 attempt.');
  });

  await t.test('expired failure and timeout remain retryable; no successful empty Map', async () => {
    now += TTL; const before = attempts;
    respond = async () => { throw new DOMException('Synthetic timeout', 'TimeoutError'); };
    await assert.rejects(fetchTickerLookup(), { name: 'TimeoutError' }); assert.equal(attempts - before, 3);
    respond = async () => Response.json(catalog('AFTERTIMEOUT'));
    assert.equal(ticker(await fetchTickerLookup()), 'AFTERTIMEOUT'); assert.equal(attempts - before, 4);
    t.diagnostic('expired read -> TimeoutError after 1 refresh / 3 HTTP attempts; ordinary retry -> AFTERTIMEOUT, +1 attempt.');
  });

  await t.test('invalid JSON, schema, partial and wholly invalid rows reject atomically and recover', async () => {
    const invalid = [
      () => new Response('{invalid json'), () => Response.json(null), () => Response.json({ fields, data: [] }),
      () => Response.json({ fields: ['cik', 'ticker'], data: [[1234567, 'BAD']] }),
      () => Response.json({ fields: [...fields, 'cik'], data: [[1234567, 'Fake', 'BAD', null, 1234567]] }),
      () => Response.json({ fields, data: [{ cik: 1234567, ticker: 'BAD' }] }),
      () => Response.json({ fields, data: [[null, 'Fake', '', null]] }),
      () => Response.json({ fields, data: [...catalog('PARTIAL').data, [1234568, 'Fake', {}, null]] }),
    ];
    for (const invalidResponse of invalid) {
      const before = attempts; respond = async () => invalidResponse();
      await assert.rejects(fetchTickerLookup(true));
      respond = async () => Response.json(catalog('VALID'));
      assert.equal(ticker(await fetchTickerLookup()), 'VALID'); assert.equal(attempts - before, 2);
    }
    t.diagnostic('8 malformed responses: each rejects (+1 HTTP), each next ordinary request recovers VALID (+1 HTTP); no partial/empty catalog committed.');
  });

  await t.test('valid absent member differs from catalog failure; existing row values/selection remain intact', async () => {
    respond = async () => Response.json({ fields: ['ticker', 'exchange', 'name', 'cik'], data: [
      ['SYNW', null, null, '0001234567'], ['syn.a', 'NYSE', 'Synthetic Class A', 1234567],
    ] });
    const map = await fetchTickerLookup(true);
    assert.deepEqual(map.get('1234567'), [
      { cik: '1234567', ticker: 'SYNW', exchange: null, name: null },
      { cik: '1234567', ticker: 'SYN.A', exchange: 'NYSE', name: 'Synthetic Class A' },
    ]);
    assert.equal(map.get('9999999'), undefined);
    assert.equal([...map.values()].flat().find((r) => r.ticker === 'ABSENT'), undefined);
    respond = async () => new Response('missing catalog', { status: 404 });
    await assert.rejects(fetchTickerLookup(true), /HTTP 404/);
    t.diagnostic('valid catalog: absent CIK/ticker -> undefined; entire catalog unavailable -> rejected HTTP 404.');
  });

  await t.test('catalog outage does not abort original source collection or fill an unverified ticker', async () => {
    const before = attempts;
    const failed = await collect();
    assert.equal(failed.ok, true, failed.error); assert.equal(failed.count, 1);
    assert.match(failed.items[0].body_text, /Synthetic filing source body/);
    assert.equal(failed.items[0].raw_payload.ticker, null);
    assert.equal(failed.diagnostics.tickerCatalog.status, 'unavailable');
    assert.match(failed.items[0].raw_payload.ticker_resolution.reason, /catalog unavailable/);
    respond = async () => Response.json(catalog('RESTORED'));
    const good = await collect();
    assert.equal(good.ok, true); assert.equal(good.items[0].raw_payload.ticker, 'RESTORED');
    assert.equal(good.diagnostics.tickerCatalog.status, 'available');
    assert.equal(good.items[0].body_text, failed.items[0].body_text);
    assert.equal(attempts - before, 2);
    t.diagnostic('8-K collection: catalog 404 -> ok=true, body retained, ticker=null, unavailable; next collection -> RESTORED, identical body; 2 refreshes / 2 catalog HTTP attempts.');
  });

  await t.test('Form25 collection distinguishes not-in-catalog from unavailable', async () => {
    fixtureForm = '25-NSE'; respond = async () => Response.json(catalog('OTHER', 7654321));
    await fetchTickerLookup(true);
    const missing = await collect(); assert.equal(missing.ok, true, missing.error);
    assert.equal(missing.items[0].raw_payload.form25_ticker_identity.reason, 'subject_not_in_sec_catalog');
    respond = async () => new Response('unavailable', { status: 404 });
    await assert.rejects(fetchTickerLookup(true));
    const failed = await collect(); assert.equal(failed.ok, true, failed.error);
    assert.equal(failed.items[0].raw_payload.form25_ticker_identity.reason, 'sec_catalog_unavailable');
    assert.equal(failed.items[0].raw_payload.ticker, null);
    assert.equal(failed.items[0].body_text, missing.items[0].body_text);
  });

  await t.test('real Form25 fresh call updates normal cache and preserves its existing unavailable reason', async () => {
    const raw = { id: 'synthetic-raw', source_unique_id: accession, source_url: base + 'primary.htm', body_text: form25Xml,
      raw_payload: { form_type: '25-NSE', cik: '1234567' } };
    let saved = null, repoCalls = 0;
    const repository = { // in-memory seam only; no actual DB reads/writes
      select: async (table) => { repoCalls++; assert.ok(['raw_items', 'sec_form25_identity_evidence', 'sec_form25_identity_human_decisions'].includes(table));
        return { ok: true, status: 200, data: table === 'raw_items' ? [raw] : table === 'sec_form25_identity_evidence' && saved ? [saved] : [] }; },
      rpc: async (name, payload) => { repoCalls++; assert.equal(name, 'persist_sec_form25_identity');
        saved = { id: 'synthetic-evidence', evidence: payload.p_evidence, evidence_sha256: payload.p_evidence_sha256 }; return { ok: true, status: 200 }; },
    };
    respond = async () => Response.json(catalog('BEFORE')); await fetchTickerLookup(true);
    const before = attempts; respond = async () => Response.json(catalog('FORMNEW'));
    const fresh = await ensureSecForm25Identity({ rawItemId: raw.id, repository });
    assert.equal(fresh.status, 'available'); assert.equal(fresh.ticker, 'FORMNEW');
    assert.equal(ticker(await fetchTickerLookup()), 'FORMNEW'); assert.equal(attempts - before, 1);
    respond = async () => new Response('down', { status: 404 });
    const failed = await ensureSecForm25Identity({ rawItemId: raw.id, repository });
    assert.equal(failed.status, 'available'); assert.equal(failed.state, 'UNRESOLVED');
    assert.equal(failed.ticker, null); assert.equal(failed.reason, 'sec_catalog_unavailable');
    respond = async () => Response.json(catalog('FORMRECOVERED'));
    assert.equal(ticker(await fetchTickerLookup()), 'FORMRECOVERED'); assert.equal(attempts - before, 3);
    t.diagnostic(`Form25 real fresh caller -> FORMNEW; normal cache -> FORMNEW without HTTP; failed fresh -> UNRESOLVED/sec_catalog_unavailable; normal retry -> FORMRECOVERED. 3 refreshes/3 HTTP; ${repoCalls} in-memory repository operations, real DB=0.`);
  });
});
