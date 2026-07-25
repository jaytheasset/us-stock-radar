import assert from "node:assert/strict";
import test from "node:test";
import {
  hydrateBusinessWireRawItems,
  type BusinessWireParsedRawItem,
} from "./parser.ts";

test("Business Wire hydration limits article request concurrency", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let active = 0;
  let maxActive = 0;
  globalThis.fetch = (async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return new Response(
      '<html><body><div id="bw-release-story"><p>Material company update.</p></div></body></html>',
      { status: 200 },
    );
  }) as typeof fetch;

  const result = await hydrateBusinessWireRawItems(
    Array.from({ length: 5 }, (_, index) => rawItem(index + 1)),
    { concurrency: 2, timeoutMs: 1_000 },
  );

  assert.equal(maxActive, 2);
  assert.equal(result.diagnostics.articleBodiesRequested, 5);
  assert.equal(result.diagnostics.articleBodiesFetched, 5);
  assert.equal(result.diagnostics.articleBodiesFailed, 0);
  assert.ok(result.items.every((item) => item.body_text?.includes("Material company update")));
});

test("Business Wire article timeout preserves RSS data and retry metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("The operation was aborted", "AbortError")),
        { once: true },
      );
    })) as typeof fetch;

  const item = rawItem(1);
  const startedAt = Date.now();
  const result = await hydrateBusinessWireRawItems([item], {
    concurrency: 1,
    timeoutMs: 100,
  });
  const elapsedMs = Date.now() - startedAt;
  const failed = result.items[0];

  assert.ok(elapsedMs < 500, `timeout took ${elapsedMs}ms`);
  assert.equal(failed.title, item.title);
  assert.equal(failed.source_url, item.source_url);
  assert.equal(failed.body_text, null);
  assert.equal(failed.raw_payload.article_fetch_retryable, true);
  assert.equal(failed.raw_payload.article_fetch_timed_out, true);
  assert.match(String(failed.raw_payload.article_fetch_error), /timed out/i);
  assert.equal(result.diagnostics.articleBodiesTimedOut, 1);
});

test("fallback candidates share one total timeout budget", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let calls = 0;
  globalThis.fetch = (async (_: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return new Response("blocked", { status: 403, statusText: "Forbidden" });
    }
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("The operation was aborted", "AbortError")),
        { once: true },
      );
    });
  }) as typeof fetch;

  const startedAt = Date.now();
  const result = await hydrateBusinessWireRawItems([rawItem(1)], {
    concurrency: 1,
    timeoutMs: 100,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(calls, 2);
  assert.ok(elapsedMs < 180, `fallback exceeded total timeout budget: ${elapsedMs}ms`);
  assert.equal(result.items[0].raw_payload.article_fetch_timed_out, true);
});

function rawItem(index: number): BusinessWireParsedRawItem {
  const releaseId = `2026072500000${index}`;
  return {
    source_code: "businesswire",
    source_group: "news",
    source_unique_id: releaseId,
    source_url: `https://www.businesswire.com/news/home/${releaseId}/en/Test-Release-${index}`,
    title: `Test release ${index}`,
    published_at: "2026-07-25T00:00:00.000Z",
    fetched_at: "2026-07-25T00:00:00.000Z",
    body_text: null,
    dedupe_key: `businesswire:${releaseId}`,
    raw_payload: {
      source_name: "Business Wire",
      ticker_source: "rss_listing",
    },
  };
}
