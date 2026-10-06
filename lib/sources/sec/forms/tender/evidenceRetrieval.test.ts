import assert from "node:assert/strict";
import test from "node:test";
import { buildTenderEvidenceIndex } from "./evidenceRetrieval.ts";
import { prepareTenderEvidence } from "./evidencePreparation.ts";
import { renderTenderSource, tenderSourceHash, TENDER_EVIDENCE_FORMS, type TenderSourcePacket } from "./evidenceSource.ts";
import { buildSecTenderSourceBlockPromptInput } from "./sourceBlockPromptInput.ts";

const accession = "0001234567-26-000001";
const other = "0001234567-26-000002";
const make = (content = "Item 4. Solicitation or Recommendation\nThe board recommends that holders accept the Offer and tender their shares.", form = "SC 14D9"): TenderSourcePacket => ({
  accession, form, unavailable: [], documents: [{ accession, form, documentId: "primary.htm", url: `https://www.sec.gov/Archives/edgar/data/1234567/${accession.replaceAll("-", "")}/primary.htm`, role: "primary", content, format: "text", completeness: "complete" }],
});
const search = (index: ReturnType<typeof buildTenderEvidenceIndex>, question = "board recommendation") => index.search_evidence({ accession, question });

test("search has metadata only; read exact context and deterministic provenance", () => {
  const packet = make();
  const index = buildTenderEvidenceIndex(packet);
  const hits = search(index).hits;
  assert.ok(hits.length);
  assert.ok(!("text" in hits[0]));
  const read = index.read_evidence({ accession, ids: hits.map(h => h.id) });
  for (const e of read.evidence) {
    assert.equal(e.text, packet.documents[0].content.slice(e.location.start, e.location.end));
    assert.equal(e.textHash, tenderSourceHash(e.text));
    assert.equal(e.sourceHash, tenderSourceHash(packet.documents[0].content));
  }
  assert.deepEqual(hits, search(buildTenderEvidenceIndex(packet)).hits);
  const changed = buildTenderEvidenceIndex(make(packet.documents[0].content + "\nAmendment changes the recommendation."));
  assert.throws(() => changed.read_evidence({ accession, ids: [hits[0].id] }));
});

test("filing scope, URL identity, foreign IDs and document scope fail closed", () => {
  const packet = make(); const index = buildTenderEvidenceIndex(packet);
  assert.throws(() => index.search_evidence({ accession: other, question: "board" }));
  assert.throws(() => index.search_evidence({ accession, documentId: "unknown.htm", question: "board" }));
  const foreign = make(); foreign.accession = other; foreign.documents[0].accession = other;
  foreign.documents[0].url = foreign.documents[0].url.replace(accession.replaceAll("-", ""), other.replaceAll("-", ""));
  const foreignId = buildTenderEvidenceIndex(foreign).search_evidence({ accession: other, question: "board" }).hits[0].id;
  assert.throws(() => index.read_evidence({ accession, ids: [foreignId] }));
  assert.throws(() => buildTenderEvidenceIndex({ ...packet, documents: foreign.documents }));
  assert.throws(() => buildTenderEvidenceIndex({ ...packet, documents: [{ ...packet.documents[0], url: "https://example.com/primary.htm" }] }));
  assert.throws(() => buildTenderEvidenceIndex({ ...packet, documents: [...packet.documents, ...packet.documents] }));
});

test("documents from different transactions in one filing stay separate and filterable", () => {
  const packet = make("Offer Alpha purchase price is $10 per share.");
  packet.documents.push({ ...packet.documents[0], documentId: "beta.htm", url: packet.documents[0].url.replace("primary.htm", "beta.htm"), role: "attachment", content: "Offer Beta purchase price is $20 per share." });
  const index = buildTenderEvidenceIndex(packet);
  const found = index.search_evidence({ accession, question: "purchase price", documentId: "beta.htm" });
  const read = index.read_evidence({ accession, ids: found.hits.map(h => h.id) });
  assert.ok(read.evidence.every(e => e.document.documentId === "beta.htm" && !e.text.includes("Alpha")));
});

test("tables preserve headers, all rows, empty cells and spans; budgets never clip", () => {
  const packet = make("<h2>Purchase price</h2><p>Amounts are in dollars; see qualifications below.</p><table><tr><th>Class</th><th colspan='2'>Consideration</th></tr><tr><td>A</td><td>10</td><td></td></tr><tr><td rowspan='2'>B</td><td>20</td><td>cash</td></tr></table><p>Subject to withdrawal rights.</p>");
  packet.documents[0].format = "html";
  const index = buildTenderEvidenceIndex(packet); const hits = search(index, "consideration purchase price").hits;
  const full = index.read_evidence({ accession, ids: hits.map(h => h.id) });
  const table = full.evidence.find(e => e.text.includes("[TABLE]"))!;
  assert.ok(table.text.includes("[/TABLE]")); assert.match(table.text, /colspan=2/); assert.match(table.text, /rowspan=2/); assert.match(table.text, /cash/);
  assert.equal(table.text, renderTenderSource(packet.documents[0].content).slice(table.location.start, table.location.end));
  assert.deepEqual(index.read_evidence({ accession, ids: [table.id], maxChars: 1 }).evidence, []);
  assert.equal(index.read_evidence({ accession, ids: [table.id], maxChars: 1 }).status, "needs-larger-context-budget");
});

test("missing source differs from no lexical match; ambiguous meaning is never classified", () => {
  assert.equal(search(buildTenderEvidenceIndex({ ...make(), documents: [], unavailable: [{ documentId: "offer.htm", reason: "fetch-403" }] })).status, "source-insufficient");
  const packet = make("The offer may expire at an unspecified time unless extended.");
  const index = buildTenderEvidenceIndex(packet);
  assert.equal(search(index, "quuxzz").status, "retrieval-no-match");
  assert.equal(search(index, "expiration").interpretation, "unassessed-source-only");
  assert.equal(search(index, "expiration").status, "hits");
  packet.documents[0].completeness = "truncated";
  assert.equal(search(buildTenderEvidenceIndex(packet), "quuxzz").status, "source-insufficient");
});

test("caller mutations cannot change evidence or identity", () => {
  const packet = make(); const index = buildTenderEvidenceIndex(packet); const original = search(index).hits[0];
  packet.accession = other; packet.documents[0].content = "fake";
  const hit = search(index).hits[0]; hit.document.url = "fake"; hit.location.start = 999;
  const first = index.read_evidence({ accession, ids: [original.id] }); first.evidence[0].text = "fake";
  const second = index.read_evidence({ accession, ids: [original.id] });
  assert.match(second.evidence[0].text, /accept/); assert.equal(second.evidence[0].document.url, original.document.url);
});

test("existing preparation accepts bound raw HTML and attachment text, never Primary or combined text", () => {
  const p = make(); const d = p.documents[0];
  const raw = { accession_number: accession, form_type: "SC 14D9", primary_document_url: d.url, primary_document_html: "<p>Board recommends accept and tender.</p>", primary_document_html_truncated: false, documents: [{ document: d.documentId, url: d.url, isPrimary: true }] };
  const prepared = prepareTenderEvidence({ rawPayload: raw, analysisText: "REJECT fabricated", bodyText: "fake combined text" });
  assert.equal(prepared.documents[0].content, raw.primary_document_html);
  assert.equal(prepared.form, "SC 14D9");
  const absent = prepareTenderEvidence({ rawPayload: { ...raw, primary_document_html: null }, analysisText: "price $100", bodyText: "price $100" });
  assert.equal(absent.documents.length, 0); assert.equal(absent.unavailable[0].reason, "document-text-not-supplied");
  const attached = prepareTenderEvidence({ rawPayload: { accession_number: accession, form_type: "SC TO-I", documents: [{ document: d.documentId, url: d.url }], attachment_texts: [{ filename: d.documentId, url: d.url, text: "The offer price is $10." }] } });
  assert.equal(attached.documents[0].role, "attachment");
  assert.equal(attached.documents[0].completeness, "excerpt");
});

test("ambiguous/mismatched attachment identity never joins by exhibit type", () => {
  const d = make().documents[0];
  for (const attachment_texts of [[{ type: "EX-99", text: "price $10" }], [{ filename: d.documentId, url: "https://example.com/wrong.htm", text: "price $10" }], [{ filename: d.documentId, text: "price $10" }, { filename: d.documentId, text: "price $20" }]]) {
    const p = prepareTenderEvidence({ rawPayload: { accession_number: accession, form_type: "SC TO-I", documents: [{ document: d.documentId, url: d.url, type: "EX-99" }], attachment_texts } });
    assert.equal(p.documents.length, 0); assert.equal(p.unavailable.length, 1);
  }
});

test("all requested Tender form identities are retained; unrelated families rejected", () => {
  for (const form of TENDER_EVIDENCE_FORMS) assert.equal(search(buildTenderEvidenceIndex(make(undefined, form))).form, form);
  assert.throws(() => buildTenderEvidenceIndex(make(undefined, "S-4")));
});

test("14D9 Recommendation priority survives late paragraphs, markup and wrong Parser form", () => {
  for (const recommendation of ["accept the Offer and tender", "reject the Offer and not tender"]) {
    const sentence = `The Board recommends that holders ${recommendation} their shares.`;
    const text = `<p>${"Offer purchase price expiration withdrawal conditions. ".repeat(300)}</p><h2>Item 4. The Solicitation or Recommendation</h2><p>${sentence}</p><h3>Reasons for the Recommendation</h3><p>The Board considered the terms.</p>`;
    const output = buildSecTenderSourceBlockPromptInput({ filingPackage: { rawPayload: { form_type: "SC 14D9" } }, parserOutput: { facts: { sec_form_type: "SC TO-T" } }, fallbackText: text });
    assert.ok(output.cleaned_source_blocks.some(b => b.text.includes(sentence)));
    assert.ok(output.cleaned_source_blocks.some(b => b.label === "Item 4 / Board Recommendation source"));
  }
});

test("invalid budgets, limits, blank questions and unsupported read IDs fail", () => {
  const index = buildTenderEvidenceIndex(make());
  for (const limit of [0, -1, 21, NaN, 1.5]) assert.throws(() => index.search_evidence({ accession, question: "offer", limit }));
  assert.throws(() => index.search_evidence({ accession, question: " " }));
  assert.throws(() => index.read_evidence({ accession, ids: [] }));
  assert.throws(() => index.read_evidence({ accession, ids: ["fake"] }));
});

test("extra Parser/Primary metadata is excluded and JSON key ordering cannot change IDs", () => {
  const packet = make();
  const baseline = search(buildTenderEvidenceIndex(packet));
  const supplied = JSON.parse(JSON.stringify(packet));
  supplied.documents[0] = { summary: "invented answer", score: 100, transaction_fingerprint: { price: 999 }, ...Object.fromEntries(Object.entries(supplied.documents[0]).reverse()) };
  supplied.analysis = { recommendation: "reject" };
  const actual = search(buildTenderEvidenceIndex(supplied));
  assert.deepEqual(actual.hits, baseline.hits);
  assert.ok(!JSON.stringify(actual).includes("invented answer"));
});
