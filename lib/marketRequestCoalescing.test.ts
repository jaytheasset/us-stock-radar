import assert from "node:assert/strict";
import test from "node:test";
import {
  createMarketRequestCoalescer,
  marketChartRequestKey,
} from "./marketRequestCoalescing.ts";

test("concurrent requests for one ticker and range share one provider load", async () => {
  const coalescer = createMarketRequestCoalescer();
  let providerCalls = 0;
  const key = marketChartRequestKey({
    forceRefresh: false,
    interval: "30minute",
    range: "5D",
    symbol: "AAPL",
  });
  const load = async () => {
    providerCalls += 1;
    await new Promise<void>((resolve) => setImmediate(resolve));
    return { points: [1, 2, 3] };
  };

  const results = await Promise.all(
    Array.from({ length: 12 }, () => coalescer.run(key, load)),
  );

  assert.equal(providerCalls, 1);
  assert.ok(results.every((result) => result === results[0]));

  await coalescer.run(key, load);
  assert.equal(providerCalls, 2, "completed requests must leave the inflight map");
});

test("a rejected provider load is cleaned up for a later retry", async () => {
  const coalescer = createMarketRequestCoalescer();
  let providerCalls = 0;
  const load = async () => {
    providerCalls += 1;
    throw new Error("temporary provider failure");
  };

  await assert.rejects(coalescer.run("MSFT:1D:5minute:cached", load));
  await assert.rejects(coalescer.run("MSFT:1D:5minute:cached", load));
  assert.equal(providerCalls, 2);
});

test("request keys preserve range, interval, and refresh semantics", () => {
  const base = {
    forceRefresh: false,
    interval: "5minute",
    range: "1D",
    symbol: "NVDA",
  };
  assert.notEqual(
    marketChartRequestKey(base),
    marketChartRequestKey({ ...base, range: "5D" }),
  );
  assert.notEqual(
    marketChartRequestKey(base),
    marketChartRequestKey({ ...base, forceRefresh: true }),
  );
});
