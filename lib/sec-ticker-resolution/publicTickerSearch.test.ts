import assert from "node:assert/strict";
import test from "node:test";
import {
  readIssuerBoundPublicSecTickerSourceFiling,
  readIssuerBoundPublicStockTickerProjection,
  readProjectedCurrentSecTicker,
} from "./publicTickerSearch.ts";

test("binds a projected current ticker to the exact SEC issuer", () => {
  assert.deepEqual(
    readProjectedCurrentSecTicker(
      [{ cik_str: 1854445, ticker: "BTLN", title: "The Glimpse Group, Inc." }],
      "BTLN",
      "0001854445",
    ),
    {
      assetType: "stock",
      companyName: "The Glimpse Group, Inc.",
      exchange: null,
      marketCap: null,
      ticker: "BTLN",
    },
  );
});

test("blocks a direct source page when its projected current ticker is not issuer-bound", async () => {
  const filing = {
    accessionNumber: "0001493152-26-039128",
    acceptedAt: "2026-08-19T12:10:31.000Z",
    currentTicker: "BTLN",
    detailHref: "/filings/source/92f17062-2c62-5736-97bf-428e0d779585/before",
    exchange: "NASDAQ",
    filedDate: "2026-08-19",
    formType: "8-K",
    historicalTicker: "GGRP",
    issuerCik: "0001854445",
    securityTitle: "Common Stock",
    sourceDocument: "form8-k.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1854445/filing.htm",
  } as const;
  const result = await readIssuerBoundPublicSecTickerSourceFiling(
    { decisionId: "92f17062-2c62-5736-97bf-428e0d779585", side: "before" },
    {
      readSourceFiling: async () => filing,
      readProjection: async () => ({
        status: "available",
        currentTicker: "BTLN",
        historicalTickers: ["VRAR", "GGRP"],
        issuerCik: "0001854445",
        sourceFilings: [filing],
      }),
      fetchCompanyTickers: async () => ({
        ok: true,
        status: 200,
        data: [{ cik_str: 9999999, ticker: "BTLN", title: "Different issuer" }],
        count: 1,
        error: undefined,
      }),
    },
  );

  assert.equal(result, null);
});

test("returns the latest bound source DTO when the chain changes between source reads", async () => {
  const stale = sourceFiling({ currentTicker: "GGRP" });
  const latest = sourceFiling({ currentTicker: "BTLN" });
  const result = await readIssuerBoundPublicSecTickerSourceFiling(
    { decisionId: "92f17062-2c62-5736-97bf-428e0d779585", side: "before" },
    {
      readSourceFiling: async () => stale,
      readProjection: async () => ({
        status: "available",
        currentTicker: "BTLN",
        historicalTickers: ["VRAR", "GGRP"],
        issuerCik: "0001854445",
        sourceFilings: [latest],
      }),
      fetchCompanyTickers: async () => ({
        ok: true,
        status: 200,
        data: [{ cik_str: 1854445, ticker: "BTLN", title: "Expected issuer" }],
        count: 1,
        error: undefined,
      }),
    },
  );

  assert.deepEqual(result, latest);
});

function sourceFiling(overrides: { currentTicker: string }) {
  return {
    accessionNumber: "0001493152-26-039128",
    acceptedAt: "2026-08-19T12:10:31.000Z",
    currentTicker: overrides.currentTicker,
    detailHref: "/filings/source/92f17062-2c62-5736-97bf-428e0d779585/before",
    exchange: "NASDAQ",
    filedDate: "2026-08-19",
    formType: "8-K",
    historicalTicker: "GGRP",
    issuerCik: "0001854445",
    securityTitle: "Common Stock",
    sourceDocument: "form8-k.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1854445/filing.htm",
  } as const;
}

test("rejects ticker reuse, ambiguity, and issuer mismatch", () => {
  assert.equal(
    readProjectedCurrentSecTicker(
      [{ cik_str: 9999999, ticker: "BTLN", title: "Different issuer" }],
      "BTLN",
      "0001854445",
    ),
    null,
  );
  assert.equal(
    readProjectedCurrentSecTicker(
      [
        { cik_str: 1854445, ticker: "BTLN", title: "Expected issuer" },
        { cik_str: 9999999, ticker: "BTLN", title: "Conflicting issuer" },
      ],
      "BTLN",
      "0001854445",
    ),
    null,
  );
  assert.equal(
    readProjectedCurrentSecTicker(
      [
        { cik_str: 1854445, ticker: "BTLN", title: "Issuer A" },
        { cik_str: 1854445, ticker: "BTLN", title: "Issuer A duplicate" },
      ],
      "BTLN",
      "0001854445",
    ),
    null,
  );
});

test("blocks source filings on a current detail route when the ticker belongs to another issuer", async () => {
  const result = await readIssuerBoundPublicStockTickerProjection("BTLN", {
    readProjection: async () => ({
      status: "available",
      currentTicker: "BTLN",
      historicalTickers: ["VRAR", "GGRP"],
      issuerCik: "0001854445",
      sourceFilings: [],
    }),
    fetchCompanyTickers: async () => ({
      ok: true,
      status: 200,
      data: [{ cik_str: 9999999, ticker: "BTLN", title: "Different issuer" }],
      count: 1,
      error: undefined,
    }),
  });

  assert.deepEqual(result, {
    status: "unavailable",
    reason: "projection_current_issuer_not_confirmed",
  });
});
