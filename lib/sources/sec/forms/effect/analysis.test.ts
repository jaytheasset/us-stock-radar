import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { analyzeEffectFiling } from "./analysis";
import { APPROVED_EVENT_TYPES, deliveryLevelForScore, type EffectFixtureInput, type EffectRequiredOutput } from "./types";

const fixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "effect", "fixtures");
const expectedDir = join(process.cwd(), "lib", "sources", "sec", "forms", "effect", "expected");
const fixtureNames = [
  "s1-effective",
  "pos-am-effective",
  "f3-foreign-effective",
  "f4-multiple-filers",
  "n4-series-contract",
  "omitted-index-form",
  "insufficient-context",
];

for (const fixtureName of fixtureNames) {
  const actual = analyzeEffectFiling(readFixture(fixtureName));
  const expected = readExpected(fixtureName);

  assert.deepEqual(actual, expected, `${fixtureName} required output JSON`);
  assert.equal(actual.analysis_output.source_group, "filings", `${fixtureName} source group`);
  assert.ok(APPROVED_EVENT_TYPES.includes(actual.analysis_output.event_type), `${fixtureName} approved event type`);
  assert.equal(
    deliveryLevelForScore(actual.analysis_output.score),
    actual.fixture_expected.expected_delivery_level,
    `${fixtureName} derived delivery level`,
  );
  assert.equal(actual.fixture_expected.market_context_needed, false, `${fixtureName} no live market context`);
  assert.equal(actual.fixture_expected.special_ui_needed, false, `${fixtureName} no special UI from this room`);
}

console.log("sec effect analysis fixture tests passed");

function readFixture(name: string): EffectFixtureInput {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8")) as EffectFixtureInput;
}

function readExpected(name: string): EffectRequiredOutput {
  return JSON.parse(readFileSync(join(expectedDir, `${name}.expected.json`), "utf8")) as EffectRequiredOutput;
}
