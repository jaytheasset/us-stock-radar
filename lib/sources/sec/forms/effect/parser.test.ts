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

const flattenedNotice = parseEffectFiling({
  formType: "EFFECT",
  accessionNumber: "9999999995-24-001005",
  text: [
    "Effectiveness Date: | April 17, 2024 4:00 P.M. |",
    "Form: | S-1 |",
    "CIK: | 0001538379 |",
    "Company Name: | Ibotta, Inc. |",
    "File Number: | 333-278172 |",
  ].join(" "),
});
assert.equal(flattenedNotice.facts.effectiveDate, "2024-04-17");
assert.equal(flattenedNotice.facts.effectiveTime, "16:00:00");
assert.equal(flattenedNotice.facts.effectiveFilingForm, "S-1");
assert.equal(flattenedNotice.facts.cik, "0001538379");
assert.equal(flattenedNotice.facts.companyName, "Ibotta, Inc.");
assert.equal(flattenedNotice.facts.registrationNumber, "333-278172");

console.log("sec effect parser fixture tests passed");

function readFixture(name: string): EffectFixtureInput {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8")) as EffectFixtureInput;
}

function readExpected(name: string): EffectRequiredOutput {
  return JSON.parse(readFileSync(join(expectedDir, `${name}.expected.json`), "utf8")) as EffectRequiredOutput;
}
