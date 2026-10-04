import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_PROXY_EVENT_TYPES, parseProxyFiling } from "./parser.ts";

const CASES = [
  "annual-meeting-routine",
  "special-meeting-merger-vote",
  "equity-plan-dilution",
  "insider-control-ownership",
  "shareholder-proposal-legal-risk",
  "governance-board-declassification",
  "preliminary-reverse-split",
  "director-nominee-withdrawal-supplement",
  "third-party-contested-solicitation",
  "notice-only-additional-material",
  "preliminary-merger-proxy",
  "additional-material-authorized-share-increase",
];

const currentDir = path.dirname(fileURLToPath(import.meta.url));

for (const caseName of CASES) {
  const fixture = readJson(`fixtures/${caseName}.json`);
  const expected = readJson(`expected/${caseName}.expected.json`);
  const parsed = parseProxyFiling(fixture.input);

  assert.deepStrictEqual(
    stripRawEnhancements(parsed),
    expected.parser_output,
    `${caseName}: parser output changed`,
  );
  assert.equal(parsed.parserGroup, "proxy", `${caseName}: parser group must remain proxy`);
  assert.equal(parsed.formType, "Proxy", `${caseName}: form type must remain Proxy`);
  assert.ok(parsed.isSupported, `${caseName}: proxy fixtures should be supported`);
  assertRawPayload(caseName, parsed);

  for (const signal of parsed.signals) {
    assert.ok(
      APPROVED_PROXY_EVENT_TYPES.includes(signal.eventType),
      `${caseName}: signal uses unapproved event type ${signal.eventType}`,
    );
  }
}

console.log(`parser.test.ts: ${CASES.length} fixture cases passed`);

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(currentDir, relativePath), "utf8"));
}

function stripRawEnhancements(parsed) {
  return {
    ...parsed,
    raw: {
      secFormType: parsed.raw.secFormType,
      attachmentNames: parsed.raw.attachmentNames,
      market_context: parsed.raw.market_context,
    },
  };
}

function assertRawPayload(caseName, parsed) {
  assert.equal(typeof parsed.raw.primaryTextChars, "number", `${caseName}: primaryTextChars missing`);
  assert.equal(typeof parsed.raw.combinedTextChars, "number", `${caseName}: combinedTextChars missing`);
  assert.ok(parsed.raw.combinedTextChars >= parsed.raw.primaryTextChars, `${caseName}: combined text shrank`);
  assert.deepStrictEqual(
    parsed.raw.attachmentInventory.map((attachment) => attachment.name),
    parsed.raw.attachmentNames,
    `${caseName}: attachment inventory names must match attachmentNames`,
  );
  const discoveryIds = new Set();
  for (const block of parsed.raw.discoveryBlocks) {
    assert.ok(block.id, `${caseName}: discovery block id missing`);
    assert.ok(!discoveryIds.has(block.id), `${caseName}: duplicate discovery block id ${block.id}`);
    discoveryIds.add(block.id);
    assert.ok(block.text, `${caseName}: discovery block text missing`);
    assert.ok(block.startChar >= 0, `${caseName}: discovery block startChar invalid`);
    assert.ok(block.endChar > block.startChar, `${caseName}: discovery block endChar invalid`);
    assert.equal(block.endChar - block.startChar, block.text.length, `${caseName}: discovery block offsets must match text length`);
    assert.ok(block.text.length <= 12_000, `${caseName}: discovery block too large`);
    assert.ok(block.cues.length > 0, `${caseName}: discovery block cue missing`);
  }
  if (parsed.raw.primaryTextChars > 0) {
    assert.ok(parsed.raw.discoveryBlocks.length > 0, `${caseName}: discovery blocks missing`);
  }
  for (const block of parsed.raw.importantBlocks) {
    assert.ok(block.kind, `${caseName}: important block kind missing`);
    assert.ok(block.label, `${caseName}: important block label missing`);
    assert.ok(block.text, `${caseName}: important block text missing`);
  }
  for (const block of parsed.raw.noiseBlocks) {
    assert.ok(block.kind, `${caseName}: noise block kind missing`);
    assert.ok(block.count > 0, `${caseName}: noise block count missing`);
    assert.ok(block.sample, `${caseName}: noise block sample missing`);
  }
}
