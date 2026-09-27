import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  evaluateForm4InsiderPurchase,
  parseStoredForm4PurchaseMatchEvidence,
  type Form4InsiderPurchaseSettings,
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
    "매수 신고: SEC Form 4의 P 코드 비파생 보통주 취득 2건이 설정 조건을 충족했습니다. 대상: 직접 선택 종목 AGIG. 신고인 직책: 이사. 최소 수량 조건 없음. 소유 관계는 해당 신고인을 매수 주문자 또는 유일한 주체로 식별하지 않습니다.",
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
  assert.match(eightThousand.evidence?.reason ?? "", /각 거래 행이 최소 8000주 조건 충족/);
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

test("match reason identifies watchlist scope and combined reporting-owner role", () => {
  const result = evaluateForm4InsiderPurchase(currentFromFixture("source-agig-form4-purchase.json"), {
    target: { scope: "watchlist" },
    role: "officer_or_director",
    minimumShares: 8000,
  });

  assert.equal(result.status, "match");
  assert.match(result.evidence?.reason ?? "", /대상: 관심종목/);
  assert.match(result.evidence?.reason ?? "", /신고인 직책: 임원 또는 이사/);
  assert.match(result.evidence?.reason ?? "", /각 거래 행이 최소 8000주 조건 충족/);
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
