import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  mapTickerSearchResults,
  normalizeTickerSearchQuery,
  normalizeTickerSymbol,
} from "./tickerSearchContract.ts";

test("ticker search normalizes safe symbol and company queries", () => {
  assert.equal(normalizeTickerSearchQuery("  Advanced   Micro Devices  "), "Advanced Micro Devices");
  assert.equal(normalizeTickerSearchQuery("AMD<script>"), "AMDscript");
  assert.equal(normalizeTickerSymbol(" nvda "), "NVDA");
  assert.equal(normalizeTickerSymbol("A/B"), null);
});

test("ticker search response uses one deduplicated client contract", () => {
  assert.deepEqual(
    mapTickerSearchResults({
      ok: true,
      data: [
        { ticker: "amd", companyName: "Advanced Micro Devices, Inc.", exchange: "NASDAQ" },
        { ticker: "AMD", companyName: "Duplicate" },
        { ticker: "NVDA", companyName: "NVIDIA Corporation", marketCap: "100" },
      ],
    }),
    [
      {
        assetType: null,
        companyName: "Advanced Micro Devices, Inc.",
        exchange: "NASDAQ",
        marketCap: null,
        ticker: "AMD",
      },
      {
        assetType: null,
        companyName: "NVIDIA Corporation",
        exchange: null,
        marketCap: 100,
        ticker: "NVDA",
      },
    ],
  );
});

test("ticker API augments the active catalog without a duplicate table", () => {
  const source = readFileSync(
    new URL("./alerts/tickers/getAlertTickersViewModel.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /supabaseSelect\("tickers"/);
  assert.match(source, /supabaseSelect\("event_tickers"/);
  assert.match(source, /fetchSecCompanyTickers/);

  const localSync = readFileSync(
    new URL("../scripts/sync-sec-ticker-catalog-local.js", import.meta.url),
    "utf8",
  );
  assert.match(localSync, /company_tickers_exchange\.json/);
  assert.match(localSync, /Refusing to sync SEC tickers to a non-local database/);
});
