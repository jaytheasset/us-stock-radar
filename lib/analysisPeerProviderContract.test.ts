import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  ANALYSIS_PEER_PROVIDER_MAX_REQUESTS,
  buildAnalysisPeerProviderFilters,
  normalizeAnalysisPeerProviderCompanies,
  normalizeAnalysisPeerProviderRows,
} from "./analysisPeerProviderContract.ts";

test("AEMD-style empty-universe classification falls back to industry then sector", () => {
  const filters = buildAnalysisPeerProviderFilters({
    industry: "Medical - Devices",
    sector: "Healthcare",
    subTheme: "",
    themeGroup: "healthcare_momentum",
  });

  assert.deepEqual(filters, [
    { bucket: "industry_group", industry: "Medical - Devices" },
    { bucket: "sector", sector: "Healthcare" },
  ]);
  assert.ok(filters.length <= ANALYSIS_PEER_PROVIDER_MAX_REQUESTS);
});

test("provider filter planning preserves sub-theme, theme, industry, sector priority", () => {
  const filters = buildAnalysisPeerProviderFilters({
    industry: "Biotechnology",
    sector: "Healthcare",
    subTheme: "Medical - Devices",
    themeGroup: "Medical - Pharmaceuticals",
  });

  assert.deepEqual(filters.map((filter) => filter.bucket), [
    "sub_theme",
    "theme",
    "industry_group",
  ]);
  assert.equal(filters.length, ANALYSIS_PEER_PROVIDER_MAX_REQUESTS);
});

test("provider rows retain only active US-listed operating equities", () => {
  const candidates = normalizeAnalysisPeerProviderRows([
    providerRow("GOOD", "Good Medical", "NASDAQ", 10_000_000, 12),
    providerRow("LARGE", "Large Medical", "NYSE", 50_000_000, 30),
    providerRow("ETF", "Medical ETF", "NYSE", 60_000_000, 20, { isEtf: true }),
    providerRow("OTC", "OTC Medical", "OTC", 70_000_000, 8),
    providerRow("HALT", "Inactive Medical", "AMEX", 20_000_000, 5, {
      isActivelyTrading: false,
    }),
    providerRow("ZERO", "Zero Price", "NASDAQ", 10_000_000, 0),
  ], "industry_group");

  assert.deepEqual(candidates.map((candidate) => candidate.symbol), [
    "LARGE",
    "GOOD",
  ]);
  assert.ok(candidates.every((candidate) => candidate.source === "filler"));
  assert.ok(
    candidates.every(
      (candidate) => candidate.fillerBucket === "industry_group",
    ),
  );
});

test("provider profiles hydrate missing related company identity without guessing", () => {
  const companies = normalizeAnalysisPeerProviderCompanies([
    {
      companyName: "Ion Quantum Systems",
      exchangeShortName: "NYSE",
      symbol: "IQS",
    },
    {
      companyName: "OTC Quantum Systems",
      exchangeShortName: "OTC",
      symbol: "OTCQ",
    },
  ]);

  assert.deepEqual(companies, [{
    companyName: "Ion Quantum Systems",
    exchange: "NYSE",
    symbol: "IQS",
  }]);
});

test("resolver calls the server provider only when local selection is short", () => {
  const resolver = read("lib/analysisMarketContext.ts");
  const provider = read("lib/analysisPeerProvider.ts");

  assert.match(
    resolver,
    /if \(localSelection\.length < ANALYSIS_PEER_LIMIT\) \{[\s\S]*loadAnalysisPeerProviderFillers\(/,
  );
  assert.match(
    resolver,
    /limit: ANALYSIS_PEER_LIMIT - localSelection\.length/,
  );
  assert.match(provider, /import "server-only"/);
  assert.match(provider, /createMarketRequestCoalescer\(\)/);
  assert.match(provider, /analysisPeerProviderCacheTtlMs = 60 \* 60 \* 1000/);
  assert.match(provider, /ANALYSIS_PEER_PROVIDER_RESULT_LIMIT/);
  assert.match(provider, /const analysisPeerProfileConcurrency = 3/);
  assert.match(resolver, /loadAnalysisPeerProviderCompanies\(/);
  assert.doesNotMatch(provider, /NEXT_PUBLIC_/);
});

function providerRow(
  symbol: string,
  companyName: string,
  exchangeShortName: string,
  marketCap: number,
  price: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    companyName,
    exchangeShortName,
    isActivelyTrading: true,
    isEtf: false,
    isFund: false,
    marketCap,
    price,
    symbol,
    ...overrides,
  };
}

function read(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}
