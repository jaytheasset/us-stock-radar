import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parseSec425Filing } from "./parser";
import {
  SEC_425_COMMUNICATION_MODE_VALUES,
  SEC_425_ROUTER_CASE_VALUES,
  SEC_425_ROUTER_EVENT_TYPES,
  SEC_425_TRANSACTION_STAGE_VALUES,
  buildSec425RouterPromptDraft,
  buildSec425RouterSourcePromptInput,
  normalizeSec425RouterResult,
  sec425RouterResponseSchema,
} from "./routerPrompt";
import type { Sec425ParseInput } from "./types";

const fixturesDir = join(process.cwd(), "lib", "sources", "sec", "forms", "425", "fixtures");
const fixtureNames = readdirSync(fixturesDir).filter((name) => name.endsWith(".json")).sort();

for (const fixtureName of fixtureNames) {
  const fixture = readFixture(fixtureName);
  const parserOutput = parseSec425Filing(fixture);
  const sourceInput = buildSec425RouterSourcePromptInput({
    filing_package: { fixture: fixtureName },
    parser_output: parserOutput,
    filing_excerpt: fixture.filingText,
    market_context: fixture.market_context || null,
  });

  assert.deepEqual(
    sourceInput.cleaned_source_blocks.map((block) => block.block_id),
    parserOutput.raw.router_source_blocks.map((block) => block.block_id),
    fixtureName,
  );
  assert.ok(sourceInput.cleaned_source_blocks.length > 0, fixtureName);
  assert.ok(sourceInput.cleaned_source_blocks.every((block) => block.text.length <= 1_500), fixtureName);
  assert.equal("facts" in sourceInput, false, fixtureName);
  assert.equal(JSON.stringify(sourceInput).includes("source_value_evidence"), false, fixtureName);
}

const shareholderParserOutput = parseSec425Filing(readFixture("shareholder-vote-solicitation.json"));
const routerPrompt = buildSec425RouterPromptDraft({
  filing_package: { fixture: "shareholder-vote-solicitation" },
  parser_output: shareholderParserOutput,
  filing_excerpt: "This text must not be copied into the compact router bundle.",
  market_context: null,
});

assert.equal(routerPrompt.key, "sec_425_router");
assert.equal(routerPrompt.version, "v2");
assert.deepEqual(sec425RouterResponseSchema.properties.event_type.enum, SEC_425_ROUTER_EVENT_TYPES);
assert.deepEqual(sec425RouterResponseSchema.properties.route_case.enum, SEC_425_ROUTER_CASE_VALUES);
assert.deepEqual(sec425RouterResponseSchema.properties.communication_mode.enum, SEC_425_COMMUNICATION_MODE_VALUES);
assert.deepEqual(sec425RouterResponseSchema.properties.transaction_stage.enum, SEC_425_TRANSACTION_STAGE_VALUES);
assert.deepEqual(sec425RouterResponseSchema.properties.display_version.enum, ["sec_425_display_v1"]);
assert.ok(routerPrompt.system.includes("route planner"));
assert.ok(routerPrompt.system.includes("compact, context-preserving excerpts"));
assert.ok(routerPrompt.system.includes("Router score is an archive gate"));
assert.ok(routerPrompt.system.includes("needs_parent_context"));
assert.ok(routerPrompt.user.includes("\"cleaned_source_blocks\""));
assert.equal(routerPrompt.user.includes("This text must not be copied"), false);
assert.equal(routerPrompt.user.includes("\"facts\""), false);

const availableIds = shareholderParserOutput.raw.router_source_blocks.map((block) => block.block_id);
const selectedId = availableIds[0];
assert.ok(selectedId);
const normalized = normalizeSec425RouterResult({
  source_group: "filings",
  source_form_type: "425",
  parser_group: "425",
  event_type: "shareholder_vote",
  score: 85,
  expected_delivery_level: "alert",
  action: "alert",
  route_case: "shareholder_meeting_or_vote",
  communication_mode: "meeting_notice",
  transaction_stage: "vote_pending",
  display_type: "candidate_special",
  display_version: "sec_425_display_v1",
  confidence: "high",
  needs_analysis_llm: true,
  archive_like_candidate: false,
  needs_parent_context: false,
  deterministic_stage: null,
  routing_reason: "The filing provides a material shareholder meeting update.",
  evidence: ["The filing sets a meeting date."],
  selected_source_block_ids: [selectedId, "missing-block"],
  source_blocks_used: [selectedId],
  needs_human_review: false,
  debug: {},
}, shareholderParserOutput);

assert.equal(normalized.score, 50);
assert.equal(normalized.expected_delivery_level, "feed");
assert.equal(normalized.action, "feed");
assert.deepEqual(normalized.selected_source_block_ids, [selectedId]);
assert.equal(normalized.needs_analysis_llm, true);
assert.equal(normalized.archive_like_candidate, false);

console.log("sec 425 router fixtures passed");

function readFixture(name: string): Sec425ParseInput {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Sec425ParseInput;
}
