// Offline only. Usage: node --experimental-strip-types scripts/verify-proxy-primary-input-offline.mjs
//   <saved-raw-directory> <new-evidence-directory> <baseline-git-ref>
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { parseProxyFiling } from "../lib/sources/sec/forms/proxy/parser.ts";
import { buildProxySourceBlockPromptInput, buildProxyLegacySourceBlockPromptInput } from "../lib/sources/sec/forms/proxy/sourceInput.ts";
import { buildProxyAnalysisPrompt } from "../lib/sources/sec/forms/proxy/analysisPrompt.ts";
import { buildProxyStructuredV1SourcePackage } from "../lib/sources/sec/forms/proxy/structuredV1.ts";

const blocked = () => { throw new Error("Offline verification forbids network"); };
globalThis.fetch = blocked;
http.request = http.get = https.request = https.get = net.connect = net.createConnection = blocked;
syncBuiltinESMExports();
const [rawDirectory, outputDirectory, baseline] = process.argv.slice(2);
assert.ok(rawDirectory && outputDirectory && baseline, "Provide raw directory, NEW output directory, baseline ref");
assert.ok(!existsSync(outputDirectory), "Use a new output directory; retained evidence must not be overwritten");
mkdirSync(outputDirectory, { recursive: true });
const repo = fileURLToPath(new URL("../", import.meta.url));
const relative = "lib/sources/sec/forms/proxy/";
const gitSource = name => execFileSync("git", ["show", `${baseline}:${relative}${name}`], { cwd: repo, encoding: "utf8", maxBuffer: 10_000_000 });
const sha = text => createHash("sha256").update(text).digest("hex");
const save = (name, value) => writeFileSync(path.join(outputDirectory, name), JSON.stringify(value, null, 2));
const loadBaseline = async (name, replacements = {}) => {
  const source = gitSource(name).replace(/from "(\.[^"]+)"/g, (_, specifier) =>
    `from ${JSON.stringify(replacements[specifier] ?? pathToFileURL(path.resolve(repo, relative, specifier)).href)}`);
  const target = path.join(outputDirectory, `baseline-${name}`);
  writeFileSync(target, source);
  return { module: await import(pathToFileURL(target)), url: pathToFileURL(target).href };
};
const oldSource = await loadBaseline("sourceInput.ts");
const oldPrompt = await loadBaseline("analysisPrompt.ts", { "./sourceInput.ts": oldSource.url });
const oldStructured = await loadBaseline("structuredV1.ts", { "./sourceInput.ts": oldSource.url });
// Diagnostic exports from an evidence-only copy; never alter the shared parser.
const parserDiagnosticsPath = path.join(outputDirectory, "parser-diagnostics.ts");
writeFileSync(parserDiagnosticsPath, gitSource("parser.ts")
  + "\nexport { extractProxyDocuments, normalizeFilingText, parseHtmlTables };\n");
const diagnostics = await import(pathToFileURL(parserDiagnosticsPath));
const unchangedFiles = ["parser.ts", "proposalDiscovery.ts", "proposalRouting.ts", "finalStructured.ts", "analysisPrompt.ts", "displayPayload.ts"];
const unchanged = Object.fromEntries(unchangedFiles.map(name => {
  const current = readFileSync(path.join(repo, relative, name), "utf8");
  assert.equal(current.replaceAll("\r\n", "\n"), gitSource(name).replaceAll("\r\n", "\n"), name);
  return [name, sha(current)];
}));
const norm = text => text.replace(/\s+/g, " ").trim();
const measures = value => { const s = JSON.stringify(value, null, 2); return { utf16CodeUnits: s.length, utf8Bytes: Buffer.byteLength(s) }; };
const rows = [];
function compare(name, input, fullEvidence) {
  const parsed = parseProxyFiling(input);
  const snapshot = structuredClone(parsed);
  const market = { verification: "offline preserved context" };
  const before = oldSource.module.buildProxySourceBlockPromptInput(parsed, market);
  const after = buildProxySourceBlockPromptInput(parsed, market);
  assert.deepEqual(buildProxyLegacySourceBlockPromptInput(parsed, market), before, name + " legacy input drift");
  const beforePrompt = oldPrompt.module.buildProxyAnalysisPrompt({ parserOutput: parsed, marketContext: market });
  const afterPrompt = buildProxyAnalysisPrompt({ parserOutput: parsed, marketContext: market });
  assert.equal(afterPrompt.replace(JSON.stringify(after, null, 2), "SOURCE_INPUT"),
    beforePrompt.replace(JSON.stringify(before, null, 2), "SOURCE_INPUT"), name + " Primary prompt contract drift");
  const { cleaned_source_blocks: ignoredBefore, ...beforeEnvelope } = before;
  const { cleaned_source_blocks: ignoredAfter, ...afterEnvelope } = after;
  assert.deepEqual(afterEnvelope, beforeEnvelope, name + " inventory/context drift");
  if (!parsed.raw.importantBlocks.some(block => block.kind === "preliminary_placeholder")) {
    assert.deepEqual(buildProxyStructuredV1SourcePackage(parsed), oldStructured.module.buildProxyStructuredV1SourcePackage(parsed), name + " legacy Structured drift");
  } else {
    assert.throws(() => buildProxyStructuredV1SourcePackage(parsed), /preliminary_placeholder/);
    assert.throws(() => oldStructured.module.buildProxyStructuredV1SourcePackage(parsed), /preliminary_placeholder/);
  }
  const sourceText = obj => obj.cleaned_source_blocks.map(block => norm(block.text));
  const oldTexts = sourceText(before), newTexts = sourceText(after);
  const contains = (texts, text) => texts.some(source => source.includes(norm(text)));
  const retained = [
    ...parsed.raw.importantBlocks.map((block, index) => ({ kind: "important", index, text: block.text })),
    ...parsed.raw.supplementalAnalysis.parentReferences.map((block, index) => ({ kind: "parent", index, text: block.evidence })),
    ...parsed.raw.supplementalAnalysis.changeSignals.map((block, index) => ({ kind: "change", index, text: block.sourceText })),
  ].map(({ text, ...item }) => ({ ...item, before: contains(oldTexts, text), after: contains(newTexts, text) }));
  assert.ok(retained.every(item => item.after), name + " lost existing Primary evidence");
  for (const table of parsed.raw.keyTableExtraction.tables) {
    const block = after.cleaned_source_blocks.find(block => block.source?.tableId === table.id);
    assert.ok(block, name + " lost table");
    const tableText = JSON.parse(block.text);
    for (const key of ["caption", "heading", "headers", "sampleRows", "warnings"]) assert.deepEqual(tableText[key], table[key]);
  }
  const coverage = parsed.raw.discoveryBlocks.map(block => ({
    id: block.id, document: block.sourceDocumentIndex, startChar: block.startChar, endChar: block.endChar,
    cues: block.cues, chars: block.text.length,
    before: contains(oldTexts, block.text), after: contains(newTexts, block.text),
  }));
  const documents = diagnostics.extractProxyDocuments(input, parsed.raw.secFormType);
  for (const block of after.cleaned_source_blocks.filter(block => block.source?.startChar !== undefined)) {
    const documentText = diagnostics.normalizeFilingText(documents[block.source.documentIndex].body);
    assert.equal(block.text, documentText.slice(block.source.startChar, block.source.endChar), name + " source slice mismatch");
  }
  const rowText = text => norm(text.replaceAll("|", " "));
  const lateTableRows = parsed.raw.keyTableExtraction.tables.flatMap(table => {
    const rawTable = diagnostics.parseHtmlTables(documents[table.sourceDocumentIndex].body)[Number(table.id.split("-").at(-1)) - 1];
    assert.equal(rawTable.rows.length, table.rowCount);
    return rawTable.rows.slice(4).map((cells, index) => {
      const value = rowText(cells.join(" "));
      const inInput = obj => obj.cleaned_source_blocks.some(block => {
        if (block.block_type === "table_source_block") {
          return JSON.parse(block.text).sampleRows.some(sample => rowText(sample.join(" ")) === value);
        }
        return rowText(block.text).includes(value);
      });
      return { tableId: table.id, rowNumber: index + 5, cells, before: inInput(before), after: inInput(after) };
    });
  });
  assert.deepEqual(parsed, snapshot, name + " mutated parser");
  const row = { name, source: { utf16CodeUnits: (input.filingText ?? "").length,
    utf8Bytes: Buffer.byteLength(input.filingText ?? "") }, before: measures(before), after: measures(after),
    beforePrompt: { utf16CodeUnits: beforePrompt.length, utf8Bytes: Buffer.byteLength(beforePrompt) },
    afterPrompt: { utf16CodeUnits: afterPrompt.length, utf8Bytes: Buffer.byteLength(afterPrompt) },
    blocksBefore: before.cleaned_source_blocks.length, blocksAfter: after.cleaned_source_blocks.length,
    retained, tableSamplesPreserved: parsed.raw.keyTableExtraction.tables.length,
    discoveryCoverage: { totalBlocks: coverage.length, beforeFullBlocks: coverage.filter(b => b.before).length,
      afterFullBlocks: coverage.filter(b => b.after).length,
      totalChars: coverage.reduce((sum, b) => sum + b.chars, 0),
      beforeFullBlockChars: coverage.filter(b => b.before).reduce((sum, b) => sum + b.chars, 0),
      afterFullBlockChars: coverage.filter(b => b.after).reduce((sum, b) => sum + b.chars, 0) },
    coverage, lateTableRows };
  if (fullEvidence) {
    save(`${name}.before.json`, before); save(`${name}.after.json`, after);
    writeFileSync(path.join(outputDirectory, `${name}.before-prompt.txt`), beforePrompt);
    writeFileSync(path.join(outputDirectory, `${name}.after-prompt.txt`), afterPrompt);
    save(`${name}.parser.json`, parsed);
  }
  rows.push(row);
}
const fixtures = path.join(repo, relative, "fixtures");
for (const file of readdirSync(fixtures).filter(file => file.endsWith(".json"))) {
  const data = JSON.parse(readFileSync(path.join(fixtures, file), "utf8"));
  if (data.input) compare(file, data.input, false);
  else for (const [name, value] of Object.entries(data)) if (value.input) compare(`${file}:${name}`, value.input, false);
}
const fixtureCount = rows.length;
for (const [name, formType] of [["alternus-mixed-capital", "PRE 14A"], ["endra-reverse-split", "DEF 14A"], ["bigbear-supplement", "DEFA14A"]]) {
  const rawFile = path.join(rawDirectory, `${name}.html`);
  const filingText = readFileSync(rawFile, "utf8");
  compare(name, { formType, filingText }, true);
  rows.at(-1).rawFile = rawFile;
  rows.at(-1).rawSha256 = sha(filingText);
}
save("comparison.json", { baseline, fixtureCount, liveExternalCalls: 0,
  units: "Exact JS UTF-16 code units and UTF-8 bytes of pretty JSON / full local Primary prompt; no token estimate or provider token count.",
  coverageMeaning: "Full discovery-block containment after whitespace normalization; NOT complete filing coverage or partial-character recall.",
  unchanged, rows });
console.log(JSON.stringify({ fixtureCount, cases: rows.slice(fixtureCount).map(({ name, before, after, discoveryCoverage }) => ({ name, before, after, discoveryCoverage })), passed: true }, null, 2));
