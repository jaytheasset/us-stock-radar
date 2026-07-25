import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  fetchAccesswireRawItems,
  waitForAccesswireBrowserDiscovery,
} from "./server.mjs";

test("NAS AccessWire stops after the first challenge and browser fallback succeeds", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let apiCalls = 0;
  let browserCalls = 0;
  globalThis.fetch = async () => {
    apiCalls += 1;
    return new Response(
      "<html><title>Just a moment</title>Cloudflare challenge-platform</html>",
      {
        status: 403,
        statusText: "Forbidden",
      },
    );
  };

  const result = await fetchAccesswireRawItems(
    {
      limit: 5,
      includeArticleBody: false,
      listTimeoutMs: 1_000,
    },
    {
      browserFetcher: async () => {
        browserCalls += 1;
        return {
          items: [rawItem("1167003")],
          feedStat: {
            label: "ACCESS Newswire browser newsroom",
            ok: true,
            status: 200,
            itemCount: 1,
          },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(apiCalls, 1);
  assert.equal(browserCalls, 1);
  assert.equal(result.diagnostics.discoveryMethod, "browser");
  assert.equal(result.diagnostics.apiChallengeDetected, true);
  assert.equal(result.diagnostics.apiFeedsAttempted, 1);
  assert.equal(
    result.diagnostics.apiFeedsSkippedAfterChallenge,
    12,
  );
});

test("NAS AccessWire keeps normal API feed behavior without a challenge", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let apiCalls = 0;
  let browserCalls = 0;
  globalThis.fetch = async () => {
    apiCalls += 1;
    const articles =
      apiCalls === 1
        ? []
        : [
            {
              id: "1167004",
              title: "Example Corp announces results",
              releaseurl:
                "https://www.accessnewswire.com/newsroom/en/financial/example-corp-announces-results-1167004",
              description: "NASDAQ: EXMP announced results.",
              adate: "Jul 25, 2026 9:30 AM ET",
              company: "Example Corp",
            },
          ];
    return new Response(
      JSON.stringify({ data: { articles } }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  const result = await fetchAccesswireRawItems(
    {
      limit: 1,
      includeArticleBody: false,
      listTimeoutMs: 1_000,
    },
    {
      browserFetcher: async () => {
        browserCalls += 1;
        return {
          items: [],
          feedStat: {
            label: "ACCESS Newswire browser newsroom",
            ok: false,
            status: 0,
            itemCount: 0,
          },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(apiCalls, 2);
  assert.equal(browserCalls, 0);
  assert.equal(result.diagnostics.discoveryMethod, "newsroom_api");
  assert.equal(result.diagnostics.apiChallengeDetected, false);
});

test("NAS browser discovery returns as soon as a release DOM is ready", async () => {
  let locatorCalls = 0;
  let timeoutCalls = 0;
  const result = await waitForAccesswireBrowserDiscovery({
    page: {
      locator() {
        locatorCalls += 1;
        return {
          evaluateAll: async () => true,
        };
      },
      async waitForTimeout() {
        timeoutCalls += 1;
      },
    },
    articlesFromResponse: [],
    deadline: Date.now() + 1_000,
  });

  assert.equal(result, "release_dom");
  assert.equal(locatorCalls, 1);
  assert.equal(timeoutCalls, 0);
});

test("NAS browser discovery does not wait for networkidle", () => {
  const source = readFileSync(
    new URL("./server.mjs", import.meta.url),
    "utf8",
  );

  assert.equal(
    source.includes('waitForLoadState("networkidle"'),
    false,
  );
});

test("NAS browser fallback obeys the shared listing deadline", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response("Forbidden", {
      status: 403,
      statusText: "Forbidden",
    });

  const startedAt = Date.now();
  const result = await fetchAccesswireRawItems(
    {
      limit: 1,
      includeArticleBody: false,
      listTimeoutMs: 150,
    },
    {
      browserFetcher: async () =>
        new Promise(() => undefined),
      rssFetcher: async () => ({
        items: [],
        feedStat: {
          label: "ACCESS Newswire RSS",
          ok: false,
          status: 0,
          itemCount: 0,
        },
      }),
    },
  );
  const elapsedMs = Date.now() - startedAt;

  assert.equal(result.ok, false);
  assert.ok(
    elapsedMs < 500,
    `NAS listing exceeded its shared budget: ${elapsedMs}ms`,
  );
});

function rawItem(sourceUniqueId) {
  return {
    source_code: "accesswire",
    source_group: "news",
    source_unique_id: sourceUniqueId,
    source_url:
      `https://www.accessnewswire.com/newsroom/en/test-${sourceUniqueId}`,
    title: "AccessWire browser test item",
    published_at: "2026-07-25T12:00:00.000Z",
    fetched_at: "2026-07-25T12:01:00.000Z",
    body_text: null,
    dedupe_key: `accesswire:${sourceUniqueId}`,
    raw_payload: {
      analysis_text: "AccessWire browser test item",
    },
  };
}
