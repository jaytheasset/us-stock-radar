import assert from "node:assert/strict";
import test from "node:test";

import {
  allAlertMarketCapFilterIds,
  matchesAlertMarketCapFilters,
} from "./marketCapFilter.ts";

test("alert market-cap filtering uses the shared boundary classifier", () => {
  assert.equal(matchesAlertMarketCapFilters(99_999_999, ["micro"]), true);
  assert.equal(matchesAlertMarketCapFilters(100_000_000, ["micro"]), false);
  assert.equal(matchesAlertMarketCapFilters(100_000_000, ["small"]), true);
  assert.equal(matchesAlertMarketCapFilters(2_000_000_000, ["mid"]), true);
  assert.equal(matchesAlertMarketCapFilters(10_000_000_000, ["large"]), true);
  assert.equal(matchesAlertMarketCapFilters(200_000_000_000, ["mega"]), true);
});

test("all selected alert bands preserve delivery when legacy market cap is unavailable", () => {
  assert.equal(matchesAlertMarketCapFilters(null, allAlertMarketCapFilterIds), true);
  assert.equal(matchesAlertMarketCapFilters(null, ["large"]), false);
  assert.equal(matchesAlertMarketCapFilters(10_000_000_000, []), false);
});
