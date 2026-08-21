import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  InMemorySecFilingXbrlArtifactRepository,
  SecFilingXbrlContextService,
  SecFilingXbrlHttpClient,
  createSecFilingXbrlFixtureArtifact,
  discoverSecFilingXbrlDocuments,
  parseSecFilingXbrlArtifact,
  parseSecFilingXbrlArtifacts,
  readOsCandidateFilingContexts,
} from "./filingXbrlContext.ts";
import type { SecOsFilingContextCandidate } from "./osCandidateExtraction.ts";
import type { SecFilingRow } from "./types.ts";
import { resolveAuthoritativeOsFromFiling } from "./authoritativeOsExtraction.ts";

const audit = JSON.parse(readFileSync(
  new URL("./fixtures/filing-xbrl-four-issuer-audit.json", import.meta.url),
  "utf8",
)) as {
  issuers: Array<{
    ticker: string;
    cik: string;
    accession: string;
    document: string;
    source_url: string;
    full_document_sha256: string;
    document_kind: "inline_xbrl" | "instance_xml";
    candidate: { taxonomy: "dei" | "us-gaap"; concept: SecOsFilingContextCandidate["concept"]; as_of: string; value: string };
  }>;
};

const NS = [
  'xmlns="http://www.w3.org/1999/xhtml"',
  'xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"',
  'xmlns:xbrli="http://www.xbrl.org/2003/instance"',
  'xmlns:xbrldi="http://xbrl.org/2006/xbrldi"',
  'xmlns:dei="http://xbrl.sec.gov/dei/2025"',
  'xmlns:us-gaap="http://fasb.org/us-gaap/2025"',
  'xmlns:goog="http://abc.xyz/20260630"',
  'xmlns:custom="https://example.test/custom"',
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
].join(" ");

function context(id: string, cik: string, instant: string, dimensions = "") {
  return `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">${cik}</xbrli:identifier>${dimensions ? `<xbrli:segment>${dimensions}</xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:instant>${instant}</xbrli:instant></xbrli:period></xbrli:context>`;
}

function explicit(axis: string, member: string) {
  return `<xbrldi:explicitMember dimension="${axis}">${member}</xbrldi:explicitMember>`;
}

function inlineDocument(resources: string, facts: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><html ${NS}><body><div><ix:header><ix:resources>${shareUnits()}${resources}</ix:resources></ix:header></div>${facts}</body></html>`;
}

function inlineDocumentWithPrefix(prefix: string, resources: string, facts: string) {
  const namespaces = NS.replace('xmlns:ix="http://www.xbrl.org/2013/inlineXBRL"', `xmlns:${prefix}="http://www.xbrl.org/2013/inlineXBRL"`);
  return `<?xml version="1.0" encoding="UTF-8"?><html ${namespaces}><body><${prefix}:header><${prefix}:resources>${shareUnits()}${resources}</${prefix}:resources></${prefix}:header>${facts}</body></html>`;
}

function shareUnits() {
  return '<xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit><xbrli:unit id="U_shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>';
}

function filingIndexBody(documents: Array<{
  name: string;
  type: string;
  description?: string;
  inline?: boolean;
  sequence?: string;
}> = [{ name: "aapl-20260627.htm", type: "10-Q", inline: true }]) {
  const rows = documents.map((document, index) => `<tr><td>${document.sequence ?? index + 1}</td><td>${document.description ?? document.type}</td><td><a href="/Archives/edgar/data/320193/000032019326000020/${document.name}">${document.name}</a>${document.inline ? " <span>iXBRL</span>" : ""}</td><td>${document.type}</td><td>100</td></tr>`).join("");
  return `<html><body><div>SEC Accession No. 0000320193-26-000020</div><table summary="Document Format Files">${rows}</table></body></html>`;
}

function acceptanceBody(ticker: string) {
  if (ticker === "AAPL") {
    return inlineDocument(
      context("c-9", "0000320193", "2026-07-17"),
      '<ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="c-9" unitRef="shares" decimals="INF">14,594,180,000</ix:nonFraction>',
    );
  }
  if (ticker === "GOOG") {
    const contexts = [
      context("c-32", "0001652044", "2026-06-30"),
      context("c-35", "0001652044", "2026-06-30", explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:CommonClassAMember")),
      context("c-36", "0001652044", "2026-06-30", explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:CommonClassBMember")),
      context("c-39", "0001652044", "2026-06-30", explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:CommonClassCMember")),
    ].join("");
    const facts = [
      ["c-32", "12,230"],
      ["c-35", "5,868"],
      ["c-36", "835"],
      ["c-39", "5,527"],
    ].map(([contextRef, value]) => `<ix:nonFraction name="us-gaap:CommonStockSharesOutstanding" contextRef="${contextRef}" unitRef="shares" decimals="-6" scale="6" format="ixt:num-dot-decimal">${value}</ix:nonFraction>`).join("");
    return inlineDocument(contexts, facts);
  }
  if (ticker === "WIT") {
    return inlineDocument(
      context("C_8083f6a7-2f42-4143-ad73-f902fca5238a", "0001123799", "2026-03-31"),
      '<ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="C_8083f6a7-2f42-4143-ad73-f902fca5238a" unitRef="U_shares" decimals="INF" format="ixt:num-dot-decimal">10,488,412,458</ix:nonFraction>',
    );
  }
  if (ticker === "NEOM") {
    return `<?xml version="1.0"?><xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:dei="http://xbrl.sec.gov/dei/2012">${shareUnits()}<xbrli:context id="PAsOn08_02_2013"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001022701</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2013-08-02</xbrli:instant></xbrli:period></xbrli:context><dei:EntityCommonStockSharesOutstanding contextRef="PAsOn08_02_2013" unitRef="shares" decimals="INF">4984827279</dei:EntityCommonStockSharesOutstanding></xbrli:xbrl>`;
  }
  throw new Error(`unknown acceptance sample ${ticker}`);
}

function filing(input: Partial<SecFilingRow> = {}): SecFilingRow {
  return {
    accessionNumber: "0000320193-26-000020",
    issuerCik: "0000320193",
    form: "10-Q",
    filedDate: "2026-07-31",
    acceptedAt: "2026-07-31T10:01:02.000Z",
    reportDate: "2026-06-27",
    primaryDocument: "aapl-20260627.htm",
    isXbrl: true,
    isInlineXbrl: true,
    sourceRawId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    sourceKind: "submissions",
    ingestedAt: "2026-08-22T00:00:00.000Z",
    ...input,
  };
}

function candidate(sample: (typeof audit.issuers)[number]): SecOsFilingContextCandidate {
  return {
    issuerCik: sample.cik,
    sharesOutstanding: sample.candidate.value,
    asOf: sample.candidate.as_of,
    accession: sample.accession,
    form: sample.ticker === "WIT" ? "20-F" : sample.ticker === "NEOM" ? "10-Q/A" : "10-Q",
    filedDate: "2026-08-22",
    acceptedAt: "2026-08-22T00:00:00.000Z",
    taxonomy: sample.candidate.taxonomy,
    concept: sample.candidate.concept,
    unit: "shares",
    sourceKind: "companyfacts",
    contextKind: "companyfacts_implicit",
    sourceFacts: [{
      sourceFactKey: "a".repeat(64),
      sourceFactPath: `facts.${sample.candidate.taxonomy}.${sample.candidate.concept}.units.shares[0]`,
      sourceRawId: "11111111-1111-4111-8111-111111111111",
    }],
    filingLedgerRawSourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    extractionStatus: "REQUIRES_FILING_CONTEXT",
    rejectionReason: sample.ticker === "WIT"
      ? "ADS_OR_ORDINARY_SHARES_REQUIRE_FILING_CONTEXT"
      : sample.ticker === "GOOG"
        ? "SAME_DATE_CONFLICT_REQUIRES_FILING_CONTEXT"
        : "MISSING_COMPANYFACTS_SECURITY_CLASS_CONTEXT",
  };
}

function artifactFor(sample: (typeof audit.issuers)[number]) {
  return createSecFilingXbrlFixtureArtifact({
    issuerCik: sample.cik,
    accession: sample.accession,
    documentName: sample.document,
    sourceUrl: sample.source_url,
    role: sample.document_kind,
    rawContent: acceptanceBody(sample.ticker),
  });
}

function filingForSample(sample: (typeof audit.issuers)[number]): SecFilingRow {
  const linked = candidate(sample);
  return filing({
    accessionNumber: linked.accession,
    issuerCik: linked.issuerCik,
    form: linked.form,
    filedDate: linked.filedDate,
    acceptedAt: linked.acceptedAt,
    reportDate: linked.asOf,
    primaryDocument: sample.ticker === "NEOM" ? "v351884_10qa.htm" : sample.document,
    isInlineXbrl: sample.document_kind === "inline_xbrl",
    sourceRawId: linked.filingLedgerRawSourceId,
  });
}

function inventoryForSample(sample: (typeof audit.issuers)[number]) {
  const row = filingForSample(sample);
  const archive = sample.source_url.slice(0, sample.source_url.lastIndexOf("/"));
  const directoryName = new URL(archive).pathname;
  const documents = sample.document_kind === "inline_xbrl"
    ? [{ name: sample.document, type: row.form, inline: true }]
    : [
        { name: row.primaryDocument!, type: row.form, inline: false },
        { name: sample.document, type: "EX-101.INS", inline: false },
      ];
  const indexHtml = `<html><body><div>SEC Accession No. ${row.accessionNumber}</div><table summary="Document Format Files">${documents.map((document, index) =>
    `<tr><td>${index + 1}</td><td>${document.type}</td><td><a href="${directoryName}/${document.name}">${document.name}</a>${document.inline ? " <span>iXBRL</span>" : ""}</td><td>${document.type}</td><td>100</td></tr>`
  ).join("")}</table></body></html>`;
  const inventory = [
    createSecFilingXbrlFixtureArtifact({
      issuerCik: row.issuerCik,
      accession: row.accessionNumber,
      documentName: "index.json",
      sourceUrl: `${archive}/index.json`,
      role: "archive_index",
      rawContent: JSON.stringify({ directory: { name: directoryName, item: documents.map((document) => ({ name: document.name, size: 100 })) } }),
    }),
    createSecFilingXbrlFixtureArtifact({
      issuerCik: row.issuerCik,
      accession: row.accessionNumber,
      documentName: `${row.accessionNumber}-index.html`,
      sourceUrl: `${archive}/${row.accessionNumber}-index.html`,
      role: "filing_index",
      rawContent: indexHtml,
    }),
  ];
  if (sample.document_kind === "instance_xml") {
    inventory.push(createSecFilingXbrlFixtureArtifact({
      issuerCik: row.issuerCik,
      accession: row.accessionNumber,
      documentName: row.primaryDocument!,
      sourceUrl: `${archive}/${row.primaryDocument}`,
      role: "primary_document",
      rawContent: "<html><body>primary filing document</body></html>",
    }));
  }
  return inventory;
}

function aaplInventoryArtifacts() {
  const archive = "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020";
  return [
    createSecFilingXbrlFixtureArtifact({
      issuerCik: "0000320193",
      accession: "0000320193-26-000020",
      documentName: "index.json",
      sourceUrl: `${archive}/index.json`,
      role: "archive_index",
      rawContent: JSON.stringify({ directory: {
        name: "/Archives/edgar/data/320193/000032019326000020",
        item: [{ name: "aapl-20260627.htm", size: 100 }],
      } }),
    }),
    createSecFilingXbrlFixtureArtifact({
      issuerCik: "0000320193",
      accession: "0000320193-26-000020",
      documentName: "0000320193-26-000020-index.html",
      sourceUrl: `${archive}/0000320193-26-000020-index.html`,
      role: "filing_index",
      rawContent: filingIndexBody(),
    }),
  ];
}

test("archive index discovery is accession-driven and separates inline and instance candidates", () => {
  const row = filing();
  const body = JSON.stringify({ directory: {
    name: "/Archives/edgar/data/320193/000032019326000020",
    item: [
      { name: "aapl-20260627.htm", size: 1018210 },
      { name: "aapl-20260627_htm.xml", size: 962405 },
      { name: "aapl-20260627_lab.xml", size: 511737 },
      { name: "FilingSummary.xml", size: 28383 },
      { name: "R1.xml", size: 1000 },
    ],
  } });
  const result = discoverSecFilingXbrlDocuments(row, body, filingIndexBody());
  assert.equal(result.status, "AVAILABLE");
  if (result.status !== "AVAILABLE") return;
  assert.equal(result.discovery.primaryDocument.documentName, "aapl-20260627.htm");
  assert.deepEqual(result.discovery.primaryIxdsDocuments.map((document) => document.documentName), ["aapl-20260627.htm"]);
  assert.deepEqual(
    result.discovery.documents.filter((document) => document.isInstanceCandidate).map((document) => document.documentName),
    ["aapl-20260627_htm.xml"],
  );
  const mismatch = discoverSecFilingXbrlDocuments(row, JSON.stringify({ directory: { name: "/Archives/edgar/data/320193/wrong", item: [] } }), filingIndexBody());
  assert.deepEqual(mismatch, { status: "UNAVAILABLE", reason: "ACCESSION_MISMATCH", detail: "archive index directory does not match filing identity" });
});

test("HTTP client uses filing attachment metadata and fetches the complete primary IXDS", async () => {
  const requests: string[] = [];
  const index = JSON.stringify({ directory: {
    name: "/Archives/edgar/data/320193/000032019326000020",
    item: [{ name: "aapl-20260627.htm", size: 100 }],
  } });
  const client = new SecFilingXbrlHttpClient(
    "StockRadar test@example.com",
    (async (input: string | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("index.json")) return new Response(index, { status: 200, headers: { "content-type": "application/json" } });
      if (url.endsWith("-index.html")) return new Response(filingIndexBody(), { status: 200, headers: { "content-type": "text/html" } });
      return new Response(acceptanceBody("AAPL"), { status: 200, headers: { "content-type": "text/html" } });
    }) as typeof fetch,
    () => new Date("2026-08-22T00:00:00.000Z"),
    100,
  );
  const result = await client.fetchFilingArtifacts(filing());
  assert.equal(result.status, "AVAILABLE");
  assert.equal(requests.length, 3);
  assert.deepEqual(result.artifacts.map((artifact) => artifact.role), ["archive_index", "filing_index", "inline_xbrl"]);
});

test("missing member of a multiple-document primary IXDS is unavailable while the complete set preserves class evidence", async () => {
  const names = ["aapl-20260627.htm", "aapl-note.htm", "aapl-fee.htm"];
  const index = JSON.stringify({ directory: {
    name: "/Archives/edgar/data/320193/000032019326000020",
    item: names.map((name) => ({ name, size: 100 })),
  } });
  const metadata = filingIndexBody([
    { name: names[0]!, type: "10-Q", inline: true, sequence: "1" },
    { name: names[1]!, type: "EX-99.1", inline: true, sequence: "2" },
    { name: names[2]!, type: "EX-FILING FEES", inline: true, sequence: "3" },
  ]);
  const requests: string[] = [];
  const sample = audit.issuers[0]!;
  const primary = inlineDocumentWithPrefix(
    "primaryIx",
    context("plain", sample.cik, sample.candidate.as_of),
    `<primaryIx:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="plain" unitRef="shares">${sample.candidate.value}</primaryIx:nonFraction>`,
  );
  const note = inlineDocumentWithPrefix(
    "noteIx",
    context("class-a", sample.cik, sample.candidate.as_of, explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:CommonClassAMember")),
    `<noteIx:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="class-a" unitRef="shares">${sample.candidate.value}</noteIx:nonFraction>`,
  );
  const client = new SecFilingXbrlHttpClient(
    "StockRadar test@example.com",
    (async (input: string | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("index.json")) return new Response(index, { status: 200 });
      if (url.endsWith("-index.html")) return new Response(metadata, { status: 200 });
      if (url.endsWith(names[0]!)) return new Response(primary, { status: 200 });
      if (url.endsWith(names[1]!)) return new Response(note, { status: 200 });
      throw new Error("separate inline exhibit must not be fetched");
    }) as typeof fetch,
    () => new Date("2026-08-22T00:00:00.000Z"),
    100,
  );
  const fetched = await client.fetchFilingArtifacts(filing());
  assert.equal(fetched.status, "AVAILABLE");
  if (fetched.status !== "AVAILABLE") return;
  assert.deepEqual(fetched.discovery.primaryIxdsDocuments.map((document) => document.documentName), names.slice(0, 2));
  assert.deepEqual(fetched.discovery.separateInlineDocuments.map((document) => document.documentName), [names[2]]);
  assert.equal(requests.some((url) => url.endsWith(names[2]!)), false);
  const parsed = parseSecFilingXbrlArtifacts(fetched.artifacts);
  assert.equal(parsed.status, "AVAILABLE");
  if (parsed.status !== "AVAILABLE") return;
  assert.equal(parsed.documentKind, "inline_xbrl_ixds");
  assert.equal(parsed.facts.length, 2);
  const repository = new InMemorySecFilingXbrlArtifactRepository();
  await repository.ingestArtifacts(fetched.artifacts.filter((artifact) => artifact.documentName !== names[1]));
  const row = filingForSample(sample);
  const missing = await readOsCandidateFilingContexts({ candidate: candidate(sample), filing: row, repository });
  assert.equal(missing.status, "UNAVAILABLE");
  if (missing.status === "UNAVAILABLE") assert.equal(missing.reason, "PRIMARY_IXDS_INCOMPLETE");
  assert.equal(resolveAuthoritativeOsFromFiling(missing).status, "UNAVAILABLE");

  await repository.ingestArtifacts(fetched.artifacts);
  const linked = await readOsCandidateFilingContexts({ candidate: candidate(sample), filing: row, repository });
  assert.equal(linked.status, "AVAILABLE");
  if (linked.status === "AVAILABLE") assert.equal(linked.matches.length, 2);
  const completeDecision = resolveAuthoritativeOsFromFiling(linked);
  assert.equal(completeDecision.status, "REQUIRES_FURTHER_CONTEXT");
  assert.equal(completeDecision.reason, "AGGREGATE_AND_CLASS_SPECIFIC_FACTS_REQUIRE_SELECTION");
});

test("conditional separate Inline XBRL attachment fails closed instead of guessing IXDS membership", async () => {
  const index = JSON.stringify({ directory: {
    name: "/Archives/edgar/data/320193/000032019326000020",
    item: [{ name: "aapl-20260627.htm" }, { name: "transaction.htm" }],
  } });
  const client = new SecFilingXbrlHttpClient(
    "StockRadar test@example.com",
    (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("index.json")) return new Response(index, { status: 200 });
      if (url.endsWith("-index.html")) return new Response(filingIndexBody([
        { name: "aapl-20260627.htm", type: "10-Q", inline: true },
        { name: "transaction.htm", type: "EX-2.01", inline: true },
      ]), { status: 200 });
      throw new Error("ambiguous IXDS must fail before document fetch");
    }) as typeof fetch,
    () => new Date("2026-08-22T00:00:00.000Z"),
    100,
  );
  const result = await client.fetchFilingArtifacts(filing());
  assert.equal(result.status, "UNAVAILABLE");
  if (result.status === "UNAVAILABLE") assert.equal(result.reason, "PRIMARY_IXDS_MEMBERSHIP_AMBIGUOUS");
});

test("Inline XBRL detection is namespace-based and independent of the namespace prefix", async () => {
  const body = inlineDocumentWithPrefix(
    "alternate",
    context("prefix-independent", "0000320193", "2026-07-17"),
    '<alternate:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="prefix-independent" unitRef="shares">100</alternate:nonFraction>',
  );
  const artifact = createSecFilingXbrlFixtureArtifact({
    issuerCik: "0000320193",
    accession: "0000320193-26-000020",
    documentName: "aapl-20260627.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm",
    role: "inline_xbrl",
    rawContent: body,
  });
  const parsed = parseSecFilingXbrlArtifacts([artifact]);
  assert.equal(parsed.status, "AVAILABLE");
  if (parsed.status === "AVAILABLE") assert.equal(parsed.facts.length, 1);
});

test("O/S concept linkage uses namespace URI and local name rather than the lexical prefix", async () => {
  const sample = audit.issuers[0]!;
  const body = inlineDocument(
    context("alternate-concept-prefix", sample.cik, sample.candidate.as_of),
    `<ix:nonFraction name="filingDei:EntityCommonStockSharesOutstanding" contextRef="alternate-concept-prefix" unitRef="shares">${sample.candidate.value}</ix:nonFraction>`,
  ).replace(
    'xmlns:dei="http://xbrl.sec.gov/dei/2025"',
    'xmlns:filingDei="http://xbrl.sec.gov/dei/2025"',
  );
  const repository = new InMemorySecFilingXbrlArtifactRepository();
  await repository.ingestArtifacts([
    ...aaplInventoryArtifacts(),
    createSecFilingXbrlFixtureArtifact({
      issuerCik: sample.cik,
      accession: sample.accession,
      documentName: sample.document,
      sourceUrl: sample.source_url,
      role: "inline_xbrl",
      rawContent: body,
    }),
  ]);
  const linked = await readOsCandidateFilingContexts({
    candidate: candidate(sample),
    filing: filingForSample(sample),
    repository,
  });
  assert.equal(linked.status, "AVAILABLE");
  if (linked.status === "AVAILABLE") {
    assert.equal(linked.matches.length, 1);
    assert.equal(linked.matches[0]?.concept.prefix, "filingDei");
    assert.equal(linked.matches[0]?.concept.namespaceUri, "http://xbrl.sec.gov/dei/2025");
  }
});

test("official reader rejects a lone filing fact artifact without archive and filing indexes", async () => {
  const sample = audit.issuers[0]!;
  const repository = new InMemorySecFilingXbrlArtifactRepository();
  await repository.ingestArtifacts([artifactFor(sample)]);
  const linked = await readOsCandidateFilingContexts({
    candidate: candidate(sample),
    filing: filingForSample(sample),
    repository,
  });
  assert.equal(linked.status, "UNAVAILABLE");
  if (linked.status === "UNAVAILABLE") {
    assert.equal(linked.reason, "FILING_ARTIFACT_MISSING");
    assert.match(linked.detail, /archive index and one filing index/);
  }
});

test("shared IXDS context map rejects conflicting context IDs across documents", () => {
  const first = createSecFilingXbrlFixtureArtifact({
    issuerCik: "0000320193",
    accession: "0000320193-26-000020",
    documentName: "aapl-20260627.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm",
    role: "inline_xbrl",
    rawContent: inlineDocument(context("shared", "0000320193", "2026-07-17"), ""),
  });
  const second = createSecFilingXbrlFixtureArtifact({
    issuerCik: "0000320193",
    accession: "0000320193-26-000020",
    documentName: "aapl-note.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-note.htm",
    role: "inline_xbrl",
    rawContent: inlineDocument(context("shared", "0000320193", "2026-07-18"), ""),
  });
  const parsed = parseSecFilingXbrlArtifacts([second, first]);
  assert.equal(parsed.status, "UNAVAILABLE");
  if (parsed.status === "UNAVAILABLE") assert.equal(parsed.reason, "CONFLICTING_CONTEXT_IDS");

  const conflictingUnit = createSecFilingXbrlFixtureArtifact({
    issuerCik: "0000320193",
    accession: "0000320193-26-000020",
    documentName: "aapl-unit.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-unit.htm",
    role: "inline_xbrl",
    rawContent: inlineDocument('<xbrli:unit id="shares"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>', ""),
  });
  const unitParsed = parseSecFilingXbrlArtifacts([first, conflictingUnit]);
  assert.equal(unitParsed.status, "UNAVAILABLE");
  if (unitParsed.status === "UNAVAILABLE") assert.equal(unitParsed.reason, "CONFLICTING_UNIT_IDS");
});

test("parser preserves instant/duration, explicit and typed dimensions without semantic inference", () => {
  const resources = [
    context("plain", "0000320193", "2026-07-17"),
    context("explicit", "0000320193", "2026-07-17", explicit("us-gaap:StatementClassOfStockAxis", "us-gaap:CommonClassAMember")),
    context("typed", "0000320193", "2026-07-17", '<xbrldi:typedMember dimension="custom:TypedAxis"><custom:TypedValue code="A">Class A exact</custom:TypedValue></xbrldi:typedMember>'),
    '<xbrli:context id="duration"><xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0000320193</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2026-01-01</xbrli:startDate><xbrli:endDate>2026-06-30</xbrli:endDate></xbrli:period></xbrli:context>',
  ].join("");
  const facts = [
    '<ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="plain" unitRef="shares">100</ix:nonFraction>',
    '<ix:nonFraction name="us-gaap:CommonStockSharesOutstanding" contextRef="explicit" unitRef="shares">60</ix:nonFraction>',
    '<ix:nonFraction name="us-gaap:CommonStockSharesOutstanding" contextRef="typed" unitRef="shares">40</ix:nonFraction>',
  ].join("");
  const parsed = parseSecFilingXbrlArtifact(createSecFilingXbrlFixtureArtifact({
    issuerCik: "0000320193",
    accession: "0000320193-26-000020",
    documentName: "aapl-20260627.htm",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm",
    role: "inline_xbrl",
    rawContent: inlineDocument(resources, facts),
  }));
  assert.equal(parsed.status, "AVAILABLE");
  if (parsed.status !== "AVAILABLE") return;
  assert.deepEqual(parsed.contexts.find((item) => item.id === "duration")?.period, {
    kind: "duration", startDate: "2026-01-01", endDate: "2026-06-30",
  });
  const explicitDimension = parsed.contexts.find((item) => item.id === "explicit")?.dimensions[0];
  assert.equal(explicitDimension?.kind, "explicit");
  if (explicitDimension?.kind === "explicit") {
    assert.equal(explicitDimension.axis.qname, "us-gaap:StatementClassOfStockAxis");
    assert.equal(explicitDimension.member.qname, "us-gaap:CommonClassAMember");
  }
  const typed = parsed.contexts.find((item) => item.id === "typed")?.dimensions[0];
  assert.equal(typed?.kind, "typed");
  if (typed?.kind === "typed") {
    assert.equal(typed.axis.qname, "custom:TypedAxis");
    assert.equal(typed.valueQName.qname, "custom:TypedValue");
    assert.equal(typed.valueText, "Class A exact");
    assert.equal(typed.canonicalXml, '<custom:TypedValue code="A">Class A exact</custom:TypedValue>');
  }
  assert.equal(parsed.units.find((item) => item.id === "shares")?.kind, "measure");
  assert.equal(parsed.facts[0]?.unit?.kind, "measure");
  if (parsed.facts[0]?.unit?.kind === "measure") {
    assert.equal(parsed.facts[0].unit.measure.qname, "xbrli:shares");
  }
});

test("unsupported facts are rejected individually and broken candidate context fails closed", async () => {
  const sample = audit.issuers.find((item) => item.ticker === "AAPL")!;
  const body = inlineDocument(
    context("good", sample.cik, sample.candidate.as_of),
    '<ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="missing" unitRef="shares">100</ix:nonFraction><ix:fraction name="us-gaap:EarningsPerShareBasic" contextRef="good" unitRef="usdPerShare"><ix:numerator>1</ix:numerator><ix:denominator>2</ix:denominator></ix:fraction>',
  );
  const repository = new InMemorySecFilingXbrlArtifactRepository();
  await repository.ingestArtifacts([...aaplInventoryArtifacts(), createSecFilingXbrlFixtureArtifact({
    issuerCik: sample.cik,
    accession: sample.accession,
    documentName: sample.document,
    sourceUrl: sample.source_url,
    role: "inline_xbrl",
    rawContent: body,
  })]);
  const linked = await readOsCandidateFilingContexts({ candidate: candidate(sample), filing: filingForSample(sample), repository });
  assert.equal(linked.status, "UNAVAILABLE");
  if (linked.status === "UNAVAILABLE") assert.equal(linked.reason, "BROKEN_CONTEXT_REF");
});

test("conflicting context IDs and uninterpretable typed members fail closed", () => {
  const conflicting = inlineDocument(
    `${context("same", "0000320193", "2026-07-17")}${context("same", "0000320193", "2026-07-18")}`,
    '<ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="same" unitRef="shares">100</ix:nonFraction>',
  );
  const badTyped = inlineDocument(
    context("typed", "0000320193", "2026-07-17", '<xbrldi:typedMember dimension="custom:TypedAxis"><custom:A>1</custom:A><custom:B>2</custom:B></xbrldi:typedMember>'),
    '<ix:nonFraction name="dei:EntityCommonStockSharesOutstanding" contextRef="typed" unitRef="shares">100</ix:nonFraction>',
  );
  for (const [rawContent, expected] of [
    [conflicting, "CONFLICTING_CONTEXT_IDS"],
    [badTyped, "UNINTERPRETABLE_TYPED_MEMBER"],
  ] as const) {
    const parsed = parseSecFilingXbrlArtifact(createSecFilingXbrlFixtureArtifact({
      issuerCik: "0000320193",
      accession: "0000320193-26-000020",
      documentName: "aapl-20260627.htm",
      sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000020/aapl-20260627.htm",
      role: "inline_xbrl",
      rawContent,
    }));
    assert.equal(parsed.status, "UNAVAILABLE");
    if (parsed.status === "UNAVAILABLE") assert.equal(parsed.reason, expected);
  }
});

test("raw artifact persistence is deterministic and replay-idempotent", async () => {
  const repository = new InMemorySecFilingXbrlArtifactRepository();
  const artifact = artifactFor(audit.issuers[0]!);
  assert.deepEqual(await repository.ingestArtifacts([artifact]), { inserted: 1, deduped: 0 });
  assert.deepEqual(await repository.ingestArtifacts([structuredClone(artifact)]), { inserted: 0, deduped: 1 });
  const stored = await repository.readArtifacts(artifact.issuerCik, artifact.accession);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.contentHash, artifact.contentHash);
  assert.equal(stored[0]?.sourceUrl, artifact.sourceUrl);
  assert.equal(stored[0]?.rawContent, artifact.rawContent);
});

test("service distinguishes incomplete inventory cache from complete IXDS cache and replay is idempotent", async () => {
  const sample = audit.issuers[0]!;
  const repository = new InMemorySecFilingXbrlArtifactRepository();
  const inventory = aaplInventoryArtifacts();
  await repository.ingestArtifacts(inventory);
  let sourceCalls = 0;
  const sourceClient = {
    async fetchFilingArtifacts() {
      sourceCalls += 1;
      return {
        status: "AVAILABLE" as const,
        discovery: {} as never,
        artifacts: [...inventory, artifactFor(sample)],
      };
    },
  };
  const service = new SecFilingXbrlContextService(sourceClient, repository);
  const row = filingForSample(sample);
  const first = await service.ingestFiling(row);
  const replay = await service.ingestFiling(row);
  assert.equal(first.status, "AVAILABLE");
  assert.equal(first.source, "sec");
  assert.equal(replay.status, "AVAILABLE");
  assert.equal(replay.source, "cache");
  assert.equal(sourceCalls, 1);
  assert.equal(first.inserted, 1);
  assert.equal((await service.readOsCandidate(candidate(sample), row)).status, "AVAILABLE");
});

test("four official issuer excerpts link CompanyFacts candidates to filing contexts", async (t) => {
  for (const sample of audit.issuers) {
    await t.test(sample.ticker, async () => {
      assert.match(sample.full_document_sha256, /^[0-9a-f]{64}$/);
      const artifact = artifactFor(sample);
      const parsed = parseSecFilingXbrlArtifact(artifact);
      assert.equal(parsed.status, "AVAILABLE");
      if (parsed.status !== "AVAILABLE") return;
      assert.equal(parsed.documentKind, sample.document_kind);
      assert.equal(parsed.source.sourceUrl, sample.source_url);
      const repository = new InMemorySecFilingXbrlArtifactRepository();
      await repository.ingestArtifacts([...inventoryForSample(sample), artifact]);
      const linked = await readOsCandidateFilingContexts({ candidate: candidate(sample), filing: filingForSample(sample), repository });
      assert.equal(linked.status, "AVAILABLE");
      if (linked.status !== "AVAILABLE") return;
      assert.ok(linked.matches.every((fact) => fact.context.period.kind === "instant" && fact.context.period.instant === sample.candidate.as_of));
      if (sample.ticker === "GOOG") {
        assert.equal(linked.matches.length, 4);
        assert.deepEqual(
          linked.matches.flatMap((fact) => fact.context.dimensions).map((dimension) => dimension.kind === "explicit" ? dimension.member.qname : "typed"),
          ["us-gaap:CommonClassAMember", "us-gaap:CommonClassBMember", "us-gaap:CommonClassCMember"],
        );
      } else {
        assert.equal(linked.matches.length, 1);
      }
    });
  }
});

test("artifact lineage rejects accession URL mismatch", () => {
  const sample = audit.issuers[0]!;
  assert.throws(() => createSecFilingXbrlFixtureArtifact({
    issuerCik: sample.cik,
    accession: sample.accession,
    documentName: sample.document,
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000999/aapl.htm",
    role: "inline_xbrl",
    rawContent: acceptanceBody(sample.ticker),
  }), /accession URL mismatch/);
});

test("artifact source identity is derived from exact body and stable across replay", () => {
  const first = artifactFor(audit.issuers[0]!);
  const second = artifactFor(audit.issuers[0]!);
  assert.equal(first.id, second.id);
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.sourceIdentity, first.sourceUrl);
  assert.equal(first.rawContentKind, "injected_exact_body");
});
