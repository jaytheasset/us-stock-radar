import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("local stdio MCP search/read isolates loaded filings and exposes no mutations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tender-evidence-test-"));
  const files: string[] = [];
  const client = new Client({ name: "tender-test", version: "1.0.0" });
  try {
    for (const [accession, price] of [["0001234567-26-000001", "10"], ["0001234567-26-000002", "20"]]) {
      const file = join(directory, `${accession}.json`);
      files.push(file);
      await writeFile(file, JSON.stringify({ accession, form: "SC TO-I", unavailable: [], documents: [{ accession, form: "SC TO-I", documentId: "offer.htm", url: `https://www.sec.gov/Archives/edgar/data/1234567/${accession.replaceAll("-", "")}/offer.htm`, role: "attachment", content: `Offer purchase price is $${price} per share.\nWithdrawal rights remain available until expiration.`, format: "text", completeness: "complete" }] }));
    }
    await client.connect(new StdioClientTransport({ command: process.execPath, args: ["--no-warnings", "--experimental-strip-types", resolve("scripts/tender-evidence-mcp.mjs"), ...files], stderr: "pipe" }));
    assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ["read_evidence", "search_evidence"]);
    const accession = "0001234567-26-000001";
    const found = await client.callTool({ name: "search_evidence", arguments: { accession, question: "purchase price" } });
    assert.ok(!found.isError);
    const search = JSON.parse((found.content as Array<{ text: string }>)[0].text);
    assert.ok(!JSON.stringify(search).includes("$10"));
    const read = await client.callTool({ name: "read_evidence", arguments: { accession, ids: search.hits.map((h: { id: string }) => h.id) } });
    assert.ok(!read.isError); const body = JSON.stringify(read.content); assert.ok(body.includes("$10")); assert.ok(!body.includes("$20"));
    const foreign = await client.callTool({ name: "read_evidence", arguments: { accession: "0001234567-26-000002", ids: [search.hits[0].id] } });
    assert.equal(foreign.isError, true);
    const absent = await client.callTool({ name: "search_evidence", arguments: { accession: "0001234567-26-000099", question: "price" } });
    assert.equal(absent.isError, true);
    const budget = await client.callTool({ name: "read_evidence", arguments: { accession, ids: [search.hits[0].id], maxChars: 1 } });
    assert.equal(JSON.parse((budget.content as Array<{ text: string }>)[0].text).status, "needs-larger-context-budget");
  } finally {
    await client.close();
    for (const file of files) await unlink(file);
    await rmdir(directory);
  }
});
