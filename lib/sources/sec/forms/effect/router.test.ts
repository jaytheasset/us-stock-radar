import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseEffectFiling } from "./parser";
import { routeEffectFiling } from "./router";
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
  const fixture = readFixture(fixtureName);
  const expected = readExpected(fixtureName);
  const decision = routeEffectFiling(parseEffectFiling(fixture));

  assert.equal(decision.deterministic, true, `${fixtureName} deterministic routing`);
  assert.equal(decision.requiresLlm, false, `${fixtureName} should not require router LLM`);
  assert.ok(APPROVED_EVENT_TYPES.includes(decision.eventType), `${fixtureName} uses an approved event type`);
  assert.equal(decision.eventType, expected.analysis_output.event_type, `${fixtureName} event type`);
  assert.equal(decision.preliminaryScore, expected.analysis_output.score, `${fixtureName} score`);
  assert.equal(decision.preliminarySignal, expected.analysis_output.signal, `${fixtureName} signal`);
  assert.equal(decision.expectedImpact, expected.fixture_expected.expected_impact, `${fixtureName} impact`);
  assert.equal(decision.marketContextNeeded, false, `${fixtureName} fixture-only market context`);
  assert.deepEqual(decision.marketContextFields, [], `${fixtureName} market context fields`);
  assert.equal(deliveryLevelForScore(decision.preliminaryScore), expected.fixture_expected.expected_delivery_level, `${fixtureName} delivery band`);
}

const s1Decision = routeEffectFiling(parseEffectFiling(readFixture("s1-effective")));
assert.equal(s1Decision.eventType, "ipo_listing");

const f3Decision = routeEffectFiling(parseEffectFiling(readFixture("f3-foreign-effective")));
assert.equal(f3Decision.eventType, "dilution_risk");

const f4Decision = routeEffectFiling(parseEffectFiling(readFixture("f4-multiple-filers")));
assert.equal(f4Decision.eventType, "strategic_transaction");

const n4Decision = routeEffectFiling(parseEffectFiling(readFixture("n4-series-contract")));
assert.equal(n4Decision.eventType, "other");
assert.equal(n4Decision.needsHumanReview, true);

const insufficientDecision = routeEffectFiling(parseEffectFiling(readFixture("insufficient-context")));
assert.equal(insufficientDecision.eventType, "other");
assert.equal(insufficientDecision.needsHumanReview, true);
assert.equal(deliveryLevelForScore(insufficientDecision.preliminaryScore), "archive");

console.log("sec effect router fixture tests passed");

function readFixture(name: string): EffectFixtureInput {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), "utf8")) as EffectFixtureInput;
}

function readExpected(name: string): EffectRequiredOutput {
  return JSON.parse(readFileSync(join(expectedDir, `${name}.expected.json`), "utf8")) as EffectRequiredOutput;
}
