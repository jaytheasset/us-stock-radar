import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./StockRadarWatchlistV2.tsx", import.meta.url),
  "utf8",
);

test("SEC ticker sources stay stock-detail-only and independent from overview completion", () => {
  const overviewBatch = source.match(/void Promise\.allSettled\(\[([\s\S]*?)\]\)\.then\(\(\[profileResult/);
  assert.ok(overviewBatch);
  assert.doesNotMatch(overviewBatch[1]!, /sec-source-filings|sourceFilingsResult/);

  assert.match(
    source,
    /shouldLoadSecTickerSourceFilings\(\{ selectionMode, ticker: selectedTicker \}\)/,
  );
  assert.match(source, /showSourceFilings=\{selectionMode === "stock"\}/);
  assert.match(source, /showSourceFilings && observation\.filter !== "news"/);
  assert.match(source, /isUnavailable=\{stockDetailUnavailable\}/);
  assert.match(source, /overviewState = resolveStockDetailRenderState/);
  assert.match(source, /detailRenderState: overviewState/);
  assert.match(source, /sourceFilingsCount: secSourceFilings\.length/);
  assert.match(source, /sourceFilingsState: secSourceFilingsState/);

  const overviewReady = source.match(/setOverviewState\(([\s\S]*?)\);\s*\}\);/);
  assert.ok(overviewReady);
  assert.doesNotMatch(overviewReady[1]!, /SourceFilings/);
});
