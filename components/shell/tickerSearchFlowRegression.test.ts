import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (relativePath: string) =>
  readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("public ticker search and stock detail expose one shared safe flow readout", () => {
  const search = read("components/shell/StockRadarTickerSearch.tsx");
  const detail = read("components/watchlist-v2/StockRadarWatchlistV2.tsx");
  const readout = read("components/shell/TickerSearchFlowReadout.tsx");
  const observation = read("lib/tickerSearchFlowObservation.ts");

  assert.match(search, /getTickerSearchRequestHref\(query\)/);
  assert.match(search, /resolveTickerSearchObservation/);
  assert.match(search, /observation\.results\.map/);
  assert.match(search, /observation\.message/);
  assert.match(search, /aria-selected=\{activeIndex === index\}/);
  assert.match(search, /createTickerSearchSelectionSnapshot/);
  assert.match(search, /<TickerSearchFlowReadout state=\{flowReadout\} \/>/);

  assert.match(detail, /parseTickerSearchSelectionSnapshot/);
  assert.match(detail, /resolveTickerSearchToStockDetailReadout/);
  assert.match(detail, /detailRenderState: overviewState/);
  assert.match(detail, /<TickerSearchFlowReadout state=\{tickerSearchFlowReadout\} \/>/);

  assert.match(readout, /aria-label="Ticker search to stock detail state"/);
  for (const field of [
    "query",
    "request-href",
    "request-state",
    "response-status",
    "api-ok",
    "http-status",
    "source-count",
    "rendered-count",
    "selected-ticker",
    "selection-href",
    "route-ticker",
    "route-href",
    "route-matches-selection",
    "detail-render-state",
    "rendered-ticker",
  ]) {
    assert.match(readout, new RegExp(`data-ticker-flow-${field}=`));
  }

  assert.match(observation, /A zero mapped count never proves an empty result/);
  assert.doesNotMatch(readout, /error|message|payload|token|cookie|account/i);
  assert.doesNotMatch(observation, /response\?\.error|response\.error|response\?\.message|response\.message/);
});
