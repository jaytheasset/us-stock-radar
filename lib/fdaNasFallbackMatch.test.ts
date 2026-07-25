import assert from "node:assert/strict";
import test from "node:test";
import { findMatchingFdaItem } from "./fdaNasFallbackMatch.ts";
import type {
  FdaParsedRawItem,
  FdaRawFetchResult,
} from "./sources/fda/parser.ts";

test("FDA source ID mismatch never adopts a single NAS result", () => {
  const listing = rawItem("correct-id", "/correct-id");
  const wrong = rawItem("wrong-id", "/wrong-id", "wrong body");

  assert.equal(findMatchingFdaItem(result([wrong]), listing), null);
});

test("FDA URL mismatch never adopts a single source-less NAS result", () => {
  const listing = rawItem(null, "/correct-page");
  const wrong = rawItem(null, "/wrong-page", "wrong body");

  assert.equal(findMatchingFdaItem(result([wrong]), listing), null);
});

test("FDA source-less listing accepts normalized matching URL", () => {
  const listing = rawItem(null, "/matching-page/?source=rss");
  const match = rawItem(null, "/matching-page", "correct body");

  assert.equal(findMatchingFdaItem(result([match]), listing), match);
});

function result(items: FdaParsedRawItem[]): FdaRawFetchResult {
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
      articleBodiesFetched: items.filter((item) => item.body_text).length,
      parserVersion: "test",
      skippedNonEnglish: 0,
      feedStats: [],
    },
  };
}

function rawItem(
  sourceUniqueId: string | null,
  path: string,
  bodyText: string | null = null,
): FdaParsedRawItem {
  const sourceUrl = `https://www.fda.gov${path}`;
  return {
    source_code: "fda",
    source_group: "news",
    source_unique_id: sourceUniqueId,
    source_url: sourceUrl,
    title: "FDA test item",
    published_at: "2026-07-26T12:00:00.000Z",
    fetched_at: "2026-07-26T12:00:00.000Z",
    body_text: bodyText,
    dedupe_key: `fda:${sourceUniqueId || sourceUrl}`,
    raw_payload: bodyText ? { analysis_text: bodyText } : {},
  };
}
