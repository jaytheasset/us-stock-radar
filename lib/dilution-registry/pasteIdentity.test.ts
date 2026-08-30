import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createDilutionRegistryPasteIdFromSource,
  createDilutionRegistrySourceFromCombinedSource,
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

test("legacy Registry JSON remains byte-for-byte unchanged", () => {
  const source = `\n {\r\n  "instruments": [],\r\n  "snapshots": [],\r\n  "activities": [],\r\n  "totals": []\r\n }\n`;
  assert.equal(createDilutionRegistrySourceFromCombinedSource(source), source);
});

test("an appended O/S member is removed without changing Registry identity", () => {
  const registry = `\n{\n  "issuer": {"issuer_cik":"0001840317","ticker":"VEEA"},\n  "instruments": [],\n  "snapshots": [],\n  "activities": [],\n  "totals": []\n}`;
  const combined = registry.replace(
    "\n}",
    ',\n  "os_observations": [{"shares_outstanding":"62214156"}]\n}',
  );
  const changedOs = combined.replace("62214156", "62214157");
  assert.equal(createDilutionRegistrySourceFromCombinedSource(combined), registry);
  assert.equal(createDilutionRegistrySourceFromCombinedSource(changedOs), registry);
  assert.equal(
    createDilutionRegistryPasteIdFromSource(createDilutionRegistrySourceFromCombinedSource(combined)),
    createDilutionRegistryPasteIdFromSource(registry),
  );
});

test("O/S position and whitespace do not affect safe Registry-only parsing", () => {
  const combined = '{ "os_observations": [], "instruments": [], "snapshots": [], "activities": [], "totals": [] }';
  const registry = createDilutionRegistrySourceFromCombinedSource(combined);
  assert.deepEqual(JSON.parse(registry), {
    instruments: [], snapshots: [], activities: [], totals: [],
  });
});
