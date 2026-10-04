import assert from "node:assert/strict";
import test from "node:test";
import { parseProxyFiling } from "./parser.ts";
import { buildProxySourceBlockPromptInput, buildProxyLegacySourceBlockPromptInput } from "./sourceInput.ts";
import { buildProxyAnalysisPrompt } from "./analysisPrompt.ts";
import { buildProxyProposalDiscoverySourcePackage } from "./proposalDiscovery.ts";
import { buildProxyStructuredV1SourcePackage } from "./structuredV1.ts";

const blocks = (parsed: ReturnType<typeof parseProxyFiling>) =>
  buildProxySourceBlockPromptInput(parsed).cleaned_source_blocks as Array<Record<string, any>>;
const text = (parsed: ReturnType<typeof parseProxyFiling>) => blocks(parsed).map(block => block.text).join("\n");

test("Primary retains late body, table rows and explicitly addressed appendix with source coordinates", () => {
  const filingText = ["PROPOSAL 1", "See Section 2 of Appendix A.", "Body prose. ".repeat(800),
    ...Array.from({ length: 8 }, (_, i) => `| Holder ${i + 1} | ${i + 1}00 shares |`),
    "LATE_TABLE_FOOTNOTE", "OTHER MATTERS", "Unselected prose. ".repeat(200),
    "APPENDIX A", "2026 PLAN", "SECTION 1 Purpose", "Unaddressed text. ".repeat(100),
    "SECTION 2 Amendment", "Addressed text. ".repeat(300), "APPENDIX_TAIL",
    "SECTION 3 Administration", "Unaddressed text. ".repeat(200), "UNADDRESSED_TAIL"].map(line => line.trim()).join("\n\n");
  const parsed = parseProxyFiling({ formType: "DEF 14A", filingText });
  const before = JSON.stringify(buildProxyLegacySourceBlockPromptInput(parsed));
  for (const marker of ["Holder 8", "LATE_TABLE_FOOTNOTE", "APPENDIX_TAIL"]) {
    assert.ok(text(parsed).includes(marker), marker);
    assert.ok(!before.includes(marker), `baseline unexpectedly contains ${marker}`);
  }
  assert.ok(!text(parsed).includes("UNADDRESSED_TAIL"));
  for (const block of blocks(parsed).filter(block => block.source?.startChar !== undefined)) {
    assert.equal(block.text, filingText.slice(block.source.startChar, block.source.endChar));
    assert.equal(block.source.documentIndex, 0);
    assert.equal(block.source.offsetCoordinate, "normalized_document_text");
  }
  assert.ok(buildProxyAnalysisPrompt({ parserOutput: parsed }).includes("Holder 8"));
});

test("uncovered Primary evidence, inventories, context and table samples survive beyond 60 blocks", () => {
  const parsed = parseProxyFiling({ formType: "DEFA14A", filingText: "A standalone update.",
    attachments: [{ filename: "notice.txt", text: "Separate attachment." }] });
  parsed.raw.discoveryBlocks = [];
  parsed.raw.importantBlocks = Array.from({ length: 65 }, (_, index) => ({
    kind: "proposal", label: "Semantic label must not be copied", text: `Unique original excerpt ${index}.`,
  }));
  parsed.raw.keyTableExtraction.tables.push({ id: "test-table", heading: "Audit Fees", caption: null,
    sourceDocumentIndex: 0, documentClass: "proxy_body", sectionKind: null, proposalId: null,
    rowCount: 8, columnCount: 2, headers: ["Name", "Amount"], sampleRows: [["Audit", "100"]],
    tableType: "unknown_key_table", confidence: "high", warnings: [], isLayoutTable: false });
  parsed.raw.supplementalAnalysis.parentReferences.push({ evidence: "PARENT_REFERENCE_AFTER_60" } as any);
  parsed.raw.supplementalAnalysis.changeSignals.push({ label: "Semantic guess", sourceText: "CHANGE_AFTER_60" } as any);
  const context = { marker: "MARKET_CONTEXT" };
  const result = buildProxySourceBlockPromptInput(parsed, context);
  assert.deepEqual(result.market_context, context);
  assert.deepEqual(result.attachment_inventory, parsed.raw.attachmentInventory);
  assert.deepEqual(result.document_inventory, parsed.raw.documentInventory);
  assert.deepEqual(result.parser_warnings, parsed.warnings);
  for (const marker of ["excerpt 64", "PARENT_REFERENCE_AFTER_60", "CHANGE_AFTER_60", "Audit"]) {
    assert.ok(JSON.stringify(result).includes(marker));
  }
  assert.ok(!JSON.stringify(result.cleaned_source_blocks).includes("Semantic"));
  assert.equal(blocks(parsed).find(block => block.block_type === "table_source_block")?.label,
    "Table sample (not complete table)");
});

test("covered snippets and overlapping source windows are replaced without losing distinct document occurrences", () => {
  const parsed = parseProxyFiling({ formType: "DEF 14A", filingText: "PROPOSAL 1\n" + "Body prose. ".repeat(100) });
  const original = parsed.raw.discoveryBlocks.find(block => block.text.length > 30)!;
  parsed.raw.discoveryBlocks = [original, { ...original, id: "overlap", startChar: original.startChar + 10,
    text: original.text.slice(10) }];
  parsed.raw.documentInventory.push({ ...parsed.raw.documentInventory[0], filename: "attachment.txt", source: "attachment" });
  parsed.raw.discoveryBlocks.push({ ...original, id: "D2-B1", sourceDocumentIndex: 1 });
  parsed.raw.importantBlocks = [{ kind: "proposal", label: "Invented interpretation", text: original.text.slice(20, 35) }];
  const result = blocks(parsed).filter(block => block.block_type !== "current_filing");
  assert.equal(result.length, 2);
  assert.equal(result[0].text, original.text);
  assert.equal(result[1].text, original.text);
  assert.equal(result[1].source.origin, "attachment");
});

test("generic regulatory references are not blindly appended and malformed coordinates fail explicitly", () => {
  const parsed = parseProxyFiling({ formType: "DEF 14A", filingText: "PROPOSAL 1\n" + "Body prose. ".repeat(100) });
  const unrelated = { ...parsed.raw.discoveryBlocks[0], id: "fee", startChar: 0, endChar: 7,
    text: "Item 25", cues: ["numbered_proposal_reference"] };
  parsed.raw.discoveryBlocks.push(unrelated);
  assert.ok(!text(parsed).includes("Item 25"));
  parsed.raw.discoveryBlocks[0].endChar++;
  assert.throws(() => blocks(parsed), /Invalid Proxy Primary source coordinates/);
});

test("missing discovery inventory keeps older stored parser inputs usable without mutating parser or Structured input", () => {
  const parsed = parseProxyFiling({ formType: "DEF 14A", filingText: "Proposal 1: Election of directors." });
  const snapshot = structuredClone(parsed);
  const discovery = buildProxyProposalDiscoverySourcePackage(parsed);
  const legacy = buildProxyStructuredV1SourcePackage(parsed);
  blocks(parsed);
  assert.deepEqual(parsed, snapshot);
  assert.deepEqual(buildProxyProposalDiscoverySourcePackage(parsed), discovery);
  assert.deepEqual(buildProxyStructuredV1SourcePackage(parsed), legacy);
  delete (parsed.raw as any).discoveryBlocks;
  assert.ok(text(parsed).includes("Election of directors"));
});

test("a parent-only supplement stays bounded and does not become an imported full proxy", () => {
  const parsed = parseProxyFiling({ formType: "DEFA14A", filingText: ["SUPPLEMENT TO THE PROXY STATEMENT",
    "We filed a definitive proxy statement. This supplement does not change the proposals in the proxy statement.",
    "Administrative discussion. ".repeat(300), "UNRELATED_TAIL"].join("\n\n") });
  assert.ok(text(parsed).includes("does not change"));
  assert.ok(!text(parsed).includes("UNRELATED_TAIL"));
});
