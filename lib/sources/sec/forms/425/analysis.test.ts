import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildSec425AnalysisPromptDraft,
  buildSec425DeterministicRoomResult,
  sec425RequiredOutputResponseSchema,
  validateSec425RoomResult,
} from "./analysisPrompt";
import { buildSec425DisplayPayload } from "./displayPayload";
import { parseSec425Filing } from "./parser";
import { routeSec425ParserOutput } from "./routerPrompt";
import {
  SEC_425_APPROVED_EVENT_TYPES,
  deliveryLevelFromScore,
  type Sec425ParseInput,
  type Sec425RoomResult,
} from "./types";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "425");
const fixturesDir = join(roomDir, "fixtures");
const expectedDir = join(roomDir, "expected");
const expectedNames = readdirSync(expectedDir).filter((name) => name.endsWith(".expected.json")).sort();

for (const expectedName of expectedNames) {
  const expected = readExpected(expectedName);
  const validationErrors = validateSec425RoomResult(expected);
  assert.deepEqual(validationErrors, [], expectedName);
  assert.equal(expected.analysis_output.source_group, "filings", expectedName);
  assert.equal(expected.parser_output.parserGroup, "425", expectedName);
  assert.equal(expected.parser_output.formType, "425", expectedName);
  assert.equal(expected.fixture_expected.expected_delivery_level, deliveryLevelFromScore(expected.analysis_output.score), expectedName);
}

const routineFixture = readFixture("routine-investor-faq-deterministic-archive.json");
const routineParserOutput = parseSec425Filing(routineFixture);
const routineRoute = routeSec425ParserOutput(routineParserOutput);
const routineResult = buildSec425DeterministicRoomResult(routineParserOutput, routineRoute);
if (!routineResult) {
  throw new Error("routine fixture should produce a deterministic room result");
}
assert.equal(routineResult.analysis_output.event_type, "other");
assert.equal(routineResult.analysis_output.score, 35);
assert.equal(routineResult.fixture_expected.expected_delivery_level, "archive");
assert.equal(routineResult.display_payload.display_type, routineRoute.display_type);
assert.equal(routineResult.display_payload.data.display_version, "sec_425_display_v1");
assert.equal(routineResult.display_payload.data.route_case, routineRoute.route_case);
assert.equal(routineResult.analysis_output.needs_human_review, false);
assert.deepEqual(validateSec425RoomResult(routineResult), []);

const mergerFixture = readFixture("merger-terms-strategic-transaction.json");
const mergerParserOutput = parseSec425Filing(mergerFixture);
const mergerRoute = routeSec425ParserOutput(mergerParserOutput);
const mergerDisplayPayload = buildSec425DisplayPayload(mergerParserOutput, mergerRoute);
const analysisPrompt = buildSec425AnalysisPromptDraft({
  filing_package: { fixture: "merger-terms-strategic-transaction" },
  parser_output: mergerParserOutput,
  router_result: mergerRoute,
  display_payload: mergerDisplayPayload,
  filing_excerpt: mergerFixture.filingText,
  market_context: mergerFixture.market_context || null,
});

assert.equal(analysisPrompt.key, "sec_425_analysis_draft");
assert.equal(analysisPrompt.version, "v1");
assert.deepEqual(sec425RequiredOutputResponseSchema.properties.analysis_output.properties.event_type.enum, SEC_425_APPROVED_EVENT_TYPES);
assert.ok(SEC_425_APPROVED_EVENT_TYPES.includes("ipo_listing"));
assert.ok(analysisPrompt.system.includes("Required Output JSON shape"));
assert.ok(analysisPrompt.system.includes("below 50 archive, 50 to 74 feed, 75 or above alert"));
assert.ok(analysisPrompt.system.includes("Copy analysis_output.event_type exactly from router_result.event_type"));
assert.ok(analysisPrompt.system.includes("Copy display_payload exactly from the supplied display_payload object"));
assert.ok(analysisPrompt.system.includes("For ipo_listing cases"));
assert.ok(analysisPrompt.system.includes("Do not call"));
assert.ok(analysisPrompt.user.includes("\"display_payload\""));
assert.ok(analysisPrompt.user.includes("\"display_version\":\"sec_425_display_v1\""));
assert.ok(analysisPrompt.user.includes("\"market_context\""));
assert.ok(analysisPrompt.user.includes("\"market_cap\":3500000000"));

console.log("sec 425 analysis fixtures passed");

function readFixture(name: string): Sec425ParseInput {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Sec425ParseInput;
}

function readExpected(name: string): Sec425RoomResult {
  return JSON.parse(readFileSync(join(expectedDir, name), "utf8")) as Sec425RoomResult;
}
