// Opt-in public SEC read-only verification. Full documents exist only in memory.
// No .env, DB, LLM, application server or persistent original-source archive.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTenderEvidenceMcpServer } from "../lib/sources/sec/forms/tender/evidenceMcp.ts";
import { renderTenderSource, tenderSourceHash } from "../lib/sources/sec/forms/tender/evidenceSource.ts";
import { prepareTenderEvidence } from "../lib/sources/sec/forms/tender/evidencePreparation.ts";
import { buildSecTenderSourceBlockPromptInput } from "../lib/sources/sec/forms/tender/sourceBlockPromptInput.ts";

const cases = [
  { name: "issuer", form: "SC TO-I", role: "attachment", url: "https://www.sec.gov/Archives/edgar/data/1830081/000121390025000757/sctoi_ex99a1arumble.htm", questions: [
    [1, "What purchase price maximum number of shares and aggregate purchase amount?", [/\$7\.50/, /70,000,000/, /525/]],
    [2, "When does the offer expire and can it be extended?", [/February\s+4,\s+2025/i, /extend/i]],
    [3, "What are proration and withdrawal rights?", [/prorat|pro rata/i, /withdraw/i]],
  ] },
  { name: "third-party", form: "SC TO-T", role: "attachment", url: "https://www.sec.gov/Archives/edgar/data/1067701/000110465925006713/tm253288d1_ex99-a1a.htm", questions: [[4, "What minimum tender and regulatory antitrust conditions apply?", [/minimum/i, /HSR|antitrust|regulatory/i]]] },
  { name: "accept", form: "SC 14D9", role: "primary", url: "https://www.sec.gov/Archives/edgar/data/1697532/000119312525335440/d84762dsc14d9.htm", questions: [[5, "What is the board recommendation to accept and tender shares?", [/recommend[\s\S]{0,250}accept[\s\S]{0,150}tender/i]]] },
  { name: "reject", form: "SC 14D9", role: "primary", url: "https://www.sec.gov/Archives/edgar/data/1711929/000119312526096287/d28126dsc14d9.htm", questions: [[6, "What is the board recommendation to reject and not tender shares?", [/recommend[\s\S]{0,300}REJECT[\s\S]{0,150}NOT\s+tender/i]]] },
  { name: "price-amendment", form: "SC TO-T/A", role: "attachment", url: "https://www.sec.gov/Archives/edgar/data/1643303/000121390023055698/sctota10ex99-a1o_nano.htm", questions: [[7, "How was the offer price increased from the previous price?", [/from\s+\$20\.05\s+to\s+\$24\.00/i]]] },
  { name: "deadline-amendment", form: "SC TO-T/A", role: "primary", url: "https://www.sec.gov/Archives/edgar/data/1697532/000119312526026154/d805076dsctota.htm", questions: [[8, "What expiration was previously scheduled and what is the extended expiration?", [/January\s+27,\s+2026/i, /January\s+28,\s+2026/i]]] },
  { name: "final", form: "SC TO-I/A", role: "primary", url: "https://www.sec.gov/Archives/edgar/data/1702510/000170251026000009/cars_2026130xsctoa.htm", questions: [[9, "What shares were accepted at what price and aggregate purchase amount in final results?", [/4,180,330/, /18\.82/, /78,673,802/]]] },
  { name: "exchange", form: "CB", role: "attachment", url: "https://www.sec.gov/Archives/edgar/data/1629583/000106299317000336/exhibit1-1.htm", questions: [[10, "What exchange ratio and share consideration will holders receive for each share?", [/0\.16/, /each|every|per/i]]] },
  { name: "fairness", form: "SC 13E3", role: "primary", url: "https://www.sec.gov/Archives/edgar/data/72333/000121390025019787/ea0231395-sc13e3_nordstrom.htm", questions: [[11, "What did the special committee determine about fairness and the best interests of stockholders?", [/special committee/i, /determined[\s\S]{0,600}fair/i]]] },
];

const loaded = [];
const report = { runAt: new Date().toISOString(), source: "live SEC HTTP; complete individual documents in memory only", results: [], recommendationCoverage: [], limitations: ["Only listed documents supplied; other exhibits and incorporated references remain unresolved.", "Lexical source-language ranking; no determination of final terms or source ambiguity."] };
for (const item of cases) {
  const response = await fetch(item.url, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "StockRadar/1.0 evidence verification admin@stockradar.app" } });
  assert.equal(response.status, 200, item.url);
  const html = await response.text();
  assert.match(html, /<html/i);
  const compact = new URL(item.url).pathname.split("/").at(-2);
  const accession = `${compact.slice(0, 10)}-${compact.slice(10, 12)}-${compact.slice(12)}`;
  const documentId = new URL(item.url).pathname.split("/").at(-1);
  const packet = prepareTenderEvidence({ rawPayload: { accession_number: accession, form_type: item.form, documents: [{ document: documentId, url: item.url, isPrimary: item.role === "primary", text: html, textTruncated: false, fetchStatus: 200 }] } });
  const rendered = renderTenderSource(html);
  loaded.push({ item, packet, rendered, hash: tenderSourceHash(html) });
  if (["accept", "reject"].includes(item.name)) {
    const prompt = buildSecTenderSourceBlockPromptInput({ filingPackage: { form_type: item.form }, fallbackText: rendered });
    const expected = item.questions[0][2][0];
    const pass = prompt.cleaned_source_blocks.some(b => expected.test(b.text));
    report.recommendationCoverage.push({ name: item.name, pass, blocks: prompt.cleaned_source_blocks.length, url: item.url });
    assert.ok(pass, `${item.name} recommendation coverage`);
  }
}
const server = createTenderEvidenceMcpServer(loaded.map(x => x.packet));
const client = new Client({ name: "tender-live-verification", version: "1.0.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);
const call = async (name, args) => { const r = await client.callTool({ name, arguments: args }); assert.ok(!r.isError, JSON.stringify(r)); return JSON.parse(r.content[0].text); };
for (const { item, packet, rendered, hash } of loaded) {
  for (const [number, question, expected] of item.questions) {
    const search = await call("search_evidence", { accession: packet.accession, question, limit: 5 });
    assert.equal(search.status, "hits");
    const read = await call("read_evidence", { accession: packet.accession, ids: search.hits.map(h => h.id), maxChars: 500000 });
    assert.equal(read.status, "read");
    for (const e of read.evidence) {
      assert.equal(e.accession, packet.accession);
      assert.equal(e.document.url, item.url);
      assert.equal(e.sourceHash, hash);
      assert.equal(e.text, rendered.slice(e.location.start, e.location.end));
      assert.equal(e.textHash, tenderSourceHash(e.text));
    }
    const checks = expected.map(pattern => ({ pattern: pattern.source, sourcePresent: pattern.test(rendered), retrieved: read.evidence.some(e => pattern.test(e.text)) }));
    const pass = checks.every(c => c.retrieved);
    const result = { number, name: item.name, question, pass, failure: pass ? null : checks.some(c => !c.sourcePresent) ? "source-coverage-or-test-expectation" : "retrieval-failure", accession: packet.accession, form: item.form, url: item.url, sourceHash: hash, checks, hits: search.hits.map(h => ({ id: h.id, location: h.location, chars: h.chars, score: h.score })), readChars: read.requiredChars };
    report.results.push(result);
    console.log(JSON.stringify({ number, name: item.name, pass, checks, chars: read.requiredChars }));
  }
}
await client.close();
await server.close();
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + "\n");
assert.ok(report.results.every(r => r.pass), "Live search/read questions failed; inspect source vs retrieval checks");
