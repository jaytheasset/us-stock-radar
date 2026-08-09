import assert from "node:assert/strict";
import test from "node:test";
import {
  applyEventTickerRelationshipFilter,
  normalizeEventRows,
} from "./eventTickerLinkage.ts";

test("ticker event queries use the persisted relationship for GOOG and GOOGL", () => {
  const search = applyEventTickerRelationshipFilter(
    { limit: "50", select: "*" },
    ["GOOGL", "GOOG"],
  );

  assert.equal(search["ticker_links.symbol"], "in.(GOOGL,GOOG)");
  assert.match(search.select, /ticker_links:event_tickers!inner\(symbol\)/);
  assert.equal("ticker" in search, false);
});

test("relationship joins still return one list row and hide transport-only join data", () => {
  const rows = normalizeEventRows([
    {
      id: "f46d2e4e-7587-49cb-b8ed-9905e37b8944",
      ticker: "GOOG",
      ticker_links: [{ symbol: "GOOG" }, { symbol: "GOOGL" }],
      title: "Alphabet filing",
    },
    {
      id: "f46d2e4e-7587-49cb-b8ed-9905e37b8944",
      ticker: "GOOG",
      ticker_links: [{ symbol: "GOOGL" }],
      title: "Alphabet filing",
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.ticker, "GOOG");
  assert.equal("ticker_links" in (rows[0] || {}), false);
});

test("invalid ticker filters fail closed instead of returning the whole feed", () => {
  const search = applyEventTickerRelationshipFilter(
    { select: "*" },
    ["not a ticker"],
  );

  assert.equal(search["ticker_links.symbol"], "eq.__INVALID_TICKER__");
  assert.match(search.select, /ticker_links:event_tickers!inner\(symbol\)/);
});
