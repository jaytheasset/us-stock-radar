import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseNewsV2Statistics } from "./newsV2ApiContract.ts";
import { hasResettableNewsV2State } from "./newsV2FilterState.ts";
import { hydrateNewsV2ItemMarketData } from "./newsV2MarketHydration.ts";
import { getEventListIdentity } from "./eventListIdentity.ts";
import { buildGooglePreferredSourceUrl } from "./googlePreferredSource.ts";
import { selectPriceChartXAxisIndexes } from "./priceChartAxis.ts";
import type { NewsV2FilterState, NewsV2Item } from "./newsV2.ts";
import { getNewsV2ScopeBadgeLabel } from "./newsV2ScopeBadge.ts";
import { resolveNewsCompanyName } from "./newsCompanyIdentity.ts";

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
  companyName: "Test Corporation",
  category: "Company",
  marketScope: "company",
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

test("news and feed share exact company, macro, policy, sector, and theme identities", () => {
  assert.deepEqual(
    getEventListIdentity({
      companyName: "JPMorgan Chase & Co.",
      eventType: "macro_market",
      marketScope: "company",
      sector: "Financial Services",
      subTheme: "interest_rates",
      themeGroup: "rates_credit_banks",
      ticker: "JPM",
    }),
    { kind: "market", primary: "MACRO", secondary: "Interest Rates" },
  );
  assert.deepEqual(
    getEventListIdentity({
      companyName: "Alphabet Inc.",
      eventType: "policy_regulation",
      marketScope: "sector",
      sector: "Communication Services",
      subTheme: "antitrust_big_tech_scrutiny",
      themeGroup: "policy_regulation",
      ticker: "GOOGL",
    }),
    {
      kind: "market",
      primary: "POLICY",
      secondary: "Antitrust & Big Tech Scrutiny",
    },
  );
  assert.deepEqual(
    getEventListIdentity({
      companyName: "NVIDIA Corporation",
      eventType: "product_update",
      marketScope: "company",
      sector: "Technology",
      ticker: "NVDA",
    }),
    { kind: "ticker", primary: "NVDA", secondary: "NVIDIA Corporation" },
  );
  assert.deepEqual(
    getEventListIdentity({ eventType: "earnings", marketScope: "company" }),
    {
      kind: "ticker",
      primary: "N/A",
      secondary: "Company name unavailable",
    },
  );
  assert.deepEqual(
    getEventListIdentity({ marketScope: "sector", sector: "Technology" }),
    { kind: "market", primary: "SECTOR", secondary: "Technology" },
  );
  assert.deepEqual(
    getEventListIdentity({
      marketScope: "theme",
      themeGroup: "ai_data_center",
    }),
    { kind: "market", primary: "THEME", secondary: "AI & Data Center" },
  );
});

test("news, filings, alerts, and watchlist share one accessible ticker autocomplete", () => {
  const componentPaths = [
    "../components/news-v2/NewsV2FilterBar.tsx",
    "../components/filings-v2/FilingsV2FilterBar.tsx",
    "../components/alerts-v2/StockRadarAlertsV2.tsx",
    "../components/watchlist-v2/StockRadarWatchlistV2.tsx",
  ];
  const autocomplete = readFileSync(
    new URL("../components/ui/TickerCompanyAutocomplete.tsx", import.meta.url),
    "utf8",
  );
  const autocompleteStyles = readFileSync(
    new URL("../components/ui/TickerCompanyAutocomplete.module.css", import.meta.url),
    "utf8",
  );

  for (const componentPath of componentPaths) {
    assert.match(
      readFileSync(new URL(componentPath, import.meta.url), "utf8"),
      /TickerCompanyAutocomplete/,
    );
  }
  assert.match(autocomplete, /aria-autocomplete="list"/);
  assert.match(autocomplete, /role="listbox"/);
  assert.match(autocomplete, /moveTickerSearchIndex/);
  assert.match(
    autocompleteStyles,
    /\.control \{[\s\S]*height: 38px;[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*background-clip: padding-box;/,
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

test("News Google preferred-source link has one exact accessible name", () => {
  const filterSource = readFileSync(
    new URL("../components/news-v2/NewsV2FilterBar.tsx", import.meta.url),
    "utf8",
  );
  const listSource = readFileSync(
    new URL("../components/news-v2/NewsV2List.tsx", import.meta.url),
    "utf8",
  );
  const linkSource = readFileSync(
    new URL("../components/ui/GooglePreferredSourceLink.tsx", import.meta.url),
    "utf8",
  );
  const pageSource = readFileSync(
    new URL("../components/news-v2/StockRadarNewsV2.tsx", import.meta.url),
    "utf8",
  );

  assert.match(linkSource, /ariaLabel\?: string;/);
  assert.match(linkSource, /aria-label=\{ariaLabel\}/);
  assert.match(
    listSource,
    /<GooglePreferredSourceLink[\s\S]*ariaLabel="Add Stock Radar on Google"[\s\S]*header/,
  );
  assert.match(
    filterSource,
    /preferredSourceUrl\?: string \| null;[\s\S]*className=\{styles\.mobilePreferredSourceLink\}[\s\S]*<GooglePreferredSourceLink[\s\S]*ariaLabel="Add Stock Radar on Google"[\s\S]*header[\s\S]*href=\{preferredSourceUrl\}/,
  );
  assert.match(pageSource, /<NewsV2FilterBar[\s\S]*preferredSourceUrl=\{preferredSourceUrl\}/);
  assert.doesNotMatch(listSource, /ariaLabel="Add Stock Radar on Google Google"/);
  assert.doesNotMatch(filterSource, /ariaLabel="Add Stock Radar on Google Google"/);
});

test("news archive rejects missing data without exposing development fixtures", () => {
  const source = readFileSync(
    new URL("../app/news/archive/[id]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /if \(!isUuid\(id\)\) notFound\(\)/);
  assert.match(source, /if \(!dbPayload\) notFound\(\)/);
  assert.match(source, /readString\(eventRow, "source_group"\) !== "news"/);
  assert.match(source, /readString\(eventRow, "delivery_level"\) !== "archive"/);
  assert.match(source, /series=\{null\}/);
  assert.match(source, /original article text is currently unavailable/i);
  assert.doesNotMatch(source, /mockArchiveEvent|buildMockPriceSeries|Trinity Bank/);
});

test("news analysis detail preserves stored original source and partial market context", () => {
  const detailSource = readFileSync(
    new URL("./newsAnalysisDetail.ts", import.meta.url),
    "utf8",
  );
  const adapterSource = readFileSync(
    new URL("../components/news-analysis-v2/NewsAnalysisAdapter.tsx", import.meta.url),
    "utf8",
  );
  const sharedAnalysisSource = readFileSync(
    new URL(
      "../components/filing-analysis-v2/GenericFilingAnalysis.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(detailSource, /readStoredNewsSourceContent/);
  assert.match(detailSource, /sanitizeNewsArticleHtml/);
  assert.match(detailSource, /readString\(primaryTickerRow, "symbol"\)/);
  assert.match(detailSource, /if \(!matched\.some\(\(item\) => item\.primary\)\) return null/);
  assert.match(detailSource, /buildNewsMarketContext/);
  assert.match(adapterSource, /<OriginalNewsArticle html=\{detail\.originalHtml\}/);
  assert.match(adapterSource, /Stored company and market context is unavailable for this event/);
  assert.match(adapterSource, /<GenericFilingAnalysis/);
  assert.equal(
    sharedAnalysisSource.match(/AI-assisted analysis\. Verify material facts against the original source\. Scores, labels, and directional signals are not investment recommendations\./g)?.length,
    1,
  );
  assert.equal(
    sharedAnalysisSource.match(/\{AI_ANALYSIS_DISCLOSURE\}/g)?.length,
    1,
  );
});

test("mobile news analysis uses a scoped document flow without changing filings", () => {
  const adapterSource = readFileSync(
    new URL("../components/news-analysis-v2/NewsAnalysisAdapter.tsx", import.meta.url),
    "utf8",
  );
  const sharedAnalysisSource = readFileSync(
    new URL(
      "../components/filing-analysis-v2/GenericFilingAnalysis.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const styles = readFileSync(
    new URL(
      "../components/filing-analysis-v2/GenericFilingAnalysis.module.css",
      import.meta.url,
    ),
    "utf8",
  );
  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 760px)"));

  assert.match(adapterSource, /presentationVariant="news-document"/);
  assert.match(sharedAnalysisSource, /presentationVariant\?: "default" \| "news-document"/);
  assert.match(sharedAnalysisSource, /presentationVariant === "news-document"/);
  assert.match(
    mobileStyles,
    /\.newsDocument \.card,[\s\S]*?border-top: var\(--sr-border-width\) solid var\(--sr-color-divider\);[\s\S]*?border-radius: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
  );
  assert.match(
    mobileStyles,
    /\.newsDocument \.hero h1 \{[^}]*font-size: var\(--sr-font-size-heading-md\);[^}]*line-height: var\(--sr-line-height-control\);/,
  );
  assert.match(
    mobileStyles,
    /\.newsDocument \.sectionLabel,[\s\S]*?font-size: var\(--sr-font-size-2xl\);/,
  );
  assert.match(
    mobileStyles,
    /\.newsDocument \.card p,[\s\S]*?font-size: 16px;[\s\S]*?line-height: 1\.6;/,
  );
  assert.match(
    mobileStyles,
    /\.newsDocument :global\(section\[aria-label="Score Rationale"\]\) \{[\s\S]*?border-radius: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
  );
});

test("legacy news detail surfaces sanitize stored or remote HTML at one server boundary", () => {
  const eventDetailSource = readFileSync(
    new URL("../app/events/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const archiveDetailSource = readFileSync(
    new URL("../app/news/archive/[id]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(eventDetailSource, /import \{ sanitizeNewsArticleHtml \} from "@\/lib\/newsArticleSanitizer"/);
  assert.match(eventDetailSource, /profile = sanitizeDetailProfileFullText\(profile\)/);
  assert.match(
    eventDetailSource,
    /fullTextHtml: sanitizeNewsArticleHtml\([\s\S]*?profile\.fullTextHtml,[\s\S]*?profile\.fullTextSourceUrl \|\| profile\.sourceUrl,[\s\S]*?\)/,
  );
  assert.match(
    eventDetailSource,
    /dangerouslySetInnerHTML=\{\{ __html: profile\.fullTextHtml \}\}/,
  );

  assert.match(archiveDetailSource, /import \{ sanitizeNewsArticleHtml \} from "@\/lib\/newsArticleSanitizer"/);
  assert.match(archiveDetailSource, /const unsafeOriginalHtml =/);
  assert.match(
    archiveDetailSource,
    /const originalHtml = sanitizeNewsArticleHtml\(unsafeOriginalHtml, sourceUrl\)/,
  );
  assert.match(
    archiveDetailSource,
    /dangerouslySetInnerHTML=\{\{ __html: archiveEvent\.originalHtml \}\}/,
  );
});

test("mobile news metadata uses a dedicated readable row", () => {
  const filters = readFileSync(
    new URL("../components/news-v2/NewsV2FilterBar.tsx", import.meta.url),
    "utf8",
  );
  const filterSheet = readFileSync(
    new URL("../components/news-v2/MobileNewsV2FilterSheet.tsx", import.meta.url),
    "utf8",
  );
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
  assert.match(rowSource, /className=\{styles\.rowMobileFooter\}/);
  assert.match(filters, /<Search aria-hidden="true" className=\{styles\.searchButtonIcon\}/);
  assert.match(filters, /className=\{styles\.searchButtonLabel\}>Search<\/span>/);
  assert.match(filterSheet, /surfaceClassName=\{styles\.newsMobileFilterSurface\}/);
  assert.match(styles, /\.newsRow \{[\s\S]*grid-template-rows: auto auto auto;/);
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.mainColumn \{[\s\S]*display: contents;[\s\S]*\.filterBar \{[\s\S]*background: transparent;[\s\S]*\.listPanel \{[\s\S]*width: calc\(100% \+ \(var\(--sr-page-gutter-mobile\) \* 2\)\);[\s\S]*margin-inline: calc\(var\(--sr-page-gutter-mobile\) \* -1\);[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*box-shadow: none;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.filterUtilityRow \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto auto;[\s\S]*\.searchForm \{[\s\S]*height: 44px;[\s\S]*min-height: 44px;[\s\S]*grid-template-columns: minmax\(0, 1fr\) 44px;[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*border-radius: var\(--sr-radius-action\);[\s\S]*background: var\(--sr-color-surface-control\);[\s\S]*\.searchForm:focus-within \{[\s\S]*border-color: var\(--sr-color-accent-border-active\);[\s\S]*box-shadow: 0 0 0 2px var\(--sr-color-accent-active-soft\);/,
  );
  assert.match(
    styles,
    /\.searchField > label \{[\s\S]*height: 42px;[\s\S]*border: 0;[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*\.searchField > label:focus-within \{[\s\S]*border: 0;[\s\S]*box-shadow: none;[\s\S]*\.searchField > label > span:first-child \{[\s\S]*display: none;[\s\S]*\.searchField > label input \{[\s\S]*font-size: 16px;[\s\S]*\.searchField::after \{[\s\S]*left: var\(--sr-space-3\);[\s\S]*height: 42px;[\s\S]*font-size: var\(--sr-font-size-base\);/,
  );
  assert.match(
    styles,
    /\.searchForm > \.searchButton \{[\s\S]*width: 44px;[\s\S]*height: 42px;[\s\S]*min-height: 42px;[\s\S]*border: 0;[\s\S]*border-left: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*\.searchForm > \.searchButton:focus-visible \{[\s\S]*outline: 0;/,
  );
  assert.doesNotMatch(styles, /\.searchForm \{[^}]*overflow:\s*hidden;/);
  assert.match(
    styles,
    /\.searchForm \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*gap: var\(--sr-space-2\);[\s\S]*\.searchForm > \.searchButton \{[\s\S]*width: calc\(var\(--sr-size-control\) \* 2\);/,
  );
  assert.match(
    styles,
    /\.mobilePreferredSourceLink \{[\s\S]*display: none;[\s\S]*@media \(max-width: 760px\) \{[\s\S]*\.mobilePreferredSourceLink \{[\s\S]*display: flex;[\s\S]*\.mobilePreferredSourceLink > a \{[\s\S]*height: 44px;[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border-control\);[\s\S]*\.mobilePreferredSourceLink > a > span::after \{[\s\S]*content: "Google";[\s\S]*\.listHeaderTitle > a \{[\s\S]*display: none;[\s\S]*\.listHeader h2 \{[\s\S]*font-size: var\(--sr-font-size-xl\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.listHeader \{[\s\S]*min-height: 40px;[\s\S]*gap: var\(--sr-space-2\);[\s\S]*padding-inline: var\(--sr-space-4\);[\s\S]*background: var\(--sr-color-surface-control-strong\);[\s\S]*\.listHeaderTitle \{[\s\S]*width: auto;[\s\S]*flex: 1 1 auto;[\s\S]*\.resultCount \{[\s\S]*width: auto;[\s\S]*flex: 0 0 auto;[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);/,
  );
  const mobileListHeader =
    [...styles.matchAll(/\.listHeader \{[^}]*\}/g)].at(-1)?.[0] ?? "";
  assert.doesNotMatch(mobileListHeader, /linear-gradient/);
  const desktopListHeader = styles.match(/^\.listHeader \{[^}]*\}/m)?.[0] ?? "";
  assert.match(
    desktopListHeader,
    /background: linear-gradient\([\s\S]*var\(--sr-color-surface-table-header-start\),[\s\S]*var\(--sr-color-surface-table-header-end\)/,
  );
  assert.match(
    styles,
    /\.newsListItem::after \{[\s\S]*background: var\(--sr-color-border\);[\s\S]*@media \(max-width: 340px\) \{[\s\S]*\.mobilePreferredSourceLink > a \{[\s\S]*width: 44px;[\s\S]*padding: 0;[\s\S]*\.mobilePreferredSourceLink > a > span \{[\s\S]*clip-path: inset\(50%\);/,
  );
  assert.match(
    styles,
    /\.listHeader \{[\s\S]*padding-inline: var\(--sr-space-4\);[\s\S]*\.newsRow \{[\s\S]*min-height: 132px;[\s\S]*row-gap: 7px;[\s\S]*padding: var\(--sr-space-4\) var\(--sr-space-3\);[\s\S]*background: var\(--sr-color-surface-table-row\);/,
  );
  assert.match(
    styles,
    /\.rowIdentityMobile\[data-mobile-identity-kind="ticker"\] \{[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*font-weight: 800;[\s\S]*letter-spacing: 0\.02em;[\s\S]*\.rowIdentityMobile\[data-mobile-identity-kind="market"\] \{[\s\S]*font-family: var\(--sr-font-family-sans\);[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*font-weight: 700;[\s\S]*\.rowHeadline \{[\s\S]*font-size: 18px;[\s\S]*font-weight: 650;[\s\S]*\.rowMobileBadges \.newsEventTypeBadge \{[\s\S]*font-family: var\(--sr-font-family-sans\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: 650;[\s\S]*text-transform: none;/,
  );
  assert.match(
    styles,
    /\.rowMobileFooter \{[\s\S]*grid-column: 1 \/ 3;[\s\S]*grid-row: 3;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.rowQuote \{[\s\S]*display: flex;[\s\S]*min-width: max-content;[\s\S]*grid-column: 3;[\s\S]*grid-row: 3;[\s\S]*align-items: baseline;[\s\S]*gap: var\(--sr-space-1\);[\s\S]*white-space: nowrap;[\s\S]*\.rowQuote > span:not\(\.rowDataUnavailable\) \{[\s\S]*font-size: 15px;[\s\S]*\.rowQuoteUnavailable \{[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.rowSource \{[\s\S]*color: var\(--sr-color-text-muted\);[\s\S]*font-family: var\(--sr-font-family-sans\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*\.rowSource::before \{[\s\S]*margin: 0 var\(--sr-space-1\);[\s\S]*content: "·";[\s\S]*\.rowMobilePublishedAt \{[\s\S]*color: var\(--sr-color-text-muted\);[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*\.rowSentiment \{[\s\S]*font-size: 16px;[\s\S]*font-weight: 700;[\s\S]*\.rowScore strong \{[\s\S]*font-size: 16px;[\s\S]*font-weight: 600;/,
  );
  assert.match(
    rowSource,
    /data-mobile-identity-kind=\{identity\.kind\}/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.rowIdentity,[\s\S]*?\.rowStory \{[\s\S]*?display: contents;[\s\S]*?\.rowIdentity > span \{[\s\S]*?display: none;/,
  );
  assert.match(
    rowSource,
    /className=\{styles\.rowMobilePublishedAt\}[\s\S]*\{formatMarketDateLabel\(item\.publishedAt, referenceDate\)\}\{" "\}[\s\S]*\{formatNewsV2PublishedAt\(item\.publishedAt, "time"\)\}/,
  );
  assert.doesNotMatch(rowSource, /rowMobileDate|rowMobileTime/);
  assert.doesNotMatch(styles, /\.rowMobileDate::after/);
  assert.match(
    styles,
    /\.liveListIndicator,[\s\S]*\.mobileFilterSheetContent header > span,[\s\S]*\.premiumCtaMobile \.premiumCtaCopy > span \{[\s\S]*font-size: var\(--sr-font-size-sm\);/,
  );
  assert.match(
    styles,
    /\.mobileFilterActions \.mobileFilterTrigger \{[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*\.mobileFilterActions \.mobileFilterTrigger > span:first-child \{[\s\S]*font-size: var\(--sr-font-size-md\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*\.newsMobileFilterSurface \{[\s\S]*scrollbar-gutter: auto;[\s\S]*\.mobileFilterGroup > div > button \{[\s\S]*min-height: 44px;[\s\S]*font-size: var\(--sr-font-size-lg\);/,
  );
});

test("all event news price charts reuse the accessible mobile disclosure", () => {
  const eventPageSource = readFileSync(
    new URL("../app/events/[id]/page.tsx", import.meta.url),
    "utf8",
  );
  const adapterSource = readFileSync(
    new URL("../components/news-analysis-v2/NewsAnalysisAdapter.tsx", import.meta.url),
    "utf8",
  );
  const chartSource = readFileSync(
    new URL("../app/events/[id]/PriceChartCard.tsx", import.meta.url),
    "utf8",
  );
  const eventChartCalls = eventPageSource.match(/<PriceChartCard[\s\S]*?\/>/g) ?? [];
  const adapterChartCalls = adapterSource.match(/<PriceChartCard[\s\S]*?\/>/g) ?? [];

  assert.equal(eventChartCalls.length, 2);
  assert.equal(adapterChartCalls.length, 1);
  for (const call of [...eventChartCalls, ...adapterChartCalls]) {
    assert.match(call, /mobileCollapsible/);
  }
  assert.match(eventPageSource, /function NewsDilutionOfferingTemplate/);
  assert.match(chartSource, /const \[isMobileChartExpanded, setIsMobileChartExpanded\] = useState\(false\)/);
  assert.match(chartSource, /aria-controls=\{mobileChartRegionId\}/);
  assert.match(chartSource, /aria-expanded=\{isMobileChartExpanded\}/);
  assert.match(chartSource, /isMobileChartExpanded \? "Hide chart" : "Show chart"/);
});

test("news rows keep event classification separate from publisher source", () => {
  const rowSource = readFileSync(
    new URL("../components/news-v2/NewsV2Row.tsx", import.meta.url),
    "utf8",
  );
  const dataSource = readFileSync(new URL("./newsV2Data.ts", import.meta.url), "utf8");
  const styleSource = readFileSync(
    new URL("../components/news-v2/StockRadarNewsV2.module.css", import.meta.url),
    "utf8",
  );

  assert.match(
    rowSource,
    /className=\{styles\.rowEventTypeBadgeMobile\}[\s\S]*?eventType=\{item\.eventType\}[\s\S]*?eventTypeCode=\{item\.eventTypeCode\}/,
  );
  assert.match(
    rowSource,
    /className=\{styles\.rowMobileFooter\}[\s\S]*?className=\{styles\.rowSource\}>\{item\.source\}<\/span>/,
  );
  assert.match(
    rowSource,
    /className=\{styles\.rowEventTypeBadgeDesktop\}[\s\S]*?className=\{styles\.rowMobileFooter\}[\s\S]*?\{item\.source\}/,
  );
  assert.match(rowSource, /const identity = getEventListIdentity\(\{/);
  assert.match(rowSource, /companyName: item\.companyName,/);
  assert.match(rowSource, /marketScope: item\.marketScope,/);
  assert.match(rowSource, /\{identity\.primary\}/);
  assert.match(rowSource, /\{identity\.secondary\}/);
  assert.equal(
    (rowSource.match(/\{identity\.primary\}/g) ?? []).length,
    2,
    "desktop and mobile identities must render the same normalized primary text",
  );
  assert.doesNotMatch(rowSource, /marketCapBand|identityMeta|item\.source\s*\|\|/);
  assert.match(dataSource, /const eventTypeCode = readString\(row\.event_type\) \|\| "event";/);
  assert.match(dataSource, /source: readString\(row\.source\) \|\| "Unknown",/);
  assert.match(
    dataSource,
    /readNewsCompanyNameMap\([\s\S]*item\.marketScope === "company"[\s\S]*item\.eventTypeCode !== "macro_market"[\s\S]*item\.eventTypeCode !== "policy_regulation"[\s\S]*\.map\(\(item\) => item\.id\)/,
  );
  assert.match(dataSource, /select: "id,metadata,source_code,source_name"/);
  assert.match(dataSource, /const companyName = resolveNewsCompanyName\(\{/);
  assert.match(dataSource, /configuredSourceName: readString\(row\?\.source_name\)/);
  assert.doesNotMatch(
    dataSource,
    /companyName\s*=\s*[^;]*item\.source|companyName:\s*readString\(row\.source\)/,
  );
  assert.match(
    dataSource,
    /eventType: getEventTypeBadge\(eventTypeCode\)\.label,[\s\S]*?eventTypeCode,/,
  );
  assert.doesNotMatch(dataSource, /source:\s*getEventTypeBadge\(/);
  assert.match(styleSource, /\.rowSource::before \{[\s\S]*?content: "·";/);
  assert.match(
    styleSource,
    /@media \(max-width: 760px\)[\s\S]*?\.rowIdentity > span \{[\s\S]*?display: none;/,
  );
});

test("news company identity restores the real EA issuer without accepting provider names", () => {
  const rawPayload = {
    provider: "Nasdaq Trader",
    source_name: "Nasdaq Trader",
    analysis_text: "Electronic Arts Inc. completed a strategic transaction.",
    corporate_action: {
      company_name: "Electronic Arts Inc.",
      symbol: "EA",
    },
  };

  const companyName = resolveNewsCompanyName({
      configuredSourceName: "Nasdaq Corporate Actions",
      rawPayload,
      sourceCode: "nasdaq_corporate_actions",
      title: "Equity Corporate Actions Alert",
    });
  assert.equal(companyName, "Electronic Arts Inc.");
  assert.deepEqual(
    getEventListIdentity({
      companyName,
      eventType: "strategic_transaction",
      marketScope: "company",
      ticker: "EA",
    }),
    { kind: "ticker", primary: "EA", secondary: "Electronic Arts Inc." },
  );
  assert.equal(
    resolveNewsCompanyName({
      configuredSourceName: "Nasdaq Corporate Actions",
      rawPayload: {
        provider: "Nasdaq Trader",
        source_name: "Nasdaq Trader",
      },
      sourceCode: "nasdaq_corporate_actions",
    }),
    null,
  );
  assert.equal(
    resolveNewsCompanyName({
      configuredSourceName: "Nasdaq Corporate Actions",
      rawPayload: {
        company_name: "Nasdaq Trader",
        provider: "Nasdaq Trader",
        source_name: "Nasdaq Trader",
      },
      sourceCode: "nasdaq_corporate_actions",
    }),
    null,
  );
});

test("Nasdaq corporate-action repair is narrow, repeatable, and preserves stored source fields", () => {
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20260803060000_nasdaq_corporate_action_company_repair.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(migration, /e\.source_group = 'news'/);
  assert.match(migration, /e\.source_code = 'nasdaq_corporate_actions'/);
  assert.match(migration, /r\.source_code = 'nasdaq_corporate_actions'/);
  assert.match(migration, /\{corporate_action,company_name\}/);
  assert.match(migration, /e\.metadata ->> 'issuer'[\s\S]*r\.raw_payload ->> 'source_name'/);
  assert.match(migration, /'\{issuer\}'[\s\S]*'\{company_name\}'/);
  assert.match(migration, /when 'nasdaq_corporate_actions' then 'Nasdaq Trader'/);
  assert.doesNotMatch(migration, /1f610868-891b-407b-ab6e-eba19a491871/);
  assert.doesNotMatch(migration, /set[\s\S]{0,120}source_name\s*=/i);
});

test("mobile news premium CTA is a flat list row while desktop keeps its premium card", () => {
  const styles = readFileSync(
    new URL(
      "../components/news-v2/StockRadarNewsV2.module.css",
      import.meta.url,
    ),
    "utf8",
  );
  const mobileRule = [...styles.matchAll(/\.premiumCtaMobile\s*\{[^}]*\}/g)].at(-1)?.[0] ?? "";

  assert.match(
    mobileRule,
    /display: block;[\s\S]*min-width: 0;[\s\S]*min-height: 0;[\s\S]*margin: 0;[\s\S]*border: 0;[\s\S]*border-bottom: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: 0;[\s\S]*padding: var\(--sr-space-4\) var\(--sr-space-3\);[\s\S]*background: var\(--sr-color-surface-table-row\);[\s\S]*box-shadow: none;/,
  );
  assert.doesNotMatch(mobileRule, /border-top|gradient|accent-border-premium/);
  assert.match(styles, /\.premiumCtaMobileItem \{[\s\S]*background: var\(--sr-color-surface-table-row\);/);
  assert.match(
    styles,
    /\.premiumCtaMobile \.premiumCtaCopy \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*align-items: center;[\s\S]*column-gap: var\(--sr-space-3\);[\s\S]*\.premiumCtaMobile \.premiumCtaCopy > span \{[\s\S]*font-size: var\(--sr-font-size-sm\);[\s\S]*font-weight: var\(--sr-font-weight-label\);[\s\S]*line-height: var\(--sr-line-height-none\);[\s\S]*\.premiumCtaMobile \.premiumCtaCopy strong \{[\s\S]*font: 700 16px \/ 1\.25 var\(--sr-font-family-sans\);[\s\S]*\.premiumCtaMobile \.premiumCtaCopy p \{[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-regular\);[\s\S]*line-height: 1\.4;/,
  );
  assert.match(
    styles,
    /\.premiumCtaMobile \.premiumCtaLink \{[\s\S]*grid-row: 1 \/ 4;[\s\S]*min-height: 40px;[\s\S]*align-self: center;[\s\S]*padding: 0 var\(--sr-space-3\);[\s\S]*background: var\(--sr-color-surface-primary-action\);[\s\S]*font: 700 var\(--sr-font-size-base\) \/ var\(--sr-line-height-none\)[\s\S]*\.premiumCtaMobile \.premiumCtaLinkIcon,[\s\S]*display: none;/,
  );
  assert.match(
    styles,
    /\.premiumCta \{[\s\S]*min-height: 152px;[\s\S]*var\(--sr-color-accent-cta-top\)[\s\S]*box-shadow: var\(--sr-shadow-cta\);/,
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

test("news mobile insight rail is a flat, readable three-section stream", () => {
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
  const mobileStart = styles.indexOf("@media (max-width: 760px)");
  const mobileEnd = styles.indexOf("@media (max-width: 340px)", mobileStart);

  assert.notEqual(mobileStart, -1);
  assert.notEqual(mobileEnd, -1);

  const mobileStyles = styles.slice(mobileStart, mobileEnd);
  const desktopInsightCard =
    styles.match(/(?:^|\n)\.insightCard \{[^}]*\}/)?.[0] ?? "";
  const mobileInsightCard =
    mobileStyles.match(/(?:^|\n)  \.insightCard \{[^}]*\}/)?.[0] ?? "";
  const insightCardSections = [
    ...railSource.matchAll(
      /<section className=\{`\$\{styles\.insightCard\} \$\{styles\.(\w+)\}`\}>/g,
    ),
  ].map((match) => match[1]);

  assert.deepEqual(insightCardSections, [
    "marketNewsRailCard",
    "sectorRailCard",
    "themeRailCard",
  ]);
  assert.equal((railSource.match(/styles\.insightCard/g) ?? []).length, 3);
  assert.match(railSource, /<h2>Market News Radar<\/h2>/);
  assert.match(railSource, /<h2>Sector Performance Radar<\/h2>/);
  assert.match(railSource, /<h2>Trending Signal Map<\/h2>/);

  assert.match(
    desktopInsightCard,
    /overflow: hidden;[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: var\(--sr-radius-base\);[\s\S]*background: var\(--sr-color-surface-panel\);[\s\S]*box-shadow: var\(--sr-shadow-panel\);/,
  );
  assert.match(
    mobileInsightCard,
    /overflow: visible;[\s\S]*border: 0;[\s\S]*border-bottom: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
  );
  assert.doesNotMatch(mobileInsightCard, /surface-panel|shadow-panel/);
  assert.match(
    mobileStyles,
    /\.insightRailContent \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*gap: 0;/,
  );
  assert.match(
    mobileStyles,
    /\.insightHeader \{[^}]*box-sizing: border-box;[^}]*width: calc\(100% \+ \(var\(--sr-page-gutter-mobile\) \* 2\)\);[^}]*margin-inline: calc\(var\(--sr-page-gutter-mobile\) \* -1\);[^}]*padding: var\(--sr-space-3\) var\(--sr-page-gutter-mobile\);[^}]*background: var\(--sr-color-surface-control-strong\);/,
  );
  const mobileInsightHeader =
    mobileStyles.match(/\.insightHeader \{[^}]*\}/)?.[0] ?? "";
  assert.doesNotMatch(mobileInsightHeader, /linear-gradient/);
  const desktopInsightHeader =
    styles.match(/^\.insightHeader \{[^}]*\}/m)?.[0] ?? "";
  assert.doesNotMatch(desktopInsightHeader, /surface-control-strong/);
  assert.match(
    mobileStyles,
    /\.insightHeader > div > span \{[^}]*font-size: var\(--sr-font-size-sm\);/,
  );
  assert.match(
    mobileStyles,
    /\.insightHeader h2 \{[^}]*font-size: var\(--sr-font-size-2xl\);[^}]*font-weight: var\(--sr-font-weight-semibold\);[^}]*line-height: var\(--sr-line-height-control\);/,
  );
  assert.match(
    mobileStyles,
    /\.insightHeader p \{[^}]*font-size: var\(--sr-font-size-base\);[^}]*line-height: 1\.4;/,
  );
  assert.match(
    mobileStyles,
    /\.rangeTabs button \{[^}]*min-height: 36px;[^}]*font-size: var\(--sr-font-size-base\);/,
  );
  assert.match(
    mobileStyles,
    /\.sourceActivityList,[\s\S]*?\.themeSignalList,[\s\S]*?\.sectorMap \{[^}]*padding-inline: 0;/,
  );
  assert.match(
    mobileStyles,
    /\.sourceActivityList > \.detailEmptyMeta,[\s\S]*?\.themeSignalList > \.detailEmptyMeta,[\s\S]*?\.industryTable > \.detailEmptyMeta,[\s\S]*?\.insightCard > \.detailEmptyMeta \{[^}]*margin: 0;[^}]*padding: var\(--sr-space-4\) 0;/,
  );
  assert.match(
    mobileStyles,
    /\.sourceActivityActions \{[^}]*padding-right: 0;[^}]*padding-left: 0;/,
  );
  assert.match(
    mobileStyles,
    /\.sourceActivityRow \{[^}]*min-height: 48px;[\s\S]*?\.sourceActivityRow strong,[\s\S]*?\.sourceActivityRow b \{[^}]*font-size: var\(--sr-font-size-base\);[^}]*font-weight: var\(--sr-font-weight-semibold\);[\s\S]*?\.sourceActivityRow span \{[^}]*font-size: var\(--sr-font-size-md\);[\s\S]*?\.sourceActivityActions button \{[^}]*font-size: var\(--sr-font-size-base\);/,
  );
  assert.match(
    mobileStyles,
    /\.sectorMap \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*?\.sectorMap button \{[^}]*min-height: 48px;[^}]*padding-block: var\(--sr-space-2\);[\s\S]*?\.sectorMap button strong \{[^}]*font-size: var\(--sr-font-size-sm\);[^}]*font-weight: 650;[\s\S]*?\.sectorMap button span \{[^}]*font-size: var\(--sr-font-size-base\);[^}]*font-weight: var\(--sr-font-weight-semibold\);/,
  );
  assert.match(
    mobileStyles,
    /\.industryTableHeader,[\s\S]*?\.industryMoverChips span \{[^}]*font-size: var\(--sr-font-size-md\);/,
  );
  assert.match(
    mobileStyles,
    /\.themeSignalRow summary \{[^}]*padding: var\(--sr-space-4\) 0;[\s\S]*?\.themeSignalTopline strong \{[^}]*font-size: 16px;[^}]*font-weight: var\(--sr-font-weight-semibold\);[\s\S]*?\.themeSignalMetrics,[\s\S]*?\.themeExpandCue \{[^}]*font-size: var\(--sr-font-size-md\);/,
  );
  assert.match(
    mobileStyles,
    /\.themeSignalScore \{[^}]*flex-basis: 36px;[^}]*width: 36px;[^}]*min-width: 36px;[^}]*height: 36px;[^}]*min-height: 36px;[^}]*font-size: var\(--sr-font-size-2xl\);/,
  );
});

test("news feed rows use watchlist density, plain metadata, and a compact rail", () => {
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

  assert.match(
    styles,
    /\.workspace \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) 320px;/,
  );
  assert.match(
    styles,
    /\.newsRow \{[\s\S]*min-height: 82px;[\s\S]*gap: var\(--sr-space-3\);[\s\S]*padding: var\(--sr-space-2\) var\(--sr-space-4\);/,
  );
  assert.match(
    styles,
    /\.rowHeadline \{[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-semibold\);/,
  );
  assert.match(
    styles,
    /\.rowIdentity strong \{[\s\S]*font-family: var\(--sr-font-family-mono\);[\s\S]*font-size: var\(--sr-font-size-base\);[\s\S]*font-weight: var\(--sr-font-weight-heavy\);/,
  );
  assert.match(
    styles,
    /\.rowScore strong \{[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*font-weight: var\(--sr-font-weight-heavy\);/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.rowHeadline \{[\s\S]*?font-size: var\(--sr-font-size-sm\);[\s\S]*?font-weight: 600;[\s\S]*?line-height: var\(--sr-line-height-snug\);/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.rowTime \{[\s\S]*?font-size: var\(--sr-font-size-xs\);[\s\S]*?line-height: var\(--sr-line-height-default\);/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.rowBadges \.newsEventTypeBadge,[\s\S]*?\.rowBadges \.newsScopeBadge \{[\s\S]*?font-size: var\(--sr-font-size-xs\);[\s\S]*?font-weight: 600;/,
  );
  assert.match(
    styles,
    /@media \(min-width: 761px\) \{[\s\S]*?\.rowSentiment \{[\s\S]*?font-size: var\(--sr-font-size-xs\);[\s\S]*?font-weight: var\(--sr-font-weight-regular\);[\s\S]*?\.rowScore strong \{[\s\S]*?font-weight: 600;/,
  );
  for (const className of ["newsEventTypeBadge", "newsScopeBadge"]) {
    assert.match(
      styles,
      new RegExp(
        `\\.rowBadges \\.${className} \\{[\\s\\S]*border: 0;[\\s\\S]*border-radius: 0;[\\s\\S]*padding: 0;[\\s\\S]*background: transparent;`,
      ),
    );
  }
  assert.match(
    styles,
    /@media \(max-width: 1440px\) and \(min-width: 761px\) \{[\s\S]*?\.rowSparklineCell \{[\s\S]*?display: none;/,
  );
  assert.match(rowSource, /getEventListIdentity\(\{/);
  assert.match(rowSource, /className=\{styles\.rowIdentityMobile\}/);
  assert.match(rowSource, /data-mobile-identity-kind=\{identity\.kind\}/);
  assert.match(rowSource, /<span title=\{identity\.secondary\}>\{identity\.secondary\}<\/span>/);
  assert.doesNotMatch(rowSource, /\bMARKET\b/);
  const desktopIdentitySecondary =
    styles.match(/^\.rowIdentity span \{[^}]*\}/m)?.[0] ?? "";
  assert.match(desktopIdentitySecondary, /color: var\(--sr-color-text-secondary\);/);
  assert.doesNotMatch(desktopIdentitySecondary, /display: none;/);
  assert.ok(
    rowSource.indexOf("{hasChange ? (") <
      rowSource.indexOf("{hasPrice ? <strong>"),
    "quote DOM should expose change before price for mobile reading order",
  );
  assert.match(
    styles,
    /\.rowQuote strong \{[\s\S]*?order: 1;[\s\S]*?\.rowQuote > span:not\(\.rowDataUnavailable\) \{[\s\S]*?order: 2;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.newsRow \{[\s\S]*?min-height: 132px;[\s\S]*?grid-template-columns: minmax\(40px, auto\) minmax\(0, 1fr\) auto;[\s\S]*?grid-template-rows: auto auto auto;[\s\S]*?row-gap: 7px;[\s\S]*?padding: var\(--sr-space-4\) var\(--sr-space-3\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.rowIdentity,[\s\S]*?\.rowStory \{[\s\S]*?display: contents;[\s\S]*?\.rowIdentity > span \{[\s\S]*?display: none;[\s\S]*?\.rowIdentity strong \{[\s\S]*?grid-column: 1;[\s\S]*?grid-row: 1;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.rowHeadline \{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?grid-row: 2;[\s\S]*?font-size: 18px;[\s\S]*?font-weight: 650;[\s\S]*?line-height: 1\.4;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.newsRow \{[\s\S]*?min-height: 132px;[\s\S]*?\.rowHeadline \{[\s\S]*?-webkit-line-clamp: 2;[\s\S]*?\.rowQuote strong \{[\s\S]*?line-height: var\(--sr-line-height-none\);[\s\S]*?\.rowQuote > span:not\(\.rowDataUnavailable\) \{[\s\S]*?line-height: var\(--sr-line-height-none\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.rowSentiment \{[\s\S]*?font-size: 16px;[\s\S]*?line-height: var\(--sr-line-height-none\);[\s\S]*?\.rowScore \{[\s\S]*?line-height: var\(--sr-line-height-none\);[\s\S]*?\.rowScore strong \{[\s\S]*?font-size: 16px;[\s\S]*?line-height: var\(--sr-line-height-none\);/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.rowQuote \{[\s\S]*?display: flex;[\s\S]*?\.rowQuote strong \{[\s\S]*?order: 2;[\s\S]*?\.rowQuote > span:not\(\.rowDataUnavailable\) \{[\s\S]*?order: 1;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.rowQuoteUnavailable \{[\s\S]*?display: none;/,
  );
});

test("product header switches to its mobile navigation at the integrated breakpoint", () => {
  const styles = readFileSync(
    new URL(
      "../components/shell/StockRadarProductHeader.module.css",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    styles,
    /@media \(max-width: 820px\) \{[\s\S]*?\.primaryNavigation \{[\s\S]*?display: none;[\s\S]*?\.actions \.mobileMenuButton \{[\s\S]*?display: flex;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 760px\) \{[\s\S]*?\.header \{[\s\S]*?height: var\(--sr-size-header\);[\s\S]*?padding: 0 var\(--sr-space-3-5\);/,
  );
});

test("news migration keeps page bounds, indexed search, real-time ET ranges, and service-only RPCs", () => {
  const migration = readFileSync(
    new URL(
      "../docs/db/migration-archive/pre-canonical-baseline/20260725015421_news_v2_filtered_stats_and_search_indexes.sql",
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
  assert.match(dataSource, /readHydratedMarketQuoteMap\(symbols\)/);
  assert.match(dataSource, /readMarketBarCacheMap\(symbols, "1D"\)/);
  assert.match(dataSource, /unstable_cache/);
  assert.match(dataSource, /revalidate: 300/);
  assert.match(dataSource, /newsV2StatisticsCacheSeconds = 15/);
  assert.match(dataSource, /includeTotal && !cursor/);
});

test("News V2 market score policy is shared by rows, stats, and facets", () => {
  const migration = readFileSync(
    new URL(
      "../docs/db/migration-archive/pre-canonical-baseline/20260725215634_news_v2_market_score_threshold.sql",
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
