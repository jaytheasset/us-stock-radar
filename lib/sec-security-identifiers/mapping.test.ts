import assert from "node:assert/strict";
import test from "node:test";
import { resolveSecSecurityIdentifier, secSecurityClassKey, type SecIdentifierObservation } from "./mapping.ts";
import { secClassTickerObservationsFromCover, secCurrentTickerObservations, secCusipClassObservationsFromSc13 } from "./sources.ts";
import type { Sc13CanonicalReadResult } from "../sec-sc13-xml/persistence.ts";
import type { SecCoverObservationReadResult } from "../sec-cover-observations/persistence.ts";

// Values below are transcribed from the linked SEC filings. The current ticker
// catalog was read on 2026-09-30; these are evidence fixtures, not a live feed.
const catalogUrl = "https://www.sec.gov/files/company_tickers.json";
const resolve = (input: Omit<Parameters<typeof resolveSecSecurityIdentifier>[0], "asOf">) =>
  resolveSecSecurityIdentifier({ ...input, asOf: "2026-09-30" });
function filing(accessionNumber: string, sourceUrl: string, locator: string, observedAt: string) {
  return { accessionNumber, sourceUrl, locator, observedAt };
}
function current(issuerCik: string, ticker: string): SecIdentifierObservation {
  return { kind: "current_ticker", issuerCik, ticker,
    evidence: { sourceUrl: catalogUrl, observedAt: "2026-09-30", locator: `ticker=${ticker}` } };
}

test("AAPL: issuer/class CUSIP plus SEC cover and current catalog produce an evidenced mapping", () => {
  const observations: SecIdentifierObservation[] = [
    { kind: "cusip_class", issuerCik: "0000320193", cusip: "037833100", securityTitle: "Common Stock",
      evidence: filing("0000932471-25-000778", "https://www.sec.gov/Archives/edgar/data/102909/000093247125000778/primary_doc.xml", "Item 2(d)-(e)", "2025-02-13") },
    { kind: "class_ticker", issuerCik: "0000320193", securityTitle: "Common Stock, $0.00001 par value per share", ticker: "AAPL",
      evidence: filing("0000320193-25-000079", "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/R1.htm", "cover 12(b)", "2025-10-31") },
    current("0000320193", "AAPL"),
  ];
  const result = resolve({ cusip: "037833100", observations });
  assert.equal(result.status, "trusted");
  if (result.status === "trusted") {
    assert.equal(result.ticker, "AAPL");
    assert.equal(result.issuerCik, "0000320193");
    assert.equal(result.evidence.length, 3);
    assert.equal(result.currentTickerObservedAt, "2026-09-30");
  }
});

test("Alphabet: separate Class A/GOOGL and Class C/GOOG CUSIPs never collapse by CIK", () => {
  const source = filing("0001193125-26-254474", "https://www.sec.gov/Archives/edgar/data/1652044/000119312526254474/d152589dfwp.htm", "CUSIP and ticker tables", "2026-06-02");
  const observations: SecIdentifierObservation[] = [
    { kind: "cusip_class", issuerCik: "0001652044", cusip: "02079K305", securityTitle: "Class A Common Stock", evidence: { ...source, locator: "CUSIP / ISIN for Class A" } },
    { kind: "cusip_class", issuerCik: "0001652044", cusip: "02079K107", securityTitle: "Class C Capital Stock", evidence: { ...source, locator: "CUSIP / ISIN for Class C" } },
    { kind: "class_ticker", issuerCik: "0001652044", securityTitle: "Class A Common Stock", ticker: "GOOGL", evidence: { ...source, locator: "Ticker / Exchange for Class A" } },
    { kind: "class_ticker", issuerCik: "0001652044", securityTitle: "Class C Capital Stock", ticker: "GOOG", evidence: { ...source, locator: "Ticker / Exchange for Class C" } },
    current("0001652044", "GOOGL"), current("0001652044", "GOOG"),
  ];
  assert.equal(resolve({ cusip: "02079K305", observations }).status, "trusted");
  const classC = resolve({ cusip: "02079K107", observations });
  assert.equal(classC.status, "trusted");
  if (classC.status === "trusted") assert.equal(classC.ticker, "GOOG");
  const ambiguous13g: SecIdentifierObservation = { kind: "cusip_class", issuerCik: "0001652044", cusip: "02079K305",
    securityTitle: "Class A Common Stock, Class B Common Stock",
    evidence: filing("0001193125-26-055590", "https://www.sec.gov/Archives/edgar/data/1652044/000119312526055590/primary_doc.xml", "Item 2(d)-(e)", "2026-02-13") };
  assert.equal(secSecurityClassKey(ambiguous13g.securityTitle), null);
  assert.deepEqual(resolve({ cusip: "02079K305", observations: [...observations, ambiguous13g] }),
    { status: "unmapped", reason: "incomplete_cusip_class_evidence" });
});

test("OmniAb: a warrant CUSIP cannot borrow the common-stock ticker or a holder's issuer-name claim", () => {
  const observations: SecIdentifierObservation[] = [
    { kind: "class_ticker", issuerCik: "0001846253", securityTitle: "Common Stock", ticker: "OABI",
      evidence: filing("0001846253-26-000046", "https://www.sec.gov/Archives/edgar/data/1846253/000184625326000046/R1.htm", "cover common stock", "2026-08-07") },
    { kind: "class_ticker", issuerCik: "0001846253", securityTitle: "Warrants to purchase common stock", ticker: "OABIW",
      evidence: filing("0001846253-26-000046", "https://www.sec.gov/Archives/edgar/data/1846253/000184625326000046/R1.htm", "cover warrants", "2026-08-07") },
    current("0001846253", "OABI"), current("0001846253", "OABIW"),
    { kind: "reported_pair", cusip: "68218J111", ticker: "OABIW",
      evidence: filing("0001711200-23-000005", "https://www.sec.gov/Archives/edgar/data/1711200/000171120023000005/hgc-13f_03312023.xml", "OABIW holding", "2023-05-15") },
  ];
  assert.deepEqual(resolve({ cusip: "68218J111", observations }),
    { status: "unmapped", reason: "no_cusip_class_evidence" });
});

test("AutoZone: conflicting SEC-reported CUSIP/ticker evidence vetoes an otherwise complete chain", () => {
  const observations: SecIdentifierObservation[] = [
    { kind: "cusip_class", issuerCik: "0000866787", cusip: "053332102", securityTitle: "COMMON STOCK",
      evidence: filing("0000080255-16-001097", "https://www.sec.gov/Archives/edgar/data/866787/000008025516001097/azo13gadec15.htm", "cover CUSIP", "2016-02-11") },
    { kind: "class_ticker", issuerCik: "0000866787", securityTitle: "Common Stock", ticker: "AZO",
      evidence: filing("0001104659-26-032757", "https://www.sec.gov/Archives/edgar/data/866787/000110465926032757/R1.htm", "cover 12(b)", "2026-03-20") },
    current("0000866787", "AZO"),
  ];
  assert.equal(resolve({ cusip: "053332102", observations }).status, "trusted");
  observations.push({ kind: "reported_pair", cusip: "053332102", ticker: "SCHW",
    evidence: filing("0000850027-26-000015", "https://www.sec.gov/Archives/edgar/data/850027/000085002726000015/primary_doc.xml", "Charles Schwab holding, Item C.1", "2026-06-30") });
  assert.deepEqual(resolve({ cusip: "053332102", observations }),
    { status: "conflict", reason: "reported_cusip_ticker_conflict" });
});

test("missing class, stale ticker, and conflicting issuer/class never produce a trusted map", () => {
  const source = filing("0001193125-26-254474", "https://www.sec.gov/Archives/edgar/data/1652044/000119312526254474/d152589dfwp.htm", "security table", "2026-06-02");
  const base: SecIdentifierObservation[] = [
    { kind: "cusip_class", issuerCik: "0001652044", cusip: "02079K305", securityTitle: "Class A Common Stock", evidence: source },
    { kind: "class_ticker", issuerCik: "0001652044", ticker: "GOOGL", securityTitle: "Class A Common Stock", evidence: source },
  ];
  assert.deepEqual(resolve({ cusip: "02079K305", observations: base }),
    { status: "unmapped", reason: "not_in_current_sec_ticker_catalog" });
  assert.equal(resolve({ cusip: "02079K305", observations: [...base,
    { kind: "cusip_class", issuerCik: "0000320193", cusip: "02079K305", securityTitle: "Common Stock", evidence: source },
    current("0001652044", "GOOGL")], }).status, "conflict");
  assert.deepEqual(resolveSecSecurityIdentifier({ cusip: "02079K305", asOf: "2026-10-02",
    observations: [...base, current("0001652044", "GOOGL")] }),
    { status: "unmapped", reason: "stale_current_ticker_catalog" });
});

test("existing validated SC13/cover shapes retain source, locator, and timing through the bridge", () => {
  const sc13 = { status: "available", filing: {
    issuer_cik: "0000320193", cusips_raw: ["037833100"], security_class_raw: "Common Stock",
    accession_number: "0000932471-25-000778", filed_at_raw: "2025-02-13",
    source_url: "https://www.sec.gov/Archives/edgar/data/102909/000093247125000778/primary_doc.xml",
    source_sha256: "a".repeat(64),
  }, reporters: [], structural: {} } as unknown as Sc13CanonicalReadResult;
  const cover = { status: "available", results: [{ result: {}, observations: [], payload: {
    source: { url: "https://www.sec.gov/Archives/edgar/data/320193/000032019325000079/R1.htm", sha256: "b".repeat(64) },
    identity: { accessionNumber: "0000320193-25-000079", acceptedAt: "2025-10-31" },
    observations: [{ issuerCik: "0000320193", contextRef: "c0",
      securityTitle: { status: "observed", parsedTextValue: "Common Stock, $0.00001 par value per share" },
      tradingSymbol: { status: "observed", parsedTextValue: "AAPL" } }],
  } }] } as unknown as SecCoverObservationReadResult;
  const observations = [
    ...secCusipClassObservationsFromSc13(sc13),
    ...secClassTickerObservationsFromCover(cover),
    ...secCurrentTickerObservations([{ cik_str: 320193, ticker: "AAPL" }], "2026-09-30"),
  ];
  const result = resolve({ cusip: "037833100", observations });
  assert.equal(result.status, "trusted");
  if (result.status === "trusted") {
    assert.equal(result.evidence[0].evidence.sourceSha256, "a".repeat(64));
    assert.equal(result.evidence[1].evidence.locator, "XBRL cover context c0");
    assert.equal(result.evidence[2].evidence.observedAt, "2026-09-30");
  }
});
