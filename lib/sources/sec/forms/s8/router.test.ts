import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildS8RouterPrompt, buildS8SourceBlockPromptInput, routeS8Filing } from "./routerPrompt.ts";
import { S8_APPROVED_EVENT_TYPES } from "./types.ts";
import type { S8FixtureInput, S8RequiredFixtureOutput } from "./types.ts";

const roomDir = dirname(fileURLToPath(import.meta.url));
const fixtureNames = [
  "routine-small-plan",
  "large-dilution-market-context",
  "s8a-administrative-amendment",
  "s8a-additional-shares-parent-context",
  "ambiguous-human-review",
  "inducement-awards",
  "post-effective-no-additional-securities",
  "reoffer-prospectus-sellingholders",
  "douglas-elliman-evergreen-s8",
];

test("S-8 route handoff is analysis-only", () => {
  for (const name of fixtureNames) {
    const expected = readExpected(name);
    const decision = routeS8Filing(expected.parser_output);

    assert.equal(S8_APPROVED_EVENT_TYPES.includes(decision.event_type), true, name);
    assert.equal(decision.route_action, "send_to_analysis", name);
    assert.equal(decision.event_type, "other", name);
    assert.equal(decision.score_hint, 0, name);
    assert.equal(decision.final_output, undefined, name);
    assert.equal(Object.hasOwn(decision, "preliminary_action"), false, name);
    assert.equal(Object.values(decision).includes("human_review"), false, name);
    assert.doesNotMatch(JSON.stringify(decision), /finalize_archive|dilution_registration|material_dilution|reoffer_resale|admin_archive/);
  }
});

test("router prompt is constrained to approved room behavior", () => {
  const expected = readExpected("large-dilution-market-context");
  const prompt = buildS8RouterPrompt(expected.parser_output);

  assert.match(prompt, /listing_risk, ipo_listing, dilution_risk, earnings/);
  assert.match(prompt, /S-8\/A filings are update filings/);
  assert.match(prompt, /Reoffer prospectus/);
  assert.match(prompt, /Exhibit 107 fee-table rows/);
  assert.match(prompt, /send_to_analysis/);
  assert.match(prompt, /Do not use parser-generated facts, signals, routingHints/);
  assert.match(prompt, /must never appear inside final_output/);
  assert.match(prompt, /do not query live DB/i);
  assert.match(prompt, /do not call live market-data APIs/i);

  const sourceInput = buildS8SourceBlockPromptInput({ parserOutput: expected.parser_output });
  const sourceKeys = collectKeys(sourceInput);
  for (const key of [
    "facts",
    "signals",
    "classification",
    "event_type",
    "display_type",
    "score",
    "topSignal",
    "extraction_summary",
    "selected_classification",
    "routingHints",
  ]) {
    assert.equal(sourceKeys.has(key), false, `source block payload must not expose ${key}`);
  }
});

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }
    return keys;
  }

  if (!value || typeof value !== "object") {
    return keys;
  }

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    keys.add(key);
    collectKeys(item, keys);
  }

  return keys;
}

function readFixture(name: string): S8FixtureInput {
  return readJson(join("fixtures", `${name}.json`));
}

function readExpected(name: string): S8RequiredFixtureOutput {
  return readJson(join("expected", `${name}.expected.json`));
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(roomDir, relativePath), "utf8")) as T;
}
