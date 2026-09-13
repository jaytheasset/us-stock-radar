import assert from "node:assert/strict";
import test from "node:test";
import {
  isStockDetailUnavailable,
  resolveStockDetailRenderState,
  shouldLoadSecTickerSourceFilings,
} from "./productProjectionClient.ts";

test("loads SEC ticker sources only for an explicit stock detail", () => {
  assert.equal(
    shouldLoadSecTickerSourceFilings({ selectionMode: "stock", ticker: "BTLN" }),
    true,
  );
  assert.equal(
    shouldLoadSecTickerSourceFilings({ selectionMode: "watchlist", ticker: "BTLN" }),
    false,
  );
  assert.equal(
    shouldLoadSecTickerSourceFilings({ selectionMode: "stock", ticker: null }),
    false,
  );
});

test("a late verified SEC source success clears only the stock-detail unavailable state", () => {
  const base = {
    overviewState: "unavailable" as const,
    selectionMode: "stock" as const,
    sourceFilingsCount: 0,
  };

  assert.equal(
    isStockDetailUnavailable({ ...base, sourceFilingsState: "loading" }),
    true,
  );
  assert.equal(
    resolveStockDetailRenderState({ ...base, sourceFilingsState: "loading" }),
    "unavailable",
  );
  assert.equal(
    isStockDetailUnavailable({
      ...base,
      sourceFilingsCount: 4,
      sourceFilingsState: "ready",
    }),
    false,
  );
  assert.equal(
    resolveStockDetailRenderState({
      ...base,
      sourceFilingsCount: 4,
      sourceFilingsState: "ready",
    }),
    "ready",
  );
  assert.equal(
    isStockDetailUnavailable({ ...base, sourceFilingsState: "unavailable" }),
    true,
  );
  assert.equal(
    resolveStockDetailRenderState({ ...base, sourceFilingsState: "unavailable" }),
    "unavailable",
  );
});

test("SEC source state never changes watchlist availability", () => {
  assert.equal(
    isStockDetailUnavailable({
      overviewState: "unavailable",
      selectionMode: "watchlist",
      sourceFilingsCount: 4,
      sourceFilingsState: "ready",
    }),
    true,
  );
  assert.equal(
    resolveStockDetailRenderState({
      overviewState: "unavailable",
      selectionMode: "watchlist",
      sourceFilingsCount: 4,
      sourceFilingsState: "ready",
    }),
    "unavailable",
  );
  assert.equal(
    isStockDetailUnavailable({
      overviewState: "ready",
      selectionMode: "stock",
      sourceFilingsCount: 0,
      sourceFilingsState: "unavailable",
    }),
    false,
  );
  assert.equal(
    resolveStockDetailRenderState({
      overviewState: "ready",
      selectionMode: "stock",
      sourceFilingsCount: 0,
      sourceFilingsState: "unavailable",
    }),
    "ready",
  );
});
