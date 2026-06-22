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
