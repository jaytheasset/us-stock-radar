import assert from "node:assert/strict";
import test from "node:test";
import { applyEventTickerRelationshipFilter } from "./eventTickerLinkage.ts";
import {
  readValidFmpServiceTickerRow,
  resolveIssuerLinkedTickersFromCatalog,
} from "./serviceTickerCatalogPolicy.ts";

const alphabetSecIssuerRows = ["GOOG", "GOOGL", "GOOGM", "GOOGN"].map(
  (symbol) => ({
    symbol,
    metadata: { sec_cik: "1652044", source: "sec" },
  }),
);

const alphabetFmpTickerRows = [
  {
    symbol: "GOOG",
    name: "Alphabet Inc. Class C",
    exchange: "NASDAQ",
    asset_type: "stock",
    is_active: true,
    metadata: { provider: "fmp" },
  },
  {
    symbol: "GOOGL",
    name: "Alphabet Inc. Class A",
    exchange: "NASDAQ",
    asset_type: "adr_or_class",
    is_active: true,
    metadata: { provider: "fmp" },
  },
  {
    symbol: "GOOGM",
    name: "",
    exchange: "NASDAQ",
    asset_type: "stock",
    is_active: true,
    metadata: { provider: "fmp" },
  },
  {
    symbol: "GOOGN",
    name: "Alphabet unit",
    exchange: "NASDAQ",
    asset_type: "unit",
    is_active: true,
    metadata: { provider: "fmp" },
  },
];

test("FMP service policy requires active named exchange-listed stock or ADR rows", () => {
  assert.ok(readValidFmpServiceTickerRow(alphabetFmpTickerRows[0]));
  assert.equal(
    readValidFmpServiceTickerRow({
      symbol: "MISS",
      name: "Missing Exchange Corp.",
      exchange: "",
      asset_type: "stock",
      is_active: true,
      metadata: { provider: "fmp" },
    }),
    null,
  );
  assert.equal(
    readValidFmpServiceTickerRow({
      symbol: "SECO",
      name: "SEC-only Catalog Corp.",
      exchange: "NYSE",
      asset_type: "stock",
      is_active: true,
      metadata: { source: "sec" },
    }),
    null,
  );
  assert.equal(readValidFmpServiceTickerRow(alphabetFmpTickerRows[2]), null);
  assert.equal(readValidFmpServiceTickerRow(alphabetFmpTickerRows[3]), null);
});

for (const [requestedTicker, expectedTickers] of [
  ["GOOG", ["GOOG", "GOOGL"]],
  ["GOOGL", ["GOOGL", "GOOG"]],
] as const) {
  test(`${requestedTicker} search intersects SEC CIK candidates with FMP-valid tickers`, () => {
    const linked = resolveIssuerLinkedTickersFromCatalog({
      requestedTickers: [requestedTicker],
      requestedSecIssuerRows: alphabetSecIssuerRows.filter(
        (row) => row.symbol === requestedTicker,
      ),
      secIssuerCandidateRows: alphabetSecIssuerRows,
      fmpTickerRows: alphabetFmpTickerRows,
    });
    const search = applyEventTickerRelationshipFilter({ select: "*" }, linked);

    assert.deepEqual(linked, expectedTickers);
    assert.equal(
      search["ticker_links.symbol"],
      `in.(${expectedTickers.join(",")})`,
    );
    assert.equal(linked.includes("GOOGM"), false);
    assert.equal(linked.includes("GOOGN"), false);
  });
}

test("an FMP-invalid or unregistered requested SEC code cannot expand to valid CIK events", () => {
  const linked = resolveIssuerLinkedTickersFromCatalog({
    requestedTickers: ["GOOGM"],
    requestedSecIssuerRows: alphabetSecIssuerRows.filter(
      (row) => row.symbol === "GOOGM",
    ),
    secIssuerCandidateRows: alphabetSecIssuerRows,
    fmpTickerRows: alphabetFmpTickerRows,
  });
  const search = applyEventTickerRelationshipFilter({ select: "*" }, linked);

  assert.deepEqual(linked, ["GOOGM"]);
  assert.equal(search["ticker_links.symbol"], "eq.GOOGM");
});

test("generic search keeps SEC CIK evidence separate from FMP trading eligibility", () => {
  const secIssuerRows = [
    "ABCD",
    "ABCE",
    "ABCF",
    "ABCG",
    "ABCH",
    "ABCI",
    "ABCJ",
    "ABCK",
    "ABCL",
  ].map((symbol) => ({
    symbol,
    metadata: { sec_cik: "9876543", source: "sec" },
  }));
  const fmpTickerRows = [
    {
      symbol: "ABCD",
      name: "Example Holdings Common Stock",
      exchange: "NYSE",
      asset_type: "stock",
      is_active: true,
      metadata: { provider: "fmp" },
    },
    {
      symbol: "ABCE",
      name: "Example Holdings Class A",
      exchange: "NYSE",
      asset_type: "stock",
      is_active: true,
      metadata: { provider: "fmp" },
    },
    {
      symbol: "ABCF",
      name: "Example Holdings ADR",
      exchange: "NASDAQ",
      asset_type: "adr_or_class",
      is_active: true,
      metadata: { provider: "fmp" },
    },
    {
      symbol: "ABCG",
      name: "Example Holdings Inactive Class",
      exchange: "NYSE",
      asset_type: "stock",
      is_active: false,
      metadata: { provider: "fmp" },
    },
    {
      symbol: "ABCH",
      name: "",
      exchange: "NYSE",
      asset_type: "stock",
      is_active: true,
      metadata: { provider: "fmp" },
    },
    {
      symbol: "ABCI",
      name: "Example Holdings Unit",
      exchange: "NYSE",
      asset_type: "unit",
      is_active: true,
      metadata: { provider: "fmp" },
    },
    {
      symbol: "ABCK",
      name: "Example Holdings Missing Exchange",
      exchange: "",
      asset_type: "stock",
      is_active: true,
      metadata: { provider: "fmp" },
    },
    {
      symbol: "ABCL",
      name: "Example Holdings SEC-only Row",
      exchange: "NYSE",
      asset_type: "stock",
      is_active: true,
      metadata: { source: "sec" },
    },
    {
      symbol: "WXYZ",
      name: "Unrelated FMP Company",
      exchange: "NYSE",
      asset_type: "stock",
      is_active: true,
      metadata: { provider: "fmp" },
    },
  ];
  const linked = resolveIssuerLinkedTickersFromCatalog({
    requestedTickers: ["ABCD"],
    requestedSecIssuerRows: secIssuerRows.filter(
      (row) => row.symbol === "ABCD",
    ),
    secIssuerCandidateRows: secIssuerRows,
    fmpTickerRows,
  });
  const lookupFailure = resolveIssuerLinkedTickersFromCatalog({
    requestedTickers: ["ABCD"],
    requestedSecIssuerRows: secIssuerRows.filter(
      (row) => row.symbol === "ABCD",
    ),
    secIssuerCandidateRows: secIssuerRows,
    fmpTickerRows: [],
  });
  const search = applyEventTickerRelationshipFilter({ select: "*" }, linked);

  assert.deepEqual(linked, ["ABCD", "ABCE", "ABCF"]);
  assert.deepEqual(lookupFailure, ["ABCD"]);
  assert.equal(search["ticker_links.symbol"], "in.(ABCD,ABCE,ABCF)");
});

test("post-FMP-sync merged rows retain SEC CIK for GOOG and GOOGL query expansion", () => {
  const mergedTickerRows = ["GOOG", "GOOGL"].map((symbol) => ({
    symbol,
    name: symbol === "GOOG" ? "Alphabet Inc. Class C" : "Alphabet Inc. Class A",
    exchange: "NASDAQ",
    asset_type: symbol === "GOOG" ? "stock" : "adr_or_class",
    is_active: true,
    metadata: {
      sec_cik: "0001652044",
      source: "sec",
      provider: "fmp",
      raw: { isActivelyTrading: true, symbol },
    },
  }));

  for (const requestedTicker of ["GOOG", "GOOGL"]) {
    const linked = resolveIssuerLinkedTickersFromCatalog({
      requestedTickers: [requestedTicker],
      requestedSecIssuerRows: mergedTickerRows.filter(
        (row) => row.symbol === requestedTicker,
      ),
      secIssuerCandidateRows: mergedTickerRows,
      fmpTickerRows: mergedTickerRows,
    });
    const search = applyEventTickerRelationshipFilter({ select: "*" }, linked);

    assert.deepEqual(new Set(linked), new Set(["GOOG", "GOOGL"]));
    assert.match(search["ticker_links.symbol"], /^in\.\((?:GOOG,GOOGL|GOOGL,GOOG)\)$/);
  }
});
