import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { moveTickerSearchIndex } from "../tickerSearchNavigation.ts";
import {
  getStockRouteHref,
  getStockOverviewEventsApiHref,
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
    getStockOverviewEventsApiHref(" brk.b "),
    "/api/events?ticker=BRK.B&limit=50&include_archive=true",
  );
  assert.equal(getStockOverviewEventsApiHref("A/B"), null);
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

test("event mapper creates canonical detail routes only for persistent UUIDs and applies score tones", () => {
  const events = mapStockOverviewEvents({
    data: [
      {
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd1",
        ticker: "AMD",
        source_group: "news",
        source_code: "reuters",
        event_type: "earnings",
        delivery_level: "alert",
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
        delivery_level: "feed",
        score: 74,
        signal: "bearish",
        title: "Registration statement",
        detected_at: "2026-07-24T14:30:00Z",
      },
      {
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd6",
        ticker: "AMD",
        source_group: "news",
        event_type: "earnings",
        delivery_level: " ARCHIVE ",
        score: 49,
        title: "Routine company update",
        detected_at: "2026-07-23T14:30:00Z",
      },
      {
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd7",
        ticker: "AMD",
        source_group: "filings",
        event_type: "ownership",
        delivery_level: "archive",
        score: 20,
        title: "Routine ownership filing",
        detected_at: "2026-07-22T14:30:00Z",
      },
      {
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd8",
        ticker: "AMD",
        source_group: "filings",
        event_type: "corporate_update",
        delivery_level: " FEED ",
        score: 50,
        title: "Material filing update",
        detected_at: "2026-07-21T14:30:00Z",
      },
      {
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd9",
        ticker: "AMD",
        source_group: "news",
        event_type: "corporate_update",
        delivery_level: "unexpected",
        score: 10,
        title: "Event with invalid delivery metadata",
        detected_at: "2026-07-20T14:30:00Z",
      },
      {
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdda",
        ticker: "AMD",
        source_group: "filings",
        event_type: "corporate_update",
        score: 10,
        title: "Event without delivery metadata",
        detected_at: "2026-07-19T14:30:00Z",
      },
    ],
  });

  assert.equal(
    events[0]?.detailHref,
    "/events/4b51454b-c7ca-4bc9-96a5-3a55390acdd1",
  );
  assert.equal(events[0]?.scoreTone, "bullish");
  assert.equal(events[0]?.deliveryLevel, "alert");
  assert.equal(events[1]?.detailHref, null);
  assert.equal(events[1]?.scoreTone, "default");
  assert.equal(
    events[2]?.detailHref,
    "/news/archive/4b51454b-c7ca-4bc9-96a5-3a55390acdd6",
  );
  assert.equal(events[2]?.deliveryLevel, "archive");
  assert.equal(
    events[3]?.detailHref,
    "/filings/archive/4b51454b-c7ca-4bc9-96a5-3a55390acdd7",
  );
  assert.equal(
    events[4]?.detailHref,
    "/filings/4b51454b-c7ca-4bc9-96a5-3a55390acdd8",
  );
  assert.equal(events[4]?.deliveryLevel, "feed");
  assert.equal(
    events[5]?.detailHref,
    "/events/4b51454b-c7ca-4bc9-96a5-3a55390acdd9",
  );
  assert.equal(events[5]?.deliveryLevel, null);
  assert.equal(
    events[6]?.detailHref,
    "/filings/4b51454b-c7ca-4bc9-96a5-3a55390acdda",
  );
  assert.equal(events[6]?.deliveryLevel, null);
  assert.equal(selectStockOverviewEvents(events, "financials").length, 2);
  assert.equal(selectStockOverviewEvents(events, "dilution").length, 1);
});

test("classifies direct dilution forms and contextual 8-K/6-K filings without treating every current report as dilution", () => {
  const events = mapStockOverviewEvents({
    data: [
      {
        detected_at: "2026-07-24T14:30:00Z",
        event_type: "registration",
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd2",
        metadata: { form_type: "S-1" },
        source_group: "filings",
        ticker: "MULN",
        title: "Registration statement",
      },
      {
        detected_at: "2026-07-23T14:30:00Z",
        event_type: "financing",
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd3",
        metadata: { form_type: "8-K" },
        source_group: "filings",
        summary: "Company entered a convertible financing with warrants.",
        ticker: "MULN",
        title: "Financing agreement",
      },
      {
        detected_at: "2026-07-22T14:30:00Z",
        event_type: "leadership",
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd4",
        metadata: { form_type: "8-K" },
        source_group: "filings",
        ticker: "MULN",
        title: "Chief operating officer appointed",
      },
      {
        detected_at: "2026-07-21T14:30:00Z",
        event_type: "governance",
        id: "4b51454b-c7ca-4bc9-96a5-3a55390acdd5",
        metadata: { form_type: "DEF 14A" },
        source_group: "filings",
        ticker: "MULN",
        title: "Annual proxy statement",
      },
    ],
  });

  assert.deepEqual(
    selectStockOverviewEvents(events, "dilution").map((event) => event.formType),
    ["S-1", "8-K"],
  );
  assert.deepEqual(
    selectStockOverviewEvents(events, "ownership").map((event) => event.formType),
    ["DEF 14A"],
  );
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
  assert.match(componentSource, /viewport="all"/);
  assert.match(componentSource, /TickerCompanyAutocomplete/);
  assert.match(addRoute, /findTickerBySymbol/);
  assert.match(addRoute, /company_name: catalogTicker\.companyName/);
  assert.match(componentSource, /viewerPlan|watchlist\.plan === "free"/);
  assert.match(componentSource, /selectionMode === "stock"/);
  assert.match(componentSource, /getStockRouteHref\(ticker\)/);
  assert.match(componentSource, /getStockOverviewEventsApiHref\(selectedTicker\)/);
  assert.match(componentSource, /className=\{styles\.watchDesktopLabel\}>Add to Watchlist/);
  assert.match(componentSource, /className=\{styles\.watchMobileLabel\}>Watch/);
  assert.match(componentSource, /<MarketTickerLogo size="detail" ticker=\{ticker\} \/>/);
  assert.match(componentSource, /isSaved \? \([\s\S]*<Check aria-hidden="true" size=\{16\} \/>/);
  assert.match(componentSource, /data-active=\{isSaved\}/);
  assert.match(componentSource, /className=\{styles\.liveAction\}/);
  assert.match(componentSource, /className=\{styles\.alertAction\}/);
  assert.match(
    componentSource,
    /href=\{getAlertsRouteHref\(ticker\)\}/,
  );
  assert.match(componentSource, /Ticker unavailable/);
  assert.match(componentSource, /"Stock research workspace"/);
  assert.match(componentSource, /"Stock Overview"/);
  assert.match(componentSource, /"Personal market workspace"/);
  assert.match(
    componentSource,
    /className=\{styles\.contextRail\}[\s\S]*<RadarBrief[\s\S]*<WatchlistUpgradeCard[\s\S]*className=\{styles\.railAd\}[\s\S]*<EventPreview[\s\S]*<StockCalendarEvents[\s\S]*<CompanyContext/,
  );
  assert.match(
    componentSource,
    /\{allowAds \? \([\s\S]*className=\{styles\.railAd\}[\s\S]*\) : null\}/,
  );
  assert.match(
    componentCss,
    /\.contextRail \{[\s\S]*display: grid;[\s\S]*align-content: start;[\s\S]*gap: var\(--sr-space-4\);[\s\S]*\}/,
  );
  const contextRailRule = componentCss.match(/\.contextRail \{([\s\S]*?)\}/)?.[1] ?? "";
  assert.doesNotMatch(contextRailRule, /max-height|overflow-y|scrollbar-gutter|position:\s*sticky/);
  assert.match(
    componentCss,
    /\.promoRow \{\s*display: none;\s*\}/,
  );
  assert.match(
    componentCss,
    /@media \(max-width: 1180px\) \{[\s\S]*\.promoRow \{[\s\S]*display: grid;/,
  );
  assert.match(
    componentSource,
    /new ResizeObserver\(scheduleActiveSectionUpdate\)/,
  );
  assert.match(
    componentSource,
    /\}, \[fundamentalsState, selectedTicker\]\);/,
  );
  assert.match(
    componentSource,
    /\.element\.scrollIntoView\(\{ block: "start" \}\);/,
  );
  assert.match(
    componentCss,
    /@media \(max-width: 760px\) \{[\s\S]*\.stockActions \{[\s\S]*display: grid;[\s\S]*grid-column: 1 \/ -1;[\s\S]*grid-template-columns: minmax\(0, 1\.08fr\) minmax\(0, 0\.75fr\) minmax\(0, 1fr\);/,
  );
  assert.match(
    componentCss,
    /\.stockActions button\[data-active="true"\] \{[\s\S]*color: var\(--sr-color-text-secondary\);[\s\S]*background: var\(--sr-color-surface-control-strong\);/,
  );
  assert.match(
    componentCss,
    /\.stockActions \.liveAction \{[\s\S]*border-color: var\(--sr-color-accent-border-strong\);[\s\S]*color: var\(--sr-color-accent-text\);[\s\S]*background: var\(--sr-color-surface-control\);/,
  );
  assert.match(
    componentCss,
    /\.stockActions \.alertAction \{[\s\S]*color: var\(--sr-color-surface-product-menu\);[\s\S]*background: var\(--sr-color-accent\);/,
  );
  assert.match(
    componentCss,
    /@media \(max-width: 760px\) \{[\s\S]*\.pageTopline > div > span \{\s*display: none;[\s\S]*\.pageTopline h1 \{\s*margin: 0;/,
  );
  assert.doesNotMatch(componentCss, /\.stockActions > :last-child/);
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
  assert.match(componentSource, /className=\{styles\.eventMobileIdentity\}/);
  assert.match(componentSource, /className=\{styles\.eventMobileSource\}/);
  assert.match(
    componentCss,
    /@media \(max-width: 760px\) \{[\s\S]*\.eventRow \{[\s\S]*min-height: 96px;[\s\S]*grid-template-columns: auto minmax\(0, 1fr\) 58px;[\s\S]*grid-template-rows: auto auto auto;[\s\S]*gap: var\(--sr-space-1-5\);[\s\S]*padding: var\(--sr-space-3\);/,
  );
  assert.match(
    componentCss,
    /@media \(max-width: 760px\) \{[\s\S]*\.eventCopy > strong \{[\s\S]*grid-column: 1 \/ 3;[\s\S]*grid-row: 2;[\s\S]*font-size: var\(--sr-font-size-lg\);[\s\S]*font-weight: 600;[\s\S]*line-height: 1\.35;/,
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
  assert.match(
    componentCss,
    /\.eventRow\[aria-pressed="true"\] \{[\s\S]*box-shadow: none;[\s\S]*background: var\(--sr-color-surface-table-row\);/,
  );
  assert.match(
    componentCss,
    /\.eventRow\[aria-pressed="true"\]::before \{[\s\S]*top: 0;[\s\S]*bottom: 0;[\s\S]*width: 3px;[\s\S]*border-radius: 0;[\s\S]*background: var\(--sr-color-accent\);/,
  );
  assert.match(
    componentCss,
    /\.eventRow\[aria-pressed="true"\]:hover \{[\s\S]*background: var\(--sr-color-surface-table-hover\);/,
  );
  assert.match(componentSource, /aria-pressed=\{event\.id === selectedEventId\}/);
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
  assert.match(headerCss, /@media \(max-width: 820px\)/);
  assert.match(
    headerCss,
    /@media \(max-width: 820px\) \{[\s\S]*\.header \{[\s\S]*position: sticky;[\s\S]*top: 0;[\s\S]*background: var\(--sr-color-surface-product-menu\);/,
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

test("mobile stock overview keeps card boundaries, wide gutters, and readable type", async () => {
  const [overviewCss, fundamentalsCss] = await Promise.all([
    readFile(
      new URL(
        "../../components/watchlist-v2/StockRadarWatchlistV2.module.css",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../../components/watchlist-v2/StockFundamentalsSections.module.css",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    overviewCss,
    /\.radarBrief,\s*\.chartPanel,\s*\.section,\s*\.eventPreview,[\s\S]*border: var\(--sr-border-width\) solid var\(--sr-color-border\);[\s\S]*border-radius: var\(--sr-radius-base\);[\s\S]*box-shadow: var\(--sr-shadow-panel\);/,
  );
  assert.match(
    overviewCss,
    /@media \(max-width: 760px\) \{[\s\S]*\.page \{\s*padding: var\(--sr-space-3\) var\(--sr-space-2\) var\(--sr-space-7\);/,
  );
  assert.match(
    overviewCss,
    /\.radarBrief h2,\s*\.upcomingEvents h2,\s*\.companyContext h2 \{\s*font-size: var\(--sr-font-size-xl\);/,
  );
  assert.match(
    overviewCss,
    /\.radarBrief p,[\s\S]*\.previewEmpty \{\s*font-size: var\(--sr-font-size-lg\);/,
  );
  assert.match(
    overviewCss,
    /\.eventRow > \.eventTime span,[\s\S]*font-size: var\(--sr-font-size-md\);/,
  );
  assert.match(
    fundamentalsCss,
    /@media \(max-width: 760px\) \{[\s\S]*\.dataSectionHeader > span,[\s\S]*font-size: var\(--sr-font-size-md\);[\s\S]*\.sourceNotice,[\s\S]*font-size: var\(--sr-font-size-sm\);[\s\S]*\.dataState strong,[\s\S]*font-size: var\(--sr-font-size-lg\);/,
  );
});
