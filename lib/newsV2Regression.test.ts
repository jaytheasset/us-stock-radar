import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseNewsV2Statistics } from "./newsV2ApiContract.ts";
import { hasResettableNewsV2State } from "./newsV2FilterState.ts";
import { hydrateNewsV2ItemMarketData } from "./newsV2MarketHydration.ts";
import type { NewsV2FilterState, NewsV2Item } from "./newsV2.ts";

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
