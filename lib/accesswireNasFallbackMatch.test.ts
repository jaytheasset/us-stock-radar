import assert from "node:assert/strict";
import test from "node:test";
import { findMatchingAccesswireItem } from "./accesswireNasFallbackMatch.ts";
import type {
  AccesswireParsedRawItem,
  AccesswireRawFetchResult,
} from "./sources/accesswire/parser.ts";

test("source ID mismatch never adopts a single NAS result", () => {
  const listing = rawItem({
    sourceUniqueId: "1167001",
    sourceUrl:
      "https://www.accessnewswire.com/newsroom/en/test/release-1167001",
  });
  const wrongNasItem = rawItem({
    sourceUniqueId: "1167999",
    sourceUrl:
      "https://www.accessnewswire.com/newsroom/en/test/release-1167999",
    bodyText: "wrong article body",
  });

  assert.equal(
    findMatchingAccesswireItem(result([wrongNasItem]), listing),
    null,
  );
});

test("URL mismatch never adopts a single NAS result when source ID is absent", () => {
  const listing = rawItem({
    sourceUniqueId: null,
    sourceUrl:
      "https://www.accessnewswire.com/newsroom/en/test/correct-release/",
  });
  const wrongNasItem = rawItem({
    sourceUniqueId: null,
    sourceUrl:
      "https://accessnewswire.com/newsroom/en/test/wrong-release",
    bodyText: "wrong article body",
  });

  assert.equal(
    findMatchingAccesswireItem(result([wrongNasItem]), listing),
    null,
  );
});

test("source-less listing accepts normalized URL before single-result fallback", () => {
  const listing = rawItem({
    sourceUniqueId: null,
    sourceUrl:
      "https://www.accessnewswire.com/newsroom/en/test/correct-release/?ref=list",
  });
  const match = rawItem({
    sourceUniqueId: null,
    sourceUrl:
      "https://accessnewswire.com/newsroom/en/test/correct-release",
    bodyText: "correct article body",
  });

  assert.equal(
    findMatchingAccesswireItem(
      result([
        rawItem({
          sourceUniqueId: null,
          sourceUrl:
            "https://accessnewswire.com/newsroom/en/test/other-release",
        }),
        match,
      ]),
      listing,
    ),
    match,
  );
});

function result(items: AccesswireParsedRawItem[]): AccesswireRawFetchResult {
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
      articleBodiesFetched: items.filter((item) => item.body_text).length,
      parserVersion: "test",
      skippedNonEnglish: 0,
      feedStats: [],
    },
  };
}

function rawItem({
  sourceUniqueId,
  sourceUrl,
  bodyText = null,
}: {
  sourceUniqueId: string | null;
  sourceUrl: string;
  bodyText?: string | null;
}): AccesswireParsedRawItem {
  return {
    source_code: "accesswire",
    source_group: "news",
    source_unique_id: sourceUniqueId,
    source_url: sourceUrl,
    title: "Test release",
    published_at: "2026-07-25T12:00:00.000Z",
    fetched_at: "2026-07-25T12:00:00.000Z",
    body_text: bodyText,
    dedupe_key: sourceUniqueId
      ? `accesswire:${sourceUniqueId}`
      : `accesswire:${sourceUrl}`,
    raw_payload: bodyText ? { analysis_text: bodyText } : {},
  };
}
