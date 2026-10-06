import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SecStructuredDataService } from './service.ts';
import { SecStructuredHttpClient } from './httpClient.ts';
import { PostgresSecStructuredRepository } from './repository.ts';
import { readStockHeaderSecIdentity } from '../watchlist/stockHeaderSecIdentity.ts';

const { issuers } = JSON.parse(await readFile(new URL('./fixtures/three-issuer-minimal.json', import.meta.url), 'utf8'));
const now = () => new Date('2026-10-06T00:00:00Z');
function document(sample, kind = 'submissions') {
  const sourceUrl = kind === 'submissions'
    ? `https://data.sec.gov/submissions/CIK${sample.cik}.json`
    : `https://data.sec.gov/api/xbrl/companyfacts/CIK${sample.cik}.json`;
  const payload = structuredClone(sample[kind]);
  return { sourceKind: kind, sourceUrl, sourceIdentity: sourceUrl, cik: sample.cik,
    payload, rawBody: JSON.stringify(payload), rawBodyKind: 'injected_exact_body', fetchedAt: sample.fetched_at };
}
function syncBody(doc) { doc.rawBody = JSON.stringify(doc.payload); return doc; }

// Narrow in-memory SQL transport for the REAL repository. This checks generated
// transaction/insert calls and conflicts, not PostgreSQL execution or RLS.
const keys = {
  sec_structured_raw_sources: ['source_kind', 'source_identity', 'content_hash'],
  sec_issuers: ['cik'], sec_issuer_source_observations: ['issuer_cik', 'source_raw_id'],
  sec_issuer_ticker_observations: ['issuer_cik', 'ticker', 'exchange', 'source_raw_id'],
  sec_filing_ledger: ['accession_number'], sec_company_facts: ['source_fact_key'],
};
class MemorySql {
  tables = Object.fromEntries(Object.keys(keys).map(key => [key, []]));
  calls = [];
  failTable = null;
  transaction = null;
  async query(sql, values = []) {
    this.calls.push(sql);
    if (sql === 'begin') this.transaction = structuredClone(this.tables);
    else if (sql === 'rollback') { this.tables = this.transaction; this.transaction = null; }
    else if (sql === 'commit') this.transaction = null;
    else if (!sql.startsWith('set local')) {
      const table = /insert into public\.(\w+)/.exec(sql)?.[1];
      assert.ok(table && keys[table], `unexpected SQL: ${sql}`);
      if (table === this.failTable) throw new Error('synthetic storage failure');
      assert.match(sql, /on conflict/);
      const inserted = [];
      for (const row of JSON.parse(values[0])) {
        const prior = this.tables[table].find(old => keys[table].every(key => old[key] === row[key]));
        if (prior) continue;
        this.tables[table].push(row);
        inserted.push(table === 'sec_filing_ledger' ? { inserted: true } : row);
      }
      return { rows: inserted, rowCount: inserted.length };
    }
    return { rows: [], rowCount: 0 };
  }
  async selectRows(table, search) {
    let rows = this.tables[table];
    assert.ok(rows, `unexpected table ${table}`);
    for (const [key, value] of Object.entries(search)) {
      if (value.startsWith('eq.')) rows = rows.filter(row => String(row[key]) === value.slice(3));
    }
    rows = [...rows];
    if (search.order) rows.sort((a, b) => b.fetched_at.localeCompare(a.fetched_at));
    if (search.limit) rows = rows.slice(0, Number(search.limit));
    return { ok: true, data: rows };
  }
}
function harness(sample = issuers[0]) {
  const sql = new MemorySql();
  const calls = { submissions: 0, companyfacts: 0 };
  let failFacts = true;
  let docs = [document(sample)];
  const client = {
    async fetchSubmissions(cik, mode) {
      calls.submissions++; assert.equal(cik, sample.cik); assert.equal(mode, 'incremental'); return structuredClone(docs);
    },
    async fetchCompanyFacts() {
      calls.companyfacts++;
      if (failFacts) throw new Error('synthetic CompanyFacts unavailable');
      return document(sample, 'companyfacts');
    },
  };
  return { sql, calls, client, service: new SecStructuredDataService(client, new PostgresSecStructuredRepository(sql), now),
    setDocs(value) { docs = value; }, allowFacts() { failFacts = false; } };
}

test('standalone accepts all three preserved fixtures, never invokes failing CompanyFacts; actual reader uses same source', async t => {
  for (const sample of issuers) {
    const h = harness(sample);
    const result = await h.service.ingestIssuerSubmissions({ cik: sample.cik });
    assert.deepEqual(h.calls, { submissions: 1, companyfacts: 0 });
    assert.deepEqual(result.sourceUpdates, { submissions: { fetched: 1, updated: 1, unchanged: 0 } });
    assert.equal(result.normalizedFacts, 0); assert.equal(result.factsInserted, 0); assert.equal(result.rejected, 0);
    assert.equal(h.sql.tables.sec_structured_raw_sources.length, 1);
    assert.equal(h.sql.tables.sec_issuer_source_observations[0].entity_name, sample.submissions.name);
    assert.deepEqual(h.sql.tables.sec_issuer_ticker_observations.map(row => [row.ticker, row.exchange]),
      sample.submissions.tickers.map((ticker, index) => [ticker, sample.submissions.exchanges[index]]));
    assert.equal(h.sql.tables.sec_filing_ledger.length, sample.submissions.filings.recent.accessionNumber.length);
    const id = h.sql.tables.sec_structured_raw_sources[0].id;
    for (const table of ['sec_issuer_source_observations', 'sec_issuer_ticker_observations', 'sec_filing_ledger']) {
      assert.ok(h.sql.tables[table].every(row => row.source_raw_id === id));
    }
    for (const [index, ticker] of sample.submissions.tickers.entries()) {
      const identity = await readStockHeaderSecIdentity(ticker, {
        readCatalog: async () => ({ ok: true, data: [{ ticker, cik_str: sample.cik }] }),
        selectRows: async (table, search) => {
          if (table !== 'sec_structured_raw_sources') assert.equal(search.source_raw_id, `eq.${id}`);
          return h.sql.selectRows(table, search);
        },
        readCanonicalExchange: async () => { assert.fail('must use exact stored observation'); },
      });
      assert.deepEqual(identity, { companyName: sample.submissions.name, exchange: sample.submissions.exchanges[index] });
    }
    t.diagnostic(`${sample.cik}: submissions=1 companyfacts=0 raw=1 facts=0 reader=PASS`);
  }
});

test('existing full path remains dependent on CompanyFacts; failure stores nothing, success still stores financial facts', async () => {
  const h = harness();
  await assert.rejects(h.service.ingestIssuer({ cik: issuers[0].cik, mode: 'incremental' }), /CompanyFacts unavailable/);
  assert.equal(h.sql.calls.length, 0);
  assert.deepEqual(h.calls, { submissions: 1, companyfacts: 1 });
  h.allowFacts();
  const result = await h.service.ingestIssuer({ cik: issuers[0].cik, mode: 'incremental' });
  assert.equal(result.sourceDocuments, 2); assert.equal(result.factsInserted, 2);
  assert.deepEqual(result.sourceUpdates.companyFacts, { fetched: 1, updated: 1, unchanged: 0 });
});

test('standalone/full replay in both orders shares source IDs, preserves first fetched_at and all facts', async t => {
  for (const order of [['single', 'single', 'full', 'single', 'full'], ['full', 'single', 'full', 'single']]) {
    const h = harness(); h.allowFacts();
    let id; let facts;
    const results = [];
    for (const [index, kind] of order.entries()) {
      const result = kind === 'single'
        ? await h.service.ingestIssuerSubmissions({ cik: issuers[0].cik })
        : await h.service.ingestIssuer({ cik: issuers[0].cik, mode: 'incremental' });
      const raw = h.sql.tables.sec_structured_raw_sources.find(row => row.source_kind === 'submissions');
      id ??= raw.id; assert.equal(raw.id, id); assert.equal(raw.fetched_at, new Date(issuers[0].fetched_at).toISOString());
      if (index) assert.deepEqual(result.sourceUpdates.submissions, { fetched: 1, updated: 0, unchanged: 1 });
      if (facts) assert.deepEqual(h.sql.tables.sec_company_facts, facts);
      if (kind === 'full') facts = structuredClone(h.sql.tables.sec_company_facts);
      // New request timestamp must not overwrite the raw snapshot's first fetch time.
      h.setDocs([{ ...document(issuers[0]), fetchedAt: now().toISOString() }]);
      results.push(result.sourceUpdates.submissions);
    }
    assert.equal(h.sql.tables.sec_structured_raw_sources.length, 2);
    assert.equal(h.sql.tables.sec_issuer_source_observations.length, 1);
    assert.equal(h.sql.tables.sec_issuer_ticker_observations.length, 1);
    assert.equal(h.sql.tables.sec_filing_ledger.length, 1);
    assert.equal(h.sql.tables.sec_company_facts.length, 2);
    t.diagnostic(`${order.join('→')}: ${JSON.stringify(results)}, raw=2 names=1 tickers=1 filings=1 facts=2`);
  }
});

test('invalid inputs, identity, raw bytes, parallel arrays and rejected main fail BEFORE storage', async t => {
  for (const cik of ['bad', '0', '', '12345678901']) {
    const h = harness(); await assert.rejects(h.service.ingestIssuerSubmissions({ cik }));
    assert.deepEqual(h.calls, { submissions: 0, companyfacts: 0 }); assert.equal(h.sql.calls.length, 0);
  }
  const mutations = {
    'empty list': () => [], 'duplicate main': doc => [doc, doc],
    'wrong document CIK': doc => [{ ...doc, cik: '2' }],
    'wrong payload CIK': doc => [syncBody({ ...doc, payload: { ...doc.payload, cik: 2 } })],
    'wrong kind': doc => [{ ...doc, sourceKind: 'companyfacts' }],
    'historical URL': doc => [{ ...doc, sourceUrl: doc.sourceUrl.replace('.json', '-submissions-001.json') }],
    'wrong identity': doc => [{ ...doc, sourceIdentity: `${doc.sourceIdentity}?run=1` }],
    'missing raw': doc => [{ ...doc, rawBody: undefined }],
    'empty raw': doc => [{ ...doc, rawBody: '' }],
    'truncated raw': doc => [{ ...doc, rawBody: doc.rawBody.slice(0, -1) }],
    'raw mismatch': doc => [{ ...doc, rawBody: '{}' }],
    'invalid raw authority': doc => [{ ...doc, rawBodyKind: undefined }],
    'invalid fetchedAt': doc => [{ ...doc, fetchedAt: 'bad' }],
    'missing payload CIK': doc => { delete doc.payload.cik; return [syncBody(doc)]; },
    'missing name': doc => { delete doc.payload.name; return [syncBody(doc)]; },
    'missing ticker arrays': doc => { delete doc.payload.tickers; return [syncBody(doc)]; },
    'missing recent': doc => { delete doc.payload.filings.recent; return [syncBody(doc)]; },
    'unequal listing arrays': doc => { doc.payload.exchanges = []; return [syncBody(doc)]; },
    'invalid ticker': doc => { doc.payload.tickers = ['INVALID TICKER']; return [syncBody(doc)]; },
    'missing ledger form': doc => { delete doc.payload.filings.recent.form; return [syncBody(doc)]; },
    'unequal ledger arrays': doc => { doc.payload.filings.recent.filingDate.push('2026-01-01'); return [syncBody(doc)]; },
    'invalid filing date': doc => { doc.payload.filings.recent.filingDate[0] = 'bad'; return [syncBody(doc)]; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const h = harness(); h.setDocs(mutate(document(issuers[0])));
    await assert.rejects(h.service.ingestIssuerSubmissions({ cik: issuers[0].cik }), undefined, name);
    assert.equal(h.sql.calls.length, 0, name); assert.equal(h.calls.companyfacts, 0);
  }
  t.diagnostic(`invalid CIK=4, invalid documents=${Object.keys(mutations).length}; storage=0 CompanyFacts=0`);
});

test('empty current listings preserve company/raw and old observations; multiple pairs retain order/class', async () => {
  const h = harness();
  const doc = document(issuers[0]);
  doc.payload.tickers = ['SYN', 'SYN.W']; doc.payload.exchanges = ['NYSE', 'Nasdaq'];
  h.setDocs([syncBody(doc)]);
  await h.service.ingestIssuerSubmissions({ cik: issuers[0].cik });
  const previous = structuredClone(h.sql.tables.sec_issuer_ticker_observations);
  assert.deepEqual(previous.map(row => [row.ticker, row.exchange]), [['SYN', 'NYSE'], ['SYN.W', 'Nasdaq']]);
  doc.payload.tickers = []; doc.payload.exchanges = [];
  h.setDocs([syncBody(doc)]);
  const result = await h.service.ingestIssuerSubmissions({ cik: issuers[0].cik });
  assert.equal(result.tickerObservationsInserted, 0); assert.equal(result.rawSourcesInserted, 1);
  assert.equal(result.issuerObservationsInserted, 1);
  assert.deepEqual(h.sql.tables.sec_issuer_ticker_observations, previous);
  assert.equal(h.sql.tables.sec_structured_raw_sources.length, 2);
});

test('real repository rollback on injected SQL failure, clean retry commits successfully', async () => {
  const h = harness(); h.sql.failTable = 'sec_issuer_ticker_observations';
  await assert.rejects(h.service.ingestIssuerSubmissions({ cik: issuers[0].cik }), /storage failure/);
  assert.equal(h.sql.calls[0], 'begin'); assert.equal(h.sql.calls.at(-1), 'rollback');
  assert.ok(Object.values(h.sql.tables).every(rows => rows.length === 0));
  h.sql.failTable = null;
  assert.equal((await h.service.ingestIssuerSubmissions({ cik: issuers[0].cik })).rawSourcesInserted, 1);
  assert.equal(h.sql.calls.at(-1), 'commit');
});

test('actual HTTP client → standalone → repository requests exactly one main JSON and never follows history', async () => {
  const sample = issuers[0]; const urls = []; const sql = new MemorySql();
  const payload = structuredClone(sample.submissions);
  payload.filings.files = [{ name: `CIK${sample.cik}-submissions-001.json` }];
  const client = new SecStructuredHttpClient('Synthetic test test@example.com', 125, async url => {
    urls.push(String(url));
    assert.equal(String(url), `https://data.sec.gov/submissions/CIK${sample.cik}.json`);
    return new Response(JSON.stringify(payload));
  }, now);
  client.fetchCompanyFacts = async () => assert.fail('CompanyFacts must not be requested');
  const result = await new SecStructuredDataService(client, new PostgresSecStructuredRepository(sql), now)
    .ingestIssuerSubmissions({ cik: sample.cik });
  assert.equal(urls.length, 1); assert.equal(result.rawSourcesInserted, 1);
  assert.equal(sql.tables.sec_structured_raw_sources[0].raw_content_kind, 'authoritative_http_body');
});
