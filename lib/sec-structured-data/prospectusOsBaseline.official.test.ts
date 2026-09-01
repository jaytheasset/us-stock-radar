import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  evaluateFinal424B4NewListingOs,
  type StoredSecProspectusRawItem,
} from "./prospectusOsBaseline.ts";

const CASES = [
  {
    name: "CURX",
    cik: "0002025942",
    accession: "0001493152-25-012350",
    filedDate: "2025-08-25",
    url: "https://www.sec.gov/Archives/edgar/data/2025942/000149315225012350/form424b4.htm",
  },
  {
    name: "XCH",
    cik: "0001979887",
    accession: "0001104659-24-098594",
    filedDate: "2024-09-10",
    url: "https://www.sec.gov/Archives/edgar/data/1979887/000110465924098594/tm2316418-35_424b4.htm",
  },
  {
    name: "HXHX",
    cik: "0001936817",
    accession: "0001213900-25-032325",
    filedDate: "2025-04-10",
    url: "https://www.sec.gov/Archives/edgar/data/1936817/000121390025032325/ea0238263-424b4_haoxin.htm",
  },
] as const;

test("official full 424B4 documents enforce the locked new-listing O/S decisions", async () => {
  const decisions = new Map<string, ReturnType<typeof evaluateFinal424B4NewListingOs>>();
  const truncatedDecisions = new Map<string, ReturnType<typeof evaluateFinal424B4NewListingOs>>();
  for (const item of CASES) {
    const response = await fetch(item.url, {
      headers: { "User-Agent": "StockRadar engineering verification@example.com" },
    });
    assert.equal(response.status, 200, `${item.name} official SEC fetch`);
    const html = await response.text();
    assert.ok(html.length > 1_000_000, `${item.name} must use the full official filing`);
    decisions.set(item.name, evaluateFinal424B4NewListingOs(rawItem(item, html)));
    if (html.length > 2_000_000) {
      const stored = rawItem(item, html.slice(0, 2_000_000));
      truncatedDecisions.set(item.name, evaluateFinal424B4NewListingOs({
        ...stored,
        rawPayload: {
          ...stored.rawPayload,
          primary_document_html_char_count: html.length,
          primary_document_html_truncated: true,
        },
      }));
    }
  }

  const curx = decisions.get("CURX")!;
  assert.equal(curx.status, "AUTO_ACCEPT");
  if (curx.status !== "AUTO_ACCEPT") return;
  assert.equal(curx.sharesOutstanding, "24000000");
  assert.equal(curx.asOf, "2025-03-31");
  assert.equal(curx.listingBasis.ticker, "CURX");
  assert.ok(curx.rejectedFutureEvidence.some((evidence) => evidence.includes("27,750,000")));

  const xch = decisions.get("XCH")!;
  assert.equal(xch.status, "REVIEW");
  if (xch.status === "REVIEW") {
    assert.ok(["ADS_OR_ADR_BASIS", "ORDINARY_SHARE_BASIS_AMBIGUOUS", "MULTIPLE_COMMON_CLASSES"].includes(xch.reason));
  }
  assert.equal(truncatedDecisions.get("XCH")?.status, "REVIEW");

  const hxhx = decisions.get("HXHX")!;
  assert.equal(hxhx.status, "REVIEW");
  if (hxhx.status === "REVIEW") {
    assert.ok(["ORDINARY_SHARE_BASIS_AMBIGUOUS", "MULTIPLE_COMMON_CLASSES"].includes(hxhx.reason));
  }
  assert.equal(truncatedDecisions.get("HXHX")?.status, "REVIEW");
});

test("future offering arithmetic and incomplete primary documents never become current O/S", () => {
  const html = `<html><body>
    <p>Our Common Stock was approved for listing on the Nasdaq Capital Market under the symbol "SAFE".</p>
    <p>The Company is authorized to issue two classes of stock. The total authorized capital consists of 90,000,000 shares of common stock and 10,000,000 shares of preferred stock.</p>
    <p>As of March 31, 2025, we had 24,000,000 shares of Common Stock issued and outstanding.</p>
    <p>Immediately after the offering, we will have 27,750,000 shares outstanding.</p>
  </body></html>`;
  const base = rawItem({
    cik: "0002025942",
    accession: "0001493152-25-012350",
    filedDate: "2025-08-25",
    url: CASES[0].url,
  }, html);
  const accepted = evaluateFinal424B4NewListingOs(base);
  assert.equal(accepted.status, "AUTO_ACCEPT");
  if (accepted.status === "AUTO_ACCEPT") assert.equal(accepted.sharesOutstanding, "24000000");

  const incomplete = evaluateFinal424B4NewListingOs({
    ...base,
    rawPayload: { ...base.rawPayload, primary_document_html_truncated: true },
  });
  assert.deepEqual(incomplete.status, "NOT_VERIFIED");
  if (incomplete.status === "NOT_VERIFIED") assert.equal(incomplete.reason, "PRIMARY_DOCUMENT_INCOMPLETE");
});

test("separate voting and non-voting common classes are review-only", () => {
  const html = `<html><body>
    <p>Our Voting Common Stock was approved for listing on the Nasdaq Capital Market under the symbol "DUAL".</p>
    <p>The Company is authorized to issue two classes of stock. The total authorized capital consists of 90,000,000 shares of Common Stock and 10,000,000 shares of preferred stock.</p>
    <p>Holders of our separate non-voting Common Stock class have no voting rights.</p>
    <p>As of March 31, 2025, we had 24,000,000 shares of Common Stock issued and outstanding.</p>
  </body></html>`;
  const decision = evaluateFinal424B4NewListingOs(rawItem({
    cik: "0002025942",
    accession: "0001493152-25-012350",
    filedDate: "2025-08-25",
    url: CASES[0].url,
  }, html));
  assert.equal(decision.status, "REVIEW");
  if (decision.status === "REVIEW") assert.equal(decision.reason, "MULTIPLE_COMMON_CLASSES");
});

test("absence of conflicting words is not positive proof of a single common class", () => {
  const html = `<html><body>
    <p>Our Common Stock was approved for listing on the Nasdaq Capital Market under the symbol "UNKNOWN".</p>
    <p>Each share of Common Stock is entitled to one vote.</p>
    <p>As of March 31, 2025, we had 24,000,000 shares of Common Stock issued and outstanding.</p>
  </body></html>`;
  const decision = evaluateFinal424B4NewListingOs(rawItem({
    cik: "0002025942",
    accession: "0001493152-25-012350",
    filedDate: "2025-08-25",
    url: CASES[0].url,
  }, html));
  assert.equal(decision.status, "REVIEW");
  if (decision.status === "REVIEW") assert.equal(decision.reason, "COMMON_CLASS_BASIS_INCOMPLETE");
});

function rawItem(
  item: { cik: string; accession: string; filedDate: string; url: string },
  html: string,
): StoredSecProspectusRawItem {
  return {
    id: randomUUID(),
    sourceUrl: item.url,
    bodyText: html,
    rawPayload: {
      form_type: "424B4",
      cik_padded: item.cik,
      accession_number: item.accession,
      filing_date: item.filedDate,
      accepted_at: `${item.filedDate}T16:00:00Z`,
      primary_document_url: item.url,
      primary_document_html: html,
      primary_document_html_char_count: html.length,
      primary_document_html_truncated: false,
    },
  };
}
