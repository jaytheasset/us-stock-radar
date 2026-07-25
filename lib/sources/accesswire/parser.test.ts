import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchAccesswireRawItems,
  hydrateAccesswireRawItems,
  parseAccesswireNewsroomApi,
  type AccesswireParsedRawItem,
} from "./parser.ts";

test("AccessWire hydration limits article request concurrency to two", async (t) => {
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

  const result = await hydrateAccesswireRawItems(
    Array.from({ length: 5 }, (_, index) => rawItem(index + 1)),
    { concurrency: 2, timeoutMs: 1_000 },
  );

  assert.equal(maxActive, 2);
  assert.equal(result.diagnostics.articleBodiesRequested, 5);
  assert.equal(result.diagnostics.articleBodiesFetched, 5);
  assert.equal(result.diagnostics.articleBodiesFailed, 0);
});

test("AccessWire timeout preserves listing data and retry metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () =>
          reject(
            new DOMException("The operation was aborted", "AbortError"),
          ),
        { once: true },
      );
    })) as typeof fetch;

  const listing = rawItem(1);
  const startedAt = Date.now();
  const result = await hydrateAccesswireRawItems([listing], {
    concurrency: 1,
    timeoutMs: 100,
  });
  const elapsedMs = Date.now() - startedAt;
  const failed = result.items[0];

  assert.ok(elapsedMs < 500, `timeout took ${elapsedMs}ms`);
  assert.equal(failed.title, listing.title);
  assert.equal(failed.source_url, listing.source_url);
  assert.equal(failed.body_text, null);
  assert.equal(failed.raw_payload.article_fetch_retryable, true);
  assert.equal(failed.raw_payload.article_fetch_timed_out, true);
  assert.match(
    String(failed.raw_payload.article_fetch_error),
    /timed out/i,
  );
  assert.equal(result.diagnostics.articleBodiesTimedOut, 1);
});

test("redirect handling and body reading share the article timeout budget", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let redirectMode: RequestRedirect | undefined;
  globalThis.fetch = (async (
    _: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    redirectMode = init?.redirect;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      url: "https://www.accessnewswire.com/newsroom/en/test-1167001",
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
    } as Response;
  }) as typeof fetch;

  const startedAt = Date.now();
  const result = await hydrateAccesswireRawItems([rawItem(1)], {
    concurrency: 1,
    timeoutMs: 100,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(redirectMode, "follow");
  assert.ok(
    elapsedMs < 500,
    `response body exceeded total timeout budget: ${elapsedMs}ms`,
  );
  assert.equal(result.items[0].raw_payload.article_fetch_timed_out, true);
});

test("AccessWire newsroom listing uses one bounded timeout budget", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let calls = 0;
  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () =>
          reject(
            new DOMException("The operation was aborted", "AbortError"),
          ),
        { once: true },
      );
    });
  }) as typeof fetch;

  const startedAt = Date.now();
  const result = await fetchAccesswireRawItems({
    feeds: [
      {
        label: "Primary",
        url: "https://www.accessnewswire.com/newsroom/api",
        primary: true,
      },
      {
        label: "Fallback",
        url: "https://www.accessnewswire.com/newsroom/api",
      },
    ],
    limit: 5,
    includeArticleBody: false,
    listTimeoutMs: 100,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.ok, false);
  assert.equal(calls, 1);
  assert.ok(
    elapsedMs < 500,
    `listing exceeded total timeout budget: ${elapsedMs}ms`,
  );
  assert.match(
    result.diagnostics.feedStats[0]?.error || "",
    /timed out/i,
  );
});

test("AccessWire newsroom parser keeps the existing listing contract", () => {
  const items = parseAccesswireNewsroomApi(
    {
      data: {
        articles: [
          {
            id: "1167001",
            title: "Example Corp announces quarterly results",
            releaseurl:
              "https://www.accessnewswire.com/newsroom/en/financial/example-corp-announces-quarterly-results-1167001",
            description: "<p>NASDAQ: EXMP reported results.</p>",
            adate: "Jul 25, 2026 8:30 AM ET",
            company: "Example Corp",
          },
        ],
      },
    },
    {
      feed: {
        label: "All Newsroom Releases",
        url: "https://www.accessnewswire.com/newsroom/api",
        primary: true,
      },
      fetchedAt: "2026-07-25T12:00:00.000Z",
    },
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].source_code, "accesswire");
  assert.equal(items[0].source_unique_id, "1167001");
  assert.equal(items[0].body_text, null);
  assert.equal(items[0].raw_payload.ticker_source, "newsroom_metadata_debug_only");
});

function articleResponse() {
  return new Response(
    [
      "<html><head>",
      '<meta property="og:title" content="Example material update">',
      "</head><body>",
      '<div class="main-article"><p>Example Corp reported a material quarterly update.</p></div>',
      "</body></html>",
    ].join(""),
    { status: 200 },
  );
}

function rawItem(index: number): AccesswireParsedRawItem {
  const releaseId = `11670${String(index).padStart(2, "0")}`;
  return {
    source_code: "accesswire",
    source_group: "news",
    source_unique_id: releaseId,
    source_url:
      `https://www.accessnewswire.com/newsroom/en/financial/test-release-${releaseId}`,
    title: `Test release ${index}`,
    published_at: "2026-07-25T12:00:00.000Z",
    fetched_at: "2026-07-25T12:00:00.000Z",
    body_text: null,
    dedupe_key: `accesswire:${releaseId}`,
    raw_payload: {
      source_name: "ACCESS Newswire",
      ticker_source: "newsroom_listing",
    },
  };
}
