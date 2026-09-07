import assert from "node:assert/strict";
import test from "node:test";
import {
  periodicFinancialAuditSample,
  preparePeriodicFinancialAuditSample,
} from "../monitor/periodicFinancialAuditFixture.testSupport.ts";
import { resolvePeriodicFinancialHistory } from "../sec-structured-data/periodicFinancialHistory.ts";
import {
  buildStockFinancialsSnapshot,
  subtractCanonicalDecimals,
  type StockFinancialDisplayRow,
} from "./stockFinancials.ts";

test("AAPL SEC history produces separate quarter, YTD, annual, instant, prior-year, and exact delta rows", () => {
  const history = historyFor([
    "AAPL 2026 Q3 10-Q",
    "AAPL 2025 Q3 10-Q",
    "AAPL 2025 10-K",
    "AAPL 2024 10-K",
  ]);
  const snapshot = buildStockFinancialsSnapshot({
    fetchedAt: "2026-09-07T00:00:00.000Z",
    history,
    symbol: "aapl",
  });

  assert.equal(snapshot.source, "SEC_XBRL");
  assert.equal(snapshot.gptDependency, false);
  assert.equal(snapshot.quarterly.latestFiling?.form, "10-Q");
  assert.equal(snapshot.annual.latestFiling?.form, "10-K");

  const quarterlyRevenue = available(snapshot.quarterly.rows, "REVENUE");
  assert.equal(quarterlyRevenue.basis, "QUARTER");
  assert.equal(quarterlyRevenue.value.value, "109417000000");
  assert.equal(quarterlyRevenue.priorYear?.value, "94036000000");
  assert.equal(quarterlyRevenue.delta, "15381000000");
  assert.equal(quarterlyRevenue.value.currency, "USD");
  assert.equal(quarterlyRevenue.provenance.form, "10-Q");
  assert.equal(quarterlyRevenue.provenance.reportDate, "2026-06-27");
  assert.match(quarterlyRevenue.provenance.sourceUrls[0] ?? "", /^https:\/\/www\.sec\.gov\/Archives\//);

  const quarterlyOcf = row(snapshot.quarterly.rows, "OPERATING_CASH_FLOW");
  assert.equal(quarterlyOcf.status, "UNAVAILABLE");
  assert.equal(quarterlyOcf.reason, "BASIS_NOT_REPORTED");
  const ytdOcf = available(snapshot.quarterly.ytdRows, "OPERATING_CASH_FLOW");
  assert.equal(ytdOcf.basis, "YEAR_TO_DATE");
  assert.equal(ytdOcf.value.value, "116996000000");
  assert.equal(ytdOcf.priorYear?.value, "81754000000");
  assert.equal(ytdOcf.delta, "35242000000");

  const quarterlyCash = available(snapshot.quarterly.rows, "CASH");
  assert.equal(quarterlyCash.basis, "INSTANT");
  assert.equal(quarterlyCash.priorYear, null);
  assert.equal(quarterlyCash.delta, null);

  const annualRevenue = available(snapshot.annual.rows, "REVENUE");
  assert.equal(annualRevenue.basis, "ANNUAL");
  assert.equal(annualRevenue.value.value, "416161000000");
  assert.equal(annualRevenue.priorYear?.value, "391035000000");
  assert.equal(annualRevenue.delta, "25126000000");
});

test("20-F remains available and a partial 40-F keeps only its missing metric unavailable", () => {
  const wix = buildStockFinancialsSnapshot({
    history: historyFor(["WIX 2025 20-F US-GAAP FPI", "WIX 2024 20-F US-GAAP FPI"]),
    symbol: "WIX",
  });
  assert.equal(wix.annual.rows.every((entry) => entry.status === "AVAILABLE"), true);
  assert.equal(available(wix.annual.rows, "REVENUE").provenance.form, "20-F");

  const fortyF = buildStockFinancialsSnapshot({
    history: historyFor(["Synthetic IFRS 40-F contract"]),
    symbol: "TEST",
  });
  assert.equal(row(fortyF.annual.rows, "OPERATING_INCOME_LOSS").status, "UNAVAILABLE");
  assert.equal(available(fortyF.annual.rows, "REVENUE").value.currency, "CAD");
  assert.equal(available(fortyF.annual.rows, "NET_INCOME_LOSS").status, "AVAILABLE");
  assert.equal(available(fortyF.annual.rows, "OPERATING_CASH_FLOW").status, "AVAILABLE");
  assert.equal(available(fortyF.annual.rows, "CASH").status, "AVAILABLE");
});

test("a conflicting prior-year series point never leaks into comparison or delta", () => {
  const latest = preparePeriodicFinancialAuditSample(periodicFinancialAuditSample("AAPL 2025 10-K"));
  const earlier = preparePeriodicFinancialAuditSample(periodicFinancialAuditSample("AAPL 2024 10-K"));
  for (const fact of earlier.filingXbrl.facts) {
    fact.concept = { ...fact.concept, namespaceUri: "http://fasb.org/us-gaap/2025" };
  }
  const filingFact = earlier.filingXbrl.facts.find((fact) =>
    fact.concept.localName === "RevenueFromContractWithCustomerExcludingAssessedTax"
    && fact.context.period.kind === "duration"
    && fact.context.period.endDate === "2024-09-28"
  )!;
  filingFact.valueText = "391,034";
  const companyFact = earlier.companyFacts.find((fact) =>
    fact.concept === "RevenueFromContractWithCustomerExcludingAssessedTax"
    && fact.endDate === "2024-09-28"
  )!;
  companyFact.valueNumeric = "391034000000";

  const history = resolvePeriodicFinancialHistory({
    companyFacts: [...latest.companyFacts, ...earlier.companyFacts],
    filingInputs: [latest, earlier].map((item) => ({
      filingXbrl: item.filingXbrl,
      targetAccession: item.filing.accessionNumber,
    })),
    filings: [latest.filing, earlier.filing],
    issuerCik: latest.filing.issuerCik,
  });
  const snapshot = buildStockFinancialsSnapshot({ history, symbol: "AAPL" });
  const revenue = available(snapshot.annual.rows, "REVENUE");
  assert.equal(revenue.value.value, "416161000000");
  assert.equal(revenue.priorYear, null);
  assert.equal(revenue.delta, null);
  assert.equal(JSON.stringify(snapshot).includes("391034000000"), false);
  assert.equal(JSON.stringify(snapshot).includes("391035000000"), false);
});

test("canonical decimal subtraction is exact and fail-closed", () => {
  assert.equal(subtractCanonicalDecimals("100.25", "99.9"), "0.35");
  assert.equal(subtractCanonicalDecimals("-10", "5.5"), "-15.5");
  assert.equal(subtractCanonicalDecimals("0", "0"), "0");
  assert.equal(subtractCanonicalDecimals("1e3", "2"), null);
});

function historyFor(labels: string[]) {
  const prepared = labels.map((label) =>
    preparePeriodicFinancialAuditSample(periodicFinancialAuditSample(label))
  );
  const issuerCik = prepared[0]!.filing.issuerCik;
  return resolvePeriodicFinancialHistory({
    companyFacts: prepared.flatMap((item) => item.companyFacts),
    filingInputs: prepared.map((item) => ({
      filingXbrl: item.filingXbrl,
      targetAccession: item.filing.accessionNumber,
    })),
    filings: prepared.map((item) => item.filing),
    issuerCik,
  });
}

function row(rows: StockFinancialDisplayRow[], metric: string) {
  const found = rows.find((entry) => entry.metric === metric);
  assert.ok(found, `missing ${metric}`);
  return found;
}

function available(rows: StockFinancialDisplayRow[], metric: string) {
  const found = row(rows, metric);
  assert.equal(found.status, "AVAILABLE", `${metric} should be available`);
  if (found.status !== "AVAILABLE") throw new Error(`${metric} unavailable`);
  return found;
}
