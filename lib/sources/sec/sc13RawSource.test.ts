import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { buildSc13AnalysisPrompt } from "./forms/sc13/analysisPrompt.ts";
import { parseSc13Filing } from "./forms/sc13/parser.ts";
import { fetchSecEdgarRawItems } from "./parser.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("Schedule 13 ingestion preserves canonical XML separately without changing rendered analysis text", async () => {
  const accession = "0000000001-26-000001";
  const detailUrl = `https://www.sec.gov/Archives/edgar/data/2222222/000000000126000001/${accession}-index.html`;
  const renderedUrl = "https://www.sec.gov/Archives/edgar/data/1111111/000000000126000001/xslSCHEDULE_13D_X02/primary_doc.xml";
  const canonicalUrl = "https://www.sec.gov/Archives/edgar/data/1111111/000000000126000001/primary_doc.xml";
  const renderedHtml = `<html><body><h1>SCHEDULE 13D</h1><p>RENDERED ANALYSIS SENTINEL</p><p>Example Issuer</p><p>(Name of Issuer)</p></body></html>`;
  const canonicalXml = `<?xml version="1.0"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D">
  <schemaVersion>X0202</schemaVersion>
  <headerData><submissionType>SCHEDULE 13D</submissionType><filerInfo><filer><filerCredentials><cik>0002222222</cik><ccc>XXXXXXXX</ccc></filerCredentials></filer></filerInfo></headerData>
  <formData>
    <coverPageHeader><securitiesClassTitle>Common Stock</securitiesClassTitle><dateOfEvent>09/01/2026</dateOfEvent><issuerInfo><issuerCIK>0001111111</issuerCIK><issuerCusips><issuerCusipNumber>111111111</issuerCusipNumber></issuerCusips><issuerName>Example Issuer</issuerName><address/></issuerInfo></coverPageHeader>
    <reportingPersons><reportingPersonInfo><reportingPersonCIK>0002222222</reportingPersonCIK><reportingPersonName>Example Filer</reportingPersonName><soleVotingPower>1.00</soleVotingPower><sharedVotingPower>0.00</sharedVotingPower><soleDispositivePower>1.00</soleDispositivePower><sharedDispositivePower>0.00</sharedDispositivePower><aggregateAmountOwned>1.00</aggregateAmountOwned><percentOfClass>5.00</percentOfClass></reportingPersonInfo></reportingPersons>
    <signatureInfo/>
  </formData>
</edgarSubmission>`;
  const detailHtml = `<html><body>
    <div class="companyInfo"><span class="companyName">Example Issuer (Subject) CIK: <a href="/cgi-bin/browse-edgar?CIK=0001111111&amp;action=getcompany">0001111111</a></span></div>
    <div class="companyInfo"><span class="companyName">Example Filer (Filed by) CIK: <a href="/cgi-bin/browse-edgar?CIK=0002222222&amp;action=getcompany">0002222222</a></span></div>
    <div class="infoHead">Filing Date</div><div class="info">2026-09-02</div>
    <table summary="Document Format Files">
      <tr><td>1</td><td></td><td><a href="${renderedUrl}">primary_doc.html</a></td><td>SCHEDULE 13D</td><td>&nbsp;</td></tr>
      <tr><td>1</td><td></td><td><a href="${canonicalUrl}">primary_doc.xml</a></td><td>SCHEDULE 13D</td><td>${canonicalXml.length}</td></tr>
    </table>
  </body></html>`;

  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.endsWith("index.json")) return Response.json({ directory: { item: [] } });
    if (url === detailUrl) return new Response(detailHtml, { status: 200, headers: { "content-type": "text/html" } });
    if (url === renderedUrl) return new Response(renderedHtml, { status: 200, headers: { "content-type": "text/html" } });
    if (url === canonicalUrl) return new Response(canonicalXml, { status: 200, headers: { "content-type": "application/xml" } });
    if (url.endsWith("company_tickers_exchange.json")) {
      return Response.json({ fields: ["cik", "name", "ticker", "exchange"], data: [[1111111, "Example Issuer", "EXM", "NYSE"]] });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  const result = await fetchSecEdgarRawItems({
    accessionNumber: accession,
    cik: "2222222",
    formTypes: ["SC 13D"],
    includeDocuments: true,
  });
  assert.equal(result.ok, true, result.error);
  const item = result.items[0]!;
  assert.match(item.body_text ?? "", /RENDERED ANALYSIS SENTINEL/);
  assert.doesNotMatch(item.body_text ?? "", /0002222222/);
  assert.equal(item.raw_payload.sc13_source_text, canonicalXml);
  assert.equal(item.raw_payload.sc13_source_url, canonicalUrl);
  assert.equal(item.raw_payload.sc13_source_format, "sec_schedule_13_xml");
  assert.equal(item.raw_payload.sc13_index_subject_cik, "0001111111");
  assert.deepEqual(item.raw_payload.sc13_index_filed_by_ciks, ["0002222222"]);
  const documents = item.raw_payload.documents as Array<Record<string, unknown>>;
  assert.equal(
    documents.find((document) => document.document === "primary_doc.xml")?.textExtractionStatus,
    "canonical_sc13_xml_preserved_not_added_to_analysis_text",
  );

  const baseline = parseSc13Filing({
    formType: "SC 13D",
    accessionNumber: accession,
    text: item.body_text ?? "",
  });
  const integrated = parseSc13Filing({
    formType: "SC 13D",
    accessionNumber: accession,
    sourceUrl: item.source_url,
    text: item.body_text ?? "",
    rawPayload: item.raw_payload,
  });
  assert.equal(integrated.structuralSource?.status, "parsed");
  assert.deepEqual(integrated.facts, baseline.facts);
  assert.deepEqual(integrated.cleaned_source_blocks, baseline.cleaned_source_blocks);
  assert.equal(integrated.summary, baseline.summary);
  assert.equal(integrated.raw.sourceLength, baseline.raw.sourceLength);
  assert.equal(buildSc13AnalysisPrompt(integrated), buildSc13AnalysisPrompt(baseline));
});

test("canonical source failures stay isolated from the existing body and prompt", async (context) => {
  const accession = "0000000001-26-000002";
  const detailUrl = `https://www.sec.gov/Archives/edgar/data/2222222/000000000126000002/${accession}-index.html`;
  const renderedUrl = "https://www.sec.gov/Archives/edgar/data/1111111/000000000126000002/xslSCHEDULE_13D_X02/primary_doc.xml";
  const canonicalUrl = "https://www.sec.gov/Archives/edgar/data/1111111/000000000126000002/primary_doc.xml";
  const renderedHtml = "<html><body><h1>SCHEDULE 13D</h1><p>UNCHANGED RENDERED SOURCE</p></body></html>";
  const validXml = `<?xml version="1.0"?><edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D"><schemaVersion>X0202</schemaVersion><headerData><submissionType>SCHEDULE 13D</submissionType><filerInfo><filer><filerCredentials><cik>0002222222</cik></filerCredentials></filer></filerInfo></headerData><formData><coverPageHeader><securitiesClassTitle>Common Stock</securitiesClassTitle><dateOfEvent>09/01/2026</dateOfEvent><issuerInfo><issuerCIK>0001111111</issuerCIK><issuerCusips><issuerCusipNumber>111111111</issuerCusipNumber></issuerCusips><issuerName>Example Issuer</issuerName></issuerInfo></coverPageHeader><reportingPersons><reportingPersonInfo><reportingPersonName>Example Filer</reportingPersonName></reportingPersonInfo></reportingPersons></formData></edgarSubmission>`;
  const detailHtml = `<html><body>
    <div class="companyInfo"><span class="companyName">Example Issuer (Subject) CIK: <a href="/cgi-bin/browse-edgar?CIK=0001111111&amp;action=getcompany">0001111111</a></span></div>
    <div class="companyInfo"><span class="companyName">Example Filer (Filed by) CIK: <a href="/cgi-bin/browse-edgar?CIK=0002222222&amp;action=getcompany">0002222222</a></span></div>
    <table summary="Document Format Files">
      <tr><td>1</td><td></td><td><a href="${renderedUrl}">primary_doc.html</a></td><td>SCHEDULE 13D</td><td>&nbsp;</td></tr>
      <tr><td>1</td><td></td><td><a href="${canonicalUrl}">primary_doc.xml</a></td><td>SCHEDULE 13D</td><td>1000</td></tr>
    </table>
  </body></html>`;

  async function collectCanonical(body: string, status = 200, contentType = "application/xml") {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.endsWith("index.json")) return Response.json({ directory: { item: [] } });
      if (url === detailUrl) return new Response(detailHtml, { status: 200, headers: { "content-type": "text/html" } });
      if (url === renderedUrl) return new Response(renderedHtml, { status: 200, headers: { "content-type": "text/html" } });
      if (url === canonicalUrl) return new Response(body, { status, headers: { "content-type": contentType } });
      if (url.endsWith("company_tickers_exchange.json")) {
        return Response.json({ fields: ["cik", "name", "ticker", "exchange"], data: [[1111111, "Example Issuer", "EXM", "NYSE"]] });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    return fetchSecEdgarRawItems({
      accessionNumber: accession,
      cik: "2222222",
      formTypes: ["SC 13D"],
      includeDocuments: true,
    });
  }

  const baselineResult = await collectCanonical(validXml);
  assert.equal(baselineResult.ok, true, baselineResult.error);
  const baselineItem = baselineResult.items[0]!;
  const baselineParser = parseSc13Filing({ formType: "SC 13D", accessionNumber: accession, text: baselineItem.body_text ?? "" });
  const baselinePrompt = buildSc13AnalysisPrompt(baselineParser);

  const cases = [
    {
      name: "unsupported namespace",
      body: validXml.replace("http://www.sec.gov/edgar/schedule13D", "urn:unsupported"),
      status: 200,
      expectedCapture: "invalid_format",
      expectedText: validXml.replace("http://www.sec.gov/edgar/schedule13D", "urn:unsupported"),
    },
    { name: "HTTP 200 HTML", body: "<html><body>SEC error page</body></html>", status: 200, expectedCapture: "invalid_format", expectedText: "<html><body>SEC error page</body></html>" },
    { name: "empty response", body: "", status: 200, expectedCapture: "empty", expectedText: "" },
    { name: "truncated XML", body: validXml.slice(0, -24), status: 200, expectedCapture: "preserved", expectedText: validXml.slice(0, -24) },
    { name: "HTTP 404", body: "not found", status: 404, expectedCapture: "fetch_failed", expectedText: null },
  ] as const;

  for (const scenario of cases) {
    await context.test(scenario.name, async () => {
      const result = await collectCanonical(scenario.body, scenario.status, scenario.name === "HTTP 200 HTML" ? "text/html" : "application/xml");
      assert.equal(result.ok, true, result.error);
      const item = result.items[0]!;
      assert.equal(item.body_text, baselineItem.body_text);
      assert.equal(item.analysis_text, baselineItem.analysis_text);
      assert.equal(item.raw_payload.sc13_source_capture_status, scenario.expectedCapture);
      assert.equal(item.raw_payload.sc13_source_text, scenario.expectedText);
      const parsed = parseSc13Filing({
        formType: "SC 13D",
        accessionNumber: accession,
        sourceUrl: item.source_url,
        text: item.body_text ?? "",
        rawPayload: item.raw_payload,
      });
      assert.equal(parsed.structuralSource?.status, "unavailable");
      assert.ok((parsed.structuralSource?.issues.length ?? 0) > 0);
      if (scenario.name !== "truncated XML") assert.ok(item.raw_payload.sc13_source_capture_error);
      assert.equal(buildSc13AnalysisPrompt(parsed), baselinePrompt);
    });
  }
});
