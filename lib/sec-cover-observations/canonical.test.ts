import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSecCoverCallerMatchesStored,
  buildSecCoverObservationPayload,
  buildSecCoverObservationPayloadFromStructuredArtifact,
  SecCoverObservationSourceError,
  validateSecCoverStoredPayload,
} from "./canonical.ts";
import { createSecFilingXbrlArtifactFromStoredHttpBody } from "../sec-structured-data/filingXbrlContext.ts";

const RAW_ITEM_ID = "10000000-0000-4000-8000-000000000001";
const ACCESSION = "0001193805-26-001157";
const CIK = "885462";
const URL = "https://www.sec.gov/Archives/edgar/data/885462/000119380526001157/gure-20260331.htm";

test("preserves one complete common-stock cover observation and exact context provenance", () => {
  const result = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(inline([
    context("c1"),
    fact("Security12bTitle", "c1", "Common Stock, $0.0005 par value"),
    fact("TradingSymbol", "c1", "GURE"),
    fact("SecurityExchangeName", "c1", "NASDAQ", ' format="ixt-sec:exchnameen"'),
  ]))));
  assert.equal(result.payload.extractionStatus, "available");
  assert.equal(result.payload.observations.length, 1);
  const observation = result.payload.observations[0]!;
  assert.equal(observation.issuerCikRaw, CIK);
  assert.equal(observation.issuerCik, "0000885462");
  assert.equal(observation.contextRef, "c1");
  assert.deepEqual(observation.context.period, { kind: "duration", startDate: "2026-01-01", endDate: "2026-03-31" });
  assert.equal(observation.securityTitle.rawLexicalValue, "Common Stock, $0.0005 par value");
  assert.equal(observation.tradingSymbol.rawLexicalValue, "GURE");
  assert.equal(observation.exchange.rawLexicalValue, "NASDAQ");
  assert.equal(observation.exchange.facts[0]?.inlineFormat, "ixt-sec:exchnameen");
});

test("keeps common stock and warrants separated by exact context", () => {
  const result = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(inline([
    context("c-common", { axis: "srt:SecurityAxis", member: "vee:CommonStockMember" }, "http://www.sec.gov/CIK", "1840317"),
    context("c-warrant", { axis: "srt:SecurityAxis", member: "vee:WarrantMember" }, "http://www.sec.gov/CIK", "1840317"),
    fact("Security12bTitle", "c-common", "Common Stock, par value $0.0001 per share"),
    fact("TradingSymbol", "c-common", "VEEA"),
    fact("SecurityExchangeName", "c-common", "Nasdaq"),
    fact("Security12bTitle", "c-warrant", "Warrants, each exercisable for one Common Stock"),
    fact("TradingSymbol", "c-warrant", "VEEAW"),
    fact("SecurityExchangeName", "c-warrant", "Nasdaq"),
  ], "1840317", true), {
    cik: "1840317",
    accession: "0001213900-24-100269",
    url: "https://www.sec.gov/Archives/edgar/data/1840317/000121390024100269/ea0221355-10q_veeainc.htm",
  })));
  assert.equal(result.payload.extractionStatus, "available");
  assert.deepEqual(
    result.payload.observations.map((row) => [row.contextRef, row.tradingSymbol.rawLexicalValue, row.context.dimensions.length]),
    [["c-common", "VEEA", 1], ["c-warrant", "VEEAW", 1]],
  );
});

test("distinguishes source-missing fields, equal duplicates, conflicts, and explicit nil", () => {
  const missing = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(inline([
    context("legacy"), instanceFact("TradingSymbol", "legacy", "GURE"),
  ], CIK, false, "2011-01-31"), {
    url: "https://www.sec.gov/Archives/edgar/data/885462/000119380511001703/gure-20110630.xml",
    accession: "0001193805-11-001703",
  })));
  assert.equal(missing.payload.extractionStatus, "partial");
  assert.equal(missing.payload.observations[0]?.securityTitle.status, "source_missing");
  assert.equal(missing.payload.observations[0]?.tradingSymbol.status, "observed");
  assert.equal(missing.payload.observations[0]?.exchange.status, "source_missing");

  const duplicates = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(inline([
    context("c1"),
    fact("Security12bTitle", "c1", "Common Stock"),
    fact("Security12bTitle", "c1", "Common Stock"),
    fact("TradingSymbol", "c1", "AAA"),
    fact("TradingSymbol", "c1", "BBB"),
    '<ix:nonNumeric name="dei:SecurityExchangeName" contextRef="c1" xsi:nil="true"></ix:nonNumeric>',
  ]))));
  const row = duplicates.payload.observations[0]!;
  assert.equal(row.securityTitle.status, "observed");
  assert.equal(row.tradingSymbol.status, "duplicate_conflict");
  assert.equal(row.tradingSymbol.rawLexicalValue, null);
  assert.equal(row.exchange.status, "explicit_nil");
});

test("fails closed on an unsupported entity scheme or mismatched issuer CIK", () => {
  const wrongScheme = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(inline([
    context("c1", undefined, "urn:not-sec:cik"), fact("TradingSymbol", "c1", "GURE"),
  ]))));
  assert.equal(wrongScheme.payload.extractionStatus, "unsupported_context");
  assert.equal(wrongScheme.payload.observations.length, 0);
  assert.equal(wrongScheme.payload.issues[0]?.code, "unsupported_entity_scheme");

  const wrongCik = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(inline([
    context("c1", undefined, "http://www.sec.gov/CIK", "999999"), fact("TradingSymbol", "c1", "NOPE"),
  ]))));
  assert.equal(wrongCik.payload.extractionStatus, "identity_mismatch");
  assert.equal(wrongCik.payload.observations.length, 0);
});

test("does not certify reordered mixed markup or whitespace-only text as observed values", () => {
  const result = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(inline([
    context("c1"),
    '<ix:nonNumeric name="dei:Security12bTitle" contextRef="c1"><span>Common </span><b>Stock</b><span> Class A</span></ix:nonNumeric>',
    fact("TradingSymbol", "c1", " "),
    fact("SecurityExchangeName", "c1", "NASDAQ"),
  ]))));
  const row = result.payload.observations[0]!;
  assert.equal(result.payload.extractionStatus, "partial");
  assert.equal(row.securityTitle.status, "unsupported");
  assert.equal(row.securityTitle.rawLexicalValue, null);
  assert.equal(row.securityTitle.facts[0]?.rawLexicalStatus, "unsupported_mixed_content");
  assert.equal(row.tradingSymbol.status, "explicit_blank");
  assert.equal(row.tradingSymbol.rawLexicalValue, " ");
  assert.equal(row.tradingSymbol.parsedTextValue, null);
});

test("supports a single unambiguous wrapper and classifies an empty fact without inventing text", () => {
  const result = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(inline([
    context("c1"),
    '<ix:nonNumeric name="dei:Security12bTitle" contextRef="c1"><span style="font-weight:bold">Common Stock</span></ix:nonNumeric>',
    '<ix:nonNumeric name="dei:TradingSymbol" contextRef="c1"></ix:nonNumeric>',
    fact("SecurityExchangeName", "c1", "NASDAQ"),
  ]))));
  const row = result.payload.observations[0]!;
  assert.equal(row.securityTitle.status, "observed");
  assert.equal(row.securityTitle.rawLexicalValue, "Common Stock");
  assert.equal(row.tradingSymbol.status, "explicit_empty");
  assert.equal(row.tradingSymbol.rawLexicalValue, null);
});

test("same source and parser result replays across fetch timestamps while raw or parser revisions remain distinct", () => {
  const body = inline([context("c1"), fact("TradingSymbol", "c1", "GURE")]);
  const first = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(body, { fetchedAt: "2026-08-30T19:21:11Z" })));
  const refetched = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(body, { fetchedAt: "2026-09-01T01:02:03Z" })));
  assert.equal(first.resultId, refetched.resultId);
  assert.equal(first.payloadSha256, refetched.payloadSha256);

  const changedRaw = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(body.replace("GURE", "GUREX"))));
  const changedParser = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(body, { parserVersion: "sec_edgar_raw_parser_v2" })));
  assert.notEqual(first.resultId, changedRaw.resultId);
  assert.notEqual(first.resultId, changedParser.resultId);
});

test("reader validation reparses exact raw source and preserves a missing declared char count", () => {
  const built = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem(
    inline([context("c1"), fact("TradingSymbol", "c1", "GURE")]),
    { declaredCharCount: null },
  )));
  const result = { ...built.result, id: built.resultId };
  const validation = validateSecCoverStoredPayload({
    result,
    observations: built.observations,
    rawSource: built.sourceRaw,
  });
  assert.equal(validation.ok, true);
});

test("structured artifact lineage is explicit and replays without pretending to be a raw item", () => {
  const body = inline([context("c1"), fact("TradingSymbol", "c1", "GURE")]);
  const artifact = createSecFilingXbrlArtifactFromStoredHttpBody({
    issuerCik: "0000885462",
    accession: ACCESSION,
    documentName: "gure-20260331.htm",
    sourceUrl: URL,
    role: "inline_xbrl",
    rawContent: body,
    fetchedAt: "2026-08-30T19:21:11Z",
    contentType: "text/html",
  });
  const built = buildSecCoverObservationPayloadFromStructuredArtifact({
    filing: {
      accessionNumber: ACCESSION,
      issuerCik: CIK,
      formType: "10-Q",
      filedDate: "2026-08-28",
      acceptedAt: "2026-08-28T20:45:51Z",
      sourceRawId: "20000000-0000-4000-8000-000000000001",
    },
    artifact,
  });
  assert.equal(built.rawItemId, null);
  assert.equal(built.payload.identity.lineageKind, "structured_filing_artifact");
  assert.equal(built.payload.identity.rawItemId, null);
  assert.equal(built.payload.source.role, "inline_xbrl");
  assert.equal(validateSecCoverStoredPayload({
    result: built.result,
    observations: built.observations,
    rawSource: built.sourceRaw,
  }).ok, true);
});

test("caller/stored check ignores capture time but rejects source or identity changes", () => {
  const body = inline([context("c1"), fact("TradingSymbol", "c1", "GURE")]);
  const caller = rawItem(body, { fetchedAt: "2026-09-01T00:00:00Z" });
  const stored = { ...rawItem(body, { fetchedAt: "2026-08-30T00:00:00Z" }), id: RAW_ITEM_ID };
  assert.doesNotThrow(() => assertSecCoverCallerMatchesStored(caller, stored));
  assert.throws(
    () => assertSecCoverCallerMatchesStored(rawItem(body.replace("GURE", "OTHER")), stored),
    (error: unknown) => error instanceof SecCoverObservationSourceError && error.code === "caller_stored_identity_mismatch",
  );
});

test("records source missing, source truncation, and parser failure without inventing observations", () => {
  const sourceMissing = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem("", { declaredCharCount: null })));
  assert.equal(sourceMissing.payload.extractionStatus, "source_missing");
  assert.equal(sourceMissing.payload.source.sha256, null);

  const sourceTruncated = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem("<html></html>", { truncated: true })));
  assert.equal(sourceTruncated.payload.extractionStatus, "source_truncated");

  const parseFailed = required(buildSecCoverObservationPayload(RAW_ITEM_ID, rawItem("<html>")));
  assert.equal(parseFailed.payload.extractionStatus, "parse_failed");
  assert.equal(parseFailed.payload.observations.length, 0);
});

function rawItem(
  html: string,
  options: {
    cik?: string;
    accession?: string;
    url?: string;
    fetchedAt?: string;
    parserVersion?: string;
    declaredCharCount?: number | null;
    truncated?: boolean;
  } = {},
) {
  const cik = options.cik ?? CIK;
  const accession = options.accession ?? ACCESSION;
  const url = options.url ?? URL;
  return {
    source_code: "sec_edgar",
    source_group: "filings",
    source_unique_id: accession,
    source_url: url.replace(/\/[^/]+$/, `/${accession}-index.htm`),
    fetched_at: options.fetchedAt ?? "2026-08-30T19:21:11Z",
    raw_payload: {
      accession_number: accession,
      cik,
      form_type: "10-Q",
      filing_date: "2026-08-28",
      accepted_at: "2026-08-28T20:45:51Z",
      parser_version: options.parserVersion ?? "sec_edgar_raw_parser_v1",
      primary_document_url: html ? url : null,
      primary_document_html: html || null,
      primary_document_html_char_count: options.declaredCharCount === undefined ? html.length : options.declaredCharCount,
      primary_document_html_truncated: options.truncated ?? false,
    },
  };
}

function inline(
  children: string[],
  cik = CIK,
  xhtml = true,
  deiVersion = "2026",
) {
  const root = xhtml ? "html" : "xbrl";
  const rootNs = xhtml
    ? ' xmlns="http://www.w3.org/1999/xhtml" xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"'
    : ' xmlns="http://www.xbrl.org/2003/instance"';
  const wrapped = xhtml
    ? `<ix:header><ix:resources>${children.filter((value) => value.startsWith("<xbrli:context")).join("")}</ix:resources></ix:header>${children.filter((value) => !value.startsWith("<xbrli:context")).join("")}`
    : children.join("");
  return `<${root}${rootNs} xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:dei="http://xbrl.sec.gov/dei/${deiVersion}" xmlns:srt="http://fasb.org/srt/2026" xmlns:vee="http://example.com/vee" xmlns:ixt-sec="http://www.sec.gov/inlineXBRL/transformation/2026" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" data-cik="${cik}">${wrapped}</${root}>`;
}

function context(
  id: string,
  dimension?: { axis: string; member: string },
  scheme = "http://www.sec.gov/CIK",
  cik = CIK,
) {
  return `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="${scheme}">${cik}</xbrli:identifier>${dimension ? `<xbrli:segment><xbrldi:explicitMember dimension="${dimension.axis}">${dimension.member}</xbrldi:explicitMember></xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate></xbrli:period></xbrli:context>`;
}

function fact(concept: string, contextRef: string, value: string, attrs = "") {
  return `<ix:nonNumeric name="dei:${concept}" contextRef="${contextRef}"${attrs}>${value}</ix:nonNumeric>`;
}

function instanceFact(concept: string, contextRef: string, value: string) {
  return `<dei:${concept} contextRef="${contextRef}">${value}</dei:${concept}>`;
}

function required<T>(value: T | null): T {
  assert.ok(value);
  return value;
}
