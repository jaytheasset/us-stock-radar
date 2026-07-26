import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createLiveFeedV2RailEventIdentity,
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
import {
  hasValidLiveFeedPrimaryTicker,
  liveFeedEventVisibilityOrFilter,
  shouldIncludeLiveFeedEvent,
} from "./liveFeedEventPolicy.ts";
import {
  buildMarketPulseItems,
  marketPulseDefinitions,
} from "./marketPulse.ts";
import {
  liveFeedRailMinimumScore,
  liveFeedRailQueries,
} from "./liveFeedRailPolicy.ts";
import { buildEventAlertScoreFilters } from "./supabaseEventFilters.ts";

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

test("tickerless non-alert market news is excluded while alerts and unrelated events remain", () => {
  for (const marketScope of ["sector", "theme", "macro"]) {
    assert.equal(
      shouldIncludeLiveFeedEvent({
        deliveryLevel: "feed",
        marketScope,
        sourceGroup: "news",
        ticker: null,
      }),
      false,
    );
    assert.equal(
      shouldIncludeLiveFeedEvent({
        deliveryLevel: "alert",
        marketScope,
        sourceGroup: "news",
        ticker: null,
      }),
      true,
    );
  }

  assert.equal(
    shouldIncludeLiveFeedEvent({
      deliveryLevel: "feed",
      marketScope: "company",
      sourceGroup: "news",
      ticker: null,
    }),
    true,
  );
  assert.equal(
    shouldIncludeLiveFeedEvent({
      deliveryLevel: "feed",
      marketScope: "company",
      sourceGroup: "filings",
      ticker: null,
    }),
    true,
  );
  assert.equal(
    shouldIncludeLiveFeedEvent({
      deliveryLevel: "feed",
      marketScope: "sector",
      sourceGroup: "news",
      ticker: "XLK",
    }),
    true,
  );
});

test("primary ticker validity preserves the existing Live Feed sentinel contract", () => {
  for (const value of [null, undefined, "", " ", "N/A", "na", "UNKNOWN", "-", "TOO_LONG_123"]) {
    assert.equal(hasValidLiveFeedPrimaryTicker(value), false);
  }

  for (const value of ["AAPL", "brk.b", "BTC-USD"]) {
    assert.equal(hasValidLiveFeedPrimaryTicker(value), true);
  }
});

test("server query policy protects exact pagination and count before rows reach the client", () => {
  const feedSource = readSource("lib/liveFeed.ts");
  const supabaseSource = readSource("lib/supabase.ts");
  const fixtures = Array.from({ length: 63 }, (_, index) => ({
    deliveryLevel: index % 17 === 0 ? "alert" : "feed",
    marketScope: index % 3 === 0 ? "sector" : "company",
    sourceGroup: index % 2 === 0 ? "news" : "filings",
    ticker: index % 5 === 0 ? null : `T${index}`,
  }));
  const visible = fixtures.filter(shouldIncludeLiveFeedEvent);
  const pages = Array.from(
    { length: Math.ceil(visible.length / liveFeedV2BatchSize) },
    (_, index) =>
      visible.slice(
        index * liveFeedV2BatchSize,
        (index + 1) * liveFeedV2BatchSize,
      ),
  );

  assert.equal(pages[0]?.length, Math.min(liveFeedV2BatchSize, visible.length));
  assert.equal(
    pages.flat().length,
    visible.length,
    "filtered total and paginated rows should describe the same result set",
  );
  assert.match(
    liveFeedEventVisibilityOrFilter,
    /delivery_level\.eq\.alert/,
  );
  assert.match(
    liveFeedEventVisibilityOrFilter,
    /ticker\.imatch\."\^\[A-Z\]/,
  );
  assert.match(
    feedSource,
    /fetchEvents\(\{[\s\S]*excludeTickerlessNonAlertMarketNews: true,[\s\S]*\.\.\.feedFilters/,
  );
  assert.match(
    supabaseSource,
    /if \(params\.excludeTickerlessNonAlertMarketNews\)[\s\S]*search\.or = `\(\$\{liveFeedEventVisibilityOrFilter\}\)`/,
  );
  assert.doesNotMatch(
    feedSource,
    /feedRows\s*=\s*toRows\(feedResult\.data\)\.filter/,
  );
});

test("three rail queries enforce alert delivery, score floor, category, and bounded results", () => {
  const feedSource = readSource("lib/liveFeed.ts");
  const supabaseSource = readSource("lib/supabase.ts");

  assert.equal(liveFeedRailMinimumScore, 75);
  for (const query of Object.values(liveFeedRailQueries)) {
    assert.equal(query.deliveryLevel, "alert");
    assert.equal(query.minimumScore, 75);
    assert.equal(query.limit, 4);
    assert.equal(query.order, "score.desc,detected_at.desc");
  }
  assert.deepEqual(liveFeedRailQueries.marketMoving.marketScopes, [
    "sector",
    "theme",
    "macro",
  ]);
  assert.equal(liveFeedRailQueries.highImpactNews.marketScope, "company");
  assert.equal(liveFeedRailQueries.highImpactNews.sourceGroup, "news");
  assert.equal(liveFeedRailQueries.alertFilings.sourceGroup, "filings");
  assert.match(
    supabaseSource,
    /Object\.assign\(search, buildEventAlertScoreFilters\(params\)\)/,
  );
  assert.deepEqual(
    buildEventAlertScoreFilters({ alertOnly: true, minimumScore: 75 }),
    { delivery_level: "eq.alert", score: "gte.75" },
  );
  assert.deepEqual(
    buildEventAlertScoreFilters({
      deliveryLevel: "alert",
      minimumScore: 74.6,
    }),
    { delivery_level: "eq.alert", score: "gte.75" },
  );
  assert.match(
    feedSource,
    /fetchEvents\(liveFeedRailQueries\.highImpactNews\)/,
  );
  assert.match(feedSource, /fetchEvents\(liveFeedRailQueries\.alertFilings\)/);
  assert.match(feedSource, /fetchEvents\(liveFeedRailQueries\.marketMoving\)/);
  assert.doesNotMatch(
    feedSource.slice(
      feedSource.indexOf("async function fetchSharedFeedData"),
      feedSource.indexOf("export async function getRankingViewModel"),
    ),
    /limit:\s*100/,
  );
  assert.equal(
    shouldIncludeLiveFeedEvent({
      deliveryLevel: "alert",
      marketScope: "macro",
      sourceGroup: "news",
      ticker: null,
    }),
    true,
  );
});

test("rail event identities only link canonical Supabase event UUIDs", () => {
  const eventId = "40026237-af5a-4162-9821-5307f526f320";
  const filingId = "0fc0c9db-ceaa-4bf1-9223-62ebc82acd78";
  const uppercaseEventId = "B8117FB7-FCDC-4194-89CD-78F5604E02FF";

  assert.deepEqual(
    createLiveFeedV2RailEventIdentity({
      destination: "events",
      eventId,
      fallbackId: "synthetic-market-event",
    }),
    {
      detailHref: `/events/${eventId}`,
      id: eventId,
    },
  );
  assert.deepEqual(
    createLiveFeedV2RailEventIdentity({
      destination: "filings",
      eventId: filingId,
      fallbackId: "synthetic-filing",
    }),
    {
      detailHref: `/filings/${filingId}`,
      id: filingId,
    },
  );

  assert.deepEqual(
    createLiveFeedV2RailEventIdentity({
      destination: "events",
      eventId: `  ${uppercaseEventId}  `,
      fallbackId: "synthetic-uppercase-event",
    }),
    {
      detailHref: `/events/${uppercaseEventId.toLowerCase()}`,
      id: uppercaseEventId.toLowerCase(),
    },
  );

  for (const invalidEventId of [
    "",
    "not-a-uuid",
    "40026237-af5a-4162-7821-5307f526f320",
    "AAPL-2026-07-26T10:45:00.000Z",
    "market-moving-Macro-policy-update",
    "synthetic-filing",
    "  arbitrary event id  ",
  ]) {
    assert.deepEqual(
      createLiveFeedV2RailEventIdentity({
        destination: "events",
        eventId: invalidEventId,
        fallbackId: "synthetic-market-event",
      }),
      {
        detailHref: null,
        id: "synthetic-market-event",
      },
    );
  }

  assert.deepEqual(
    createLiveFeedV2RailEventIdentity({
      destination: "events",
      eventId: null,
      fallbackId: "synthetic-market-event",
    }),
    {
      detailHref: null,
      id: "synthetic-market-event",
    },
  );
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

test("group market data never exposes classification labels as prices", () => {
  for (const scopeLabel of ["Industry", "Theme", "Sector", "Sub Theme"]) {
    assert.deepEqual(
      resolveLiveFeedV2MarketData({
        changeLabel: null,
        chartCloses: [],
        priceLabel: scopeLabel,
      }),
      { changePercent: null, price: null, sparkline: [] },
    );
  }

  assert.deepEqual(
    resolveLiveFeedV2MarketData({
      changeLabel: "+1.75%",
      chartCloses: [100, 101, 102],
      priceLabel: "Industry",
    }),
    { changePercent: 1.75, price: null, sparkline: [100, 101, 102] },
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
    "<FeedPremiumCard",
    "<FeedPreviewPanel",
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

test("feed context rail renders navigable events as Next links with a non-link fallback", () => {
  const adapterSource = readSource("lib/liveFeedV2.ts");
  const railSource = readSource("components/feed-v2/FeedContextRail.tsx");
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );

  assert.match(adapterSource, /mapRankedEvent\(item, "filings"\)/);
  assert.match(adapterSource, /mapRankedEvent\(item, "events"\)/);
  assert.match(
    adapterSource,
    /destination: "events",[\s\S]*eventId: item\.id,[\s\S]*fallbackId: `market-moving-/,
  );
  assert.match(railSource, /import Link from "next\/link"/);
  assert.match(
    railSource,
    /item\.detailHref \? \([\s\S]*<Link[\s\S]*href=\{item\.detailHref\}[\s\S]*\{content\}[\s\S]*<\/Link>/,
  );
  assert.match(
    railSource,
    /:\s*\([\s\S]*<article className=\{styles\.contextEvent\}[\s\S]*\{content\}[\s\S]*<\/article>/,
  );
  assert.match(
    styleSource,
    /\.contextEventLink\s*\{[\s\S]*color: inherit;[\s\S]*text-decoration: none;/,
  );
  assert.match(
    styleSource,
    /\.contextEventLink:focus-visible\s*\{[\s\S]*var\(--sr-focus-ring-color\)/,
  );
});

test("feed rows use one centered dash for unavailable quote and chart", () => {
  const listSource = readSource("components/feed-v2/FeedEventList.tsx");
  const adapterSource = readSource("lib/liveFeed.ts");
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );
  const sparklineSource = readSource(
    "components/feed-v2/FeedSparkline.tsx",
  );

  assert.match(
    listSource,
    /const quoteUnavailable =[\s\S]*item\.price === null &&[\s\S]*item\.changePercent === null \|\| item\.feedType !== "market"/,
  );
  assert.match(listSource, /aria-label="Quote unavailable"/);
  assert.match(listSource, /item\.price \?\? "—"/);
  assert.match(listSource, /styles\.quotePriceUnavailable/);
  assert.doesNotMatch(listSource, />N\/A</);
  assert.match(sparklineSource, /aria-label="Chart unavailable"/);
  assert.match(
    adapterSource,
    /displayPrice: groupDisplay \? groupDisplay\.price : quoteValues\.price/,
  );
  assert.match(
    adapterSource,
    /kind: marketScope === "macro" && !snapshot \? "macro" : "group",[\s\S]*price: ""/,
  );
  assert.match(
    adapterSource,
    /bars: snapshot \? groupSnapshotToBars\(snapshot\) : \[\]/,
  );
  assert.match(
    adapterSource,
    /change = snapshot \? formatSignedPercent\(snapshot\.changePercent\) : ""/,
  );
  assert.doesNotMatch(
    adapterSource,
    /formatGroupScope|price = snapshot \?|fallback\.scopeLabel/,
  );
  assert.match(
    styleSource,
    /\.quoteUnavailable\s*\{[\s\S]*place-items: center[\s\S]*color: var\(--sr-color-text-muted\)/,
  );
  assert.match(
    styleSource,
    /\.sparklineUnavailable\s*\{[\s\S]*place-items: center/,
  );
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

test("desktop feed rows follow the Watchlist typography and selection hierarchy", () => {
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );

  assert.match(
    styleSource,
    /\.feedItemSelected\s*\{[\s\S]*box-shadow: none;[\s\S]*background: var\(--sr-color-surface-table-row\);/,
  );
  assert.match(
    styleSource,
    /\.feedItemSelected::before\s*\{[\s\S]*top: 0;[\s\S]*bottom: 0;[\s\S]*width: 3px;[\s\S]*border-radius: 0;[\s\S]*background: var\(--sr-color-accent\);/,
  );
  assert.match(
    styleSource,
    /@media \(min-width: 761px\)[\s\S]*\.feedList\s*\{[\s\S]*font-family: var\(--sr-font-family-sans\);[\s\S]*\.feedItem\s*\{[\s\S]*min-height: 82px;[\s\S]*gap: var\(--sr-space-3\);/,
  );
  assert.match(
    styleSource,
    /@media \(min-width: 761px\)[\s\S]*\.time\s*\{[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-size: var\(--sr-font-size-xs\);[\s\S]*\.time span\s*\{[\s\S]*font-weight: var\(--sr-font-weight-heavy\);[\s\S]*\.time strong\s*\{[\s\S]*font-weight: var\(--sr-font-weight-regular\);/,
  );
  assert.match(
    styleSource,
    /@media \(min-width: 761px\)[\s\S]*\.identity strong\s*\{[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-size: var\(--sr-font-size-sm\);[\s\S]*font-weight: var\(--sr-font-weight-heavy\);/,
  );
  assert.match(
    styleSource,
    /\.eventBadge\s*\{[\s\S]*min-height: 0;[\s\S]*justify-content: flex-start;[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*padding: 0;[\s\S]*background: transparent;/,
  );
  assert.match(
    styleSource,
    /@media \(min-width: 761px\)[\s\S]*\.eventBadge\s*\{[\s\S]*font-size: var\(--sr-font-size-xs\);[\s\S]*font-weight: 600;/,
  );
  assert.match(
    styleSource,
    /@media \(min-width: 761px\)[\s\S]*\.eventCopy h2\s*\{[\s\S]*font-size: var\(--sr-font-size-sm\);[\s\S]*font-weight: 600;[\s\S]*line-height: var\(--sr-line-height-snug\);/,
  );
  assert.match(
    styleSource,
    /@media \(min-width: 761px\)[\s\S]*\.impactScore span\s*\{[\s\S]*font-size: var\(--sr-font-size-xs\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*\.impactScore strong\s*\{[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*font-weight: 600;/,
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

test("tickerless market preview uses scope and theme without fake security identity", () => {
  const market = createLiveFeedV2Preview({
    ...basePreviewSource,
    companyName: null,
    feedType: "market",
    marketScopeLabel: "Macro",
    primaryTicker: null,
    themeLabel: "Monetary Policy",
    ticker: "N/A",
  });
  const marketPreviewSource = readSource(
    "components/feed-v2/FeedMarketNewsPreview.tsx",
  );

  assert.equal(market.kind, "market-news");
  assert.equal(market.theme, "Monetary Policy");
  assert.equal(market.coverage, "Macro");
  assert.equal(market.ticker, null);
  assert.match(marketPreviewSource, /Globe2/);
  assert.match(marketPreviewSource, /<h2>\{news\.theme\}<\/h2>/);
  assert.match(marketPreviewSource, /<p>\{news\.coverage\}<\/p>/);
  assert.doesNotMatch(marketPreviewSource, /MarketTickerLogo/);
  assert.doesNotMatch(marketPreviewSource, /previewValue\(news\.ticker\)/);
  assert.doesNotMatch(marketPreviewSource, /previewValue\(news\.company\)/);
  assert.doesNotMatch(marketPreviewSource, /N\/A|—\s*·\s*—/);
});

test("market pulse is exactly six cash indicators plus three futures in product order", () => {
  assert.equal(marketPulseDefinitions.length, 9);
  assert.deepEqual(
    marketPulseDefinitions.map((item) => item.label),
    [
      "S&P 500",
      "Nasdaq 100",
      "Russell 2000",
      "SOX",
      "VIX",
      "US 10Y",
      "S&P 500 Fut.",
      "Nasdaq Fut.",
      "Russell Fut.",
    ],
  );
  assert.equal(
    marketPulseDefinitions.filter((item) => item.group === "cash").length,
    6,
  );
  assert.equal(
    marketPulseDefinitions.filter((item) => item.group === "futures").length,
    3,
  );
});

test("market pulse preserves safe cache misses and formats US 10Y in percent and basis points", () => {
  const empty = buildMarketPulseItems(new Map(), new Map());
  assert.equal(empty.length, 9);
  assert.ok(empty.every((item) => item.value === "—"));
  assert.ok(empty.every((item) => item.trend.length === 0));

  const quotes = new Map([
    [
      "US10Y",
      {
        changeAmount: 0.021,
        changePercent: 0.45,
        price: 4.69,
        provider: "fmp",
      },
    ],
  ]);
  const items = buildMarketPulseItems(quotes, new Map());
  const treasury = items.find((item) => item.cacheSymbol === "US10Y");
  assert.equal(treasury?.value, "4.690%");
  assert.equal(treasury?.detail, "+2.1 bp");
  assert.equal(treasury?.tone, "volatile");
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
  assert.match(combinedPreviewSource, /aria-label=\{`\$\{news\.coverage\} market`\}/);
  assert.doesNotMatch(combinedPreviewSource, /ticker=\{news\.ticker \|\| "MARKET"\}/);
  assert.doesNotMatch(
    `${dispatcherSource}\n${sheetSource}\n${combinedPreviewSource}`,
    /lib\/mock|feedV2Data|feedV2Repository|fake chart/i,
  );
});
