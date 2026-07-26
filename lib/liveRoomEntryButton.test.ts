import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("shared Live Room entry button routes ticker context to one company room", () => {
  const source = read("components/live-room/LiveRoomEntryButton.tsx");
  const styles = read("components/live-room/LiveRoomEntryButton.module.css");

  assert.match(source, /label\?: LiveRoomEntryLabel/);
  assert.match(source, /variant\?: LiveRoomEntryVariant/);
  assert.match(source, /data-live-room-ticker/);
  assert.match(source, /data-live-room-issuer/);
  assert.match(source, /data-live-room-event-id/);
  assert.match(source, /data-live-room-event-type/);
  assert.match(source, /getLiveRoomHref\(ticker\)/);
  assert.match(source, /if \(!href\) return null/);
  assert.match(source, /<Link/);
  assert.match(source, /href=\{href\}/);
  assert.doesNotMatch(source, /router\.push|toast/);
  assert.match(styles, /var\(--sr-color-border-control\)/);
  assert.match(styles, /var\(--sr-size-control\)/);
  assert.match(styles, /@media \(max-width: 760px\)/);
});

test("stock and analysis surfaces use the shared entry button without list-row duplication", () => {
  const watchlist = read("components/watchlist-v2/StockRadarWatchlistV2.tsx");
  const analysis = read(
    "components/filing-analysis-v2/GenericFilingAnalysis.tsx",
  );
  const newsList = read("components/news-v2/NewsV2Row.tsx");
  const filingsList = read("components/filings-v2/FilingsV2List.tsx");
  const feedList = read("components/feed-v2/FeedEventList.tsx");

  assert.match(
    watchlist,
    /<LiveRoomEntryButton issuer=\{companyName\} ticker=\{ticker\} \/>/,
  );
  assert.match(analysis, /label="Discuss in Live Room"/);
  assert.match(analysis, /event=\{liveRoomEvent\}/);
  assert.match(analysis, /\{hasTicker \? \(/);
  assert.doesNotMatch(newsList, /LiveRoomEntryButton/);
  assert.doesNotMatch(filingsList, /LiveRoomEntryButton/);
  assert.doesNotMatch(feedList, /LiveRoomEntryButton/);
});
