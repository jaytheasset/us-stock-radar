// Synthetic response only; run unchanged before/after the common-reader refactor.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchSecCompanyTickers } from '../lib/integrations.ts';

const rows = [
  { cik_str: 1234567, ticker: 'syn.a', title: 'Synthetic Blue Company' },
  { cik_str: 2345678, ticker: 'BETA', title: 'Synthetic Green Company' },
  { cik_str: 3456789, ticker: 'SYNX', title: '  Synthetic Blue Holdings  ' },
  { cik_str: 1234567, ticker: 'SYN.B', title: 'Synthetic Blue Company Class B' },
  ...Array.from({ length: 57 }, (_, i) => ({ cik_str: 4000000 + i, ticker: `FILL${i}`, title: `Filler Company ${i}` })),
];
const cases = [['', {}], [' syn.a ', {}], ['sYn', {}], ['bLuE', {}], ['SYN.A', { exactTicker: true }],
  ['SYN', { exactTicker: true }], ['not-found', {}], ['FILL', {}]];
const nativeFetch = globalThis.fetch, priorAgent = process.env.SEC_USER_AGENT;
let calls = 0;
process.env.SEC_USER_AGENT = 'Synthetic tests contact@example.test';
globalThis.fetch = async (url) => {
  assert.equal(String(url), 'https://www.sec.gov/files/company_tickers.json'); calls++;
  return Response.json(Object.fromEntries(rows.map((row, i) => [String(i), row])));
};
try {
  const results = [];
  for (const [query, options] of cases) results.push({ query, options, result: await fetchSecCompanyTickers(query, options) });
  const serialized = JSON.stringify(results);
  const write = process.argv.find((a) => a.startsWith('--write='))?.slice(8);
  const compare = process.argv.find((a) => a.startsWith('--compare='))?.slice(10);
  if (write) writeFileSync(write, serialized, { flag: 'wx' });
  if (compare) assert.deepEqual(JSON.parse(serialized), JSON.parse(readFileSync(compare, 'utf8')));
  assert.equal(calls, cases.length, 'default remains fresh');
  console.log(JSON.stringify({ synthetic: true, queries: cases.length, HTTP: calls,
    sha256: createHash('sha256').update(serialized).digest('hex'),
    counts: results.map((r) => ({ query: r.query, exact: !!r.options.exactTicker, count: r.result.count, returned: r.result.data.length })),
    order: results[0].result.data.slice(0, 4), compared: !!compare }));
} finally {
  globalThis.fetch = nativeFetch;
  if (priorAgent === undefined) delete process.env.SEC_USER_AGENT; else process.env.SEC_USER_AGENT = priorAgent;
}
