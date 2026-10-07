// Synthetic company/tickers, isolated HTTP double, fake clock. No network or DB.
// Before fix: --expect=OLD. After fix: default NEW.
import assert from 'node:assert/strict';
import { fetchTickerLookup } from '../lib/sources/sec/parser.ts';

const expected = process.argv.find((a) => a.startsWith('--expect='))?.slice(9) ?? 'NEW';
let ticker = 'OLD', requests = 0, now = 1_000_000;
const originalFetch = globalThis.fetch, originalNow = Date.now;
globalThis.fetch = async (url) => {
  assert.equal(String(url), 'https://www.sec.gov/files/company_tickers_exchange.json');
  requests++;
  return Response.json({ fields: ['cik', 'name', 'ticker', 'exchange'],
    data: [[1234567, 'Synthetic Cache Company', ticker, 'Nasdaq']] });
};
Date.now = () => now;
try {
  const read = async (fresh = false) => (await fetchTickerLookup(fresh)).get('1234567')[0].ticker;
  const first = await read(); const cached = await read();
  ticker = 'NEW'; now += 1000;
  const fresh = await read(true); const after = await read();
  assert.deepEqual([first, cached, fresh, after], ['OLD', 'OLD', 'NEW', expected]);
  assert.equal(requests, 2);
  console.log(JSON.stringify({ synthetic: true, first, cached, fresh, after, refreshes: requests, httpAttempts: requests, realNetworkCalls: 0 }));
} finally { globalThis.fetch = originalFetch; Date.now = originalNow; }
