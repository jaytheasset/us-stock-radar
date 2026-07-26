import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseNewsV2Statistics } from "./newsV2ApiContract.ts";
import { hasResettableNewsV2State } from "./newsV2FilterState.ts";
import { hydrateNewsV2ItemMarketData } from "./newsV2MarketHydration.ts";
import { buildGooglePreferredSourceUrl } from "./googlePreferredSource.ts";
import { selectPriceChartXAxisIndexes } from "./priceChartAxis.ts";
import type { NewsV2FilterState, NewsV2Item } from "./newsV2.ts";
import { getNewsV2ScopeBadgeLabel } from "./newsV2ScopeBadge.ts";

const emptyFilters: NewsV2FilterState = {
  sentiments: [],
  marketCaps: [],
  eventTypes: [],
  sources: [],
  sectors: [],
  themes: [],
};

const baseItem: NewsV2Item = {
  id: "00000000-0000-4000-8000-000000000001",
  publishedAt: "2026-07-25T12:00:00.000Z",
  headline: "Example",
  summary: "Example summary",
  source: "SEC",
  category: "Company",
  relatedTickers: ["TEST"],
  sentiment: "Neutral",
  score: 50,
  relatedSectors: [],
  themes: [],
  eventType: "Event",
  eventTypeCode: "event",
  trend: [],
  deliveryLevel: "feed",
};

test("filtered statistics contract parses numeric fields and fixed ET ranges", () => {
  const statistics = parseNewsV2Statistics({
    as_of: "2026-07-25T12:00:00.000Z",
    range_time_zone: "America/New_York",
    source_activity: [{
      source: "SEC",
      count: "42",
      average_score: 81,
      range_counts: { Today: "0", "5D": 3, "1M": 9, "3M": 18 },
    }],
    theme_activity: [{
      theme_group: "AI Infrastructure",
      count: 7,
      average_score: "76",
      high_impact_count: 4,
      signal_counts: { bullish: 5, bearish: 1, neutral: 1, volatile: 0 },
      sub_themes: [],
    }],
  });

  assert.ok(statistics);
  assert.equal(statistics.rangeTimeZone, "America/New_York");
  assert.deepEqual(statistics.sourceActivity[0]?.rangeCounts, {
    Today: 0,
    "5D": 3,
    "1M": 9,
    "3M": 18,
  });
  assert.equal(statistics.sourceActivity[0]?.count, 42);
  assert.equal(statistics.themeActivity[0]?.averageScore, 76);
});

test("statistics without a valid as-of or ET contract are rejected", () => {
  assert.equal(parseNewsV2Statistics({}), null);
  assert.equal(
    parseNewsV2Statistics({
      as_of: "2026-07-25T12:00:00.000Z",
      range_time_zone: "UTC",
    }),
    null,
  );
});

test("market hydration keeps quote and chart availability independent", () => {
  const quoteOnly = hydrateNewsV2ItemMarketData(baseItem, {
    provider: "fmp",
    price: 12.5,
    changePercent: -1.25,
  });
  assert.equal(quoteOnly.priceLabel, "$12.50");
  assert.equal(quoteOnly.changePercent, "-1.25%");
  assert.deepEqual(quoteOnly.trend, []);

  const chartOnly = hydrateNewsV2ItemMarketData(baseItem, undefined, {
    symbol: "TEST",
    range: "1D",
    interval: "5min-ext",
    provider: "polygon",
    providerLabel: "Market cache",
    previousClose: 10,
    latestPrice: Number.NaN,
    changeAmount: Number.NaN,
    changePercent: Number.NaN,
    points: [
      { time: "2026-07-25T12:00:00Z", open: 10, high: 11, low: 9, close: 10, volume: 1, vwap: 10 },
      { time: "2026-07-25T12:05:00Z", open: 10, high: 12, low: 10, close: 11, volume: 1, vwap: 11 },
    ],
  });
  assert.equal(chartOnly.priceLabel, undefined);
  assert.equal(chartOnly.changePercent, undefined);
  assert.deepEqual(chartOnly.trend, [10, 11]);
});

test("reset stays enabled for an applied search after the draft is cleared", () => {
  assert.equal(hasResettableNewsV2State(emptyFilters, "", "NVDA"), true);
  assert.equal(hasResettableNewsV2State(emptyFilters, "", ""), false);
  assert.equal(
    hasResettableNewsV2State({ ...emptyFilters, sources: ["SEC"] }, "", ""),
    true,
  );
});

test("news scope badges hide company scope and use source-backed market taxonomy", () => {
  assert.equal(getNewsV2ScopeBadgeLabel(baseItem), undefined);
  assert.equal(
    getNewsV2ScopeBadgeLabel({
      category: "Theme",
      theme: "AI Infrastructure",
      subThemeSlug: "ai_infrastructure",
    }),
    "AI & Data Center",
  );
  assert.equal(
    getNewsV2ScopeBadgeLabel({
      category: "Theme",
      theme: "Semiconductor Supply Chain",
    }),
    "Semiconductor Supply Chain",
  );
  assert.equal(
    getNewsV2ScopeBadgeLabel({
      category: "Sector",
      sector: "Communication Services",
    }),
    "Communication Services",
  );
  assert.equal(getNewsV2ScopeBadgeLabel({ category: "Sector" }), undefined);
  assert.equal(getNewsV2ScopeBadgeLabel({ category: "Theme" }), undefined);
  assert.equal(
    getNewsV2ScopeBadgeLabel({
      category: "Macro",
      sector: "Technology",
      theme: "AI Infrastructure",
    }),
    "MACRO",
  );

  const rowSource = readFileSync(
    new URL("../components/news-v2/NewsV2Row.tsx", import.meta.url),
    "utf8",
  );
  assert.match(rowSource, /const scopeBadgeLabel = getNewsV2ScopeBadgeLabel\(item\)/);
  assert.match(rowSource, /scopeBadgeLabel \? \(/);
  assert.match(rowSource, /label=\{scopeBadgeLabel\}/);
});

test("news, filings, and watchlist searches share the inset icon divider contract", () => {
  const searchFields = [
    {
      component: "../components/news-v2/NewsV2FilterBar.tsx",
      styles: "../components/news-v2/StockRadarNewsV2.module.css",
      fieldClass: "searchField",
    },
    {
      component: "../components/filings-v2/FilingsV2FilterBar.tsx",
      styles: "../components/filings-v2/StockRadarFilingsV2.module.css",
      fieldClass: "searchControl",
    },
    {
      component: "../components/watchlist-v2/StockRadarWatchlistV2.tsx",
      styles: "../components/watchlist-v2/StockRadarWatchlistV2.module.css",
      fieldClass: "tickerSearch",
    },
  ];

  for (const searchField of searchFields) {
    const componentSource = readFileSync(
      new URL(searchField.component, import.meta.url),
      "utf8",
    );
    const styles = readFileSync(new URL(searchField.styles, import.meta.url), "utf8");

    assert.match(componentSource, /className=\{styles\.searchIconCell\}/);
    assert.match(
      styles,
      new RegExp(
        `\\.${searchField.fieldClass} \\{[\\s\\S]*?height: 38px;[\\s\\S]*?gap: var\\(--sr-space-2\\);`,
      ),
    );
    assert.match(
      styles,
      /\.searchIconCell \{[\s\S]*?height: 100%;[\s\S]*?flex: 0 0 28px;/,
    );
    assert.match(
      styles,
      /\.searchIconCell::after \{[\s\S]*?top: 7px;[\s\S]*?bottom: 7px;[\s\S]*?width: var\(--sr-border-width\);[\s\S]*?background: var\(--sr-color-divider\);/,
    );
  }
});

test("10k+ tuple cursor pagination is stable with tied timestamps", () => {
  const rows = Array.from({ length: 10_050 }, (_, index) => ({
    id: index.toString().padStart(12, "0"),
    publishedAt: new Date(
      Date.UTC(2026, 6, 25, 12, 0, Math.floor(index / 17)),
    ).toISOString(),
  })).sort(
    (left, right) =>
      right.publishedAt.localeCompare(left.publishedAt) ||
      right.id.localeCompare(left.id),
  );

  const visited: string[] = [];
  let cursor: (typeof rows)[number] | undefined;
  while (visited.length < rows.length) {
    const page = rows
      .filter((row) =>
        !cursor ||
        row.publishedAt < cursor.publishedAt ||
        (row.publishedAt === cursor.publishedAt && row.id < cursor.id),
      )
      .slice(0, 25);
    if (!page.length) break;
    visited.push(...page.map((row) => row.id));
    cursor = page.at(-1);
  }

  assert.equal(visited.length, rows.length);
  assert.equal(new Set(visited).size, rows.length);
});

test("Google preferred-source links always use the public Stock Radar domain", () => {
  assert.equal(
    buildGooglePreferredSourceUrl(),
    "https://google.com/preferences/source?q=us-stock-radar.com",
  );

  for (const path of [
    "../app/news/page.tsx",
    "../components/news-analysis-v2/NewsAnalysisAdapter.tsx",
    "../app/filings/page.tsx",
    "../app/filings/[id]/page.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /buildGooglePreferredSourceUrl\(\)/, path);
    assert.doesNotMatch(source, /getServerEnv\(\)\.appBaseUrl/, path);
  }
});

test("news archive rejects missing data without exposing development fixtures", () => {
  const source = readFileSync(
    new URL("../app/news/archive/[id]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /if \(!isUuid\(id\)\) notFound\(\)/);
  assert.match(source, /if \(!dbPayload\) notFound\(\)/);
  assert.match(source, /series=\{null\}/);
  assert.match(source, /original article text is currently unavailable/i);
  assert.doesNotMatch(source, /mockArchiveEvent|buildMockPriceSeries|Trinity Bank/);
});

test("mobile news metadata uses a dedicated readable row", () => {
  const rowSource = readFileSync(
    new URL("../components/news-v2/NewsV2Row.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL(
      "../components/news-v2/StockRadarNewsV2.module.css",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(rowSource, /className=\{styles\.rowMobileBadges\}/);
  assert.match(styles, /\.newsRow \{[\s\S]*grid-template-rows: auto auto auto;/);
  assert.match(
    styles,
    /\.rowSource \{[\s\S]*grid-column: 2 \/ 4;[\s\S]*grid-row: 2;/,
  );
  assert.match(
    styles,
    /\.rowMobilePublishedAt \{[\s\S]*grid-column: 1;[\s\S]*grid-row: 2;/,
  );
});

test("price chart reduces time ticks only for narrow plots", () => {
  assert.deepEqual(
    selectPriceChartXAxisIndexes(100, 260),
    [0, 33, 66, 99],
  );
  assert.deepEqual(
    selectPriceChartXAxisIndexes(100, 320),
    [0, 20, 40, 59, 79, 99],
  );
  assert.deepEqual(selectPriceChartXAxisIndexes(0, 260), []);
});

test("news mid-width layout keeps compact filters, feed, then a stable rail grid", () => {
  const layoutSource = readFileSync(
    new URL("../components/news-v2/StockRadarNewsV2.tsx", import.meta.url),
    "utf8",
  );
  const railSource = readFileSync(
    new URL("../components/news-v2/NewsV2InsightRail.tsx", import.meta.url),
    "utf8",
  );
  const styles = readFileSync(
    new URL(
      "../components/news-v2/StockRadarNewsV2.module.css",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(layoutSource, /className=\{styles\.listPanelAnchor\}/);
  assert.match(railSource, /styles\.marketNewsRailCard/);
  assert.match(railSource, /styles\.sectorRailCard/);
  assert.match(railSource, /styles\.themeRailCard/);
  assert.match(
    styles,
    /@media \(max-width: 980px\) \{[\s\S]*?\.filterBar \{[\s\S]*?grid-row: 1;[\s\S]*?\.listPanelAnchor \{[\s\S]*?grid-row: 2;[\s\S]*?\.insightRailAnchor \{[\s\S]*?grid-row: 3;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 980px\) \{[\s\S]*?\.desktopFilterMatrix \{[\s\S]*?display: none;[\s\S]*?\.mobileFilterActions \{[\s\S]*?display: flex;/,
  );
  assert.match(
    styles,
    /\.sectorRailCard,\s*\.mobileInsightAdItem,\s*\.themeRailCard \{[\s\S]*?grid-column: 1 \/ -1;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.insightRailContent \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/,
  );
});

test("product header switches to its mobile navigation before mid-width clipping", () => {
  const styles = readFileSync(
    new URL(
      "../components/shell/StockRadarProductHeader.module.css",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    styles,
    /@media \(max-width: 1120px\) \{[\s\S]*?\.primaryNavigation \{[\s\S]*?display: none;[\s\S]*?\.actions \.mobileMenuButton \{[\s\S]*?display: flex;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.header \{[\s\S]*?height: var\(--sr-size-header\);[\s\S]*?padding: 0 var\(--sr-space-3-5\);/,
  );
});

test("news migration keeps page bounds, indexed search, real-time ET ranges, and service-only RPCs", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260724202810_news_v2_filtered_stats_and_search_indexes.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const rowSource = readFileSync(
    new URL("../components/news-v2/NewsV2Row.tsx", import.meta.url),
    "utf8",
  );
  const dataSource = readFileSync(new URL("./newsV2Data.ts", import.meta.url), "utf8");

  assert.match(migration, /create extension if not exists pg_trgm/i);
  assert.match(migration, /using gin[\s\S]+extensions\.gin_trgm_ops/i);
  assert.match(migration, /stats_filtered as materialized/i);
  assert.match(migration, /normalized as not materialized/i);
  assert.match(
    migration,
    /\(n\.effective_published_at, n\.id\) < \(p_cursor_published_at, p_cursor_id\)/i,
  );
  assert.match(migration, /least\(greatest\(p_limit, 1\), 25\)/i);
  assert.match(
    migration,
    /current_timestamp at time zone 'America\/New_York'/i,
  );
  assert.doesNotMatch(migration, /max\(effective_published_at\) as latest_at/i);
  assert.match(
    migration,
    /revoke all on function public\.search_news_v2[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.search_news_v2[\s\S]+to service_role/i,
  );
  assert.doesNotMatch(rowSource, /\/api\/market\/chart/);
  assert.match(dataSource, /readMarketQuoteCacheMap\(symbols\)/);
  assert.match(dataSource, /readMarketBarCacheMap\(symbols, "1D"\)/);
  assert.match(dataSource, /unstable_cache/);
  assert.match(dataSource, /revalidate: 300/);
  assert.match(dataSource, /newsV2StatisticsCacheSeconds = 15/);
  assert.match(dataSource, /includeTotal && !cursor/);
});

test("News V2 market score policy is shared by rows, stats, and facets", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260725215634_news_v2_market_score_threshold.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const dataSource = readFileSync(new URL("./newsV2Data.ts", import.meta.url), "utf8");
  const isVisible = (marketScope: string | null, score: number | null) => {
    const normalizedScope = marketScope?.trim().toLowerCase() || "company";
    return (
      !["sector", "theme", "macro"].includes(normalizedScope) ||
      (score ?? 50) >= 75
    );
  };

  assert.equal(isVisible("company", 50), true);
  assert.equal(isVisible("company", 74), true);
  for (const marketScope of ["sector", "theme", "macro"]) {
    assert.equal(isVisible(marketScope, 74), false);
    assert.equal(isVisible(marketScope, 75), true);
    assert.equal(isVisible(marketScope, null), false);
  }

  assert.match(migration, /pg_get_functiondef\(p\.oid\)/i);
  assert.match(migration, /p\.proname = 'search_news_v2'/i);
  assert.match(migration, /p\.proname = 'get_news_v2_facets'/i);
  assert.match(
    migration,
    /not in \('sector', 'theme', 'macro'\)[\s\S]*or coalesce\(e\.score, 50\) >= 75/i,
  );
  assert.equal(
    (migration.match(/execute replace\([^;]+visible_anchor\)/gi) || []).length,
    2,
  );
  assert.match(
    migration,
    /revoke all on function public\.search_news_v2[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_news_v2_facets\(\)[\s\S]+to service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /\b(?:delete\s+from|update|truncate|alter\s+table)\s+public\.events\b/i,
  );
  assert.match(dataSource, /news-v2-filter-options-v3-market-score-75/);
  assert.match(dataSource, /news-v2-filtered-first-page-v2-market-score-75/);
});
