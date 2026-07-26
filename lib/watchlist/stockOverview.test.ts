import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { moveTickerSearchIndex } from "../tickerSearchNavigation.ts";
import {
  getStockRouteHref,
  hasStockOverviewData,
  mapStockOverviewChart,
  mapStockOverviewEvents,
  mapStockOverviewProfile,
  mapStockOverviewQuote,
  normalizeStockTicker,
  resolveStockOverviewTicker,
  resolveWatchlistTicker,
  selectStockOverviewEvents,
} from "./stockOverview.ts";

test("URL ticker selects a saved item and otherwise falls back to the first saved item", () => {
  assert.equal(resolveWatchlistTicker(" amd ", ["NVDA", "AMD"]), "AMD");
  assert.equal(resolveWatchlistTicker("TSLA", ["NVDA", "AMD"]), "NVDA");
  assert.equal(resolveWatchlistTicker(undefined, ["NVDA", "AMD"]), "NVDA");
  assert.equal(resolveWatchlistTicker("AMD", []), null);
});

test("stock routes accept safe tickers without requiring a saved watchlist item", () => {
  assert.equal(normalizeStockTicker(" amd "), "AMD");
  assert.equal(normalizeStockTicker("BRK.B"), "BRK.B");
  assert.equal(normalizeStockTicker("NVDA<script>"), null);
  assert.equal(normalizeStockTicker("A/B"), null);
  assert.equal(normalizeStockTicker("A".repeat(13)), null);
  assert.equal(getStockRouteHref(" brk.b "), "/stocks/BRK.B");
  assert.equal(getStockRouteHref("A/B"), null);
  assert.equal(
    resolveStockOverviewTicker("TSLA", ["NVDA", "AMD"], "stock"),
    "TSLA",
  );
  assert.equal(
    resolveStockOverviewTicker("TSLA", ["NVDA", "AMD"], "watchlist"),
    "NVDA",
  );
});

test("header search arrow navigation wraps without selecting an invalid index", () => {
  assert.equal(moveTickerSearchIndex(-1, 3, "ArrowDown"), 0);
  assert.equal(moveTickerSearchIndex(-1, 3, "ArrowUp"), 2);
  assert.equal(moveTickerSearchIndex(2, 3, "ArrowDown"), 0);
  assert.equal(moveTickerSearchIndex(0, 3, "ArrowUp"), 2);
  assert.equal(moveTickerSearchIndex(0, 0, "ArrowDown"), -1);
});

test("overview availability requires real profile, quote, or event data", () => {
  const emptyProfile = mapStockOverviewProfile({});
  const emptyQuote = mapStockOverviewQuote({});
  assert.equal(hasStockOverviewData(emptyProfile, emptyQuote, []), false);
  assert.equal(
    hasStockOverviewData(
      mapStockOverviewProfile({ data: [{ companyName: "AMD" }] }),
      emptyQuote,
      [],
    ),
    true,
  );
  assert.equal(
    hasStockOverviewData(
      emptyProfile,
      mapStockOverviewQuote({ data: [{ price: 100 }] }),
      [],
    ),
    true,
  );
});

test("profile and quote mappers keep real values and preserve missing values as null", () => {
  const profile = mapStockOverviewProfile({
    ok: true,
    data: [
      {
        companyName: "Advanced Micro Devices, Inc.",
        exchangeShortName: "NASDAQ",
        industry: "Semiconductors",
        mktCap: 301_000_000_000,
        sector: "Technology",
        website: "https://www.amd.com/",
      },
    ],
  });
  const quote = mapStockOverviewQuote({
    ok: true,
    data: [{ change: 2.4, changesPercentage: 1.25, price: 194.2 }],
  });

  assert.equal(profile.companyName, "Advanced Micro Devices, Inc.");
  assert.equal(profile.exchange, "NASDAQ");
  assert.equal(profile.marketCap, 301_000_000_000);
  assert.equal(quote.price, 194.2);
  assert.equal(quote.changePercent, 1.25);
  assert.equal(quote.dayHigh, null);
});

test("chart mapper rejects incomplete points instead of inventing a line", () => {
  assert.deepEqual(
    mapStockOverviewChart({
      points: [
        { close: 10, high: 11, low: 9, open: 9.5, time: "9:30 AM", volume: 12 },
        { close: null, high: 12, low: 10, open: 11, time: "9:35 AM" },
      ],
    }),
    [
      {
        close: 10,
        high: 11,
        low: 9,
        open: 9.5,
        time: "9:30 AM",
        volume: 12,
      },
    ],
  );
});

test("event mapper creates real analysis routes only for persistent UUIDs and applies score tones", () => {
  const events = mapStockOverviewEvents({
    data: [
      {
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd1",
        ticker: "AMD",
        source_group: "news",
        source_code: "reuters",
        event_type: "earnings",
        score: 75,
        signal: "bullish",
        title: "Company raises guidance",
        summary: "Guidance moved higher.",
        detected_at: "2026-07-25T14:30:00Z",
      },
      {
        id: "synthetic-AMD-2026",
        ticker: "AMD",
        source_group: "filings",
        event_type: "offering",
        score: 74,
        signal: "bearish",
        title: "Registration statement",
        detected_at: "2026-07-24T14:30:00Z",
      },
    ],
  });

  assert.equal(
    events[0]?.detailHref,
    "/events/4b51454b-c7ca-4bc9-96a5-3a55390acdd1",
  );
  assert.equal(events[0]?.scoreTone, "bullish");
  assert.equal(events[1]?.detailHref, null);
  assert.equal(events[1]?.scoreTone, "default");
  assert.equal(selectStockOverviewEvents(events, "financials").length, 1);
  assert.equal(selectStockOverviewEvents(events, "dilution").length, 1);
});

test("watchlist page preserves auth/API contracts and uses the current product shell", async () => {
  const [
    pageSource,
    stockPageSource,
    componentSource,
    componentCss,
    headerSource,
    headerSearchSource,
    headerCss,
    addRoute,
    deleteRoute,
  ] = await Promise.all([
    readFile(new URL("../../app/watchlist/page.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../../app/stocks/[ticker]/page.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../../components/watchlist-v2/StockRadarWatchlistV2.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../components/watchlist-v2/StockRadarWatchlistV2.module.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../components/shell/StockRadarProductHeader.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../components/shell/StockRadarTickerSearch.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../components/shell/StockRadarProductHeader.module.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../../app/api/watchlist/route.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../../app/api/watchlist/[ticker]/route.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(pageSource, /getOptionalCurrentUserId/);
  assert.match(pageSource, /getWatchlistViewModel/);
  assert.match(componentSource, /StockRadarAppShell/);
  assert.match(componentSource, /\/api\/watchlist/);
  assert.match(componentSource, /method: "POST"/);
  assert.match(componentSource, /method: "DELETE"/);
  assert.match(componentSource, /payload\.persisted === false/);
  assert.match(componentSource, /viewport="tablet"/);
  assert.match(componentSource, /viewerPlan|watchlist\.plan === "free"/);
  assert.match(componentSource, /selectionMode === "stock"/);
  assert.match(componentSource, /getStockRouteHref\(ticker\)/);
  assert.match(componentSource, /isSaved \? "Watching" : "Add to Watchlist"/);
  assert.match(componentSource, /Ticker unavailable/);
  assert.match(componentSource, /"Stock research workspace"/);
  assert.match(componentSource, /"Stock Overview"/);
  assert.match(componentSource, /"Personal market workspace"/);
  assert.match(
    componentCss,
    /@media \(max-width: 760px\) \{[\s\S]*\.stockActions \{[\s\S]*display: grid;[\s\S]*grid-column: 1 \/ -1;/,
  );
  assert.match(
    componentCss,
    /\.sectionNavigation \{[\s\S]*position: sticky;[\s\S]*top: 0;[\s\S]*width: 100%;[\s\S]*max-width: 100%;[\s\S]*height: var\(--watchlist-section-navigation-height\);[\s\S]*background: var\(--sr-color-surface-panel\);[\s\S]*box-shadow: var\(--sr-shadow-header\);/,
  );
  assert.match(
    componentCss,
    /\.section \{[\s\S]*scroll-margin-top:[\s\S]*var\(--watchlist-section-navigation-height\)[\s\S]*var\(--sr-space-3\)/,
  );
  assert.match(
    componentCss,
    /@media \(max-width: 1120px\) \{[\s\S]*\.sectionNavigation \{[\s\S]*top: var\(--sr-size-header\);[\s\S]*\.section \{[\s\S]*scroll-margin-top:[\s\S]*var\(--sr-size-header\)[\s\S]*var\(--watchlist-section-navigation-height\)[\s\S]*var\(--sr-space-3\)/,
  );
  assert.match(
    componentCss,
    /\.sectionNavigation a\[aria-current="location"\],[\s\S]*\.sectionNavigation a\[aria-current="location"\]:hover \{[\s\S]*border-color: transparent;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
  );
  assert.match(
    componentCss,
    /\.sectionNavigation a\[aria-current="location"\]::after \{[\s\S]*height: 2px;[\s\S]*background: var\(--sr-color-accent\);/,
  );
  assert.match(
    componentCss,
    /\.eventToolbar \[role="tab"\]\[aria-selected="true"\],[\s\S]*\.eventToolbar \[role="tab"\]\[aria-selected="true"\]:hover \{[\s\S]*border-color: transparent;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
  );
  assert.match(
    componentCss,
    /\.eventToolbar \[role="tab"\]\[aria-selected="true"\]::after \{[\s\S]*height: 2px;[\s\S]*background: var\(--sr-color-accent\);/,
  );
  assert.match(
    componentCss,
    /\.rangeControl button\[aria-checked="true"\] \{[\s\S]*border-color: var\(--sr-color-accent-border-active\);[\s\S]*background: var\(--sr-color-accent-selected\);/,
  );
  assert.match(componentSource, /aria-current=\{[\s\S]*"location"/);
  assert.match(componentSource, /getStockSectionIdFromHash/);
  assert.match(componentSource, /window\.location\.hash/);
  assert.match(componentSource, /window\.requestAnimationFrame/);
  assert.match(
    componentSource,
    /window\.addEventListener\("scroll", scheduleActiveSectionUpdate, \{[\s\S]*passive: true/,
  );
  assert.match(
    componentSource,
    /window\.addEventListener\("hashchange", handleHashChange\)/,
  );
  assert.match(componentSource, /window\.cancelAnimationFrame/);
  assert.doesNotMatch(
    componentCss,
    /\.stockActions,\s*\.stockIdentity p\s*\{\s*display: none;/,
  );
  assert.match(stockPageSource, /normalizeStockTicker/);
  assert.match(stockPageSource, /selectionMode="stock"/);
  assert.match(stockPageSource, /notFound\(\)/);
  assert.match(stockPageSource, /alternates: \{ canonical:/);
  assert.match(headerSource, /StockRadarTickerSearch/);
  assert.match(headerSearchSource, /220/);
  assert.match(headerSearchSource, /AbortController/);
  assert.match(headerSearchSource, /role="combobox"/);
  assert.match(headerSearchSource, /role="listbox"/);
  assert.match(headerSearchSource, /ArrowDown/);
  assert.match(headerSearchSource, /ArrowUp/);
  assert.match(headerSearchSource, /event\.key === "Escape"/);
  assert.match(headerSearchSource, /moveTickerSearchIndex/);
  assert.match(headerSearchSource, /router\.push\(href\)/);
  assert.match(headerCss, /@media \(max-width: 1120px\)/);
  assert.match(
    headerCss,
    /@media \(max-width: 1120px\) \{[\s\S]*\.header \{[\s\S]*position: sticky;[\s\S]*top: 0;[\s\S]*background: var\(--sr-color-surface-product-menu\);/,
  );
  assert.match(headerCss, /\.globalSearchPanel \{[\s\S]*position: fixed/);
  assert.match(headerCss, /left: var\(--sr-space-3\)/);
  assert.match(
    headerCss,
    /\.mobileMenuPopover \{[\s\S]*top: var\(--sr-size-header\);[\s\S]*max-height: calc\(100dvh - var\(--sr-size-header\) - var\(--sr-space-3\)\);[\s\S]*overflow-y: auto;[\s\S]*overscroll-behavior: contain;/,
  );
  assert.match(
    headerCss,
    /@media \(max-width: 760px\) \{[\s\S]*\.header \{[\s\S]*height: var\(--sr-size-header\);[\s\S]*padding: 0 var\(--sr-space-3-5\);/,
  );
  assert.match(
    headerSource,
    /const previousBodyOverflow = body\.style\.overflow;/,
  );
  assert.match(
    headerSource,
    /const previousBodyPaddingRight = body\.style\.paddingRight;/,
  );
  assert.match(
    headerSource,
    /const scrollbarWidth = window\.innerWidth - document\.documentElement\.clientWidth;/,
  );
  assert.match(
    headerSource,
    /body\.style\.paddingRight = `calc\(\$\{bodyPaddingRight\} \+ \$\{scrollbarWidth\}px\)`;/,
  );
  assert.match(headerSource, /body\.style\.overflow = "hidden";/);
  assert.match(headerSource, /body\.style\.overflow = previousBodyOverflow;/);
  assert.match(
    headerSource,
    /body\.style\.paddingRight = previousBodyPaddingRight;/,
  );
  assert.doesNotMatch(headerSource, /documentElement\.style\.overflow = "hidden"/);
  assert.match(
    headerCss,
    /\.globalSearchClose svg \{[\s\S]*width: 17px;[\s\S]*flex: 0 0 17px;/,
  );
  assert.match(addRoute, /persisted: false/);
  assert.match(addRoute, /DUPLICATE_TICKER/);
  assert.match(addRoute, /assertWatchlistLimit/);
  assert.match(deleteRoute, /persisted: false/);
});
