import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stock detail routes Financials only through the SEC endpoint while FMP remains ownership-only", async () => {
  const watchlist = await readFile(
    new URL("./StockRadarWatchlistV2.tsx", import.meta.url),
    "utf8",
  );
  const financials = await readFile(
    new URL("./StockFundamentalsSections.tsx", import.meta.url),
    "utf8",
  );
  const fmpServer = await readFile(
    new URL("../../lib/watchlist/stockFundamentalsServer.ts", import.meta.url),
    "utf8",
  );
  const secRoute = await readFile(
    new URL("../../app/api/market/sec/financials/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(watchlist, /\/api\/market\/sec\/financials\?symbol=/);
  assert.match(watchlist, /financialSnapshot=\{financials\}/);
  assert.doesNotMatch(financials, /snapshot\?\.financials|calculatePercentChange|qoq=/);
  assert.match(financials, /No FMP fallback, GPT numeric value, QoQ calculation/);
  assert.doesNotMatch(fmpServer, /endpoint: "income-statement"/);
  assert.doesNotMatch(fmpServer, /endpoint: "balance-sheet-statement"/);
  assert.doesNotMatch(fmpServer, /endpoint: "cash-flow-statement"/);
  assert.match(secRoute, /fetchStockFinancials/);
  assert.doesNotMatch(secRoute, /FMP|GPT|OpenAI/);
});
