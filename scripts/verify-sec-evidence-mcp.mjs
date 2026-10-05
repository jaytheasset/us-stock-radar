// Offline real stdio MCP replay of the accepted 5-case/15-query report. No source copies written.
// Arguments: existing packet directory, accepted retrieval-report.json, NEW report path.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildS4F4EvidenceIndex } from "../lib/sources/sec/forms/s4-f4/evidenceRetrieval.ts";

const [directory, baselinePath, outputPath] = process.argv.slice(2);
assert.ok(directory && baselinePath && outputPath, "Provide packets, baseline report, NEW output path");
assert.ok(!existsSync(outputPath), "Do not overwrite audit records");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
assert.equal(baseline.questions.length, 15);
assert.equal(baseline.assertionPass, true);
const hash = (s) => createHash("sha256").update(s).digest("hex");
const packets = new Map(), paths = [];
for (const c of baseline.cases) {
  const path = resolve(directory, `${c.case}-selected.json`);
  const bytes = readFileSync(path);
  assert.equal(hash(bytes), c.packetFileSha256, `${c.case}: baseline source changed`);
  const packet = JSON.parse(bytes.toString("utf8"));
  packets.set(c.case, { packet, index: buildS4F4EvidenceIndex(packet), accession: c.accession });
  paths.push(path);
}
const transport = new StdioClientTransport({ command: process.execPath,
  args: ["--no-warnings", "--experimental-strip-types", resolve("scripts/sec-evidence-mcp.mjs"), ...paths],
  stderr: "pipe", env: {} });
const client = new Client({ name: "stock-radar-offline-e2e", version: "1" });
const report = { scope: "Local MCP stdio initialize/list/search/read; exact existing 15 queries and selected source hashes", providerCalls: 0,
  questions: [], sourceBodiesStored: false };
let stderr = "";
try {
  await client.connect(transport);
  transport.stderr?.on("data", (s) => { stderr += s; });
  const list = await client.listTools();
  assert.deepEqual(list.tools.map((t) => t.name), ["sec_evidence_search", "sec_evidence_read"]);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, JSON.stringify(r));
    assert.deepEqual(JSON.parse(r.content[0].text), r.structuredContent);
    return r.structuredContent;
  };
  for (const q of baseline.questions) {
    const { packet, index, accession } = packets.get(q.case);
    const start = performance.now();
    const search = await call("sec_evidence_search", { filingAccession: accession, query: q.query, limit: q.limit });
    const { filingAccession, form, ...retrieval } = search;
    assert.deepEqual(retrieval, q.result, `${q.case}/${q.id}: ranking, budget, metadata or stable IDs changed`);
    assert.equal(form, packet.form);
    assert.equal(filingAccession, accession);
    let chars = 0;
    for (const hit of search.hits) {
      assert.ok(!("text" in hit), "Search must not return body");
      const read = await call("sec_evidence_read", { filingAccession: accession, evidenceId: hit.ref });
      const { status, filingAccession: a, form: f, ...evidence } = read;
      assert.equal(status, "read");
      assert.equal(a, accession);
      assert.equal(f, packet.form);
      assert.deepEqual(evidence, index.read(hit.ref), "Exact text, tables, notes, coordinates and hashes");
      chars += read.text.length;
    }
    assert.equal(chars, q.returnedChars);
    report.questions.push({ case: q.case, id: q.id, query: q.query, pass: true, hits: search.hits.length, chars,
      refs: search.hits.map((h) => h.ref), packetPercent: q.packetPercent, elapsedMs: Math.round(performance.now() - start),
      exactBaselineRetrieval: true, exactSourceReadAndProvenance: true, wholeSectionPreserved: q.wholeSectionPreserved });
  }
  report.pass = report.questions.length === 15;
} finally {
  await client.close();
}
assert.equal(stderr, "", "Server stdout is protocol-only and stderr has no failures");
writeFileSync(outputPath, JSON.stringify(report, null, 2), { flag: "wx" });
console.log(JSON.stringify({ pass: report.pass, queries: report.questions.length, providerCalls: 0, outputPath }));
