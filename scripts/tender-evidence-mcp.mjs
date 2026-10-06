// Existing source packets only; no network, DB, provider, .env or writes.
import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTenderEvidenceMcpServer } from "../lib/sources/sec/forms/tender/evidenceMcp.ts";

try {
  if (!process.argv[2]) throw new Error("Usage: node --experimental-strip-types scripts/tender-evidence-mcp.mjs <existing-source-packet.json> [...]");
  const packets = await Promise.all(process.argv.slice(2).map(async path => JSON.parse(await readFile(path, "utf8"))));
  await createTenderEvidenceMcpServer(packets).connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
