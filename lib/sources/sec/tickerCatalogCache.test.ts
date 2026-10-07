import assert from "node:assert/strict";
import test from "node:test";
import { createTickerCatalogCache, SEC_TICKER_CATALOG_TTL_MS as TTL } from "./tickerCatalogCache.ts";

// All company names, tickers and identities in this file are synthetic.
const catalog = (ticker: string) => new Map([["1234567", [{ cik: "1234567", ticker, exchange: "Nasdaq", name: "Synthetic Cache Company" }]]]);
const symbol = (value: ReturnType<typeof catalog>) => value.get("1234567")?.[0].ticker;
function deferred<T>() { let resolve!: (v: T) => void; let reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test("15-minute TTL uses successful completion time, including unchanged content", async () => {
  let now = 0, refreshes = 0, value = "OLD";
  const cache = createTickerCatalogCache(async () => { refreshes++; return catalog(value); }, () => now);
  assert.equal(TTL, 900_000);
  assert.equal(symbol(await cache.get()), "OLD");
  now = TTL - 1; value = "NEW";
  assert.equal(symbol(await cache.get()), "OLD"); assert.equal(refreshes, 1);
  now = TTL;
  assert.equal(symbol(await cache.get()), "NEW"); assert.equal(cache.state().lastSuccessAt, TTL);
  now = TTL + 100;
  assert.equal(symbol(await cache.get(true)), "NEW"); assert.equal(cache.state().lastSuccessAt, TTL + 100);
  now = 2 * TTL;
  assert.equal(symbol(await cache.get()), "NEW"); assert.equal(refreshes, 3);
  console.log(JSON.stringify({ scenario: "ttl-and-same-content", refreshes, lastSuccessAt: cache.state().lastSuccessAt, returned: "NEW" }));
});

test("normal and fresh callers share one in-flight refresh and wait rather than receive the old snapshot", async () => {
  let now = 10, refreshes = 0, pending = deferred<ReturnType<typeof catalog>>();
  const cache = createTickerCatalogCache(() => { refreshes++; return pending.promise; }, () => now);
  const first = [cache.get(), cache.get(true), cache.get()];
  await Promise.resolve(); assert.equal(refreshes, 1);
  pending.resolve(catalog("OLD"));
  assert.deepEqual((await Promise.all(first)).map(symbol), ["OLD", "OLD", "OLD"]);
  pending = deferred(); now = 20;
  const fresh = cache.get(true), normal = cache.get(), anotherFresh = cache.get(true);
  let normalDone = false; void normal.then(() => { normalDone = true; });
  await Promise.resolve(); assert.equal(refreshes, 2); assert.equal(normalDone, false);
  now = 30; pending.resolve(catalog("NEW"));
  assert.deepEqual((await Promise.all([fresh, normal, anotherFresh])).map(symbol), ["NEW", "NEW", "NEW"]);
  assert.equal(cache.state().lastSuccessAt, 30);
  assert.equal(symbol(await cache.get()), "NEW"); assert.equal(refreshes, 2);
  console.log(JSON.stringify({ scenario: "coalesced-normal-fresh", callers: 6, refreshes, final: "NEW", checkedAt: 30 }));
});

test("initial, forced and expired failures reject, preserve successful time and allow normal retry", async () => {
  let now = 10, refreshes = 0, fail = true;
  const cache = createTickerCatalogCache(async () => { refreshes++; if (fail) throw Error("HTTP unavailable"); return catalog("GOOD"); }, () => now);
  await assert.rejects(cache.get(), /unavailable/);
  assert.deepEqual(cache.state(), { lastSuccessAt: null, refreshing: false, refreshFailed: true });
  fail = false; await cache.get(); assert.equal(cache.state().lastSuccessAt, 10);
  now = 20; fail = true; await assert.rejects(cache.get(true));
  assert.equal(cache.state().lastSuccessAt, 10);
  await assert.rejects(cache.get()); // must retry even though the old snapshot is still within TTL
  assert.equal(refreshes, 4);
  fail = false; now = 30; assert.equal(symbol(await cache.get()), "GOOD");
  now = 30 + TTL; fail = true; await assert.rejects(cache.get());
  assert.equal(cache.state().lastSuccessAt, 30);
  fail = false; now++; assert.equal(symbol(await cache.get()), "GOOD");
  assert.equal(refreshes, 7); assert.equal(cache.state().lastSuccessAt, 30 + TTL + 1);
  console.log(JSON.stringify({ scenario: "failure-recovery", refreshes, final: "GOOD", lastSuccessAt: cache.state().lastSuccessAt }));
});

test("loader and callers cannot mutate cached Maps, arrays or rows", async () => {
  const ownedByLoader = catalog("GOOD");
  const cache = createTickerCatalogCache(async () => ownedByLoader);
  const [a, b] = await Promise.all([cache.get(), cache.get()]);
  a.get("1234567")![0].ticker = "CORRUPT";
  a.get("1234567")!.push({ cik: "1234567", ticker: "EXTRA", name: "Fake", exchange: "NYSE" }); a.clear();
  ownedByLoader.get("1234567")![0].name = "MUTATED"; ownedByLoader.clear();
  assert.deepEqual(b, catalog("GOOD")); assert.deepEqual(await cache.get(), catalog("GOOD"));
});
