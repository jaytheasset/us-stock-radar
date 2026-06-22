import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseEffectFiling } from "./parser";
import type { EffectFixtureInput, EffectRequiredOutput } from "./types";

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
  const fixture = readFixture(fixtureName);
  const expected = readExpected(fixtureName);
  const parsed = parseEffectFiling(fixture);

  assert.deepEqual(parsed, expected.parser_output, `${fixtureName} parser output should match fixture expectation`);
  assert.equal(parsed.parserGroup, "effect", `${fixtureName} parser group`);
  assert.equal(parsed.formType, "EFFECT", `${fixtureName} form type`);
  assert.equal(parsed.isSupported, true, `${fixtureName} support flag`);
}

const posAm = parseEffectFiling(readFixture("pos-am-effective"));
assert.equal(posAm.facts.effectiveFilingForm, "POS AM");
assert.equal(posAm.facts.referenceAccessionNumber, "0001477932-22-009165");
assert.equal(posAm.facts.effectiveFormSource, "effectiveData.submissionType");

const multiFiler = parseEffectFiling(readFixture("f4-multiple-filers"));
assert.equal(multiFiler.facts.hasMultipleFilers, true);
assert.equal(multiFiler.facts.filers.length, 3);

const n4Series = parseEffectFiling(readFixture("n4-series-contract"));
assert.equal(n4Series.facts.hasSeriesClassContractData, true);
assert.equal(n4Series.facts.primaryFiler?.seriesClassContract?.classContractName, "StarStream Variable Annuity");

const omittedIndexForm = parseEffectFiling(readFixture("omitted-index-form"));
assert.equal(omittedIndexForm.facts.effectiveFilingForm, "S-3");
assert.ok(omittedIndexForm.warnings.includes("Index/header registration form was absent in fixture metadata; XML effectiveData.form was used."));

const insufficientContext = parseEffectFiling(readFixture("insufficient-context"));
assert.equal(insufficientContext.facts.effectiveFilingForm, null);
assert.ok(insufficientContext.warnings.includes("Related registration form type was not identified."));

console.log("sec effect parser fixture tests passed");

function readFixture(name: string): EffectFixtureInput {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8")) as EffectFixtureInput;
}

function readExpected(name: string): EffectRequiredOutput {
  return JSON.parse(readFileSync(join(expectedDir, `${name}.expected.json`), "utf8")) as EffectRequiredOutput;
}
