import assert from "node:assert/strict";
import test from "node:test";
import { prepareSourceHydrationBatch } from "../../sourceHydrationIngestPlan.ts";
import {
  fetchGlobeNewswireRawItems,
  hydrateGlobeNewswireRawItems,
  type GlobeParsedRawItem,
} from "./parser.ts";

type Raw = Record<string, unknown> & { id: string };
type Event = { id: string };

test("Globe listing-only fetch preserves preview fields without article requests", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input) => {
    requestedUrls.push(String(input));
    return new Response(searchHtml(), { status: 200 });
  }) as typeof fetch;

  const result = await fetchGlobeNewswireRawItems({
    limit: 1,
    includeArticleBody: false,
  });

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(requestedUrls.length, 1);
  assert.equal(result.items[0].source_code, "globe");
  assert.equal(result.items[0].body_text, null);
  assert.equal(result.items[0].title, "Listing-only Globe release");
  assert.equal(result.diagnostics.articleBodiesRequested, 0);
  assert.equal(result.diagnostics.articleBodiesFetched, 0);
});

test("five existing Globe events perform zero article requests", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let articleRequests = 0;
  globalThis.fetch = (async () => {
    articleRequests += 1;
    return articleResponse();
  }) as typeof fetch;

  const batch = await prepareSourceHydrationBatch<
    GlobeParsedRawItem,
    Raw,
    Event
  >({
    items: Array.from({ length: 5 }, (_, index) => rawItem(index + 1)),
    sourceCode: "globe",
    loadExistingState: async (item) => ({
      raw: {
        id: `raw-${item.source_unique_id}`,
        body_text: "stored article body",
      },
      event: { id: `event-${item.source_unique_id}` },
    }),
    hydrateItems: (items) =>
      hydrateGlobeNewswireRawItems(items, {
        concurrency: 2,
        timeoutMs: 1_000,
      }),
    mergeExistingRaw: mergeStoredRaw,
  });

  assert.equal(articleRequests, 0);
  assert.equal(batch.skipped.length, 5);
  assert.equal(batch.processingItems.length, 0);
  assert.equal(batch.stats.preexistingCount, 5);
  assert.equal(batch.stats.hydrationRequestedCount, 0);
});

test("Globe hydration requests only new or retryable items", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input) => {
    requestedUrls.push(String(input));
    return articleResponse();
  }) as typeof fetch;

  const existing = rawItem(1);
  const fresh = rawItem(2);
  const batch = await prepareSourceHydrationBatch<
    GlobeParsedRawItem,
    Raw,
    Event
  >({
    items: [existing, fresh],
    sourceCode: "globe",
    loadExistingState: async (item) =>
      item.source_unique_id === existing.source_unique_id
        ? {
            raw: {
              id: "raw-existing",
              body_text: "stored body",
            },
            event: { id: "event-existing" },
          }
        : { raw: null, event: null },
    hydrateItems: (items) =>
      hydrateGlobeNewswireRawItems(items, {
        concurrency: 2,
        timeoutMs: 1_000,
      }),
    mergeExistingRaw: mergeStoredRaw,
  });

  assert.deepEqual(requestedUrls, [fresh.source_url]);
  assert.equal(batch.skipped.length, 1);
  assert.equal(batch.processingItems.length, 1);
  assert.equal(batch.processingItems[0].source_unique_id, fresh.source_unique_id);
  assert.match(batch.processingItems[0].body_text || "", /Material company update/);
});

test("Globe hydration limits article request concurrency to two", async (t) => {
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
    return articleResponse();
  }) as typeof fetch;

  const result = await hydrateGlobeNewswireRawItems(
    Array.from({ length: 5 }, (_, index) => rawItem(index + 1)),
    { concurrency: 2, timeoutMs: 1_000 },
  );

  assert.equal(maxActive, 2);
  assert.equal(result.diagnostics.articleBodiesRequested, 5);
  assert.equal(result.diagnostics.articleBodiesFetched, 5);
  assert.equal(result.diagnostics.articleBodiesFailed, 0);
});

test("Globe redirect and body read share one article timeout budget", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async (_input, init) =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      url: "https://www.globenewswire.com/en/news-release/redirected",
      text: () =>
        new Promise<string>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () =>
              reject(
                new DOMException(
                  "The operation was aborted",
                  "AbortError",
                ),
              ),
            { once: true },
          );
        }),
    }) as Response) as typeof fetch;

  const startedAt = Date.now();
  const result = await hydrateGlobeNewswireRawItems([rawItem(1)], {
    concurrency: 1,
    timeoutMs: 100,
  });
  const elapsedMs = Date.now() - startedAt;
  const failed = result.items[0];

  assert.ok(elapsedMs < 500, `timeout took ${elapsedMs}ms`);
  assert.equal(result.diagnostics.articleBodiesTimedOut, 1);
  assert.equal(result.diagnostics.articleBodiesFailed, 1);
  assert.equal(failed.body_text, null);
  assert.equal(failed.raw_payload.article_fetch_retryable, true);
  assert.equal(failed.raw_payload.article_fetch_timed_out, true);
  assert.match(String(failed.raw_payload.article_fetch_error), /timed out/i);
});

test("failed Globe hydration cannot reach analysis and retries next run", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const listing = rawItem(1);
  globalThis.fetch = (async () =>
    new Response("blocked", {
      status: 503,
      statusText: "Service Unavailable",
    })) as typeof fetch;

  const failed = await prepareSourceHydrationBatch<
    GlobeParsedRawItem,
    Raw,
    Event
  >({
    items: [listing],
    sourceCode: "globe",
    loadExistingState: async () => ({ raw: null, event: null }),
    hydrateItems: (items) =>
      hydrateGlobeNewswireRawItems(items, {
        concurrency: 1,
        timeoutMs: 1_000,
      }),
    mergeExistingRaw: mergeStoredRaw,
  });

  assert.equal(failed.processingItems.length, 0);
  assert.equal(failed.retryableFailures.length, 1);
  assert.equal(failed.stats.hydrationFailedCount, 1);
  assert.equal(
    failed.retryableFailures[0].raw_payload.article_fetch_retryable,
    true,
  );

  globalThis.fetch = (async () => articleResponse()) as typeof fetch;
  const retried = await prepareSourceHydrationBatch<
    GlobeParsedRawItem,
    Raw,
    Event
  >({
    items: [listing],
    sourceCode: "globe",
    loadExistingState: async () => ({
      raw: {
        id: "raw-retry",
        body_text: null,
        analysis_text: null,
        raw_payload: {
          article_fetch_error: "Service Unavailable",
          article_fetch_retryable: true,
        },
      },
      event: null,
    }),
    hydrateItems: (items) =>
      hydrateGlobeNewswireRawItems(items, {
        concurrency: 1,
        timeoutMs: 1_000,
      }),
    mergeExistingRaw: mergeStoredRaw,
  });

  assert.equal(retried.skipped.length, 0);
  assert.equal(retried.processingItems.length, 1);
  assert.equal(retried.retryableFailures.length, 0);
  assert.match(retried.processingItems[0].body_text || "", /Material company update/);
});

function rawItem(index: number): GlobeParsedRawItem {
  const releaseId = `100000${index}`;
  return {
    source_code: "globe",
    source_group: "news",
    source_unique_id: releaseId,
    source_url:
      `https://www.globenewswire.com/en/news-release/2026/07/25/${releaseId}/0/en/Test-${index}.html`,
    title: `Test release ${index}`,
    published_at: "2026-07-25T00:00:00.000Z",
    fetched_at: "2026-07-25T00:00:00.000Z",
    body_text: null,
    dedupe_key: `globe:${releaseId}`,
    raw_payload: {
      provider: "GlobeNewswire",
      ticker_source: "search_listing",
    },
  };
}

function articleResponse() {
  return new Response(
    [
      "<html><body>",
      '<h1 class="article-headline">Material Globe release</h1>',
      '<div id="main-body-container"><p>Material company update.</p></div>',
      "</body></html>",
    ].join(""),
    { status: 200 },
  );
}

function searchHtml() {
  return [
    '<div class="recentNewsH"><ul>',
    '<li class="row">',
    '<div class="mainLink">',
    '<a href="/en/news-release/2026/07/25/100001/0/en/Listing.html">',
    "Listing-only Globe release",
    "</a>",
    "</div>",
    '<div class="date-source"><span>July 25, 2026 08:00 ET</span>',
    'Source: <a href="/search/organization/Test">Test Corp</a></div>',
    '<div class="newsTxt">Material listing summary.</div>',
    "</li>",
    "</ul></div>",
  ].join("");
}

function mergeStoredRaw(
  item: GlobeParsedRawItem,
  raw: Raw,
): GlobeParsedRawItem {
  return {
    ...item,
    body_text:
      typeof raw.body_text === "string"
        ? raw.body_text
        : null,
  };
}
