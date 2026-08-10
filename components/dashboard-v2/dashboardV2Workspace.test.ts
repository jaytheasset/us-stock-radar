import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(projectRoot, relativePath), "utf8");

test("Markets uses the established centered 1600px workspace contract", () => {
  const dashboardStyles = read(
    "components/dashboard-v2/StockRadarDashboardV2.module.css",
  );

  assert.match(
    dashboardStyles,
    /\.workspace\s*{[\s\S]*?width: min\(100%, 1600px\);[\s\S]*?margin: 0 auto;/,
  );
  assert.match(
    dashboardStyles,
    /\.dashboard-v2-left\)\s*{[\s\S]*?padding: var\(--sr-space-5\) var\(--sr-page-gutter-desktop\) var\(--sr-space-4-5\);/,
  );
  assert.match(
    dashboardStyles,
    /@media \(max-width: 1320px\)[\s\S]*?\.workspace\s*{\s*grid-template-columns: minmax\(690px, 1fr\) minmax\(390px, 420px\);/,
  );
  assert.match(
    dashboardStyles,
    /@media \(max-width: 1180px\)[\s\S]*?\.workspace\s*{[\s\S]*?grid-template-columns: 1fr;/,
  );
  assert.match(
    dashboardStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.dashboard-v2-left\)\s*{\s*padding: var\(--sr-page-gutter-mobile\);/,
  );
});

test("existing 1600px product workspaces remain the read-only reference", () => {
  for (const stylesheet of [
    "components/watchlist-v2/StockRadarWatchlistV2.module.css",
    "components/news-v2/StockRadarNewsV2.module.css",
    "components/filings-v2/StockRadarFilingsV2.module.css",
  ]) {
    const source = read(stylesheet);

    assert.match(source, /width: min\(100%, 1600px\);/);
    assert.match(source, /margin: 0 auto;/);
  }
});

test("Markets ticker links use the canonical stock route without replacing row selection", () => {
  const table = read("components/dashboard-v2/MarketMoversTable.tsx");
  const desktopRow = read("components/market/DesktopMarketRow.tsx");
  const mobileRow = read("components/market/MobileMarketRow.tsx");

  assert.match(table, /getStockRouteHref\(row\.ticker\)/);
  assert.match(table, /tickerHref=\{tickerHref\}/);
  for (const row of [desktopRow, mobileRow]) {
    assert.match(row, /href=\{tickerHref\}/);
    assert.match(row, /View \$\{ticker\} stock overview/);
    assert.match(row, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.match(row, /onKeyDown=\{\(event\) => event\.stopPropagation\(\)\}/);
    assert.match(row, /onClick=\{onSelect\}/);
    assert.match(row, /onSelect\?\.\(\)/);
  }
});

test("Markets gates every ad placement with the shared viewer-plan decision", () => {
  const page = read("app/dashboard-v2/page.tsx");
  const dashboard = read("components/dashboard-v2/StockRadarDashboardV2.tsx");
  const mobilePreview = read(
    "components/dashboard-v2/MobileTickerBottomSheet.tsx",
  );
  const table = read("components/dashboard-v2/MarketMoversTable.tsx");

  assert.match(
    page,
    /const \[viewerPlan, userId\] = await Promise\.all\(\[[\s\S]*getCurrentViewerPlan\(\),[\s\S]*getOptionalCurrentUserId\(\),/,
  );
  assert.match(page, /const initialSession = getPreferredDashboardSession\(\)/);
  assert.match(
    page,
    /<StockRadarDashboardV2[\s\S]*initialAuthenticated=\{Boolean\(userId\)\}[\s\S]*initialSession=\{initialSession\}[\s\S]*viewerPlan=\{viewerPlan\}/,
  );
  assert.match(
    dashboard,
    /useState<DashboardV2Session>\(initialSession\)/,
  );
  assert.match(dashboard, /areAdsEnabledForPlan\(viewerPlan\)/);
  assert.match(dashboard, /adsEnabledForViewer=\{adsEnabledForViewer\}/);
  assert.match(
    dashboard,
    /adsEnabledForViewer \? <DesktopRailAdSlot \/> : null/,
  );
  assert.equal(
    (table.match(/adsEnabledForViewer &&/g) || []).length,
    3,
    "desktop mid-list, desktop footer, and mobile inline ads must all be gated",
  );
  assert.doesNotMatch(table, /viewerPlan\s*===\s*["']free["']/);
  assert.match(
    mobilePreview,
    /<TickerDetailContent[\s\S]*\/>[\s\S]*viewerPlan === "free" \? <FeedPreviewAd size="320x100" \/>/,
  );
});

test("Markets mobile preview reuses the Live Feed control and sheet contracts", () => {
  const mobilePreview = read(
    "components/dashboard-v2/MobileTickerBottomSheet.tsx",
  );
  const actions = read("components/dashboard-v2/MarketsPreviewActions.tsx");
  const detail = read("components/dashboard-v2/TickerDetailContent.tsx");
  const dashboardStyles = read(
    "components/dashboard-v2/StockRadarDashboardV2.module.css",
  );

  assert.match(mobilePreview, /showCloseButton/);
  assert.match(mobilePreview, /showHandle/);
  assert.match(
    mobilePreview,
    /topControls=\{[\s\S]*<MarketsPreviewActions[\s\S]*\}/,
  );
  assert.match(mobilePreview, /viewport="mobile"/);
  assert.match(mobilePreview, /overlayLabel="Close ticker detail overlay"/);
  assert.match(
    actions,
    /<WatchlistButton[\s\S]*<SavedContentButton/,
    "Watchlist must precede Bookmark like the Feed preview",
  );
  assert.match(actions, /event\.sourceGroup === "filings"[\s\S]*"filing"/);
  assert.match(actions, /event\.sourceGroup === "news"[\s\S]*"news"/);
  assert.match(detail, /mobileSheetHeader \? <LatestEventIcon/);
  assert.doesNotMatch(detail, /dashboard-v2-mobile-favorite/);
  assert.match(
    dashboardStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.dashboard-v2-detail-header\)\s*\{[\s\S]*?border-bottom: var\(--sr-border-width\) solid var\(--sr-color-divider\);[\s\S]*?padding: var\(--sr-space-5\) var\(--sr-space-4\) var\(--sr-space-4\);/,
  );
  assert.match(
    dashboardStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.dashboard-v2-analysis-button\)\s*\{[\s\S]*?position: static;[\s\S]*?min-height: calc\(var\(--sr-size-control\) \+ var\(--sr-space-3\)\);[\s\S]*?font-size: 16px;/,
  );
});

test("Markets mobile controls stay full-width, single-line, and locally sized", () => {
  const dashboard = read("components/dashboard-v2/StockRadarDashboardV2.tsx");
  const filterBar = read("components/dashboard-v2/FilterBar.tsx");
  const filterTriggerStyles = read("components/ui/FilterTrigger.module.css");
  const segmentedControl = read("components/ui/SegmentedControl.module.css");
  const dashboardStyles = read(
    "components/dashboard-v2/StockRadarDashboardV2.module.css",
  );

  assert.match(dashboard, /variant="marketsPrimary"/);
  assert.match(dashboard, /variant="marketsCompact"/);
  assert.match(
    segmentedControl,
    /@media \(max-width: 760px\)[\s\S]*?\.marketsPrimary,[\s\S]*?\.marketsCompact\s*{[\s\S]*?width: 100%;[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);[\s\S]*?overflow: hidden;/,
  );
  assert.match(
    segmentedControl,
    /\.marketsPrimary \.item,[\s\S]*?\.marketsCompact \.item\s*{[\s\S]*?font-size: var\(--sr-font-size-md\);[\s\S]*?white-space: nowrap;/,
  );
  assert.equal(
    (filterBar.match(/className="dashboard-v2-mobile-quick-filter"/g) || []).length,
    2,
  );
  assert.match(
    filterTriggerStyles,
    /\.compact:global\(\.dashboard-v2-mobile-quick-filter\) \.label\s*{\s*font-size: var\(--sr-font-size-sm\);/,
  );
  assert.doesNotMatch(
    dashboardStyles,
    /\.dashboard-v2-mobile-quick-filter span/,
  );
  assert.match(
    dashboardStyles,
    /\.dashboard-v2-mobile-filter-controls\)\s*{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);[\s\S]*?overflow-x: hidden;/,
  );
});

test("Markets availability hierarchy and mobile panels use the flat tokenized treatment", () => {
  const dashboardStyles = read(
    "components/dashboard-v2/StockRadarDashboardV2.module.css",
  );

  assert.match(
    dashboardStyles,
    /\.marketState strong,[\s\S]*?\.detailState strong\s*{[\s\S]*?font-size: var\(--sr-font-size-xl\);/,
  );
  assert.match(
    dashboardStyles,
    /\.marketState span,[\s\S]*?\.detailState span\s*{[\s\S]*?font-size: var\(--sr-font-size-base\);/,
  );
  assert.match(
    dashboardStyles,
    /\.marketTimestamp\s*{[\s\S]*?font-size: var\(--sr-font-size-sm\);/,
  );
  assert.match(
    dashboardStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.marketState,[\s\S]*?\.dashboard-v2-table-panel\)\s*{[\s\S]*?border: 0;[\s\S]*?border-top: var\(--sr-border-width\) solid var\(--sr-color-divider\);[\s\S]*?border-bottom: var\(--sr-border-width\) solid var\(--sr-color-divider\);[\s\S]*?border-radius: 0;[\s\S]*?background: transparent;[\s\S]*?box-shadow: none;/,
  );
  assert.match(
    dashboardStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.marketState,[\s\S]*?\.dashboard-v2-table-panel\)\s*{[\s\S]*?box-sizing: border-box;[\s\S]*?width: calc\(\s*100% \+ var\(--sr-page-gutter-mobile\) \+ var\(--sr-page-gutter-mobile\)\s*\);[\s\S]*?margin-right: calc\(var\(--sr-page-gutter-mobile\) \* -1\);[\s\S]*?margin-left: calc\(var\(--sr-page-gutter-mobile\) \* -1\);/,
  );
});

test("Markets UI and safe DOM observation use the same mover state model", () => {
  const dashboard = read("components/dashboard-v2/StockRadarDashboardV2.tsx");
  const observation = read("lib/dashboardV2MoverObservation.ts");

  assert.match(dashboard, /getDashboardV2MoversRequest\(activeMoverTab, activeSession\)/);
  assert.match(dashboard, /fetch\(request\.href/);
  assert.match(dashboard, /resolveDashboardV2MoverObservation\(\{/);
  assert.match(dashboard, /data-market-movers-state=\{observation\.status\}/);
  assert.match(dashboard, /data-market-movers-render-state=\{observation\.renderState\}/);
  assert.match(
    dashboard,
    /data-market-movers-source-result-count=\{observation\.sourceResultCount\}/,
  );
  assert.match(
    dashboard,
    /data-market-movers-rendered-result-count=\{observation\.renderedResultCount\}/,
  );
  assert.match(dashboard, /<strong>\{observation\.renderTitle\}<\/strong>/);
  assert.match(dashboard, /<span>\{observation\.renderMessage\}<\/span>/);
  assert.match(dashboard, /\{observation\.resultLabel\}/);
  assert.doesNotMatch(dashboard, /payload\.message\s*\|\||payload\.error\s*\|\|/);
  assert.match(observation, /Do not infer an empty result from row count alone/);
  assert.doesNotMatch(observation, /response\?\.error|response\.error|response\?\.message|response\.message/);
});
