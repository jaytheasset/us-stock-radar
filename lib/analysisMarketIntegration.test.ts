import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("News and Filings use one peer resolver and one fresh-cache market loader", () => {
  const news = read("lib/newsAnalysisDetail.ts");
  const filings = read("app/filings/[id]/page.tsx");
  const resolver = read("lib/analysisMarketContext.ts");
  const loader = read("lib/analysisMarketData.ts");

  assert.match(news, /resolveAnalysisMarketContext\(\{/);
  assert.match(filings, /resolveAnalysisMarketContext\(\{/);
  assert.match(news, /loadAnalysisMarketData\(ticker\)/);
  assert.match(filings, /loadAnalysisMarketData\(ticker\)/);
  assert.match(resolver, /selectAnalysisPeers\(\{/);
  assert.match(resolver, /source: peer\.source/);
  assert.match(resolver, /fillerBucket: peer\.fillerBucket/);
  assert.match(loader, /readMarketQuoteCache\(symbol\)/);
  assert.match(loader, /readMarketBarCacheMap\(\[symbol\], range\)/);
});

test("News always mounts a real-ticker chart and only missing ranges use the chart API", () => {
  const adapter = read("components/news-analysis-v2/NewsAnalysisAdapter.tsx");
  const chart = read("app/events/[id]/PriceChartCard.tsx");

  assert.match(adapter, /const hasRealTicker = isRealTicker\(filing\.ticker\)/);
  assert.match(adapter, /priceRenderer=\{hasRealTicker \? \(/);
  assert.doesNotMatch(adapter, /storedOnly/);
  assert.ok(
    chart.indexOf("hasStoredAnalysisChartRange(series, requestedRange)") <
      chart.indexOf("fetch(`/api/market/chart?symbol="),
  );
  assert.match(chart, /Chart unavailable/);
});

test("Filings always mount the shared real-ticker chart and keep it collapsible on mobile", () => {
  const filings = read("app/filings/[id]/page.tsx");

  assert.match(filings, /const hasRealFilingTicker = isRealTicker\(filing\.ticker\)/);
  assert.match(filings, /priceRenderer=\{hasRealFilingTicker \? \(/);
  assert.ok((filings.match(/mobileCollapsible/g) || []).length >= 3);
  assert.doesNotMatch(filings, /storedOnly/);
});

test("the market chart route preserves cache-first TTL behavior and 5Y handling", () => {
  const route = read("app/api/market/chart/route.ts");
  const cache = read("lib/marketDataCache.ts");
  const cacheRead = route.indexOf("readMarketBarCache(symbol, range, interval)");
  const providerRead = route.indexOf("fetchPolygonChart(symbol, range");

  assert.ok(cacheRead >= 0 && cacheRead < providerRead);
  assert.match(route, /if \(!forceRefresh && range !== "5Y"\)/);
  assert.match(route, /range === "5Y"\s*\? \{ ok: false \}/);
  assert.match(route, /coalesceMarketChartRequest\(/);
  assert.ok(
    route.indexOf("readMarketBarCache(symbol, range, interval)") <
      route.indexOf("coalesceMarketChartRequest("),
  );
  assert.match(route, /quoteChangePercent: cachedChart\.data\.changePercent/);
  assert.match(route, /rangeChangePercent: rangeMovement\?\.changePercent/);
  assert.match(cache, /case "1D":\s*return 60;/);
  assert.match(cache, /case "5D":\s*return 300;/);
  assert.match(cache, /case "1M":\s*return 1800;/);
  assert.match(cache, /case "3M":\s*case "1Y":\s*return 3600;/);
  assert.ok((cache.match(/expires_at: `gt\.\$\{new Date\(\)\.toISOString\(\)\}`/g) || []).length >= 4);
});

test("Market Context exposes real quote fields, explicit unavailable states, and a two-card mobile pager", () => {
  const panel = read("app/events/[id]/SectorThemeContextPanel.tsx");
  const styles = read("app/globals.css");

  assert.match(panel, /price: Number\.isFinite\(lastPrice\) \? formatCurrency\(lastPrice\) : ""/);
  assert.match(panel, /resolveMarketRangeChangePercent\(\{/);
  assert.match(panel, /rangeChangePercent: data\.rangeChangePercent/);
  assert.doesNotMatch(panel, /Number\(data\.changePercent\)/);
  assert.match(panel, /index \+= marketContextRequestConcurrency/);
  assert.match(panel, /const marketContextRequestConcurrency = 3/);
  assert.doesNotMatch(panel, /live\?\.change \|\| mover\.change/);
  assert.doesNotMatch(panel, /live\?\.values \|\| mover\.trend/);
  assert.match(panel, /Company name unavailable/);
  assert.match(panel, /Market data unavailable/);
  assert.match(panel, /Related ticker and taxonomy peer market data is unavailable/);
  assert.match(panel, /paginateAnalysisPeers\(movers\)/);
  assert.match(panel, /Ticker page \$\{pageIndex \+ 1\} of \$\{pages\.length\}/);
  assert.match(panel, /event\.key === "ArrowRight"/);
  assert.match(panel, /event\.key === "ArrowLeft"/);
  assert.match(panel, /aria-current=\{currentPage === pageIndex \? "page" : undefined\}/);
  assert.match(styles, /\.context-mover-slide \{[\s\S]*flex: 0 0 100%;[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[\s\S]*scroll-snap-align: start;/);
  assert.match(styles, /\.context-mover-slider \{[\s\S]*overflow-x: auto;[\s\S]*overflow-y: hidden;[\s\S]*scroll-snap-type: x mandatory;[\s\S]*scrollbar-width: none;/);
});

test("future News events retain prompt market context without changing old-event compatibility", () => {
  const ingest = read("lib/newsIngest.ts");
  assert.match(ingest, /marketContext: analysisRun\.input\.market_context/);
  assert.match(ingest, /market_context: toRecord\(marketContext\) \|\| null/);
});

function read(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}
