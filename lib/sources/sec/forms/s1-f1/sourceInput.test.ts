import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { contextPreservingChunks } from "../common/contextPreservingChunks.ts";
import { parseS1F1Filing } from "./parser.ts";
import { buildS1F1LlmSourceInput, clipS1F1PromptText } from "./sourceInput.ts";
import type { S1F1CleanedSourceBlock, S1F1ParserOutput } from "./types.ts";

describe("S-1 attachment source preparation", () => {
  it("keeps a short attachment as one structurally identified chunk", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: "Issuer registration statement.",
      attachments: [{ name: "short.txt", description: "Short attachment", text: "First paragraph. Second sentence." }],
    });
    const chunks = attachmentBlocks(parserOutput, "short.txt");

    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].chunkIndex, 1);
    assert.equal(chunks[0].chunkCount, 1);
    assert.equal(chunks[0].documentId, "short.txt");
  });

  it("splits long attachments sequentially at existing structural boundaries without overlap", () => {
    const source = longDocument("sequential", 42);
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: "Issuer registration statement.",
      attachments: [{ name: "long.txt", description: "Long attachment", text: source }],
    });
    const chunks = attachmentBlocks(parserOutput, "long.txt");

    assert.ok(chunks.length > 2);
    assert.deepEqual(chunks.map((block) => block.chunkIndex), chunks.map((_, index) => index + 1));
    assert.ok(chunks.every((block) => block.chunkCount === chunks.length));
    assert.ok(chunks.every((block) => block.text.length <= 5_000));
    for (let index = 0; index < 42; index += 1) {
      const marker = `sequential-marker-${String(index).padStart(2, "0")}`;
      assert.equal(chunks.filter((block) => block.text.includes(marker)).length, 1);
    }
    assert.ok(chunks.at(-1)?.text.includes("sequential-marker-41"), "the document tail remains available");
  });

  it("uses deterministic round-robin allocation so one long document cannot monopolize attachment slots", () => {
    const parserOutput = parseS1F1Filing({
      formType: "S-1",
      filingText: "Issuer registration statement.",
      attachments: [
        { name: "doc-a.txt", text: longDocument("alpha", 100) },
        { name: "doc-b.txt", text: longDocument("beta", 100) },
        { name: "doc-c.txt", text: longDocument("gamma", 100) },
      ],
    });
    const first = preparedAttachmentBlocks(parserOutput);
    const second = preparedAttachmentBlocks(parserOutput);
    const byDocument = new Map<string, number[]>();
    for (const block of first) {
      const documentName = String(block.documentName);
      const indices = byDocument.get(documentName) ?? [];
      indices.push(Number(block.chunk_index));
      byDocument.set(documentName, indices);
    }

    assert.ok(first.length <= 20);
    assert.ok(first.length >= 16);
    assert.deepEqual(first, second);
    assert.deepEqual([...byDocument.keys()], ["doc-a.txt", "doc-b.txt", "doc-c.txt"]);
    assert.ok([...byDocument.values()].every((indices) => indices.length >= 5));
    assert.ok([...byDocument.values()].every((indices) => indices.every((value, index) => value === index + 1)));
  });

  it("keeps stable attachment IDs and source references independent of changes to another document", () => {
    const build = (firstText: string) => parseS1F1Filing({
      formType: "S-1",
      filingText: "Issuer registration statement.",
      attachments: [
        { name: "changing.txt", text: firstText },
        { name: "stable.txt", text: longDocument("stable", 25) },
      ],
    });
    const before = preparedAttachmentBlocks(build(longDocument("before", 20))).filter((block) => block.documentName === "stable.txt");
    const after = preparedAttachmentBlocks(build(longDocument("after", 33))).filter((block) => block.documentName === "stable.txt");

    assert.deepEqual(after.map((block) => block.block_id), before.map((block) => block.block_id));
    assert.ok(before.every((block) => block.source_ref === block.block_id));
    assert.ok(before.every((block) => block.documentId === "stable.txt"));
    assert.ok(before.every((block) => Number(block.chunk_count) >= Number(block.chunk_index)));
  });

  it("contains no accession, exhibit, value, or keyword selection rule", () => {
    const sourceInputCode = readFileSync(new URL("./sourceInput.ts", import.meta.url), "utf8");
    const chunkHelperCode = readFileSync(new URL("../common/contextPreservingChunks.ts", import.meta.url), "utf8");
    const selectionCode = `${sourceInputCode}\n${chunkHelperCode}`;

    assert.doesNotMatch(selectionCode, /0001437749|EX-10\.36|10,000,000|gross proceeds|warrant/i);
  });
});

describe("S-1 exact source input budget", () => {
  it("uses the benchmark-selected S-1-only limits", () => {
    const output = buildWithBlocks([primaryBlock("one", "Source text")]);
    const budget = sourceBudget(output);

    assert.equal(budget.maxBlocks, 40);
    assert.equal(budget.maxBlockTextChars, 5_000);
    assert.equal(budget.maxTotalTextChars, 135_000);
  });

  it("keeps ellipsis and tiny remaining budgets inside the requested code-unit length", () => {
    assert.equal(clipS1F1PromptText("abcdef", 0), "");
    assert.equal(clipS1F1PromptText("abcdef", 1), "a");
    assert.equal(clipS1F1PromptText("abcdef", 2), "ab");
    assert.equal(clipS1F1PromptText("abcdef", 3), "abc");
    assert.equal(clipS1F1PromptText("abcdef", 4), "a...");
    assert.ok(89_999 + clipS1F1PromptText("summary", 1).length <= 90_000);
  });

  for (const remaining of [0, 1, 2, 3, 4, 17]) {
    it(`enforces the configured hard cap with ${remaining} code units remaining`, () => {
      const prefixLength = 135_000 - remaining;
      const blocks = sizedPrimaryBlocks(prefixLength);
      blocks.push(primaryBlock("final", "final source text"));
      const output = buildWithBlocks(blocks);
      const budget = sourceBudget(output);

      assert.ok(Number(budget.includedTextChars) <= Number(budget.maxTotalTextChars));
      assert.equal(budget.includedTextChars, 135_000);
    });
  }

  it("preserves max-1, exact-max, and max-plus-input boundaries", () => {
    const maxMinusOne = sourceBudget(buildWithBlocks(sizedPrimaryBlocks(134_999)));
    const exactMax = sourceBudget(buildWithBlocks(sizedPrimaryBlocks(135_000)));
    const maxPlusInput = sourceBudget(buildWithBlocks([...sizedPrimaryBlocks(135_000), primaryBlock("overflow", "overflow") ]));

    assert.equal(maxMinusOne.includedTextChars, 134_999);
    assert.equal(exactMax.includedTextChars, 135_000);
    assert.equal(maxPlusInput.includedTextChars, 135_000);
  });
});

function attachmentBlocks(parserOutput: S1F1ParserOutput, documentName: string): S1F1CleanedSourceBlock[] {
  return (parserOutput.raw.cleanedSourceBlocks ?? []).filter(
    (block) => block.source === "attachment" && block.documentName === documentName,
  );
}

function preparedAttachmentBlocks(parserOutput: S1F1ParserOutput): Array<Record<string, unknown>> {
  return (buildS1F1LlmSourceInput(parserOutput).cleaned_source_blocks as Array<Record<string, unknown>>)
    .filter((block) => block.source === "attachment");
}

function buildWithBlocks(blocks: S1F1CleanedSourceBlock[]): Record<string, unknown> {
  const parserOutput = parseS1F1Filing({ formType: "S-1", filingText: "Issuer registration statement." });
  parserOutput.raw.cleanedSourceBlocks = blocks;
  return buildS1F1LlmSourceInput(parserOutput);
}

function sourceBudget(output: Record<string, unknown>): Record<string, number> {
  return ((output.source_inventory as Record<string, unknown>).sourceBlockBudget ?? {}) as Record<string, number>;
}

function primaryBlock(sectionKey: string, text: string): S1F1CleanedSourceBlock {
  return { source: "primary", sectionKey, sectionTitle: sectionKey, documentName: null, text, tables: [] };
}

function sizedPrimaryBlocks(totalLength: number): S1F1CleanedSourceBlock[] {
  const blocks: S1F1CleanedSourceBlock[] = [];
  let remaining = totalLength;
  let index = 0;
  while (remaining > 0) {
    const length = Math.min(5_000, remaining);
    blocks.push(primaryBlock(`sized_${index}`, patternedText(length, index)));
    remaining -= length;
    index += 1;
  }
  return blocks;
}

function patternedText(length: number, seed: number): string {
  const alphabet = `source-${seed}-abcdefghijklmnopqrstuvwxyz0123456789`;
  return alphabet.repeat(Math.ceil(length / alphabet.length)).slice(0, length);
}

function longDocument(label: string, paragraphs: number): string {
  return Array.from({ length: paragraphs }, (_, index) => {
    const marker = `${label}-marker-${String(index).padStart(2, "0")}`;
    return `${marker}. ${patternedText(420, index)}. End paragraph ${index}.`;
  }).join("\n\n");
}
