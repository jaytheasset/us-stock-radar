import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildSec425AnalysisPromptDraft,
  buildSec425DeterministicRoomResult,
  SEC_425_IMPACT_LEVEL_VALUES,
  sec425RequiredOutputResponseSchema,
  validateSec425RoomResult,
} from "./analysisPrompt";
import { parseSec425Filing } from "./parser";
import type { Sec425RouterDecision } from "./routerPrompt";
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
const routineRoute = buildRouterDecision(routineParserOutput, {
  event_type: "other",
  score: 35,
  expected_delivery_level: "archive",
  action: "archive",
  route_case: "routine_repetition",
  communication_mode: "faq",
  transaction_stage: "solicitation",
  display_type: "generic",
  needs_analysis_llm: false,
  archive_like_candidate: true,
  deterministic_stage: "router",
});
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
assert.equal(routineResult.analysis_output.summary, routineParserOutput.facts.deterministic_archive_reason);
assert.deepEqual(routineResult.analysis_output.what_to_watch_next, []);
assert.deepEqual(validateSec425RoomResult(routineResult), []);

const routerReasonArchive = buildSec425DeterministicRoomResult(
  {
    ...routineParserOutput,
    facts: {
      ...routineParserOutput.facts,
      deterministic_archive_reason: null,
    },
  },
  {
    ...routineRoute,
    routing_reason: "The filing reports a social-media repost but does not provide its substantive content.",
  },
);
assert.equal(
  routerReasonArchive?.analysis_output.summary,
  "The filing reports a social-media repost but does not provide its substantive content.",
);

const mergerFixture = readFixture("merger-terms-strategic-transaction.json");
const mergerParserOutput = parseSec425Filing(mergerFixture);
const mergerRoute = buildRouterDecision(mergerParserOutput, {
  event_type: "strategic_transaction",
  route_case: "transaction_announcement_or_terms",
  communication_mode: "press_release",
  transaction_stage: "agreement_signed",
  display_type: "candidate_special",
});
const analysisPrompt = buildSec425AnalysisPromptDraft({
  filing_package: {
    fixture: "merger-terms-strategic-transaction",
    filing_context: {
      related_transaction: {
        status: "found",
        selected_filings: [
          {
            form_type: "S-4",
            event_title: "Prior merger registration statement",
            summary: "The parties previously disclosed the signed merger terms.",
          },
        ],
      },
    },
  },
  parser_output: mergerParserOutput,
  router_result: mergerRoute,
  filing_excerpt: mergerFixture.filingText,
  market_context: mergerFixture.market_context || null,
});

assert.equal(analysisPrompt.key, "sec_425_analysis_draft");
assert.equal(analysisPrompt.version, "v8");
assert.deepEqual(sec425RequiredOutputResponseSchema.properties.analysis_output.properties.event_type.enum, SEC_425_APPROVED_EVENT_TYPES);
assert.ok(SEC_425_APPROVED_EVENT_TYPES.includes("ipo_listing"));
assert.ok(analysisPrompt.system.includes("Required Output JSON shape"));
assert.ok(analysisPrompt.system.includes("below 50 archive, 50 to 74 feed, 75 or above alert"));
assert.ok(analysisPrompt.system.includes("set impact_level to exactly one of repeated_information, procedural_update, material_progression, or decisive_outcome"));
assert.deepEqual(SEC_425_IMPACT_LEVEL_VALUES, [
  "repeated_information",
  "procedural_update",
  "material_progression",
  "decisive_outcome",
]);
assert.ok(analysisPrompt.system.includes("Use 75-84 only when the current Form 425 itself establishes a decisive new catalyst"));
assert.ok(analysisPrompt.system.includes("A resolved material external condition is a decisive_outcome even when closing remains pending"));
assert.ok(analysisPrompt.system.includes("Do not downgrade a decisive current-filing update merely because the underlying transaction was announced earlier"));
assert.ok(analysisPrompt.system.includes("Use 75-79 when this Form 425 first reports final regulatory clearance"));
assert.ok(analysisPrompt.system.includes("If it cannot, cap the score at 74"));
assert.ok(analysisPrompt.system.includes("A procedural_update is analyzed but archived"));
assert.ok(analysisPrompt.system.includes("Feed begins only when the current filing establishes a substantive change"));
assert.ok(analysisPrompt.system.includes("A meeting date, record-date change, proxy mailing, solicitation reminder, or routine adjournment is archive-level"));
assert.ok(analysisPrompt.system.includes("score_reason is the visible score explanation"));
assert.ok(analysisPrompt.system.includes("targeting 18-32 words"));
assert.ok(analysisPrompt.system.includes("Do not begin with 'The score'"));
assert.ok(analysisPrompt.system.includes("Copy analysis_output.event_type exactly from router_result.event_type"));
assert.ok(analysisPrompt.system.includes("Do not use parser-generated display payload fields as evidence"));
assert.ok(analysisPrompt.system.includes("write exactly 4 snapshot_items"));
assert.ok(analysisPrompt.system.includes("Never output Not disclosed"));
assert.ok(analysisPrompt.system.includes("For ipo_listing cases"));
assert.ok(analysisPrompt.system.includes("Do not call"));
assert.ok(analysisPrompt.system.includes("Analyze this Form 425 independently"));
assert.ok(analysisPrompt.system.includes("Prior 8-K, 6-K, S-4, F-4, proxy, tender, and Form 425 analyses are not supplied"));
assert.ok(analysisPrompt.system.includes("candidate gate, not final proof of materiality"));
assert.ok(analysisPrompt.system.includes("stakeholder-facing transcript, video, town hall, FAQ, interview, or message"));
assert.ok(analysisPrompt.system.includes("override the router candidate"));
assert.ok(analysisPrompt.system.includes("without supplying its substantive content"));
assert.ok(analysisPrompt.system.includes("is archive-level"));
assert.ok(analysisPrompt.system.includes("Write no more than 3 key_evidence items"));
assert.ok(analysisPrompt.system.includes("populate current_changes from the original source blocks"));
assert.ok(analysisPrompt.system.includes("Snapshot and Summary must collectively cover every current_changes item"));
assert.ok(analysisPrompt.system.includes("Exclude slogans, aspirations, expected benefits, and promotional claims"));
assert.ok(analysisPrompt.system.includes("no more than 3 what_to_watch_next items"));
assert.ok(analysisPrompt.system.includes("summary 2 to 4 concise sentences under 100 words total"));
assert.ok(analysisPrompt.system.includes("Keep each item under 72 characters"));
assert.equal(analysisPrompt.user.includes("\"display_payload\""), false);
assert.equal(analysisPrompt.user.includes("\"related_transaction_context\""), false);
assert.equal(analysisPrompt.user.includes("Prior merger registration statement"), false);
assert.ok(analysisPrompt.user.includes("\"market_context\""));
assert.ok(analysisPrompt.user.includes("\"market_cap\":3500000000"));
assert.ok(analysisPrompt.user.includes("\"analysis_source_block_count\""));
assert.ok(analysisPrompt.user.includes("\"analysis_source_selection\""));
assert.ok(analysisPrompt.user.includes("router_selected_with_adjacent_context"));
assert.ok(analysisPrompt.user.includes(mergerParserOutput.raw.cleaned_source_blocks[0]?.block_id || "missing-block-id"));
assert.equal(sec425RequiredOutputResponseSchema.properties.analysis_output.properties.key_evidence.maxItems, 3);
assert.equal(sec425RequiredOutputResponseSchema.properties.analysis_output.properties.key_evidence.items.maxLength, 180);
assert.equal(sec425RequiredOutputResponseSchema.properties.analysis_output.properties.what_to_watch_next.maxItems, 3);
assert.equal(sec425RequiredOutputResponseSchema.properties.analysis_output.properties.event_title.maxLength, 90);
assert.equal(sec425RequiredOutputResponseSchema.properties.analysis_output.properties.score_reason.maxLength, 180);
assert.equal(sec425RequiredOutputResponseSchema.properties.analysis_output.properties.what_to_watch_next.items.maxLength, 72);
assert.equal(sec425RequiredOutputResponseSchema.properties.analysis_output.properties.snapshot_items.maxItems, 4);
assert.equal(sec425RequiredOutputResponseSchema.properties.analysis_output.properties.current_changes.maxItems, 4);

const validationFixture = JSON.parse(JSON.stringify(routineResult)) as Sec425RoomResult;
const validationSourceBlockId = validationFixture.parser_output.raw.cleaned_source_blocks[0]?.block_id;
if (!validationSourceBlockId) throw new Error("validation fixture requires an original source block");
validationFixture.analysis_output.score = 65;
validationFixture.analysis_output.summary = "The board discussed the transaction and its strategic rationale.";
validationFixture.analysis_output.current_changes = [{
  topic: "Distribution record date",
  change: "The filing changed the distribution record date.",
  result: "July 6, 2026",
  priority: "secondary",
  source_block_id: validationSourceBlockId,
}];
validationFixture.analysis_output.key_evidence = [
  "The board reaffirmed its support for the transaction.",
  "The board recommended continued support for the transaction.",
  "This combination will define the next century of the industry.",
];
validationFixture.fixture_expected.expected_delivery_level = "feed";
const qualityWarnings = validateSec425RoomResult(validationFixture);
assert.ok(qualityWarnings.some((warning) => /current_changes not reflected/i.test(warning)));
assert.ok(qualityWarnings.some((warning) => /duplicate decision topics/i.test(warning)));
assert.ok(qualityWarnings.some((warning) => /promotional or non-verifiable claims/i.test(warning)));

const amendmentParserOutput = parseSec425Filing({
  title: "425 - merger amendment notice",
  formType: "425",
  filingText: "The parties entered into a second amendment to their merger agreement.",
  attachments: [{
    documentType: "EX-2.1",
    description: "Second Amendment to Agreement and Plan of Merger",
    filename: "second-amendment.htm",
    text: [
      "SECOND AMENDMENT TO AGREEMENT AND PLAN OF MERGER",
      ...Array.from(
        { length: 14 },
        (_, index) => `WHEREAS, recital ${index + 1} describes background to the original agreement without changing its terms.`,
      ),
      "NOW, THEREFORE, Section 1.7 is replaced to permit eligible preferred holders to make a Liquidation Preference Election.",
    ].join("\n"),
  }],
});
const amendmentRoute = buildRouterDecision(amendmentParserOutput, {
  route_case: "agreement_amendment",
  communication_mode: "agreement_filing",
  transaction_stage: "amended",
  selected_source_block_ids: [amendmentParserOutput.raw.cleaned_source_blocks[0]?.block_id || "missing-block-id"],
});
const amendmentPrompt = buildSec425AnalysisPromptDraft({
  filing_package: { fixture: "agreement-amendment-source-selection" },
  parser_output: amendmentParserOutput,
  router_result: amendmentRoute,
  filing_excerpt: "",
  market_context: null,
});
assert.ok(amendmentPrompt.user.includes("router_selected_with_material_document_context"));
assert.ok(amendmentPrompt.user.includes("Liquidation Preference Election"));

console.log("sec 425 analysis fixtures passed");

function readFixture(name: string): Sec425ParseInput {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Sec425ParseInput;
}

function readExpected(name: string): Sec425RoomResult {
  return JSON.parse(readFileSync(join(expectedDir, name), "utf8")) as Sec425RoomResult;
}

function buildRouterDecision(
  parserOutput: ReturnType<typeof parseSec425Filing>,
  overrides: Partial<Sec425RouterDecision>,
): Sec425RouterDecision {
  const selectedId = parserOutput.raw.router_source_blocks[0]?.block_id;
  if (!selectedId) throw new Error("fixture must provide a router source block");
  return {
    source_group: "filings",
    source_form_type: "425",
    parser_group: "425",
    event_type: "strategic_transaction",
    score: 50,
    expected_delivery_level: "feed",
    action: "feed",
    route_case: "transaction_announcement_or_terms",
    communication_mode: "press_release",
    transaction_stage: "agreement_signed",
    display_type: "candidate_special",
    display_version: "sec_425_display_v1",
    confidence: "high",
    needs_analysis_llm: true,
    archive_like_candidate: false,
    material_update_present: true,
    material_update_reason: "The current filing announces an explicit material transaction event.",
    needs_parent_context: false,
    deterministic_stage: null,
    routing_reason: "The selected original source block contains a material transaction update.",
    evidence: ["The selected source block contains the transaction update."],
    selected_source_block_ids: [selectedId],
    source_blocks_used: [selectedId],
    needs_human_review: false,
    debug: {
      parser_version: "sec_425_parser_v2",
      router_prompt_key: "sec_425_router",
      router_prompt_version: "v4",
    },
    ...overrides,
  };
}
