// Process-only display-test boundary. No native fetch or database connection.
const fs = require('node:fs');
const assert = require('node:assert/strict');
const pg = require('pg');
const state = () => JSON.parse(fs.readFileSync(process.env.SEC_HEADER_DISPLAY_FIXTURE, 'utf8'));
const log = data => fs.appendFileSync(process.env.SEC_HEADER_DISPLAY_TRACE, JSON.stringify(data) + '\n');
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  const method = (init?.method ?? input.method ?? 'GET').toUpperCase();
  const catalog = method === 'GET' && url.href === 'https://www.sec.gov/files/company_tickers.json';
  log({ kind: 'http-fixture', path: url.pathname, method, catalog, transmitted: false });
  if (catalog) return Response.json(state().catalog);
  if (method === 'GET' && url.hostname === 'fixture.invalid' && url.pathname.startsWith('/rest/v1/') && !url.pathname.startsWith('/rest/v1/rpc/')) return Response.json([]);
  return new Response('Excluded display verification dependency', { status: 503 });
};
pg.Client.prototype.connect = async function () { throw Error('Actual DB forbidden in display test'); };
pg.Pool.prototype.connect = async function () {
  log({ kind: 'sql-fixture-acquire', transmitted: false });
  return { release() { log({ kind: 'sql-fixture-release', transmitted: false }); }, async query(sql, values) {
    assert.match(sql, /^select/); assert.match(sql, /from public.sec_submissions_current c/);
    const fixture = state(); const cik = values[0];
    log({ kind: 'sql-fixture', cik, transmitted: false });
    if (cik === fixture.unavailableCik && !fixture.recovered) throw Error('Synthetic unavailable');
    const row = fixture.rows[cik]; return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  } };
};
