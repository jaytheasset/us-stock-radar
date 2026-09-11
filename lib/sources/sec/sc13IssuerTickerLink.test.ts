import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { buildSc13AnalysisPrompt } from "./forms/sc13/analysisPrompt.ts";
import { parseSc13Filing } from "./forms/sc13/parser.ts";
import { fetchSecEdgarRawItems } from "./parser.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Schedule 13 ticker lookup uses only the provenance-verified canonical XML issuer CIK", async () => {
  const filerCik = "2222222";
  const issuerCik = "1111111";
  const validAccession = "0002222222-26-000001";
  const invalidAccession = "0002222222-26-000002";
  const requests: string[] = [];

  const fixture = (accession: string, subjectCik: string) => {
    const accessionNoDashes = accession.replace(/-/g, "");
    const detailUrl = `https://www.sec.gov/Archives/edgar/data/${filerCik}/${accessionNoDashes}/${accession}-index.html`;
    const renderedUrl = `https://www.sec.gov/Archives/edgar/data/${issuerCik}/${accessionNoDashes}/xslSCHEDULE_13D_X02/primary_doc.xml`;
    const canonicalUrl = `https://www.sec.gov/Archives/edgar/data/${issuerCik}/${accessionNoDashes}/primary_doc.xml`;
    const renderedHtml = "<html><body><div>Example Issuer</div><div>(Name of Issuer)</div><p>RENDERED ANALYSIS SENTINEL</p></body></html>";
    const canonicalXml = `<?xml version="1.0"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D">
  <schemaVersion>X0202</schemaVersion>
  <headerData><submissionType>SCHEDULE 13D</submissionType><filerInfo><filer><filerCredentials><cik>0002222222</cik></filerCredentials></filer></filerInfo></headerData>
  <formData>
    <coverPageHeader><securitiesClassTitle>Common Stock</securitiesClassTitle><dateOfEvent>09/01/2026</dateOfEvent><issuerInfo><issuerCIK>0001111111</issuerCIK><issuerCusips><issuerCusipNumber>111111111</issuerCusipNumber></issuerCusips><issuerName>Example Issuer</issuerName></issuerInfo></coverPageHeader>
    <reportingPersons><reportingPersonInfo><reportingPersonCIK>0002222222</reportingPersonCIK><reportingPersonName>Example Filer</reportingPersonName></reportingPersonInfo></reportingPersons>
  </formData>
</edgarSubmission>`;
    const detailHtml = `<html><body>
      <div class="companyInfo"><span class="companyName">Example Issuer (Subject) CIK: <a href="/cgi-bin/browse-edgar?CIK=${subjectCik}&amp;action=getcompany">${subjectCik}</a></span></div>
      <div class="companyInfo"><span class="companyName">Example Filer (Filed by) CIK: <a href="/cgi-bin/browse-edgar?CIK=0002222222&amp;action=getcompany">0002222222</a></span></div>
      <table summary="Document Format Files">
        <tr><td>1</td><td></td><td><a href="${renderedUrl}">primary_doc.html</a></td><td>SCHEDULE 13D</td><td>&nbsp;</td></tr>
        <tr><td>1</td><td></td><td><a href="${canonicalUrl}">primary_doc.xml</a></td><td>SCHEDULE 13D</td><td>${canonicalXml.length}</td></tr>
      </table>
    </body></html>`;
    return { accession, accessionNoDashes, detailUrl, renderedUrl, canonicalUrl, renderedHtml, canonicalXml, detailHtml };
  };

  const valid = fixture(validAccession, "0001111111");
  const invalid = fixture(invalidAccession, "0003333333");
  const fixtures = [valid, invalid];

  globalThis.fetch = (async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.endsWith("company_tickers_exchange.json")) {
      return Response.json({
        fields: ["cik", "name", "ticker", "exchange"],
        data: [
          [1111111, "Example Issuer", "EXM", "NYSE"],
          [2222222, "Example Filer", "FILR", "Nasdaq"],
          [3333333, "Wrong Subject", "WRNG", "NYSE"],
        ],
      });
    }
    for (const current of fixtures) {
      if (url === `https://www.sec.gov/Archives/edgar/data/${filerCik}/${current.accessionNoDashes}/index.json`) {
        return Response.json({ directory: { item: [] } });
      }
      if (url === current.detailUrl) return new Response(current.detailHtml, { status: 200, headers: { "content-type": "text/html" } });
      if (url === current.renderedUrl) return new Response(current.renderedHtml, { status: 200, headers: { "content-type": "text/html" } });
      if (url === current.canonicalUrl) return new Response(current.canonicalXml, { status: 200, headers: { "content-type": "application/xml" } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const collect = (accessionNumber: string) => fetchSecEdgarRawItems({
    accessionNumber,
    cik: filerCik,
    formTypes: ["SC 13D"],
    includeDocuments: true,
  });

  const validResult = await collect(validAccession);
  assert.equal(validResult.ok, true, validResult.error);
  const validItem = validResult.items[0]!;
  assert.equal(validItem.raw_payload.ticker, "EXM");
  assert.equal(validItem.raw_payload.exchange, "NYSE");
  assert.deepEqual(validItem.raw_payload.ticker_resolution, {
    source: "issuer_cik_sec",
    confidence: "high",
    reason: "Verified canonical Schedule 13 XML issuer CIK matched SEC company ticker table.",
    cusip: null,
  });
  assert.equal(validItem.raw_payload.cik, filerCik, "legacy raw CIK identity must remain unchanged");
  assert.equal(validItem.raw_payload.filer_cik, filerCik);
  assert.equal(validItem.raw_payload.ownership_issuer_cik, null);
  assert.match(validItem.body_text ?? "", /RENDERED ANALYSIS SENTINEL/);
  assert.doesNotMatch(validItem.body_text ?? "", /0001111111|0002222222/);
  const tickerlessPayload = structuredClone(validItem.raw_payload);
  tickerlessPayload.ticker = null;
  tickerlessPayload.exchange = null;
  tickerlessPayload.tickers = [];
  tickerlessPayload.ticker_resolution = {
    source: "unresolved",
    confidence: "none",
    reason: "No trusted issuer ticker, issuer CIK, or verified CUSIP match was available; Schedule 13 accession CIK is not trusted as issuer ticker evidence.",
    cusip: null,
  };
  const parserInput = {
    formType: "SC 13D",
    accessionNumber: validAccession,
    sourceUrl: validItem.source_url,
    text: validItem.body_text ?? "",
  };
  assert.equal(
    buildSc13AnalysisPrompt(parseSc13Filing({ ...parserInput, rawPayload: validItem.raw_payload })),
    buildSc13AnalysisPrompt(parseSc13Filing({ ...parserInput, rawPayload: tickerlessPayload })),
    "ticker identity connection must not alter the existing Schedule 13 analysis prompt",
  );

  const invalidResult = await collect(invalidAccession);
  assert.equal(invalidResult.ok, true, invalidResult.error);
  const invalidItem = invalidResult.items[0]!;
  assert.equal(invalidItem.raw_payload.ticker, null);
  assert.equal(invalidItem.raw_payload.exchange, null);
  assert.deepEqual(invalidItem.raw_payload.tickers, []);
  assert.deepEqual(invalidItem.raw_payload.ticker_resolution, {
    source: "unresolved",
    confidence: "none",
    reason: "Canonical Schedule 13 XML issuer provenance could not be verified; no alternate ticker identity was used.",
    cusip: null,
  });
  assert.notEqual(invalidItem.raw_payload.ticker, "FILR");
  assert.notEqual(invalidItem.raw_payload.ticker, "WRNG");
  assert.equal(invalidItem.raw_payload.cik, filerCik);
  assert.equal(invalidItem.body_text, validItem.body_text);
  assert.equal(invalidItem.analysis_text, validItem.analysis_text);
  assert.equal(invalidItem.title, validItem.title);
  assert.equal(invalidItem.raw_payload.company_name, validItem.raw_payload.company_name);
  assert.equal(requests.some((url) => url.includes("financialmodelingprep.com")), false);
});
