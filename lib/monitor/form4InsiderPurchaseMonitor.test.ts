import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildForm4PurchaseAlertCopy,
  evaluateForm4InsiderPurchase,
  parseStoredForm4PurchaseMatchEvidence,
  type Form4InsiderPurchaseSettings,
  type Form4PurchaseMatchEvidence,
  type Form4PurchaseMatchRow,
} from "./form4InsiderPurchaseMonitor.ts";
import type { CurrentOwnershipReadResult } from "./ownershipMonitorPersistence.ts";
import { buildOwnershipParserFactRows } from "./ownershipParserFacts.ts";

type Row = Record<string, unknown>;

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "../sources/sec/forms/ownership/fixtures");
const eventId = "22222222-2222-4222-8222-222222222222";
const rawItemId = "11111111-1111-4111-8111-111111111111";

test("AGIG real SEC XML matches both direct P-code common-stock purchases without changing raw numbers", () => {
  const current = currentFromFixture("source-agig-form4-purchase.json");
  const result = evaluateForm4InsiderPurchase(current, settings("director"));

  assert.equal(result.status, "match");
  assert.ok(result.evidence);
  assert.equal(result.evidence.ticker, "AGIG");
  assert.equal(result.evidence.matches.length, 2);
  assert.equal(result.trace.rows.length, 2);
  assert.deepEqual(result.trace.rows.map((row) => [row.status, row.reasonCode, row.transactionCode, row.acquisitionDispositionCode, row.directOrIndirectOwnership]), [
    ["match", "matched", "P", "A", "D"],
    ["match", "matched", "P", "A", "D"],
  ]);
  assert.ok(result.trace.rows.every((row) => row.owners.some((owner) => (
    owner.roleStatus === "match"
    && owner.relationStatus === "validated"
    && owner.relationEvidence.length > 0
  ))));
  assert.equal(
    result.evidence.reason,
    "A Form 4 reported two purchases that matched this alert.",
  );
  assert.deepEqual(result.evidence.matches.map((row) => ({
    owner: row.ownerName,
    roles: row.ownerRoles,
    shares: row.shares,
    sharesRaw: row.sharesRaw,
    price: row.pricePerShare,
    priceRaw: row.pricePerShareRaw,
    relation: row.ownershipRelation,
    date: row.transactionDate,
  })), [
    {
      owner: "Bailey Robert J.", roles: ["director"], shares: 1050, sharesRaw: "1050",
      price: 1.195, priceRaw: "1.195", relation: "direct", date: "2026-05-12",
    },
    {
      owner: "Bailey Robert J.", roles: ["director"], shares: 8950, sharesRaw: "8950",
      price: 1.1999, priceRaw: "1.1999", relation: "direct", date: "2026-05-12",
    },
  ]);
  assert.deepEqual(parseStoredForm4PurchaseMatchEvidence(result.evidence), result.evidence);
});

test("AGIG role and minimum-share matrix is literal and row scoped", () => {
  const current = currentFromFixture("source-agig-form4-purchase.json");
  assert.equal(evaluateForm4InsiderPurchase(current, settings("officer")).status, "no_match");
  assert.equal(evaluateForm4InsiderPurchase(current, settings("officer_or_director")).status, "match");

  const eightThousand = evaluateForm4InsiderPurchase(current, settings("director", 8000));
  assert.equal(eightThousand.status, "match");
  assert.deepEqual(eightThousand.evidence?.matches.map((row) => row.sharesRaw), ["8950"]);
  assert.match(eightThousand.evidence?.reason ?? "", /The purchase met the 8,000-share minimum/);
  assert.equal(evaluateForm4InsiderPurchase(current, settings("director", 9000)).status, "no_match");
  assert.equal(
    evaluateForm4InsiderPurchase(current, settings("director", 9000)).reasonCode,
    "minimum_shares_not_met",
  );
  assert.equal(
    evaluateForm4InsiderPurchase(current, settings("officer")).reasonCode,
    "reporting_owner_role_not_met",
  );
});

test("match reason states the threshold without exposing internal targeting language", () => {
  const result = evaluateForm4InsiderPurchase(currentFromFixture("source-agig-form4-purchase.json"), {
    target: { scope: "watchlist" },
    role: "officer_or_director",
    minimumShares: 8000,
  });

  assert.equal(result.status, "match");
  assert.match(result.evidence?.reason ?? "", /a purchase that matched this alert/);
  assert.match(result.evidence?.reason ?? "", /8,000-share minimum/);
  assert.doesNotMatch(result.evidence?.reason ?? "", /P code|non-derivative|same-row|sole buyer|monitor|watchlist/i);
});

test("single-purchase alert copy is concise and states a configured threshold naturally", () => {
  const evidence = matchEvidence("ONTF", [matchRow({
    ownerName: "Paul Cynthia",
    ownerRoles: ["director"],
    securityTitle: "Common Stock",
    shares: 33407,
    sharesRaw: "33407",
    pricePerShare: 5.56,
    pricePerShareRaw: "5.56",
    transactionDate: "2025-06-12",
    ownershipRelation: "indirect",
  })]);
  const copy = buildForm4PurchaseAlertCopy(evidence, {
    target: { scope: "ticker", ticker: "ONTF" },
    role: "director",
    minimumShares: 1000,
  });

  assert.equal(copy.title, "ONTF Form 4 purchase");
  assert.equal(
    copy.summary,
    "An ONTF Form 4 reported a 33,407-share common stock purchase. Director Paul Cynthia is listed with indirect ownership. The purchase meets your 1,000-share minimum.",
  );
  assert.doesNotMatch(copy.summary, /P code|non-derivative|same-row|sole buyer|open-market|personal funds|row|monitor|directly selected/i);
});

test("multi-purchase alert copy keeps transaction details out of its concise summary", () => {
  const evaluation = evaluateForm4InsiderPurchase(currentFromFixture("source-agig-form4-purchase.json"), settings("director"));
  assert.ok(evaluation.evidence);
  const copy = buildForm4PurchaseAlertCopy(evaluation.evidence, settings("director"));

  assert.equal(
    copy.summary,
    "An AGIG Form 4 reported two common stock purchases. Director Bailey Robert J. is listed with direct ownership. Both transactions match your alert.",
  );
  assert.doesNotMatch(copy.summary, /1,050|8,950|\$1\.195|\$1\.1999|May 12, 2026/);
  assert.doesNotMatch(copy.summary, /row|monitor|minimum-share threshold/i);
  assert.doesNotMatch(copy.summary, /10,000|total(?:ed|ing)?/i);
});

test("multi-owner alert copy remains natural while price omissions stay in details", () => {
  const evidence = matchEvidence("TEST", [
    matchRow({ ownerName: "Alex One", ownerRoles: ["officer"], officerTitle: "Chief Financial Officer", pricePerShare: null, pricePerShareRaw: null }),
    matchRow({ transactionIndex: 1, ownerName: "Jordan Two", ownerRoles: ["director"], shares: 2500, sharesRaw: "2500", pricePerShare: 7.25, pricePerShareRaw: "7.25", ownershipRelation: "indirect" }),
  ]);
  const copy = buildForm4PurchaseAlertCopy(evidence, {
    target: { scope: "watchlist" }, role: "officer_or_director", minimumShares: 500,
  });

  assert.match(copy.summary, /Alex One \(Officer · Chief Financial Officer\) is listed with direct ownership/);
  assert.match(copy.summary, /Director Jordan Two is listed with indirect ownership/);
  assert.match(copy.summary, /Both purchases meet your 500-share minimum/);
  assert.doesNotMatch(copy.summary, /price|row|monitor|watchlist/i);
});

test("VENU derivative gift and every UWMC sale/conversion row stay negative", () => {
  const venu = evaluateForm4InsiderPurchase(
    currentFromFixture("source-venu-form4-section16-derivative-gift.json"),
    settings("officer_or_director"),
  );
  const uwmc = evaluateForm4InsiderPurchase(
    currentFromFixture("source-uwmc-form4-multi-owner-10b5-1-conversion.json"),
    settings("officer_or_director"),
  );

  assert.equal(venu.status, "no_match");
  assert.equal(uwmc.status, "no_match");
  assert.equal(venu.evidence, undefined);
  assert.equal(uwmc.evidence, undefined);
  assert.equal(venu.reasonCode, "nonpurchase_transaction");
  assert.equal(uwmc.reasonCode, "nonpurchase_transaction");
  assert.ok(venu.trace.rows.some((row) => row.reasonCode === "transaction_code_not_purchase"));
  assert.ok(uwmc.trace.rows.every((row) => row.reasonCode !== "matched"));
});

test("Form 4 amendments and unclear direct values are never eligible", () => {
  const current = currentFromFixture("source-agig-form4-purchase.json");
  assert.equal(evaluateForm4InsiderPurchase({ ...current, filingForm: "4/A" }, settings("director")).status, "no_match");

  const unclear = structuredClone(current) as Extract<CurrentOwnershipReadResult, { status: "available" }>;
  (unclear.rows[0] as Row).transaction_code = null;
  assert.equal(evaluateForm4InsiderPurchase(unclear, settings("director")).status, "match");
  assert.deepEqual(
    evaluateForm4InsiderPurchase(unclear, settings("director")).evidence?.matches.map((row) => row.sharesRaw),
    ["8950"],
  );

  (unclear.rows[1] as Row).transaction_code = null;
  assert.equal(evaluateForm4InsiderPurchase(unclear, settings("director")).status, "ineligible");
});

function settings(
  role: Form4InsiderPurchaseSettings["role"],
  minimumShares: number | null = null,
): Form4InsiderPurchaseSettings {
  return { target: { scope: "ticker", ticker: "AGIG" }, role, minimumShares };
}

function matchEvidence(ticker: string, matches: readonly Form4PurchaseMatchRow[]): Form4PurchaseMatchEvidence {
  return {
    version: "form4_insider_purchase_match_v1",
    kind: "form4_insider_purchase",
    ticker,
    accessionNumber: "0001415889-25-017308",
    filedAt: "2025-06-14T08:22:00.000Z",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1110611/000141588925017308/form4-06132025_110621.xml",
    reason: "Legacy stored reason",
    matches,
  };
}

function matchRow(overrides: Partial<Form4PurchaseMatchRow> = {}): Form4PurchaseMatchRow {
  return {
    transactionIndex: 0,
    ownerName: "Alex One",
    ownerRoles: ["officer"],
    officerTitle: null,
    securityTitle: "Common Stock",
    shares: 1000,
    sharesRaw: "1000",
    pricePerShare: 4.5,
    pricePerShareRaw: "4.5",
    transactionDate: "2025-06-12",
    ownershipRelation: "direct",
    relationEvidence: [{ kind: "footnote", ref: "F1", text: "Source-backed ownership detail." }],
    ...overrides,
  };
}

function currentFromFixture(filename: string): Extract<CurrentOwnershipReadResult, { status: "available"; form: "form4" }> {
  const fixture = JSON.parse(readFileSync(join(fixtureRoot, filename), "utf8")) as Row;
  const sourceText = String(fixture.filingText);
  const accessionNumber = String(fixture.accessionNumber);
  const sourceUrl = String((fixture.source as Row).url);
  const ticker = xmlValue(sourceText, "issuerTradingSymbol");
  const issuerCik = xmlValue(sourceText, "issuerCik");
  const formType = String(fixture.formType);
  const built = buildOwnershipParserFactRows({
    eventId,
    symbol: ticker,
    rawItem: {
      id: rawItemId,
      source_unique_id: accessionNumber,
      raw_payload: {
        form_type: formType,
        accession_number: accessionNumber,
        cik: issuerCik,
        ownership_issuer_cik: issuerCik,
        ownership_issuer_trading_symbol: ticker,
        ticker,
        ownership_source_text: sourceText,
        ownership_source_url: sourceUrl,
        ownership_source_format: "ownership_xml",
        ownership_source_text_truncated: false,
      },
    },
  });
  return {
    status: "available",
    form: "form4",
    rows: built.form4Transactions as never,
    eventId,
    rawItemId,
    sourceExecutionId: eventId,
    accessionNumber,
    parserVersion: String(built.parserOutput.parserVersion),
    persistedAt: "2026-05-23T15:00:00.000Z",
    filingForm: formType as "4" | "4/A",
    filedAt: "2026-05-23T15:00:00.000Z",
  };
}

function xmlValue(sourceText: string, localName: string) {
  const tag = `(?:[A-Za-z_][\\w.-]*:)?${localName}`;
  return sourceText.match(new RegExp(`<${tag}\\b[^>]*>\\s*([^<]*?)\\s*</${tag}>`, "i"))?.[1]?.trim() ?? null;
}
