import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createLiveFeedV2RailEventIdentity,
  decodeLiveFeedV2Cursor,
  encodeLiveFeedV2Cursor,
  formatLiveFeedV2Timestamp,
  getLiveFeedV2MobileIdentityLabel,
  liveFeedV2BatchSize,
  normalizeLiveFeedV2Filter,
  resolveLiveFeedV2MarketData,
} from "./liveFeedV2Contract.ts";
import {
  createLiveFeedV2Preview,
  type LiveFeedV2PreviewSource,
} from "./liveFeedV2Preview.ts";
import { getLiveFeedV2EventPresentation } from "./liveFeedV2EventType.ts";
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

test("live feed preserves news and filing event labels without dashboard abbreviations", () => {
  assert.deepEqual(
    getLiveFeedV2EventPresentation("legal_risk", "news"),
    { label: "Legal Risk", tone: "legal" },
  );
  assert.deepEqual(
    getLiveFeedV2EventPresentation("legal", "filings"),
    { label: "Legal", tone: "legal" },
  );
  assert.deepEqual(
    getLiveFeedV2EventPresentation("dilution", "filings"),
    { emphasis: "dilution", label: "Dilution", tone: "legal" },
  );
  assert.deepEqual(
    getLiveFeedV2EventPresentation("fda_clinical", "news"),
    { label: "FDA / Clinical", tone: "product" },
  );
  assert.deepEqual(
    getLiveFeedV2EventPresentation("event", "news"),
    { label: "Other", tone: "neutral" },
  );
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

test("mobile feed filters keep one row and disclose alerts and watchlist", () => {
  const clientSource = readSource(
    "components/feed-v2/StockRadarFeedV2.tsx",
  );
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );

  assert.match(clientSource, /mobilePrimaryFilters/);
  assert.match(clientSource, /mobileMoreFilters/);
  assert.match(
    clientSource,
    /filter\.value !== "alerts" && filter\.value !== "watchlist"/,
  );
  assert.match(
    clientSource,
    /filter\.value === "alerts" \|\| filter\.value === "watchlist"/,
  );
  assert.match(clientSource, /aria-controls=\{mobileMoreId\}/);
  assert.match(clientSource, /aria-expanded=\{mobileMoreOpen\}/);
  assert.match(clientSource, /<span>More<\/span>/);
  assert.match(clientSource, /className=\{styles\.mobileMoreChevron\}/);
  assert.match(clientSource, /<Check aria-hidden="true" size=\{15\} \/>/);
  assert.match(clientSource, /Additional feed filters/);
  assert.match(clientSource, /setMobileMoreOpen\(false\)/);
  assert.match(clientSource, /event\.key !== "Escape"/);
  assert.doesNotMatch(
    styleSource,
    /\.mobileFilterRow\s*\{[\s\S]{0,300}repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styleSource,
    /\.filters\s*\{[\s\S]*display: flex;[\s\S]*overflow-x: auto;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.filters\s*\{[\s\S]*overflow: visible;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.mobileFilterRow\s*\{[\s\S]*grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 340px\)\s*\{\s*\.mobileFilterRow\s*\{\s*gap: var\(--sr-space-0-5\);\s*\}/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.mobileFilters\s*\{[\s\S]*position: relative;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.mobileMoreFilters\s*\{[\s\S]*position: absolute;[\s\S]*right: 0;[\s\S]*width: min\(176px, calc\(100% - var\(--sr-space-4\)\)\);/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.mobileFilters button\s*\{[\s\S]*width: 100%;[\s\S]*min-width: 0;[\s\S]*min-height: var\(--sr-size-filter-chip\);[\s\S]*padding: 0 var\(--sr-space-0-5\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*white-space: nowrap;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.mobileFilters \.mobileMoreButton\s*\{[\s\S]*gap: var\(--sr-space-0-5\);[\s\S]*padding-inline: 0;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.mobileMoreFilters button\s*\{[\s\S]*min-height: 40px;[\s\S]*padding: 0 var\(--sr-space-3\);[\s\S]*font-size: var\(--sr-font-size-base\);/,
  );
  assert.doesNotMatch(
    styleSource,
    /\.mobileMoreFilters\s*\{[\s\S]{0,400}grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
});

test("feed ticker rows map real company names without disguising the source", () => {
  const source = readSource("lib/liveFeedV2.ts");

  assert.match(
    source,
    /company:\s*item\.displayKind === "ticker"\s*\? item\.companyName\.trim\(\) \|\| "Company name unavailable"\s*:\s*`\$\{formatMarketScope\(item\.marketScope\)\} market event`/,
  );
  assert.doesNotMatch(
    source,
    /item\.displayKind === "ticker"\s*\? item\.source/,
  );
  assert.match(source, /source: item\.source,/);
});

test("mobile feed header keeps title and result count on one compact row", () => {
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );
  const mobileFeedHeader =
    [...styleSource.matchAll(/\.feedHeader\s*\{[^}]*\}/g)].at(-1)?.[0] ?? "";

  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.feedHeader\s*\{[\s\S]*min-height: 40px;[\s\S]*flex-wrap: nowrap;[\s\S]*gap: var\(--sr-space-2\);[\s\S]*padding-block: 0;[\s\S]*padding-inline: var\(--sr-space-4\);[\s\S]*background: var\(--sr-color-surface-control-strong\);/,
  );
  assert.doesNotMatch(mobileFeedHeader, /linear-gradient/);
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.feedTitle\s*\{[\s\S]*width: auto;[\s\S]*min-width: 0;[\s\S]*flex: 1 1 auto;[\s\S]*overflow: hidden;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.feedTitle h1\s*\{[\s\S]*font-size: var\(--sr-font-size-xl\);[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.liveIndicator\s*\{[\s\S]*font-size: var\(--sr-font-size-sm\);/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.resultCount\s*\{[\s\S]*width: auto;[\s\S]*max-width: 48%;[\s\S]*overflow: hidden;[\s\S]*flex: 0 0 auto;[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*text-overflow: ellipsis;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.filters\s*\{[\s\S]*padding: var\(--sr-space-2\) var\(--sr-space-4\);[\s\S]*overflow: visible;/,
  );
  assert.match(
    styleSource,
    /\.feedHeader\s*\{[\s\S]{0,180}min-height: var\(--sr-size-table-header-row\);/,
  );
  const desktopFeedHeader = styleSource.match(/^\.feedHeader \{[^}]*\}/m)?.[0] ?? "";
  assert.match(
    desktopFeedHeader,
    /background: linear-gradient\([\s\S]*var\(--sr-color-surface-table-header-start\),[\s\S]*var\(--sr-color-surface-table-header-end\)/,
  );
});

test("mobile feed uses a full-bleed flat list without changing desktop framing", () => {
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );

  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.feedColumn\s*\{[\s\S]*width: calc\(100% \+ \(var\(--sr-page-gutter-mobile\) \* 2\)\);[\s\S]*margin-inline: calc\(var\(--sr-page-gutter-mobile\) \* -1\);[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
  );
  assert.match(
    styleSource,
    /\.feedColumn\s*\{[\s\S]{0,180}border-radius: var\(--sr-radius-control\);[\s\S]{0,100}background: var\(--sr-color-surface-table-panel\);/,
  );
});

test("mobile feed premium CTA is a flat list row while desktop keeps its premium card", () => {
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );
  const mobileRule = [...styleSource.matchAll(/\.premiumCardMobile\s*\{[^}]*\}/g)].at(-1)?.[0] ?? "";

  assert.match(
    mobileRule,
    /display: grid;[\s\S]*min-width: 0;[\s\S]*min-height: 0;[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*align-items: center;[\s\S]*column-gap: var\(--sr-space-3\);[\s\S]*margin: 0;[\s\S]*border: 0;[\s\S]*border-bottom: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: 0;[\s\S]*padding: var\(--sr-space-4\) var\(--sr-space-3\);[\s\S]*background: var\(--sr-color-surface-table-row\);[\s\S]*box-shadow: none;/,
  );
  assert.doesNotMatch(mobileRule, /border-top|gradient|accent-border-premium/);
  assert.match(
    styleSource,
    /\.premiumCardMobile > span \{[\s\S]*font-size: var\(--sr-font-size-sm\);[\s\S]*font-weight: var\(--sr-font-weight-label\);[\s\S]*line-height: var\(--sr-line-height-none\);[\s\S]*\.premiumCardMobile > strong \{[\s\S]*font: 700 16px \/ 1\.25 var\(--sr-font-family-sans\);[\s\S]*\.premiumCardMobile > p \{[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*line-height: 1\.4;/,
  );
  assert.match(
    styleSource,
    /\.premiumCardMobile > a \{[\s\S]*grid-column: 2;[\s\S]*grid-row: 1 \/ 4;[\s\S]*min-height: 40px;[\s\S]*align-self: center;[\s\S]*padding: 0 var\(--sr-space-3\);[\s\S]*background: var\(--sr-color-surface-primary-action\);[\s\S]*font: 700 var\(--sr-font-size-base\) \/ var\(--sr-line-height-none\)[\s\S]*\.premiumCardMobile > a svg \{[\s\S]*display: none;/,
  );
  assert.match(
    styleSource,
    /\.premiumCard \{[\s\S]*min-height: 152px;[\s\S]*var\(--sr-color-accent-cta-top\)[\s\S]*box-shadow: var\(--sr-shadow-cta\);/,
  );
});

test("mobile feed summary uses existing counts in an accessible two-column disclosure", () => {
  const boardSource = readSource(
    "components/feed-v2/FeedSituationBoard.tsx",
  );
  const clientSource = readSource(
    "components/feed-v2/StockRadarFeedV2.tsx",
  );
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );
  const desktopStart = boardSource.indexOf(
    '<div className={styles.situationGrid}>',
  );
  const mobileStart = boardSource.indexOf(
    '<div className={styles.situationMobileGrid}>',
  );
  const desktopMarkup = boardSource.slice(desktopStart, mobileStart);
  const mobileMarkup = boardSource.slice(mobileStart);

  assert.ok(desktopStart >= 0 && mobileStart > desktopStart);
  assert.match(desktopMarkup, /items\.map\(\(item\) =>/);
  assert.doesNotMatch(desktopMarkup, /Total Events/);
  assert.match(mobileMarkup, /<details className=\{styles\.situationDisclosure\}>/);
  assert.match(
    mobileMarkup,
    /<summary aria-label="Toggle additional market summary metrics">/,
  );
  assert.match(mobileMarkup, /<span>Total Events<\/span>/);
  assert.match(mobileMarkup, /<span>Alerts<\/span>/);
  assert.match(
    boardSource,
    /const alertItem = items\.find\(\(item\) => item\.label === "Today's Alerts"\);/,
  );
  assert.match(
    boardSource,
    /totalEvents === null \? "—" : totalEvents\.toLocaleString\("en-US"\)/,
  );
  assert.match(boardSource, /alertItem\?\.value \?\? "—"/);
  assert.match(
    boardSource,
    /const additionalSituationLabels = \[[\s\S]*"Dilution Risk",[\s\S]*"Listing Risk",[\s\S]*"Earnings",[\s\S]*"Insider \/ Ownership",[\s\S]*"Dividends",[\s\S]*"FDA \/ Clinical",[\s\S]*\] as const;/,
  );
  assert.match(boardSource, /additionalSituationLabels\.flatMap/);
  assert.match(
    mobileMarkup,
    /<span>\{compactLabels\[item\.label\] \?\? item\.label\}<\/span>/,
  );
  assert.doesNotMatch(
    mobileMarkup,
    /situationLabelFull|situationLabelCompact/,
  );
  assert.match(
    boardSource,
    /"Earnings",[\s\S]*"Dividends",[\s\S]*"FDA \/ Clinical",/,
  );
  assert.match(mobileMarkup, /<small>\{item\.window\}<\/small>/);
  assert.doesNotMatch(boardSource, /useState|useId|IconButton|fetch\(/);
  assert.match(
    clientSource,
    /<FeedSituationBoard[\s\S]*items=\{initialData\.situationItems\}[\s\S]*totalEvents=\{initialData\.page\.totalCount\}/,
  );
  assert.match(
    styleSource,
    /\.situationMobileGrid \{[\s\S]*display: none;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.situationGrid \{[\s\S]*display: none;[\s\S]*\.situationMobileGrid \{[\s\S]*display: block;/,
  );
  assert.match(
    styleSource,
    /\.situationDisclosure > summary \{[\s\S]*min-height: var\(--sr-size-control\);[\s\S]*list-style: none;[\s\S]*\.situationDisclosure > summary:focus-visible \{[\s\S]*outline: var\(--sr-focus-ring-width\) solid var\(--sr-focus-ring-color\);/,
  );
  assert.match(
    styleSource,
    /\.situationPrimaryMetrics \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*\.situationSummaryCell \{[\s\S]*min-height: var\(--sr-size-control\);[\s\S]*\.situationSummaryCell \+ \.situationSummaryCell \{[\s\S]*border-left: var\(--sr-border-width\) solid var\(--sr-color-divider\);/,
  );
  assert.match(
    styleSource,
    /\.situationSummaryCell:last-child \{[\s\S]*padding-right: calc\(var\(--sr-space-3\) \+ var\(--sr-space-5\)\);[\s\S]*\.situationChevron \{[\s\S]*right: 0;[\s\S]*width: var\(--sr-space-5\);/,
  );
  assert.match(
    styleSource,
    /\.situationDisclosure\[open\] \.situationChevron svg \{[\s\S]*transform: rotate\(180deg\);[\s\S]*\.situationExpandedGrid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    styleSource,
    /\.situationSummaryCell span \{[\s\S]*font-size: var\(--sr-font-size-md\);/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 340px\) \{[\s\S]*\.situationSummaryCell \{[\s\S]*column-gap: var\(--sr-space-1\);/,
  );
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

test("mobile market context is flat and uses shared directional score tones", () => {
  const railSource = readSource("components/feed-v2/FeedContextRail.tsx");
  const styleSource = readSource(
    "components/feed-v2/StockRadarFeedV2.module.css",
  );

  assert.match(
    railSource,
    /aria-label=\{`\$\{item\.sentiment\} direction score \$\{item\.impactScore\} out of 99`\}/,
  );
  assert.match(
    railSource,
    /data-score-tone=\{getDirectionalScoreTone\([\s\S]*item\.impactScore,[\s\S]*item\.sentiment,[\s\S]*\)\}/,
  );
  assert.match(
    railSource,
    /\{item\.sentiment\} \{item\.impactScore\}/,
  );
  assert.doesNotMatch(railSource, /Impact\{" "\}/);
  assert.match(
    styleSource,
    /\.contextEvent > strong\[data-score-tone="bullish"\] \{[\s\S]*color: var\(--sr-color-positive\);/,
  );
  assert.match(
    styleSource,
    /\.contextEvent > strong\[data-score-tone="bearish"\] \{[\s\S]*color: var\(--sr-color-negative\);/,
  );
  assert.match(
    styleSource,
    /\.contextEvent > strong\[data-score-tone="volatile"\] \{[\s\S]*color: var\(--sr-color-warning\);/,
  );
  assert.match(
    styleSource,
    /\.contextEvent > strong\[data-score-tone="neutral"\] \{[\s\S]*color: var\(--sr-color-event-neutral\);/,
  );
  assert.match(
    styleSource,
    /\.contextEvent > strong\[data-score-tone="default"\] \{[\s\S]*color: var\(--sr-color-text-heading\);/,
  );
  assert.doesNotMatch(
    styleSource,
    /\.contextEvent > strong span\[data-score-tone=/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.contextPanel \{[\s\S]*min-width: 0;[\s\S]*overflow: visible;[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.contextPanelHeading \{[\s\S]*padding: var\(--sr-space-3\) 0;[\s\S]*border-bottom-color: var\(--sr-color-border\);[\s\S]*background: var\(--sr-color-surface-control-strong\);[\s\S]*\.contextPanelHeading h2 \{[\s\S]*font-size: var\(--sr-font-size-xl\);[\s\S]*\.contextPanelHeading span \{[\s\S]*font-size: var\(--sr-font-size-md\);/,
  );
  const mobileContextHeading =
    [...styleSource.matchAll(/\.contextPanelHeading \{[^}]*\}/g)].at(-1)?.[0] ?? "";
  assert.doesNotMatch(mobileContextHeading, /linear-gradient/);
  const desktopContextHeading =
    styleSource.match(/^\.contextPanelHeading \{[^}]*\}/m)?.[0] ?? "";
  assert.doesNotMatch(desktopContextHeading, /surface-control-strong/);
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.marketPulseGrid \{[\s\S]*min-width: 0;[\s\S]*padding: 0;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*gap: 0;[\s\S]*\.marketPulseGrid article \{[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.marketPulseGrid article:nth-last-child\(2\):nth-child\(even\) \{[\s\S]*border-bottom: var\(--sr-border-width\) solid var\(--sr-color-divider\);/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.marketPulseGroupTitle \{[\s\S]*border-top-color: var\(--sr-color-border\);[\s\S]*border-bottom: var\(--sr-border-width\) solid var\(--sr-color-divider\);[\s\S]*\.marketPulseGroupTitle \+ \.marketPulseGrid \{[\s\S]*border-bottom: var\(--sr-border-width\) solid var\(--sr-color-divider\);/,
  );
  const desktopGroupTitleRule = styleSource.match(/^\.marketPulseGroupTitle \{[^}]*\}/m)?.[0] ?? "";
  assert.match(desktopGroupTitleRule, /border-top: var\(--sr-border-width\) solid var\(--sr-color-divider\);/);
  assert.doesNotMatch(desktopGroupTitleRule, /border-bottom/);
  assert.equal(
    [...styleSource.matchAll(/\.marketPulseGroupTitle \+ \.marketPulseGrid/g)].length,
    1,
    "only the mobile futures grid should receive the closing divider",
  );
  const fillsOddGridBoundary = (itemCount: number) =>
    (itemCount - 1) % 2 === 0;
  for (const itemCount of [3, 5]) assert.equal(fillsOddGridBoundary(itemCount), true);
  for (const itemCount of [4, 6]) assert.equal(fillsOddGridBoundary(itemCount), false);
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.marketPulseGrid span,[\s\S]*\.marketPulseGrid small \{[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*\.marketPulseGrid strong \{[\s\S]*font-size: var\(--sr-font-size-2xl\);/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.contextEventList \{[\s\S]*padding: 0;[\s\S]*\.contextEvent \{[\s\S]*min-width: 0;[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*padding: var\(--sr-space-3\) 0;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.contextEvent:last-child \{[\s\S]*border-bottom: var\(--sr-border-width\) solid var\(--sr-color-border\);/,
  );
  const desktopLastContextEventRule = styleSource.match(/^\.contextEvent:last-child \{[^}]*\}/m)?.[0] ?? "";
  assert.match(desktopLastContextEventRule, /border-bottom: 0;/);
  assert.equal(
    [...styleSource.matchAll(/\.contextEvent:last-child/g)].length,
    2,
    "desktop and mobile should each define the final context-event border",
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.contextEvent p \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*font-size: 16px;[\s\S]*line-height: 1\.4;[\s\S]*\.contextEvent > strong \{[\s\S]*position: static;[\s\S]*font-size: 16px;[\s\S]*white-space: nowrap;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.railEmpty \{[\s\S]*padding: var\(--sr-space-4\) 0;[\s\S]*font-size: var\(--sr-font-size-base\);/,
  );
  assert.match(
    styleSource,
    /\.contextPanel,[\s\S]*\.previewEmpty,[\s\S]*\.premiumCard \{[\s\S]*overflow: hidden;[\s\S]*border-radius: var\(--sr-radius-base\);/,
  );
});

test("feed rows use one centered dash for unavailable quote and chart", () => {
  const listSource = readSource("components/feed-v2/FeedEventList.tsx");
  const adapterSource = readSource("lib/liveFeed.ts");
  const quoteHydrationSource = readSource("lib/marketQuoteHydration.ts");
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
    /kind: marketScope === "macro" && !snapshot \? "macro" : "group",[\s\S]*price: hasTickerQuote \? quote\.price : ""/,
  );
  assert.match(
    adapterSource,
    /bars: snapshot \? groupSnapshotToBars\(snapshot\) : \[\]/,
  );
  assert.match(
    adapterSource,
    /const change = hasTickerQuote[\s\S]*\? quote\.change[\s\S]*: snapshot[\s\S]*\? formatSignedPercent\(snapshot\.changePercent\)[\s\S]*: ""/,
  );
  assert.match(
    adapterSource,
    /price: Number\.isFinite\(price\) \? formatCurrency\(price\) : "",[\s\S]*changeAmount: Number\.isFinite\(change\) \? `\$\$\{formatAbs\(change\)\}` : "",[\s\S]*change: Number\.isFinite\(changePct\)[\s\S]*: ""/,
  );
  assert.doesNotMatch(adapterSource, /change: [^\n]*"\+0\.00%"/);
  assert.doesNotMatch(adapterSource, /changeAmount: [^\n]*"\$0\.00"/);
  assert.match(
    adapterSource,
    /resolveEventQuoteSymbol\([\s\S]*relatedTickers\?\.get\(readString\(row, \["id"\]\)\)[\s\S]*readHydratedMarketQuoteMap\(symbols\)/,
  );
  assert.match(
    quoteHydrationSource,
    /marketQuoteHydrationLimit = 25[\s\S]*readMarketQuoteCacheMap\(normalizedSymbols\)[\s\S]*missingSymbols[\s\S]*fetchFmpQuotes\(symbols\)[\s\S]*writeMarketQuoteCache/,
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
  assert.match(
    styleSource,
    /\.page\s*{[\s\S]*?width: min\(100%, 1600px\);[\s\S]*?margin: 0 auto;/,
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
    /@media \(max-width: 760px\)[\s\S]*grid-template-columns: minmax\(40px, auto\) minmax\(0, 1fr\) auto/,
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

test("tickerless mobile market alerts use real scope identities", () => {
  const marketPreviewSource: LiveFeedV2PreviewSource = {
    category: "Market",
    detailHref: "/events/market-1",
    feedType: "market",
    headline: "Market alert",
    id: "market-1",
    impactScore: 80,
    marketScopeLabel: "Macro",
    primaryTicker: null,
    publishedAt: "2026-07-26T14:05:00.000Z",
    sentiment: "Volatile",
    source: "Market News",
    themeLabel: "Monetary Policy",
    ticker: "N/A",
  };

  assert.equal(
    getLiveFeedV2MobileIdentityLabel({
      category: "Macro Alert",
      preview: createLiveFeedV2Preview(marketPreviewSource),
      ticker: "N/A",
    }),
    "MACRO",
  );
  assert.equal(
    getLiveFeedV2MobileIdentityLabel({
      category: "Sector Alert",
      preview: createLiveFeedV2Preview({
        ...marketPreviewSource,
        marketScopeLabel: "Sector",
        themeLabel: "Technology",
      }),
      ticker: "N/A",
    }),
    "SECTOR",
  );
  assert.equal(
    getLiveFeedV2MobileIdentityLabel({
      category: "Theme Alert",
      preview: createLiveFeedV2Preview({
        ...marketPreviewSource,
        marketScopeLabel: "Theme",
        themeLabel: "AI Infrastructure",
      }),
      ticker: "N/A",
    }),
    "AI Infrastructure",
  );
});

test("desktop feed rows follow the Watchlist typography and selection hierarchy", () => {
  const listSource = readSource("components/feed-v2/FeedEventList.tsx");
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
  assert.match(listSource, /getLiveFeedV2MobileIdentityLabel\(item\)/);
  assert.match(listSource, /className=\{styles\.identityMobile\}/);
  assert.match(
    listSource,
    /data-mobile-identity-kind=\{[\s\S]*item\.feedType === "market" \? "market" : "ticker"/,
  );
  assert.match(listSource, /<strong>\{item\.timeLabel\} ET<\/strong>/);
  assert.equal(
    (listSource.match(/\{item\.timeLabel\} ET/g) ?? []).length,
    2,
    "desktop and mobile should each render one ET suffix",
  );
  assert.match(listSource, /<span>\{item\.company\}<\/span>/);
  assert.match(
    listSource,
    /<span className=\{styles\.source\}>\{item\.source\}<\/span>/,
  );
  assert.match(listSource, /<h2>\{item\.headline\}<\/h2>/);
  assert.ok(
    listSource.indexOf("{formatChangePercent(item.changePercent)}") <
      listSource.indexOf('{item.price ?? "—"}'),
    "quote DOM should expose change before price for mobile reading order",
  );
  assert.match(
    styleSource,
    /\.quote strong \{[\s\S]*?order: 1;[\s\S]*?\.quote span \{[\s\S]*?order: 2;/,
  );
  assert.match(
    styleSource,
    /\.quote > \.sentimentPositive \{[\s\S]*?color: var\(--sr-color-positive\);[\s\S]*?\.quote > \.sentimentNegative \{[\s\S]*?color: var\(--sr-color-negative\);[\s\S]*?\.quote > \.sentimentNeutral \{[\s\S]*?color: var\(--sr-color-text-muted\);/,
  );
  assert.match(styleSource, /\.identity \.identityMobile\s*\{\s*display: none;/);
  assert.match(listSource, /\{item\.timeDateLabel\} \{item\.timeLabel\} ET/);
  assert.doesNotMatch(listSource, /styles\.eventDateMobile|styles\.eventClockMobile/);
  assert.doesNotMatch(
    listSource,
    /\{item\.timeDateLabel\} · \{item\.timeLabel\} ET/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.feedItem \{[\s\S]*min-height: 132px;[\s\S]*grid-template-columns: minmax\(40px, auto\) minmax\(0, 1fr\) auto;[\s\S]*grid-template-rows: auto auto auto;[\s\S]*column-gap: var\(--sr-space-2\);[\s\S]*row-gap: 7px;[\s\S]*padding: var\(--sr-space-4\) var\(--sr-space-3\);/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.identity strong \{[\s\S]*overflow: visible;[\s\S]*overflow-wrap: anywhere;[\s\S]*text-overflow: clip;[\s\S]*white-space: normal;[\s\S]*\.identityMobile\[data-mobile-identity-kind="ticker"\] \{[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*font-weight: 800;[\s\S]*letter-spacing: 0\.02em;[\s\S]*\.identityMobile\[data-mobile-identity-kind="market"\] \{[\s\S]*font-family: var\(--sr-font-family-sans\);[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*font-weight: 700;[\s\S]*letter-spacing: normal;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.eventBadge \{[\s\S]*max-width: 100%;[\s\S]*grid-column: 2;[\s\S]*grid-row: 1;[\s\S]*align-self: center;[\s\S]*overflow: visible;[\s\S]*font-family: var\(--sr-font-family-sans\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: 650;[\s\S]*line-height: var\(--sr-line-height-none\);[\s\S]*overflow-wrap: anywhere;[\s\S]*text-overflow: clip;[\s\S]*text-transform: none;[\s\S]*white-space: normal;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.eventCopy h2 \{[\s\S]*grid-column: 1 \/ -1;[\s\S]*grid-row: 2;[\s\S]*font-size: var\(--sr-font-size-2xl\);[\s\S]*font-weight: 650;[\s\S]*line-height: 1\.4;[\s\S]*-webkit-line-clamp: 2;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.eventTimeMobile \{[\s\S]*color: var\(--sr-color-text-muted\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: 400;[\s\S]*\.source \{[\s\S]*overflow: hidden;[\s\S]*color: var\(--sr-color-text-muted\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: 400;[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;[\s\S]*\.source::before \{[\s\S]*margin: 0 var\(--sr-space-1\);[\s\S]*content: "·";/,
  );
  assert.doesNotMatch(styleSource, /\.eventDateMobile|\.eventClockMobile/);
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.quote strong \{[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*\.quote span \{[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*\.impactScore span \{[\s\S]*overflow: visible;[\s\S]*font-size: 16px;[\s\S]*text-overflow: clip;[\s\S]*white-space: nowrap;[\s\S]*\.impactScore strong \{[\s\S]*font-size: 16px;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.quote,[\s\S]*\.quoteUnavailable \{[\s\S]*grid-column: 3;[\s\S]*grid-row: 3;[\s\S]*\.quote \{[\s\S]*min-width: max-content;[\s\S]*flex-direction: row;[\s\S]*align-items: baseline;[\s\S]*justify-self: end;[\s\S]*gap: var\(--sr-space-1\);[\s\S]*white-space: nowrap;[\s\S]*\.quote strong \{[\s\S]*order: 2;[\s\S]*\.quote span \{[\s\S]*order: 1;/,
  );
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*\.quoteUnavailable,[\s\S]*\.quote \.quotePriceUnavailable,[\s\S]*\.quote > \.sentimentNeutral \{[\s\S]*display: none;/,
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
  assert.equal(news.watchlist, false);
  assert.equal(news.saved, false);
  assert.equal(news.authenticated, false);
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
