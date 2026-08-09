import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSecFilingGroupDedupe,
  buildSecIssuerEventTickerRows,
  resolveSecIssuerSecurityLinkage,
} from "./secIssuerEventLinkage.ts";

const alphabetSecurities = [
  { ticker: "GOOGL", exchange: "Nasdaq" },
  { ticker: "GOOG", exchange: "Nasdaq" },
  { ticker: "GOOGM", exchange: "Nasdaq" },
  { ticker: "GOOGN", exchange: "Nasdaq" },
];

test("Alphabet CIK resolves one deterministic display ticker and every verified SEC security", () => {
  const linkage = resolveSecIssuerSecurityLinkage({
    cik: "1652044",
    ticker: "GOOG",
    ticker_resolution: { source: "accession_cik_sec" },
    tickers: alphabetSecurities,
  });

  assert.ok(linkage);
  assert.equal(linkage.issuerCik, "0001652044");
  assert.equal(linkage.displaySecurity.ticker, "GOOG");
  assert.deepEqual(
    linkage.securities.map((security) => security.ticker),
    ["GOOGL", "GOOG", "GOOGM", "GOOGN"],
  );

  const rows = buildSecIssuerEventTickerRows("event-1", linkage);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((row) => [row.symbol, row.role]),
    [
      ["GOOG", "primary"],
      ["GOOGL", "related"],
      ["GOOGM", "related"],
      ["GOOGN", "related"],
    ],
  );
  assert.ok(rows.every((row) => row.event_id === "event-1"));
  assert.ok(
    rows.every((row) => row.metadata.issuer_cik === "0001652044"),
  );
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
  assert.equal(goog.accessionNumber, googl.accessionNumber);
  assert.ok(goog.lookupGroupDedupeKeys.includes(goog.legacyGroupDedupeKey));
  assert.ok(googl.lookupGroupDedupeKeys.includes(googl.legacyGroupDedupeKey));
});
