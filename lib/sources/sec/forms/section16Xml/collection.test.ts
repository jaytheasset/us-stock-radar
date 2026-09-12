import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { fetchAndParseSection16XmlFiling } from "./collection.ts";

const originalFetch = globalThis.fetch;
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const xml = readFileSync(path.join(fixtureDir, "0000891839-26-000252-form3a.xml"), "utf8");
const manifest = JSON.parse(readFileSync(path.join(fixtureDir, "sources.json"), "utf8")) as {
  fixtures: Array<{ file: string; sourceUrl: string; sha256: string }>;
};
const fixture = manifest.fixtures.find((candidate) => candidate.file === "0000891839-26-000252-form3a.xml");

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("production SEC collection preserves actual Form 3/A XML and issuer metadata before XML-only parsing", async () => {
  assert.ok(fixture);
  const requestedUrls: string[] = [];
  const detailUrl = "https://www.sec.gov/Archives/edgar/data/1854445/000089183926000252/0000891839-26-000252-index.html";
  const detailHtml = `
    <html><body>
      <div class="companyInfo"><span class="companyName">THE GLIMPSE GROUP, INC. (Filer)</span></div>
      <div class="infoHead">Filing Date</div><div class="info">2026-06-18</div>
      <div class="infoHead">Accepted</div><div class="info">2026-06-18 16:18:13</div>
      <table summary="Document Format Files">
        <tr><td>1</td><td>FORM 3/A</td><td><a href="form3a.xml">form3a.xml</a></td><td>3/A</td><td>${xml.length}</td></tr>
      </table>
    </body></html>`;

  globalThis.fetch = (async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("/full-index/2026/QTR2/master.idx")) {
      return new Response(
        "1854445|THE GLIMPSE GROUP, INC.|3/A|2026-06-18|edgar/data/1854445/0000891839-26-000252.txt\n",
        { status: 200, headers: { "content-type": "text/plain" } },
      );
    }
    if (url.includes("/full-index/2026/") && url.endsWith("/master.idx")) {
      return new Response("CIK|Company Name|Form Type|Date Filed|Filename\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    if (url === detailUrl) {
      return new Response(detailHtml, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url === fixture.sourceUrl) {
      return new Response(xml, { status: 200, headers: { "content-type": "application/xml" } });
    }
    if (url.endsWith("/files/company_tickers_exchange.json")) {
      return Response.json({
        fields: ["cik", "name", "ticker", "exchange"],
        data: [
          [1854445, "The Glimpse Group, Inc.", "GGRP", "Nasdaq"],
          [36146, "Trustmark Corp", "TRMK", "Nasdaq"],
        ],
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const result = await fetchAndParseSection16XmlFiling({
    accessionNumber: "0000891839-26-000252",
    formType: "3/A",
  });

  assert.equal(result.rawItem.raw_payload.ownership_source_text, xml);
  assert.equal(result.rawItem.raw_payload.ownership_source_url, fixture.sourceUrl);
  assert.equal(result.rawItem.raw_payload.ownership_source_format, "ownership_xml");
  assert.equal(result.rawItem.raw_payload.ownership_source_text_char_count, xml.length);
  assert.equal(result.rawItem.raw_payload.ownership_source_text_truncated, false);
  assert.equal(result.rawItem.raw_payload.ownership_source_sha256, fixture.sha256);
  assert.equal(result.rawItem.raw_payload.ownership_issuer_cik, "1854445");
  assert.equal(result.rawItem.raw_payload.accepted_at, "2026-06-18 16:18:13");
  assert.equal(result.parsed.parserMode, "xml_only_no_llm");
  assert.equal(result.parsed.source.canonicalXml, xml);
  assert.equal(result.parsed.source.sha256, fixture.sha256);
  assert.equal(result.parsed.issuer.cik.value, "0001854445");
  assert.equal(result.parsed.filing.acceptedAt.value, "2026-06-18 16:18:13");
  assert.equal(result.parsed.holdings.length, 2);
  assert.ok(requestedUrls.some((url) => url.includes("/full-index/2026/QTR2/master.idx")));
  assert.ok(requestedUrls.includes(detailUrl));
  assert.ok(requestedUrls.includes(fixture.sourceUrl));
});

test("production SEC collection preserves actual Form 5 XML and source-local acceptance time before parsing", async () => {
  const form5Fixture = manifest.fixtures.find((candidate) => candidate.file === "0000036146-26-000004-form5.xml");
  assert.ok(form5Fixture);
  const form5Xml = readFileSync(path.join(fixtureDir, "0000036146-26-000004-form5.xml"), "utf8");
  const requestedUrls: string[] = [];
  const detailUrl = "https://www.sec.gov/Archives/edgar/data/36146/000003614626000004/0000036146-26-000004-index.html";
  const detailHtml = `
    <html><body>
      <div class="companyInfo"><span class="companyName">TRUSTMARK CORP (Filer)</span></div>
      <div class="infoHead">Filing Date</div><div class="info">2026-02-13</div>
      <div class="infoHead">Accepted</div><div class="info">2026-02-13 16:29:10</div>
      <table summary="Document Format Files">
        <tr><td>1</td><td>FORM 5</td><td><a href="form5.xml">form5.xml</a></td><td>5</td><td>${form5Xml.length}</td></tr>
      </table>
    </body></html>`;

  globalThis.fetch = (async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.includes("/full-index/2026/QTR1/master.idx")) {
      return new Response(
        "36146|TRUSTMARK CORP|5|2026-02-13|edgar/data/36146/0000036146-26-000004.txt\n",
        { status: 200, headers: { "content-type": "text/plain" } },
      );
    }
    if (url.includes("/full-index/2026/") && url.endsWith("/master.idx")) {
      return new Response("CIK|Company Name|Form Type|Date Filed|Filename\n", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    }
    if (url === detailUrl) {
      return new Response(detailHtml, { status: 200, headers: { "content-type": "text/html" } });
    }
    if (url === form5Fixture.sourceUrl) {
      return new Response(form5Xml, { status: 200, headers: { "content-type": "application/xml" } });
    }
    if (url.endsWith("/files/company_tickers_exchange.json")) {
      return Response.json({
        fields: ["cik", "name", "ticker", "exchange"],
        data: [
          [1854445, "The Glimpse Group, Inc.", "GGRP", "Nasdaq"],
          [36146, "Trustmark Corp", "TRMK", "Nasdaq"],
        ],
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const result = await fetchAndParseSection16XmlFiling({
    accessionNumber: "0000036146-26-000004",
    formType: "5",
  });

  assert.equal(result.rawItem.raw_payload.ownership_source_text, form5Xml);
  assert.equal(result.rawItem.raw_payload.ownership_source_url, form5Fixture.sourceUrl);
  assert.equal(result.rawItem.raw_payload.ownership_source_sha256, form5Fixture.sha256);
  assert.equal(result.rawItem.raw_payload.ownership_issuer_cik, "36146");
  assert.equal(result.rawItem.raw_payload.accepted_at, "2026-02-13 16:29:10");
  assert.equal(result.parsed.formType, "5");
  assert.equal(result.parsed.source.canonicalXml, form5Xml);
  assert.equal(result.parsed.filing.acceptedAt.value, "2026-02-13 16:29:10");
  assert.equal(result.parsed.transactions.length, 6);
  assert.ok(requestedUrls.some((url) => url.includes("/full-index/2026/QTR1/master.idx")));
  assert.ok(requestedUrls.includes(detailUrl));
  assert.ok(requestedUrls.includes(form5Fixture.sourceUrl));
});
