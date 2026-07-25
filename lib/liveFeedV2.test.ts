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
import {
  createLiveFeedV2Preview,
  type LiveFeedV2PreviewSource,
} from "./liveFeedV2Preview.ts";

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
  const feedSource = readSource("lib/liveFeed.ts");
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
  assert.match(adapterSource, /createLiveFeedV2Preview/);
  assert.match(adapterSource, /preview: createLiveFeedV2Preview/);
  assert.match(adapterSource, /priceLabel: item\.displayPrice/);
  assert.match(adapterSource, /changeLabel: item\.displayChange/);
  assert.match(adapterSource, /chartCloses: chartBars\.map/);
  assert.doesNotMatch(
    `${pageSource}\n${adapterSource}\n${feedSource}\n${clientSource}`,
    /lib\/mock|feedV2Data|feedV2Repository|feedMock/,
  );
  assert.match(feedSource, /fetchFeedPreviewContext/);
  assert.match(feedSource, /event_analysis/);
  assert.match(feedSource, /raw_items/);
  assert.match(feedSource, /event_tickers/);
  assert.doesNotMatch(feedSource, /select: "id,source_unique_id,metadata,raw_payload"/);
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
  const bottomSheetSource = readSource("components/ui/BottomSheetShell.tsx");
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
  assert.match(sheetSource, /BottomSheetShell/);
  assert.match(sheetSource, /layout="full-scroll"/);
  assert.match(bottomSheetSource, /role="dialog"/);
  assert.match(bottomSheetSource, /event\.key === "Escape"/);
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

test("feed context rail keeps the product order without an unconnected watchlist card", () => {
  const railSource = readSource("components/feed-v2/FeedContextRail.tsx");
  const orderedMarkers = [
    "<FeedPreviewPanel",
    "<FeedPremiumCard",
    'viewerPlan === "free" ? <FeedRailAdSlot />',
    "<h2>Market Pulse</h2>",
    'title="Market-Moving News"',
    'title="High-Impact News"',
    'title="Alert Filings"',
  ];
  const markerPositions = orderedMarkers.map((marker) =>
    railSource.indexOf(marker),
  );

  assert.ok(
    markerPositions.every((position) => position >= 0),
    "every context rail section should be present",
  );
  assert.deepEqual(
    markerPositions,
    [...markerPositions].sort((left, right) => left - right),
    "context rail sections should preserve the product order",
  );
  assert.doesNotMatch(railSource, /Watchlist Activity|Not connected/);
});

test("feed rows use one centered dash for unavailable quote and chart", () => {
  const listSource = readSource("components/feed-v2/FeedEventList.tsx");
  const sparklineSource = readSource(
    "components/feed-v2/FeedSparkline.tsx",
  );

  assert.match(listSource, /item\.price === null/);
  assert.match(listSource, /aria-label="Quote unavailable"/);
  assert.doesNotMatch(listSource, />N\/A</);
  assert.match(sparklineSource, /aria-label="Chart unavailable"/);
  assert.doesNotMatch(
    `${listSource}\n${sparklineSource}`,
    /No chart|Price change unavailable/,
  );
});

test("feed v2 surfaces follow the News and Filings product design tokens", () => {
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );
  const previewStyleSource = readSource(
    "components/feed-v2/FeedFilingPreview.module.css",
  );
  const bottomSheetStyleSource = readSource(
    "components/ui/BottomSheetShell.module.css",
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
    bottomSheetStyleSource,
    /border-radius: var\(--sr-radius-sheet\) var\(--sr-radius-sheet\) 0 0/,
  );
  assert.match(
    bottomSheetStyleSource,
    /\.close\s*\{[\s\S]*position: absolute/,
  );
  assert.match(
    previewStyleSource,
    /\.detailIdentity h2\s*\{[\s\S]*font-size: var\(--sr-font-size-xl\)[\s\S]*font-weight: var\(--sr-font-weight-heavy\)[\s\S]*line-height: var\(--sr-line-height-none\)/,
  );
  assert.match(
    previewStyleSource,
    /\.detailSection h3\s*\{[\s\S]*font-size: var\(--sr-font-size-lg\)[\s\S]*font-weight: var\(--sr-font-weight-strong\)[\s\S]*line-height: var\(--sr-line-height-relaxed\)/,
  );
  assert.match(
    previewStyleSource,
    /\.detailSection p,[\s\S]*\.detailSection li\s*\{[\s\S]*font-size: var\(--sr-font-size-md\)[\s\S]*line-height: var\(--sr-line-height-default\)/,
  );
  assert.match(
    previewStyleSource,
    /\.detailFacts\s*\{[\s\S]*font-size: var\(--sr-font-size-sm\)/,
  );
  assert.match(
    previewStyleSource,
    /@media \(max-width: 760px\)[\s\S]*\.detailContent\s*\{[\s\S]*padding: var\(--sr-space-5\) var\(--sr-space-4\)/,
  );
});

const basePreviewSource: LiveFeedV2PreviewSource = {
  category: "legal_risk",
  detailHref: "/events/event-1",
  feedType: "news",
  headline: "A real headline",
  id: "event-1",
  impactScore: 65,
  keyEvidence: ["Evidence one", "Evidence two"],
  primaryTicker: "ELWT",
  publishedAt: "2026-07-26T14:05:00.000Z",
  sentiment: "Bearish",
  source: "PR Newswire",
  summary: "A real summary",
  ticker: "ELWT",
};

test("feed preview mapper preserves filing-specific fields and related filings", () => {
  const filing = createLiveFeedV2Preview(
    {
      ...basePreviewSource,
      accessionNumber: "0001193125-26-134682",
      companyName: "Infleqtion, Inc.",
      detailHref: "/events/filing-1",
      feedType: "filings",
      formType: "8-K/A",
      id: "filing-1",
      primaryTicker: "INFQ",
      ticker: "INFQ",
    },
    [
      {
        ...basePreviewSource,
        detailHref: "/events/filing-2",
        feedType: "filings",
        formType: "8-K",
        id: "filing-2",
        primaryTicker: "INFQ",
        ticker: "INFQ",
      },
    ],
  );

  assert.equal(filing.kind, "filing");
  assert.equal(filing.company, "Infleqtion, Inc.");
  assert.equal(filing.formType, "8-K/A");
  assert.equal(filing.accession, "0001193125-26-134682");
  assert.deepEqual(filing.keyPoints, ["Evidence one", "Evidence two"]);
  assert.equal(filing.relatedFilings.length, 1);
  assert.equal(filing.relatedFilings[0]?.href, "/events/filing-2");
});

test("feed preview mapper preserves company-news hierarchy without fake values", () => {
  const news = createLiveFeedV2Preview({
    ...basePreviewSource,
    companyName: null,
  });

  assert.equal(news.kind, "company-news");
  assert.equal(news.company, null);
  assert.equal(news.brief, "A real summary");
  assert.deepEqual(news.keyPoints, ["Evidence one", "Evidence two"]);
  assert.equal(news.coverage, "Company");
  assert.equal(news.watchlist, null);
});

test("feed preview mapper preserves market fields independently", () => {
  const market = createLiveFeedV2Preview({
    ...basePreviewSource,
    companyName: null,
    feedType: "market",
    marketScopeLabel: "Sector",
    primaryTicker: null,
    relatedTickers: [
      { context: "Mentioned in analysis", ticker: "NVDA" },
      { context: null, ticker: "AMD" },
    ],
    themeLabel: "Semiconductors",
    ticker: "MARKET",
  });

  assert.equal(market.kind, "market-news");
  assert.equal(market.theme, "Semiconductors");
  assert.equal(market.coverage, "Sector");
  assert.equal(market.ticker, null);
  assert.deepEqual(market.drivers, ["Evidence one", "Evidence two"]);
  assert.deepEqual(
    market.relatedCompanies.map((company) => company.ticker),
    ["NVDA", "AMD"],
  );
});

test("desktop and mobile preview dispatchers wire all three V2 preview types", () => {
  const dispatcherSource = readSource(
    "components/feed-v2/FeedPreviewPanel.tsx",
  );
  const sheetSource = readSource(
    "components/feed-v2/MobileFeedPreviewSheet.tsx",
  );
  const combinedPreviewSource = [
    "components/feed-v2/FeedFilingPreview.tsx",
    "components/feed-v2/FeedCompanyNewsPreview.tsx",
    "components/feed-v2/FeedMarketNewsPreview.tsx",
  ]
    .map(readSource)
    .join("\n");

  assert.match(dispatcherSource, /item\.preview\.kind === "filing"/);
  assert.match(dispatcherSource, /item\.preview\.kind === "market-news"/);
  assert.match(dispatcherSource, /FeedCompanyNewsPreview/);
  assert.match(sheetSource, /FeedPreviewPanel item=\{item\} variant="mobile"/);
  assert.match(combinedPreviewSource, /data-preview-kind="filing"/);
  assert.match(combinedPreviewSource, /data-preview-kind="company-news"/);
  assert.match(combinedPreviewSource, /data-preview-kind="market-news"/);
  assert.match(combinedPreviewSource, /aria-label="Ticker unavailable"/);
  assert.doesNotMatch(combinedPreviewSource, /ticker=\{news\.ticker \|\| "MARKET"\}/);
  assert.doesNotMatch(
    `${dispatcherSource}\n${sheetSource}\n${combinedPreviewSource}`,
    /lib\/mock|feedV2Data|feedV2Repository|fake chart/i,
  );
});
