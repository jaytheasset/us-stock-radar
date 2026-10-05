import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createS4F4EvidenceMcpServer } from "./evidenceMcp.ts";
import { selectS4F4Sources } from "./sourceSelector.ts";

const current = "0000000001-26-000001", parent = "0000000001-25-000001", other = "0000000002-26-000001";
const source = (accession: string, role: "current" | "parent" | "exhibit", text: string) => ({
  accession, role, url: `https://example.test/${accession}.htm`, filename: "filing.htm",
  html: `<h2>Closing Conditions</h2><p>${text}</p><table><tr><td>Shares</td><td>10 (1)</td></tr></table><p>(1) Assumes no redemptions.</p><h2>Other Information</h2>`,
});

test("MCP tools preserve source, roles, identity and budgets without Primary", async () => {
  const packet = selectS4F4Sources({ form: "S-4/A", documents: [source(current, "current", "Net Cash is cash less expenses. 😀"),
    { ...source(parent, "parent", "Net Cash prior draft."), purpose: "amendment-comparison" },
    { ...source(current, "exhibit", "Net Cash supplement."), purpose: "direct-supplement" }] });
  // Such app analysis data must never enter evidence, even when it fails/is wrong.
  Object.assign(packet, { primary: { status: "failed", summary: "INVENTED_999_FACT" }, analysis_text: "INVENTED_999_FACT" });
  const second = selectS4F4Sources({ form: "F-4", documents: [source(other, "current", "Net Cash unrelated deal.")] });
  const server = createS4F4EvidenceMcpServer([packet, second]);
  const client = new Client({ name: "test", version: "1" });
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  await client.connect(c);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, JSON.stringify(r));
    assert.deepEqual(JSON.parse((r.content as Array<{ text: string }>)[0].text), r.structuredContent);
    return r.structuredContent as Record<string, any>;
  };
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name), ["sec_evidence_search", "sec_evidence_read"]);
    assert.ok(tools.tools.every((t) => t.annotations?.readOnlyHint));
    assert.ok(client.getInstructions()?.includes(current));
    const base = { filingAccession: current, query: 'How is "Net Cash" defined?' };
    const search = await call("sec_evidence_search", base);
    assert.equal(search.hits.length, 1);
    assert.equal(search.hits[0].document.role, "current");
    assert.doesNotMatch(JSON.stringify(search), /INVENTED_999_FACT|cash less expenses|unrelated deal/);
    const ref = search.hits[0].ref;
    const read = await call("sec_evidence_read", { filingAccession: current, evidenceId: ref });
    assert.equal(read.text, packet.documents[0].sections[0].text);
    assert.match(read.text, /\[TABLE\][\s\S]*\(1\) Assumes no redemptions/);
    assert.equal(read.document.htmlSha256, packet.documents[0].sha256);
    assert.equal(read.section.htmlStart, packet.documents[0].sections[0].htmlStart);
    assert.equal(read.form, "S-4/A");
    const section = await call("sec_evidence_read", { filingAccession: current, evidenceId: read.section.ref });
    assert.equal(section.text, read.text);
    for (const role of ["parent", "exhibit"]) {
      const r = await call("sec_evidence_search", { ...base, role });
      assert.equal(r.hits.length, 1);
      assert.equal(r.hits[0].document.role, role);
      const rr = await call("sec_evidence_read", { filingAccession: current, evidenceId: r.hits[0].ref });
      assert.equal(rr.document.role, role);
      assert.notEqual(rr.ref, ref);
    }
    const mismatch = await call("sec_evidence_search", { ...base, documentAccession: parent });
    assert.equal(mismatch.status, "no-match-in-selected-source");
    const small = await call("sec_evidence_search", { ...base, maxChars: 1 });
    assert.equal(small.status, "needs-larger-context-budget");
    assert.equal(small.hits.length, 0);
    assert.equal(small.deferred[0].ref, ref);
    const smallRead = await call("sec_evidence_read", { filingAccession: current, evidenceId: ref, maxChars: 1 });
    assert.equal(smallRead.status, "needs-larger-context-budget");
    assert.ok(!("text" in smallRead));
    for (const args of [
      { filingAccession: other, evidenceId: ref },
      { filingAccession: current, evidenceId: `evidence:${"0".repeat(64)}` },
      { filingAccession: current, evidenceId: ref, maxChars: 200001 },
      { filingAccession: current, evidenceId: ref, path: "arbitrary-file" },
    ]) assert.equal((await client.callTool({ name: "sec_evidence_read", arguments: args })).isError, true);
    packet.documents[0].sections[0].text += "mutated";
    assert.equal((await client.callTool({ name: "sec_evidence_read", arguments: { filingAccession: current, evidenceId: ref } })).isError, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test("ambiguous duplicate filing packets fail at startup", () => {
  const packet = selectS4F4Sources({ form: "S-4", documents: [source(current, "current", "Cash condition")] });
  assert.throws(() => createS4F4EvidenceMcpServer([packet, packet]), /Duplicate/);
  assert.throws(() => createS4F4EvidenceMcpServer([]), /At least one/);
});
