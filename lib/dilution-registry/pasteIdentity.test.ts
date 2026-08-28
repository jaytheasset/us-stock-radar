import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDilutionRegistryPasteIdFromSource,
  DILUTION_REGISTRY_PASTE_ID_PREFIX,
} from "./pasteIdentity.ts";

const fixturePath = process.env.DILUTION_REGISTRY_REFERENCE_FIXTURE;
const fixtureTest = fixturePath ? test : test.skip;

fixtureTest(
  "paste identity is deterministic for the exact validated Preview source",
  () => {
    const source = readFileSync(fixturePath!, "utf8");
    const pasteId = createDilutionRegistryPasteIdFromSource(source);

    assert.match(
      pasteId,
      new RegExp(`^${DILUTION_REGISTRY_PASTE_ID_PREFIX}[0-9a-f]{64}$`),
    );
    assert.equal(createDilutionRegistryPasteIdFromSource(source), pasteId);
  },
);

fixtureTest("a byte change produces a different paste identity", () => {
  const source = readFileSync(fixturePath!, "utf8");
  assert.notEqual(
    createDilutionRegistryPasteIdFromSource(`${source}\n`),
    createDilutionRegistryPasteIdFromSource(source),
  );
});

fixtureTest("a changed SEC value produces a different paste identity", () => {
  const source = readFileSync(fixturePath!, "utf8");
  const changed = JSON.parse(source);
  changed.totals[0].source_note = `${changed.totals[0].source_note || ""} changed`;

  assert.notEqual(
    createDilutionRegistryPasteIdFromSource(JSON.stringify(changed)),
    createDilutionRegistryPasteIdFromSource(source),
  );
});

test("invalid Preview JSON cannot receive a paste identity", () => {
  assert.throws(
    () => createDilutionRegistryPasteIdFromSource('{"instruments":[]}'),
    /Invalid Dilution Registry Preview JSON/,
  );
});
