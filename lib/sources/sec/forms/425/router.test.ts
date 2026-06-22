import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSec425Filing } from "./parser";
import {
  SEC_425_ROUTER_CASE_VALUES,
  buildSec425RouterPromptDraft,
  routeSec425ParserOutput,
  sec425RouterResponseSchema,
} from "./routerPrompt";
import {
  SEC_425_APPROVED_EVENT_TYPES,
  deliveryLevelFromScore,
  type Sec425ParseInput,
} from "./types";

const fixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "425", "fixtures");
const fixtureNames = readdirSync(fixturesDir).filter((name) => name.endsWith(".json")).sort();

for (const fixtureName of fixtureNames) {
  const fixture = readFixture(fixtureName);
  const parserOutput = parseSec425Filing(fixture);
  const decision = routeSec425ParserOutput(parserOutput);

  assert.equal(decision.source_group, "filings", fixtureName);
  assert.equal(decision.source_form_type, "425", fixtureName);
  assert.equal(decision.parser_group, "425", fixtureName);
  assert.equal(decision.event_type, fixture.expected?.event_type, fixtureName);
  assert.equal(decision.expected_delivery_level, fixture.expected?.expected_delivery_level, fixtureName);
  assert.equal(decision.expected_delivery_level, deliveryLevelFromScore(decision.score), fixtureName);
  assert.equal(decision.action, deliveryLevelFromScore(decision.score), fixtureName);
  assert.ok(SEC_425_ROUTER_CASE_VALUES.includes(decision.route_case), fixtureName);
  assert.ok(["generic", "offering_terms", "candidate_special", "spac_transaction_status"].includes(decision.display_type), fixtureName);
  assert.equal(decision.display_version, "sec_425_display_v1", fixtureName);
  assert.ok(decision.routing_reason.length > 20, fixtureName);

  if (fixture.expected?.deterministic) {
    assert.equal(decision.needs_analysis_llm, false, fixtureName);
    assert.equal(decision.deterministic_stage, "parser", fixtureName);
    assert.equal(decision.action, "archive", fixtureName);
    assert.equal(decision.score < 50, true, fixtureName);
  } else {
    assert.equal(decision.needs_analysis_llm, true, fixtureName);
    assert.equal(decision.deterministic_stage, null, fixtureName);
  }
}

const routerPrompt = buildSec425RouterPromptDraft({
  filing_package: { fixture: "shareholder-vote-solicitation" },
  parser_output: parseSec425Filing(readFixture("shareholder-vote-solicitation.json")),
  filing_excerpt: "The special meeting of Northstar stockholders will be held on July 15, 2026.",
  market_context: null,
});

assert.equal(routerPrompt.key, "sec_425_router_draft");
assert.equal(routerPrompt.version, "v1");
assert.deepEqual(sec425RouterResponseSchema.properties.event_type.enum, SEC_425_APPROVED_EVENT_TYPES);
assert.ok(SEC_425_APPROVED_EVENT_TYPES.includes("ipo_listing"));
assert.deepEqual(sec425RouterResponseSchema.properties.display_version.enum, ["sec_425_display_v1"]);
assert.ok(routerPrompt.system.includes("below 50 archive, 50 to 74 feed, 75 or above alert"));
assert.ok(routerPrompt.system.includes("Use ipo_listing only when the main event is a traditional IPO"));
assert.ok(routerPrompt.system.includes("Do not use ipo_listing for ordinary resale registration"));
assert.ok(routerPrompt.system.includes("Choose display_type and display_version"));
assert.ok(routerPrompt.system.includes("Use display_type spac_transaction_status"));
assert.ok(routerPrompt.system.includes("Do not use spac_transaction_status for a plain blank-check IPO registration"));
assert.ok(routerPrompt.system.includes("Do not use parser-generated facts"));
assert.ok(routerPrompt.system.includes("Do not request or assume live market data") || routerPrompt.system.includes("Do not request"));
assert.ok(routerPrompt.user.includes("\"cleaned_source_blocks\""));

const spacDecision = routeSec425ParserOutput(parseSec425Filing(readFixture("spac-pipe-business-combination.json")));
assert.equal(spacDecision.route_case, "spac_business_combination_terms");
assert.equal(spacDecision.event_type, "strategic_transaction");
assert.equal(spacDecision.display_type, "spac_transaction_status");

console.log("sec 425 router fixtures passed");

function readFixture(name: string): Sec425ParseInput {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Sec425ParseInput;
}
