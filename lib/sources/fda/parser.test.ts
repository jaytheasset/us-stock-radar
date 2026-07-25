import assert from "node:assert/strict";
import test from "node:test";
import { findMatchingFdaItem } from "../../fdaNasFallbackMatch.ts";
import { partitionSourceHydrationItems } from "../../sourceHydrationIngestPlan.ts";
import {
  fetchFdaRawItems,
  hydrateFdaRawItems,
  type FdaParsedRawItem,
  type FdaRawFetchResult,
} from "./parser.ts";

test("FDA fetch can return listing-only items without article requests", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(rssXml(), { status: 200 });
  }) as typeof fetch;

  const result = await fetchFdaRawItems({
    feeds: [
      {
        label: "Test FDA feed",
        url: "https://www.fda.gov/test-feed.xml",
        kind: "press_release",
        primary: true,
      },
    ],
    limit: 1,
    includeArticleBody: false,
  });

  assert.equal(calls, 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].body_text, null);
  assert.equal(result.diagnostics.articleBodiesRequested, 0);
  assert.equal(result.diagnostics.articleBodiesFetched, 0);
});

test("successful direct FDA hydration never calls NAS", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () => articleResponse()) as typeof fetch;
  let nasCalls = 0;
  const result = await hydrateFdaRawItems([rawItem("correct-id")], {
    concurrency: 1,
    timeoutMs: 1_000,
    fallbackHydrator: async () => {
      nasCalls += 1;
      return { ok: false, status: 0, item: null };
    },
  });

  assert.equal(nasCalls, 0);
  assert.match(result.items[0].body_text || "", /material safety update/i);
  assert.equal(result.diagnostics.nasFallbackRequested, 0);
  assert.equal(result.diagnostics.articleBodiesFetched, 1);
});

test("failed direct FDA hydration uses a matching NAS item", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response("Forbidden", {
      status: 403,
      statusText: "Forbidden",
    })) as typeof fetch;

  const listing = rawItem("correct-id");
  const result = await hydrateFdaRawItems([listing], {
    concurrency: 1,
    timeoutMs: 1_000,
    fallbackHydrator: async () => ({
      ok: true,
      status: 200,
      item: {
        ...listing,
        body_text: "FDA NAS hydrated body",
        raw_payload: { analysis_text: "FDA NAS hydrated body" },
      },
    }),
  });

  assert.equal(result.items[0].body_text, "FDA NAS hydrated body");
  assert.equal(result.items[0].raw_payload.article_hydration_source, "nas_bridge");
  assert.equal(result.diagnostics.directArticleBodiesFailed, 1);
  assert.equal(result.diagnostics.nasFallbackRequested, 1);
  assert.equal(result.diagnostics.nasFallbackSucceeded, 1);
});

test("FDA 200 response without article text also uses NAS fallback", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response("<html><body><nav>FDA navigation only</nav></body></html>", {
      status: 200,
    })) as typeof fetch;

  const listing = rawItem("missing-body");
  let nasCalls = 0;
  const result = await hydrateFdaRawItems([listing], {
    concurrency: 1,
    timeoutMs: 1_000,
    fallbackHydrator: async () => {
      nasCalls += 1;
      return {
        ok: true,
        status: 200,
        item: {
          ...listing,
          body_text: "FDA body recovered from NAS",
          raw_payload: { analysis_text: "FDA body recovered from NAS" },
        },
      };
    },
  });

  assert.equal(nasCalls, 1);
  assert.equal(result.items[0].body_text, "FDA body recovered from NAS");
  assert.equal(result.diagnostics.directArticleBodiesFailed, 1);
  assert.equal(result.diagnostics.nasFallbackSucceeded, 1);
});

test("mismatched FDA NAS item remains retryable", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = (async () =>
    new Response("Forbidden", {
      status: 403,
      statusText: "Forbidden",
    })) as typeof fetch;

  const listing = rawItem("correct-id");
  const wrong = {
    ...rawItem("wrong-id"),
    body_text: "wrong FDA body",
    raw_payload: { analysis_text: "wrong FDA body" },
  };
  const result = await hydrateFdaRawItems([listing], {
    concurrency: 1,
    timeoutMs: 1_000,
    fallbackHydrator: async () => {
      const matched = findMatchingFdaItem(fdaResult([wrong]), listing);
      return {
        ok: Boolean(matched),
        status: 200,
        item: matched,
        error: matched ? undefined : "No matching FDA NAS item",
      };
    },
  });
  const partition = partitionSourceHydrationItems(result.items, "fda");

  assert.equal(partition.ready.length, 0);
  assert.equal(partition.retryableFailures.length, 1);
  assert.equal(result.items[0].raw_payload.article_fetch_retryable, true);
  assert.equal(result.diagnostics.nasFallbackSucceeded, 0);
  assert.equal(result.diagnostics.nasFallbackFailed, 1);
});

function articleResponse() {
  return new Response(
    [
      "<html><head>",
      '<meta property="og:title" content="FDA material safety update">',
      "</head><body><main>",
      "<h1>FDA material safety update</h1>",
      "<p>The FDA announced a material safety update for a regulated product.</p>",
      "</main></body></html>",
    ].join(""),
    { status: 200 },
  );
}

function rssXml() {
  return [
    '<?xml version="1.0"?>',
    "<rss><channel><item>",
    "<title>FDA announces material safety update</title>",
    "<link>https://www.fda.gov/news-events/press-announcements/material-safety-update</link>",
    "<guid>https://www.fda.gov/news-events/press-announcements/material-safety-update</guid>",
    "<pubDate>Sun, 26 Jul 2026 12:00:00 EST</pubDate>",
    "<description>FDA safety announcement.</description>",
    "</item></channel></rss>",
  ].join("");
}

function rawItem(sourceUniqueId: string): FdaParsedRawItem {
  const sourceUrl =
    `https://www.fda.gov/news-events/press-announcements/${sourceUniqueId}`;
  return {
    source_code: "fda",
    source_group: "news",
    source_unique_id: sourceUniqueId,
    source_url: sourceUrl,
    title: "FDA test release",
    published_at: "2026-07-26T12:00:00.000Z",
    fetched_at: "2026-07-26T12:00:00.000Z",
    body_text: null,
    dedupe_key: `fda:${sourceUniqueId}`,
    raw_payload: {
      feed_kind: "press_release",
      candidate_class: "sector_theme_policy_candidate",
    },
  };
}

function fdaResult(items: FdaParsedRawItem[]): FdaRawFetchResult {
  return {
    ok: true,
    status: 200,
    fetchedAt: "2026-07-26T12:00:00.000Z",
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
