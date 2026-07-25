import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  decodeLiveFeedV2Cursor,
  encodeLiveFeedV2Cursor,
  formatLiveFeedV2Timestamp,
  liveFeedV2BatchSize,
  normalizeLiveFeedV2Filter,
  resolveLiveFeedV2MarketData,
} from "./liveFeedV2Contract.ts";

const projectRoot = process.cwd();

function readSource(relativePath: string) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("feed v2 uses deterministic 25-event page cursors", () => {
  assert.equal(liveFeedV2BatchSize, 25);
  assert.equal(encodeLiveFeedV2Cursor(2), "page:2");
  assert.equal(decodeLiveFeedV2Cursor("page:17"), 17);
  assert.equal(decodeLiveFeedV2Cursor("page:0"), 1);
  assert.equal(decodeLiveFeedV2Cursor("not-a-cursor"), 1);
});

test("feed v2 filters reject unknown values", () => {
  assert.equal(normalizeLiveFeedV2Filter("news"), "news");
  assert.equal(normalizeLiveFeedV2Filter("watchlist"), "watchlist");
  assert.equal(normalizeLiveFeedV2Filter("mock"), "all");
  assert.equal(normalizeLiveFeedV2Filter(null), "all");
});

test("feed timestamps use America/New_York for Today and clock labels", () => {
  const now = new Date("2026-07-26T15:00:00.000Z");

  assert.deepEqual(
    formatLiveFeedV2Timestamp("2026-07-26T14:05:00.000Z", now),
    { dateLabel: "Today", timeLabel: "10:05 AM" },
  );
  assert.deepEqual(
    formatLiveFeedV2Timestamp("2026-07-26T01:30:00.000Z", now),
    { dateLabel: "Jul 25", timeLabel: "9:30 PM" },
  );
});

test("feed market data keeps quote and chart availability independent", () => {
  assert.deepEqual(
    resolveLiveFeedV2MarketData({
      changeLabel: "+1.25%",
      chartCloses: [],
      priceLabel: "$123.45",
    }),
    { changePercent: 1.25, price: "$123.45", sparkline: [] },
  );
  assert.deepEqual(
    resolveLiveFeedV2MarketData({
      changeLabel: "N/A",
      chartCloses: [10, 11, 12],
      priceLabel: "N/A",
    }),
    { changePercent: null, price: null, sparkline: [10, 11, 12] },
  );
  assert.deepEqual(
    resolveLiveFeedV2MarketData({
      changeLabel: "",
      chartCloses: [],
      priceLabel: "—",
    }),
    { changePercent: null, price: null, sparkline: [] },
  );
  assert.equal(
    resolveLiveFeedV2MarketData({
      changeLabel: "+0.00%",
      chartCloses: [1, 1],
      priceLabel: "$1.00",
    }).changePercent,
    0,
  );
});

test("production feed is wired to real server data without mock repositories", () => {
  const pageSource = readSource("app/feed/page.tsx");
  const adapterSource = readSource("lib/liveFeedV2.ts");
  const clientSource = readSource(
    "components/feed-v2/StockRadarFeedV2.tsx",
  );
  const redirectSource = readSource("app/feed-v2/page.tsx");

  assert.match(pageSource, /getLiveFeedV2InitialData/);
  assert.match(pageSource, /getCurrentViewerPlan/);
  assert.match(pageSource, /StockRadarAppShell/);
  assert.match(pageSource, /themeMode="user-selectable"/);
  assert.match(adapterSource, /getLiveFeedViewModel/);
  assert.match(adapterSource, /filter === "watchlist"/);
  assert.match(adapterSource, /availability: "unavailable"/);
  assert.match(adapterSource, /resolveLiveFeedV2MarketData/);
  assert.match(adapterSource, /priceLabel: item\.displayPrice/);
  assert.match(adapterSource, /changeLabel: item\.displayChange/);
  assert.match(adapterSource, /chartCloses: chartBars\.map/);
  assert.doesNotMatch(
    `${pageSource}\n${adapterSource}\n${clientSource}`,
    /lib\/mock|feedV2Data|feedV2Repository|feedMock/,
  );
  assert.match(redirectSource, /redirect\("\/feed"\)/);
});

test("interactive feed preserves cursor, abort, selection, preview, and ad gates", () => {
  const clientSource = readSource(
    "components/feed-v2/StockRadarFeedV2.tsx",
  );
  const listSource = readSource("components/feed-v2/FeedEventList.tsx");
  const railSource = readSource("components/feed-v2/FeedContextRail.tsx");
  const inlineAdSource = readSource(
    "components/feed-v2/FeedInlineAdSlots.tsx",
  );
  const railAdSource = readSource("components/feed-v2/FeedRailAdSlot.tsx");
  const sheetSource = readSource(
    "components/feed-v2/MobileFeedPreviewSheet.tsx",
  );
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );

  assert.match(clientSource, /new AbortController\(\)/);
  assert.match(clientSource, /params\.set\("cursor", cursor\)/);
  assert.match(clientSource, /activeState\.nextCursor/);
  assert.match(listSource, /aria-pressed=\{selected\}/);
  assert.match(listSource, /viewerPlan === "free"/);
  assert.match(railSource, /viewerPlan === "free" \? <FeedRailAdSlot \/>/);
  assert.match(railSource, /items\.slice\(0, 4\)/);
  assert.match(railSource, /window\.addEventListener\("scroll"/);
  assert.match(inlineAdSource, /inlineAdDesktopPlacement/);
  assert.match(inlineAdSource, /inlineAdMobilePlacement/);
  assert.match(inlineAdSource, /height=\{90\}/);
  assert.match(railAdSource, /railAdPlacement/);
  assert.match(sheetSource, /role="dialog"/);
  assert.match(sheetSource, /event\.key === "Escape"/);
  assert.match(styleSource, /@media \(max-width: 1180px\)/);
  assert.match(styleSource, /@media \(max-width: 760px\)/);
  assert.match(
    styleSource,
    /\.contextRail\s*\{[\s\S]*display: grid[\s\S]*grid-auto-rows: max-content[\s\S]*overflow-y: hidden/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 1180px\)[\s\S]*\.railAdPlacement\s*\{[\s\S]*display: none/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.inlineAdDesktopPlacement\s*\{[\s\S]*display: none[\s\S]*\.inlineAdMobilePlacement\s*\{[\s\S]*display: block/,
  );
  assert.match(styleSource, /minmax\(0, 72fr\)[\s\S]*minmax\(calc\(300px \+ var\(--sr-space-3\)\), 28fr\)/);
});

test("feed rows use one centered dash for unavailable quote and chart", () => {
  const listSource = readSource("components/feed-v2/FeedEventList.tsx");
  const previewSource = readSource(
    "components/feed-v2/FeedPreviewPanel.tsx",
  );
  const sparklineSource = readSource(
    "components/feed-v2/FeedSparkline.tsx",
  );

  assert.match(listSource, /item\.price === null/);
  assert.match(listSource, /aria-label="Quote unavailable"/);
  assert.doesNotMatch(listSource, />N\/A</);
  assert.match(previewSource, /item\.price === null/);
  assert.match(previewSource, /if \(value === null\) return "—"/);
  assert.match(sparklineSource, /aria-label="Chart unavailable"/);
  assert.doesNotMatch(
    `${listSource}\n${previewSource}\n${sparklineSource}`,
    /No chart|Price change unavailable/,
  );
});

test("feed v2 surfaces follow the News and Filings product design tokens", () => {
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );

  assert.match(
    styleSource,
    /padding: var\(--sr-space-4-5\) var\(--sr-page-gutter-desktop\) var\(--sr-space-7\)/,
  );
  assert.match(styleSource, /box-shadow: var\(--sr-shadow-panel\)/);
  assert.match(styleSource, /\.feedColumn[\s\S]*border-radius: var\(--sr-radius-control\)/);
  assert.match(
    styleSource,
    /var\(--sr-color-surface-table-header-start\)[\s\S]*var\(--sr-color-surface-table-header-end\)/,
  );
  assert.match(
    styleSource,
    /\.liveIndicator::before[\s\S]*background: var\(--sr-color-accent\)/,
  );
  assert.match(
    styleSource,
    /\.premiumCard[\s\S]*var\(--sr-color-accent-cta-top\)[\s\S]*var\(--sr-shadow-cta\)/,
  );
  assert.match(
    styleSource,
    /grid-template-columns:\s*auto minmax\(0, 1fr\) auto/,
  );
  assert.match(
    styleSource,
    /border-radius: var\(--sr-radius-sheet\) var\(--sr-radius-sheet\) 0 0/,
  );
  assert.match(
    styleSource,
    /\.mobileSheet \.sheetClose\s*\{[\s\S]*position: absolute/,
  );
  assert.match(
    styleSource,
    /\.previewPanel header div > strong\s*\{[\s\S]*font-size: var\(--sr-font-size-xl\)[\s\S]*font-weight: var\(--sr-font-weight-heavy\)[\s\S]*line-height: var\(--sr-line-height-none\)/,
  );
  assert.match(
    styleSource,
    /\.previewPanel\s*\{[\s\S]*font-family:\s*[\s\S]*Arial,[\s\S]*"Segoe UI"[\s\S]*sans-serif/,
  );
  assert.match(
    styleSource,
    /\.previewPanel h2\s*\{[\s\S]*font-size: var\(--sr-font-size-xl\)[\s\S]*font-weight: var\(--sr-font-weight-heavy\)[\s\S]*line-height: var\(--sr-line-height-body\)[\s\S]*-webkit-line-clamp: 3/,
  );
  assert.match(
    styleSource,
    /\.previewPanel > p\s*\{[\s\S]*font-size: var\(--sr-font-size-md\)[\s\S]*font-weight: var\(--sr-font-weight-regular\)[\s\S]*line-height: var\(--sr-line-height-default\)[\s\S]*-webkit-line-clamp: 3/,
  );
  assert.match(
    styleSource,
    /\.previewMeta\s*\{[\s\S]*font-size: var\(--sr-font-size-xs\)[\s\S]*line-height: var\(--sr-line-height-default\)/,
  );
  assert.match(
    styleSource,
    /\.previewMarket strong\s*\{[\s\S]*font-size: var\(--sr-font-size-sm\)[\s\S]*font-weight: var\(--sr-font-weight-semibold\)[\s\S]*line-height: var\(--sr-line-height-body\)/,
  );
});
