import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchAccesswireRawItems,
  hydrateAccesswireRawItems,
  parseAccesswireNewsroomApi,
  type AccesswireParsedRawItem,
} from "./parser.ts";
import { partitionSourceHydrationItems } from "../../sourceHydrationIngestPlan.ts";
import { findMatchingAccesswireItem } from "../../accesswireNasFallbackMatch.ts";

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

test("direct 403 falls back to NAS and returns usable article text", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response("Forbidden", {
      status: 403,
      statusText: "Forbidden",
    })) as typeof fetch;

  let fallbackCalls = 0;
  const result = await hydrateAccesswireRawItems([rawItem(1)], {
    concurrency: 1,
    timeoutMs: 1_000,
    fallbackHydrator: async (listing) => {
      fallbackCalls += 1;
      return {
        ok: true,
        status: 200,
        item: {
          ...listing,
          body_text: "NAS hydrated material article body",
          raw_payload: {
            ...listing.raw_payload,
            analysis_text: "NAS hydrated material article body",
          },
        },
      };
    },
  });

  assert.equal(fallbackCalls, 1);
  assert.equal(result.items[0].body_text, "NAS hydrated material article body");
  assert.equal(result.items[0].raw_payload.article_hydration_source, "nas_bridge");
  assert.equal(result.items[0].raw_payload.direct_article_fetch_status, 403);
  assert.equal(result.items[0].raw_payload.article_fetch_error, undefined);
  assert.equal(result.diagnostics.directArticleBodiesFailed, 1);
  assert.equal(result.diagnostics.nasFallbackRequested, 1);
  assert.equal(result.diagnostics.nasFallbackSucceeded, 1);
  assert.equal(result.diagnostics.nasFallbackFailed, 0);
});

test("direct 403 and NAS failure remains retryable and cannot be processed", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response("Forbidden", {
      status: 403,
      statusText: "Forbidden",
    })) as typeof fetch;

  let fallbackCalls = 0;
  const result = await hydrateAccesswireRawItems([rawItem(1)], {
    concurrency: 1,
    timeoutMs: 1_000,
    fallbackHydrator: async () => {
      fallbackCalls += 1;
      return {
        ok: false,
        status: 502,
        item: null,
        error: "NAS article fetch failed",
      };
    },
  });
  const partition = partitionSourceHydrationItems(
    result.items,
    "accesswire",
  );

  assert.equal(fallbackCalls, 1);
  assert.equal(partition.ready.length, 0);
  assert.equal(partition.retryableFailures.length, 1);
  assert.equal(result.items[0].raw_payload.article_fetch_retryable, true);
  assert.equal(result.items[0].raw_payload.direct_article_fetch_status, 403);
  assert.equal(result.items[0].raw_payload.nas_fallback_status, 502);
  assert.equal(
    result.items[0].raw_payload.nas_fallback_error,
    "NAS article fetch failed",
  );
  assert.equal(result.diagnostics.nasFallbackFailed, 1);
});

test("mismatched single NAS result remains a retryable hydration failure", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response("Forbidden", {
      status: 403,
      statusText: "Forbidden",
    })) as typeof fetch;

  const listing = rawItem(1);
  const wrongItem = {
    ...rawItem(2),
    body_text: "body for the wrong release",
    raw_payload: {
      ...rawItem(2).raw_payload,
      analysis_text: "body for the wrong release",
    },
  };
  const result = await hydrateAccesswireRawItems([listing], {
    concurrency: 1,
    timeoutMs: 1_000,
    fallbackHydrator: async () => {
      const matched = findMatchingAccesswireItem(
        accesswireResult([wrongItem]),
        listing,
      );
      return {
        ok: Boolean(matched),
        status: 200,
        item: matched,
        error: matched
          ? undefined
          : "NAS bridge returned no matching hydrated item",
      };
    },
  });
  const partition = partitionSourceHydrationItems(
    result.items,
    "accesswire",
  );

  assert.equal(partition.ready.length, 0);
  assert.equal(partition.retryableFailures.length, 1);
  assert.equal(result.items[0].raw_payload.article_fetch_retryable, true);
  assert.equal(result.diagnostics.nasFallbackSucceeded, 0);
  assert.equal(result.diagnostics.nasFallbackFailed, 1);
});

test("direct timeout exhausts the article budget without calling NAS", async (t) => {
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

  let fallbackCalls = 0;
  const result = await hydrateAccesswireRawItems([rawItem(1)], {
    concurrency: 1,
    timeoutMs: 100,
    fallbackHydrator: async () => {
      fallbackCalls += 1;
      return { ok: false, status: 0, item: null };
    },
  });

  assert.equal(fallbackCalls, 0);
  assert.equal(result.items[0].raw_payload.article_fetch_timed_out, true);
  assert.equal(
    result.items[0].raw_payload.nas_fallback_skipped_reason,
    "time_budget_exhausted",
  );
  assert.equal(result.diagnostics.nasFallbackRequested, 0);
});

test("direct and NAS share one abort-enforced article budget", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return new Response("Forbidden", {
      status: 403,
      statusText: "Forbidden",
    });
  }) as typeof fetch;

  const startedAt = Date.now();
  const result = await hydrateAccesswireRawItems([rawItem(1)], {
    concurrency: 1,
    timeoutMs: 100,
    fallbackHydrator: async (_listing, context) =>
      new Promise((resolve) => {
        context.signal.addEventListener(
          "abort",
          () =>
            resolve({
              ok: false,
              status: 0,
              item: null,
              error: "NAS timed out",
              timedOut: true,
            }),
          { once: true },
        );
      }),
  });
  const elapsedMs = Date.now() - startedAt;

  assert.ok(
    elapsedMs < 250,
    `direct + NAS exceeded the shared budget: ${elapsedMs}ms`,
  );
  assert.equal(result.diagnostics.nasFallbackRequested, 1);
  assert.equal(result.diagnostics.nasFallbackFailed, 1);
  assert.equal(result.items[0].raw_payload.nas_fallback_timed_out, true);
});

test("NAS fallback stays inside the overall hydration concurrency of two", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response("Forbidden", {
      status: 403,
      statusText: "Forbidden",
    })) as typeof fetch;

  let active = 0;
  let maxActive = 0;
  const result = await hydrateAccesswireRawItems(
    Array.from({ length: 5 }, (_, index) => rawItem(index + 1)),
    {
      concurrency: 2,
      timeoutMs: 1_000,
      fallbackHydrator: async (listing) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return {
          ok: true,
          status: 200,
          item: {
            ...listing,
            body_text: `NAS body ${listing.source_unique_id}`,
          },
        };
      },
    },
  );

  assert.equal(maxActive, 2);
  assert.equal(result.diagnostics.nasFallbackRequested, 5);
  assert.equal(result.diagnostics.nasFallbackSucceeded, 5);
  assert.equal(result.diagnostics.articleBodiesFetched, 5);
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

function accesswireResult(items: AccesswireParsedRawItem[]) {
  return {
    ok: true,
    status: 200,
    fetchedAt: "2026-07-25T12:00:00.000Z",
    count: items.length,
    items,
    diagnostics: {
      feedCount: 0,
      parsedFromFeeds: items.length,
      articleBodiesRequested: items.length,
      articleBodiesFetched: items.length,
      parserVersion: "test",
      skippedNonEnglish: 0,
      feedStats: [],
    },
  };
}
