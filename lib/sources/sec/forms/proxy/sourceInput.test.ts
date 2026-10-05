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

test("covered snippets are replaced while overlapping windows and distinct document occurrences keep their boundaries", () => {
  const parsed = parseProxyFiling({ formType: "DEF 14A", filingText: "PROPOSAL 1\n" + "Body prose. ".repeat(100) });
  const original = parsed.raw.discoveryBlocks.find(block => block.text.length > 30)!;
  parsed.raw.discoveryBlocks = [original, { ...original, id: "overlap", startChar: original.startChar + 10,
    text: original.text.slice(10) }];
  parsed.raw.documentInventory.push({ ...parsed.raw.documentInventory[0], filename: "attachment.txt", source: "attachment" });
  parsed.raw.discoveryBlocks.push({ ...original, id: "D2-B1", sourceDocumentIndex: 1 });
  parsed.raw.importantBlocks = [{ kind: "proposal", label: "Invented interpretation", text: original.text.slice(20, 35) }];
  const result = blocks(parsed).filter(block => block.block_type !== "current_filing");
  assert.equal(result.length, 3);
  assert.equal(result[0].text, original.text);
  assert.equal(result[1].text, original.text.slice(10));
  assert.equal(result[2].text, original.text);
  assert.equal(result[2].source.origin, "attachment");
});

test("malformed coordinates fail explicitly instead of silently dropping a parser block", () => {
  const parsed = parseProxyFiling({ formType: "DEF 14A", filingText: "PROPOSAL 1\n" + "Body prose. ".repeat(100) });
  parsed.raw.discoveryBlocks[0].endChar++;
  assert.throws(() => blocks(parsed), /Invalid Proxy Primary source coordinates/);
});

test("Proposal, Item and Matter standalone references survive without semantic cues or legacy excerpt matches", () => {
  for (const label of ["Proposal", "Item", "Matter"]) {
    for (const number of ["1", "12", "25", "No. 2", "Number THREE", "2 (the accompanying amendment)"]) {
      const marker = `Refer to ${label} ${number} for the accompanying text.`;
      const parsed = parseProxyFiling({ formType: "DEF 14A", filingText: marker });
      assert.ok(parsed.raw.discoveryBlocks.some(block => block.cues.includes("numbered_proposal_reference")), marker);
      parsed.raw.importantBlocks = [];
      parsed.raw.supplementalAnalysis.parentReferences = [];
      parsed.raw.supplementalAnalysis.changeSignals = [];
      assert.ok(text(parsed).includes(marker), marker);
    }
  }
  const qualified = parseProxyFiling({ formType: "DEF 14A", filingText: "See Proposal 2(a) for the accompanying text." });
  qualified.raw.importantBlocks = [];
  assert.ok(text(qualified).includes("Proposal 2(a)"), "preserve existing Proposal reference behavior");
});

test("parser-selected fee/rule citations are retained without Primary grammar exceptions", () => {
  for (const citation of ["Item 25(b)", "Item 25 (b)", "Item 7.01", "Item 12(a)(2)"]) {
    const filingText = `Fee computed on the table in the exhibit required by ${citation} per Exchange Act Rules.`;
    const parsed = parseProxyFiling({ formType: "DEF 14A", filingText });
    assert.ok(parsed.raw.discoveryBlocks.length > 0);
    parsed.raw.importantBlocks = [];
    assert.ok(text(parsed).includes(filingText), citation);
    for (const label of ["Proposal", "Item", "Matter"]) {
      const mixed = parseProxyFiling({ formType: "DEF 14A", filingText: `${filingText} See ${label} 2 for the accompanying text.` });
      mixed.raw.importantBlocks = [];
      assert.ok(text(mixed).includes(filingText), "retain whole context of a selected paragraph");
    }
  }
});

test("all parser blocks retain array order, text, IDs and coordinates regardless of cues or matching legacy excerpts", () => {
  const parsed = parseProxyFiling({ formType: "DEF 14A", filingText: ["PROPOSAL 1",
    "Neutral context. ".repeat(900), "OTHER MATTERS"].join("\n") });
  assert.ok(parsed.raw.discoveryBlocks.length > 2);
  parsed.raw.discoveryBlocks = parsed.raw.discoveryBlocks.reverse().map((block, index) => ({
    ...block, cues: index % 2 ? [] : ["future_parser_locator"],
  }));
  parsed.raw.importantBlocks = [];
  parsed.raw.supplementalAnalysis.parentReferences = [];
  parsed.raw.supplementalAnalysis.changeSignals = [];
  const snapshot = structuredClone(parsed);
  const delivered = blocks(parsed).filter(block => block.source?.startChar !== undefined);
  assert.deepEqual(delivered.map(block => ({
    id: block.source.discoveryBlockIds[0], text: block.text, documentIndex: block.source.documentIndex,
    start: block.source.startChar, end: block.source.endChar,
  })), parsed.raw.discoveryBlocks.map(block => ({
    id: block.id, text: block.text, documentIndex: block.sourceDocumentIndex,
    start: block.startChar, end: block.endChar,
  })));
  assert.deepEqual(parsed, snapshot);
});

test("long adjacent body chunks remain exact parser blocks and later chunk openings reach a per-block repair clip", () => {
  const parsed = parseProxyFiling({ formType: "DEF 14A", filingText: ["PROPOSAL 1",
    Array.from({ length: 1250 }, (_, index) => `Paragraph ${index}: neutral body wording.`).join(" "), "OTHER MATTERS"].join("\n") });
  const body = parsed.raw.discoveryBlocks.filter(block => block.cues.includes("proposal_body_section"));
  assert.ok(body.length >= 5);
  const located = blocks(parsed).filter(block => block.source?.startChar !== undefined);
  const laterOpening = body[4].text.slice(0, 80);
  assert.ok(!body.map(block => block.text).join("").slice(0, 5000).includes(laterOpening));
  assert.ok(located.some(block => block.text.slice(0, 5000).includes(laterOpening)));
  for (const original of body) {
    const delivered = located.find(block => block.source.discoveryBlockIds.includes(original.id));
    assert.ok(delivered, original.id);
    assert.deepEqual(delivered.source.discoveryBlockIds, [original.id]);
    assert.equal(delivered.source.startChar, original.startChar);
    assert.equal(delivered.source.endChar, original.endChar);
    assert.equal(delivered.text, original.text);
    assert.ok(delivered.text.length <= 6000);
    assert.equal(delivered.text.slice(0, 5000), original.text.slice(0, 5000));
  }
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
