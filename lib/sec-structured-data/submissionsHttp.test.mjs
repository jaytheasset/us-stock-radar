import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { SecStructuredHttpClient } from './httpClient.ts';
import { SecRequestPolicy } from './secRequestPolicy.ts';
import { SecStructuredDataService } from './service.ts';

// Synthetic loopback responses only; the product source URL remains unchanged.
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const before = process.env.SEC_SUBMISSIONS_BODY_BEFORE === '1';
const timeoutMs = process.env.SEC_SUBMISSIONS_REAL_TIMEOUT === '1' ? 30_000 : 200;
const valid = JSON.stringify({ cik: 1, name: 'Synthetic Issuer', tickers: [], exchanges: [],
  filings: { recent: { accessionNumber: [], form: [], filingDate: [] }, files: [] } });

async function harness(maximumAttempts = 1) {
  let mode = 'stall';
  let attempts = 0;
  let signal;
  let abortedAt;
  let headersAt;
  let closed = 0;
  let writes = 0;
  const timers = new Set();
  let forcedCleanup = false;
  const later = (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); };
  const server = createServer((req, res) => {
    res.on('close', () => closed++);
    if (mode === 'headers') return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.flushHeaders();
    if (mode === 'ok') return res.end(valid);
    if (mode === 'invalid') return res.end('{broken');
    res.write('{');
    if (mode === 'cut') later(() => res.destroy(), 20);
    if (mode === 'slow') {
      const timer = setInterval(() => res.write(' '), 30); timers.add(timer);
    }
    if (mode === 'delayed') later(() => res.end(valid.slice(1)), 40);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  // A broken product timeout must fail the test, not strand the test process.
  // Assertions below distinguish this emergency cleanup from product abort.
  const watchdog = setTimeout(() => { forcedCleanup = true; server.closeAllConnections(); }, timeoutMs + 3000);
  timers.add(watchdog);
  const policy = new SecRequestPolicy('Synthetic test test@example.com', {
    requestTimeoutMs: timeoutMs, minimumIntervalMs: 100, maximumAttempts,
    fetchImplementation: async (url, init) => {
      assert.equal(String(url), 'https://data.sec.gov/submissions/CIK0000000001.json');
      attempts++;
      signal = init.signal;
      signal.addEventListener('abort', () => { abortedAt = performance.now(); }, { once: true });
      const response = await fetch(`http://127.0.0.1:${server.address().port}`, init);
      headersAt = performance.now();
      return response;
    },
  });
  const client = new SecStructuredHttpClient('Synthetic test test@example.com', 125, undefined, undefined, policy);
  const service = new SecStructuredDataService(client, {
    async ingestBatch(batch) {
      writes++;
      assert.equal(batch.rawSources.length, 1);
      assert.equal(batch.rawSources[0].rawContent, valid);
      assert.equal(batch.facts.length, 0);
      return { inserted: 3, updated: 0, deduped: 0, rawSourcesInserted: 1,
        issuersInserted: 1, issuerObservationsInserted: 1, tickerObservationsInserted: 0,
        filingsInserted: 0, filingsUpdated: 0, factsInserted: 0, insertedRawSourceIds: [batch.rawSources[0].id] };
    },
  });
  return { client, service, policy, setMode(value) { mode = value; },
    stats: () => ({ attempts, aborted: signal?.aborted, abortedAt, headersAt, closed, writes, forcedCleanup }),
    async close() {
      for (const timer of timers) clearInterval(timer);
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

test('Submissions headers-complete body-stall: actual stream timeout and recovery', async t => {
  const h = await harness(3);
  let settled = false;
  const start = performance.now();
  const result = (before ? h.client.fetchSubmissions('1', 'incremental') : h.service.ingestIssuerSubmissions({ cik: '1' })).then(
    value => { settled = true; return { value }; }, error => { settled = true; return { error }; });
  try {
    if (before) {
      await sleep(650);
      assert.equal(settled, false);
      assert.equal(h.stats().aborted, false);
      assert.ok(h.stats().headersAt);
      t.diagnostic(JSON.stringify({ before: true, elapsedMs: performance.now() - start, ...h.stats(), settled }));
      // Only the before reproduction uses forced cleanup to release the hung body.
      await h.close();
      assert.ok((await result).error);
      return;
    }
    const outcome = await result;
    assert.equal(h.stats().forcedCleanup, false);
    assert.ok(outcome.error);
    assert.equal(h.stats().aborted, true);
    assert.equal(h.stats().attempts, 1);
    assert.equal(h.stats().writes, 0);
    assert.ok(h.stats().abortedAt - start >= timeoutMs - 20);
    assert.ok(performance.now() - start < timeoutMs + 1500);
    await sleep(30);
    assert.equal(h.stats().closed, 1);
    t.diagnostic(JSON.stringify({ elapsedMs: performance.now() - start,
      abortMs: h.stats().abortedAt - start, ...h.stats(), settled }));
    h.setMode('ok');
    assert.equal((await h.service.ingestIssuerSubmissions({ cik: '1' })).rawSourcesInserted, 1);
    assert.equal(h.stats().writes, 1);
    assert.equal(h.stats().attempts, 2);
  } finally { if (!before) await h.close(); }
});

test('Submissions body/header boundaries, no body retry, queue recovers', { skip: before }, async t => {
  const h = await harness();
  try {
    for (const mode of ['headers', 'cut', 'invalid', 'slow', 'delayed']) {
      h.setMode(mode);
      const count = h.stats().attempts;
      const start = performance.now();
      const writes = h.stats().writes;
      if (mode === 'delayed') assert.equal((await h.service.ingestIssuerSubmissions({ cik: '1' })).rawSourcesInserted, 1);
      else await assert.rejects(h.service.ingestIssuerSubmissions({ cik: '1' }));
      assert.equal(h.stats().writes, writes + (mode === 'delayed' ? 1 : 0));
      assert.equal(h.stats().forcedCleanup, false);
      assert.equal(h.stats().attempts - count, 1);
      assert.ok(performance.now() - start < timeoutMs + 1500);
      if (['headers', 'slow'].includes(mode)) assert.equal(h.stats().aborted, true);
      t.diagnostic(`${mode}: ${Math.round(performance.now() - start)}ms, attempts=1`);
      h.setMode('ok');
      assert.equal((await h.client.fetchSubmissions('1', 'incremental'))[0].rawBody, valid);
    }
  } finally { await h.close(); }
});

test('caller cancellation stays attached during native body read', { skip: before }, async () => {
  const h = await harness(3);
  const controller = new AbortController();
  try {
    const promise = h.policy.fetchText('https://data.sec.gov/submissions/CIK0000000001.json', { signal: controller.signal });
    const rejected = assert.rejects(promise);
    while (!h.stats().headersAt) await sleep(5);
    controller.abort(new Error('synthetic caller cancellation'));
    await rejected;
    assert.equal(h.stats().forcedCleanup, false);
    assert.equal(h.stats().aborted, true); assert.equal(h.stats().attempts, 1);
    h.setMode('ok');
    assert.equal((await h.client.fetchSubmissions('1', 'incremental'))[0].rawBody, valid);
  } finally { await h.close(); }
});

test('JSON body consumer preserves transient-status retries and final HTTP status without reading error bodies', { skip: before }, async () => {
  let attempts = 0; let cancelled = 0; let at = 0;
  const policy = new SecRequestPolicy('Synthetic test test@example.com', {
    minimumIntervalMs: 125, maximumAttempts: 3,
    nowMs: () => at, sleep: async ms => { at += ms; },
    fetchImplementation: async () => {
      attempts++;
      return new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 503 });
    },
  });
  const client = new SecStructuredHttpClient('Synthetic test test@example.com', 125, undefined, undefined, policy);
  await assert.rejects(client.fetchSubmissions('1', 'incremental'), error => error.status === 503);
  assert.equal(attempts, 3); assert.equal(cancelled, 3);
});

test('late body completion from a transport ignoring abort cannot reach normalization/storage', { skip: before }, async () => {
  let calls = 0; let writes = 0;
  const policy = new SecRequestPolicy('Synthetic test test@example.com', {
    requestTimeoutMs: 10, minimumIntervalMs: 100, maximumAttempts: 3,
    fetchImplementation: async () => {
      calls++;
      if (calls > 1) return new Response(valid);
      return new Response(new ReadableStream({ start(controller) {
        setTimeout(() => { controller.enqueue(new TextEncoder().encode(valid)); controller.close(); }, 50);
      } }));
    },
  });
  const client = new SecStructuredHttpClient('Synthetic test test@example.com', 125, undefined, undefined, policy);
  const service = new SecStructuredDataService(client, { async ingestBatch() { writes++; throw new Error('storage reached'); } });
  await assert.rejects(service.ingestIssuerSubmissions({ cik: '1' }), /timed out/);
  assert.equal(calls, 1); assert.equal(writes, 0);
  assert.equal((await client.fetchSubmissions('1', 'incremental'))[0].rawBody, valid);
  assert.equal(calls, 2); assert.equal(writes, 0);
});
