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
  const table = read("components/dashboard-v2/MarketMoversTable.tsx");

  assert.match(page, /const viewerPlan = await getCurrentViewerPlan\(\)/);
  assert.match(page, /<StockRadarDashboardV2 viewerPlan=\{viewerPlan\} \/>/);
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
});

test("Markets mobile controls stay full-width, single-line, and locally sized", () => {
  const dashboard = read("components/dashboard-v2/StockRadarDashboardV2.tsx");
  const filterBar = read("components/dashboard-v2/FilterBar.tsx");
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
    dashboardStyles,
    /\.dashboard-v2-mobile-quick-filter span\)\s*{\s*font-size: var\(--sr-font-size-sm\);/,
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
});
