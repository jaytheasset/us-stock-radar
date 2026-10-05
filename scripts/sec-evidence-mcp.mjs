// Local stdio MCP server. Paths are operator startup configuration, never tool arguments.
// Only existing selector packets are loaded. No .env, provider, DB, download, or disk writes.
import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createS4F4EvidenceMcpServer } from "../lib/sources/sec/forms/s4-f4/evidenceMcp.ts";

try {
  const paths = process.argv.slice(2);
  if (!paths.length) throw new Error("Usage: node --experimental-strip-types scripts/sec-evidence-mcp.mjs <existing-selected-packet.json> [...]");
  const packets = await Promise.all(paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))));
  const server = createS4F4EvidenceMcpServer(packets);
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
