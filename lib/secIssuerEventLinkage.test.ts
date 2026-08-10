import assert from "node:assert/strict";
import test from "node:test";
import { normalizeStoredAlertTickers } from "./alerts/delivery/alertTickerNormalization.ts";
import {
  buildSecFilingGroupDedupe,
  buildSecIssuerEventTickerRows,
  buildSecIssuerSecurityLinkageMetadata,
  readSecAnalysisContextTickers,
  resolveSecIssuerProductTickerState,
  resolveSecIssuerSecurityEvidence,
  resolveSecIssuerSecurityLinkage,
} from "./secIssuerEventLinkage.ts";

const alphabetSecurities = [
  { ticker: "GOOGL", exchange: "Nasdaq" },
  { ticker: "GOOG", exchange: "Nasdaq" },
  { ticker: "GOOGM", exchange: "Nasdaq" },
  { ticker: "GOOGN", exchange: "Nasdaq" },
];

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
    name: "Alphabet non-product security",
    exchange: "NASDAQ",
    asset_type: "unit",
    is_active: true,
    metadata: { provider: "fmp" },
  },
];

const genericSecIssuerSecurities = [
  { ticker: "ABCD", exchange: "NYSE" },
  { ticker: "ABCE", exchange: "NYSE" },
  { ticker: "ABCF", exchange: "Nasdaq" },
  { ticker: "ABCG", exchange: "NYSE" },
  { ticker: "ABCH", exchange: "NYSE" },
  { ticker: "ABCI", exchange: "NYSE" },
  { ticker: "ABCJ", exchange: "NYSE" },
  { ticker: "ABCK", exchange: "NYSE" },
  { ticker: "ABCL", exchange: "NYSE" },
];

const genericFmpTickerRows = [
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

test("Alphabet keeps source-backed GOOG primary and links only service-valid securities", () => {
  const linkage = resolveSecIssuerSecurityLinkage({
    cik: "1652044",
    ticker: "GOOG",
    ticker_resolution: { source: "accession_cik_sec" },
    tickers: alphabetSecurities,
  }, alphabetFmpTickerRows);

  assert.ok(linkage);
  assert.equal(linkage.issuerCik, "0001652044");
  assert.equal(linkage.displaySecurity.ticker, "GOOG");
  assert.deepEqual(
    linkage.securities.map((security) => security.ticker),
    ["GOOG", "GOOGL"],
  );

  const rows = buildSecIssuerEventTickerRows("event-1", linkage);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.symbol, row.role]),
    [
      ["GOOG", "primary"],
      ["GOOGL", "related"],
    ],
  );
  assert.ok(rows.every((row) => row.event_id === "event-1"));
  assert.ok(
    rows.every((row) => row.metadata.issuer_cik === "0001652044"),
  );
  assert.deepEqual(buildSecIssuerSecurityLinkageMetadata(linkage).tickers, [
    "GOOG",
    "GOOGL",
  ]);
});

test("Alphabet keeps source-backed GOOGL primary instead of applying CIK ticker heuristics", () => {
  const linkage = resolveSecIssuerSecurityLinkage({
    cik: "1652044",
    ticker: "GOOGL",
    ticker_resolution: { source: "issuer_trading_symbol_and_cik_sec" },
    tickers: alphabetSecurities,
  }, alphabetFmpTickerRows);

  assert.ok(linkage);
  assert.equal(linkage.displaySecurity.ticker, "GOOGL");
  const rows = buildSecIssuerEventTickerRows("event-2", linkage);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [
      row.symbol,
      row.role,
    ]),
    [
      ["GOOGL", "primary"],
      ["GOOG", "related"],
    ],
  );
  assert.deepEqual(buildSecIssuerSecurityLinkageMetadata(linkage).tickers, [
    "GOOGL",
    "GOOG",
  ]);
  assert.deepEqual(
    linkage.excludedSecurities.map((security) => security.ticker),
    ["GOOGM", "GOOGN"],
  );
});

test("catalog lookup failure or incomplete catalog data excludes additional issuer links", () => {
  const rawPayload = {
    cik: "1652044",
    ticker: "GOOG",
    ticker_resolution: { source: "accession_cik_sec" },
    tickers: alphabetSecurities,
  };

  const lookupFailure = resolveSecIssuerSecurityLinkage(rawPayload);
  const incompleteRows = resolveSecIssuerSecurityLinkage(rawPayload, [
    {
      symbol: "GOOGL",
      name: "",
      exchange: "NASDAQ",
      asset_type: "stock",
      is_active: true,
      metadata: { provider: "fmp" },
    },
    {
      symbol: "GOOGM",
      name: "Alphabet",
      exchange: "NASDAQ",
      asset_type: "stock",
      is_active: false,
      metadata: { provider: "fmp" },
    },
  ]);

  assert.equal(lookupFailure, null);
  assert.equal(incompleteRows, null);
});

test("SEC CIK evidence intersects FMP ticker rows before product linkage", () => {
  const rawPayload = {
    cik: "9876543",
    ticker: "ABCD",
    ticker_resolution: { source: "issuer_trading_symbol_and_cik_sec" },
    tickers: genericSecIssuerSecurities,
  };
  const linkage = resolveSecIssuerSecurityLinkage(
    rawPayload,
    genericFmpTickerRows,
  );
  const lookupFailure = resolveSecIssuerSecurityLinkage(rawPayload);

  assert.ok(linkage);
  assert.equal(lookupFailure, null);
  assert.deepEqual(
    linkage.candidateSecurities.map((security) => security.ticker),
    [
      "ABCD",
      "ABCE",
      "ABCF",
      "ABCG",
      "ABCH",
      "ABCI",
      "ABCJ",
      "ABCK",
      "ABCL",
    ],
  );
  assert.deepEqual(
    linkage.securities.map((security) => security.ticker),
    ["ABCD", "ABCE", "ABCF"],
  );
  assert.deepEqual(
    linkage.excludedSecurities.map((security) => security.ticker),
    ["ABCG", "ABCH", "ABCI", "ABCJ", "ABCK", "ABCL"],
  );
  const eventTickerRows = buildSecIssuerEventTickerRows("event-generic", linkage);
  assert.deepEqual(
    eventTickerRows.map((row) => [row.symbol, row.role]),
    [
      ["ABCD", "primary"],
      ["ABCE", "related"],
      ["ABCF", "related"],
    ],
  );
  assert.deepEqual(buildSecIssuerSecurityLinkageMetadata(linkage).tickers, [
    "ABCD",
    "ABCE",
    "ABCF",
  ]);
  assert.deepEqual(
    normalizeStoredAlertTickers("ABCD", eventTickerRows).tickers,
    ["ABCD", "ABCE", "ABCF"],
  );
});

test("FMP-invalid source blocks issuer linkage but preserves analysis context tickers", () => {
  const rawPayload = {
    cik: "9876543",
    ticker: "BADX",
    ticker_resolution: { source: "issuer_trading_symbol_and_cik_sec" },
    tickers: [
      { ticker: "BADX", exchange: "NYSE" },
      { ticker: "ABCE", exchange: "NYSE" },
    ],
  };
  const validSibling = genericFmpTickerRows.find(
    (row) => row.symbol === "ABCE",
  );
  assert.ok(validSibling);

  const invalidSourceRows = [
    null,
    {
      symbol: "BADX",
      name: "Inactive Source Corp.",
      exchange: "NYSE",
      asset_type: "stock",
      is_active: false,
      metadata: { provider: "fmp" },
    },
    {
      symbol: "BADX",
      name: "Source Unit",
      exchange: "NYSE",
      asset_type: "unit",
      is_active: true,
      metadata: { provider: "fmp" },
    },
    {
      symbol: "BADX",
      name: "",
      exchange: "NYSE",
      asset_type: "stock",
      is_active: true,
      metadata: { provider: "fmp" },
    },
    {
      symbol: "BADX",
      name: "Missing Exchange Source Corp.",
      exchange: "",
      asset_type: "stock",
      is_active: true,
      metadata: { provider: "fmp" },
    },
  ];
  const analysisContextTickers = readSecAnalysisContextTickers({
    tickers: [
      {
        ticker: "SPY",
        exchange: "NYSEARCA",
        role: "theme_constituent",
        reason: "Broad market context",
      },
    ],
    related_tickers: [
      {
        ticker: "QQQ",
        exchange: "NASDAQ",
        reason: "Technology market context",
      },
    ],
  });

  for (const invalidSourceRow of invalidSourceRows) {
    const evidence = resolveSecIssuerSecurityEvidence(rawPayload);
    const linkage = resolveSecIssuerSecurityLinkage(rawPayload, [
      validSibling,
      ...(invalidSourceRow ? [invalidSourceRow] : []),
    ]);
    const tickerState = resolveSecIssuerProductTickerState({
      evidence,
      fallback: { ticker: "ABCE", exchange: "NYSE" },
      linkage,
    });
    const issuerEventTickerRows = linkage
      ? buildSecIssuerEventTickerRows("event-invalid-source", linkage)
      : [];
    const contextEventTickerRows = analysisContextTickers.map((candidate, index) => ({
      symbol: candidate.ticker,
      role: candidate.role,
      sort_order: index + 1,
    }));
    const eventTickerRows = [
      ...issuerEventTickerRows,
      ...contextEventTickerRows,
    ];
    const issuerLinkageMetadata = linkage
      ? buildSecIssuerSecurityLinkageMetadata(linkage)
      : null;
    const alertShape = normalizeStoredAlertTickers(
      tickerState.primarySecurity.ticker,
      eventTickerRows,
    );

    assert.ok(evidence);
    assert.deepEqual(
      evidence.candidateSecurities.map((security) => security.ticker),
      ["BADX", "ABCE"],
    );
    assert.equal(linkage, null);
    assert.deepEqual(tickerState.primarySecurity, {
      exchange: null,
      ticker: null,
    });
    assert.deepEqual(issuerEventTickerRows, []);
    assert.deepEqual(
      eventTickerRows.map((row) => [row.symbol, row.role]),
      [
        ["SPY", "theme_constituent"],
        ["QQQ", "related"],
      ],
    );
    assert.equal(issuerLinkageMetadata, null);
    assert.equal(alertShape.primaryTicker, "SPY");
    assert.deepEqual(alertShape.tickers, ["SPY", "QQQ"]);
  }
});

test("issuer linkage rejects ticker arrays without trusted CIK catalog evidence", () => {
  assert.equal(
    resolveSecIssuerSecurityLinkage({
      cik: "1652044",
      ticker_resolution: { source: "llm" },
      tickers: alphabetSecurities,
    }),
    null,
  );
});

test("the same accession produces one event identity across ticker and form variants", () => {
  const goog = buildSecFilingGroupDedupe({
    id: "raw-goog",
    source_unique_id: "0001652044-26-000100",
    raw_payload: {
      accession_number: "0001652044-26-000100",
      form_type: "10-Q",
      ticker: "GOOG",
    },
  });
  const googl = buildSecFilingGroupDedupe({
    id: "raw-googl",
    source_unique_id: "GOOGL-copy",
    raw_payload: {
      accession_number: "000165204426000100",
      form_type: "8-K",
      ticker: "GOOGL",
    },
  });

  assert.equal(
    goog.groupDedupeKey,
    "sec_edgar:accession:0001652044-26-000100",
  );
  assert.equal(googl.groupDedupeKey, goog.groupDedupeKey);
  assert.equal(new Set([goog.groupDedupeKey, googl.groupDedupeKey]).size, 1);
  assert.equal(goog.accessionNumber, googl.accessionNumber);
  assert.ok(goog.lookupGroupDedupeKeys.includes(goog.legacyGroupDedupeKey));
  assert.ok(googl.lookupGroupDedupeKeys.includes(googl.legacyGroupDedupeKey));
});
