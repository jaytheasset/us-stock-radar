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
assert.equal(routerPrompt.version, "v8");
assert.deepEqual(sec425RouterResponseSchema.properties.event_type.enum, SEC_425_ROUTER_EVENT_TYPES);
assert.deepEqual(sec425RouterResponseSchema.properties.route_case.enum, SEC_425_ROUTER_CASE_VALUES);
assert.deepEqual(sec425RouterResponseSchema.properties.communication_mode.enum, SEC_425_COMMUNICATION_MODE_VALUES);
assert.deepEqual(sec425RouterResponseSchema.properties.transaction_stage.enum, SEC_425_TRANSACTION_STAGE_VALUES);
assert.deepEqual(sec425RouterResponseSchema.properties.display_version.enum, ["sec_425_display_v1"]);
assert.ok(routerPrompt.system.includes("route planner"));
assert.ok(routerPrompt.system.includes("compact, context-preserving excerpts"));
assert.ok(routerPrompt.system.includes("Router score is an archive gate"));
assert.ok(routerPrompt.system.includes("related filings are display-only navigation"));
assert.ok(routerPrompt.system.includes("material_update_present true only"));
assert.ok(routerPrompt.system.includes("Material information is not automatically a material event"));
assert.ok(routerPrompt.system.includes("material_update_reason must describe what happened or changed"));
assert.ok(routerPrompt.system.includes("proposed merger"));
assert.ok(routerPrompt.system.includes("has not been accepted or signed"));
assert.ok(routerPrompt.system.includes("an FAQ was provided to employees"));
assert.ok(routerPrompt.system.includes("use communication_mode faq"));
assert.ok(routerPrompt.system.includes("intended audience"));
assert.ok(routerPrompt.system.includes("announcement of a future investor call"));
assert.ok(routerPrompt.system.includes("does not yet disclose the promised operating metrics"));
assert.ok(routerPrompt.system.includes("SEC solicitation boilerplate as context"));
assert.ok(routerPrompt.system.includes("Final conflict check"));
assert.ok(routerPrompt.system.includes("concrete adjournment"));
assert.ok(routerPrompt.system.includes("reaffirms an already signed transaction"));
assert.ok(routerPrompt.system.includes("does not include its substantive content"));
assert.ok(routerPrompt.system.includes("supporting communication by default"));
assert.ok(routerPrompt.system.includes("employee-facing video, town hall, transcript, or interview"));
assert.ok(routerPrompt.user.includes("\"cleaned_source_blocks\""));
assert.equal(routerPrompt.user.includes("This text must not be copied"), false);
assert.equal(routerPrompt.user.includes("\"facts\""), false);

const presentationParserOutput = parseSec425Filing({
  formType: "425",
  accessionNumber: "0000000000-26-042599",
  companyName: "Presentation SPAC Corp.",
  filingText: [
    "PUBLIC INVESTOR PRESENTATION",
    "This presentation is issued in connection with the previously announced business combination between Presentation SPAC Corp. and Target Systems Inc.",
    "TRANSACTION OVERVIEW",
    "The proposed business combination values Target Systems at an enterprise value of $500 million and is expected to close after shareholder approval.",
    "BUSINESS OVERVIEW",
    "Target Systems provides operational software to enterprise customers and plans to expand through organic product growth.",
    "GROWTH PLAN",
    "The combined company expects to use public equity as acquisition currency following completion of the business combination.",
  ].join("\n\n"),
});
assert.ok(presentationParserOutput.raw.router_source_blocks.length >= 2);
assert.ok(
  presentationParserOutput.raw.router_source_blocks.some((block) =>
    /previously announced business combination/i.test(block.text),
  ),
);

const callNoticeParserOutput = parseSec425Filing({
  formType: "425",
  accessionNumber: "0000000000-26-042598",
  companyName: "Call Notice SPAC Corp.",
  filingText: [
    "Filed by Call Notice SPAC Corp. pursuant to Rule 425.",
    "TargetAI to Host Business Update Call",
    "TargetAI announced that it will provide a business update by conference call. During the call, management will discuss commercial, financial, and strategic milestones before the proposed business combination with Call Notice SPAC Corp.",
    "Conference Call Details",
    "Domestic dial-in: 1-800-555-0100. Replay conference ID: 123456.",
    "Additional Information",
    "The registration statement includes a proxy statement for the shareholder vote on the proposed business combination.",
  ].join("\n\n"),
});
assert.ok(
  callNoticeParserOutput.raw.router_source_blocks.some((block) =>
    /will provide a business update by conference call/i.test(block.text),
  ),
);

const employeeVideoParserOutput = parseSec425Filing({
  formType: "425",
  accessionNumber: "0000000000-26-042597",
  companyName: "Employee Video Corp.",
  filingText: [
    "TRANSCRIPT OF A VIDEO ANNOUNCEMENT MADE TO EMPLOYEES",
    "This is a transcript of a video announcement made to employees in connection with the proposed business combination between Employee Video Corp. and Acquirer Inc.",
    "Management described the strategic rationale, expected benefits, and employee transition planning for the proposed transaction.",
  ].join("\n\n"),
});
assert.equal(employeeVideoParserOutput.raw.document_inventory[0]?.document_role, "stakeholder_communication");
assert.ok(employeeVideoParserOutput.raw.router_source_blocks.every((block) => block.document_role === "stakeholder_communication"));

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
  material_update_present: true,
  material_update_reason: "The filing sets a new shareholder meeting date.",
  needs_parent_context: false,
  deterministic_stage: null,
  routing_reason: "The filing provides a material shareholder meeting update.",
  selected_source_block_ids: [selectedId],
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
assert.throws(() => normalizeSec425RouterResult({ ...normalized, selected_source_block_ids: [selectedId, "missing-block"] }, shareholderParserOutput), /source_reference_invalid/);

const normalizedFaq = normalizeSec425RouterResult({
  ...normalized,
  route_case: "spac_business_combination",
  communication_mode: "faq",
}, shareholderParserOutput);
assert.equal(normalizedFaq.route_case, "stakeholder_faq_or_communication");

const normalizedMeetingUpdate = normalizeSec425RouterResult({
  ...normalized,
  event_type: "strategic_transaction",
  route_case: "shareholder_meeting_or_vote",
}, shareholderParserOutput);
assert.equal(normalizedMeetingUpdate.event_type, "shareholder_vote");

const normalizedRoutine = normalizeSec425RouterResult({
  ...normalized,
  event_type: "other",
  route_case: "routine_repetition",
  communication_mode: "social_media",
  score: 50,
  needs_analysis_llm: true,
  archive_like_candidate: false,
  material_update_present: false,
  material_update_reason: "The communication repeats transaction background without an explicit new event.",
}, shareholderParserOutput);
assert.equal(normalizedRoutine.needs_analysis_llm, false);
assert.equal(normalizedRoutine.archive_like_candidate, true);
assert.equal(normalizedRoutine.deterministic_stage, "router");
assert.equal(normalizedRoutine.score, 49);
assert.equal(normalizedRoutine.expected_delivery_level, "archive");
assert.equal(normalizedRoutine.needs_parent_context, false);

const normalizedFaqArchive = normalizeSec425RouterResult({
  ...normalized,
  route_case: "stakeholder_faq_or_communication",
  communication_mode: "faq",
  material_update_present: false,
  material_update_reason: "Employee guidance does not announce a new transaction event.",
}, shareholderParserOutput);
assert.equal(normalizedFaqArchive.needs_analysis_llm, false);
assert.equal(normalizedFaqArchive.expected_delivery_level, "archive");

const nonSpacCombinationParserOutput = parseSec425Filing({
  formType: "425",
  accessionNumber: "0000000000-26-042596",
  companyName: "Rumble Inc.",
  filingText: [
    "Rumble Inc. announced that its proposed business combination with Northern Data AG received final regulatory approval.",
    "No further regulatory approvals are required, and closing is expected in mid-June 2026.",
  ].join("\n"),
});
const nonSpacSelectedId = nonSpacCombinationParserOutput.raw.router_source_blocks[0]?.block_id;
if (!nonSpacSelectedId) throw new Error("non-SPAC fixture requires a router source block");
const normalizedNonSpacCombination = normalizeSec425RouterResult({
  ...normalized,
  display_type: "spac_transaction_status",
  route_case: "regulatory_or_closing_update",
  selected_source_block_ids: [nonSpacSelectedId],
  source_blocks_used: [nonSpacSelectedId],
}, nonSpacCombinationParserOutput);
assert.equal(normalizedNonSpacCombination.display_type, "candidate_special");

const explicitSpacParserOutput = parseSec425Filing(readFixture("spac-pipe-business-combination.json"));
const explicitSpacSelectedId = explicitSpacParserOutput.raw.router_source_blocks[0]?.block_id;
if (!explicitSpacSelectedId) throw new Error("SPAC fixture requires a router source block");
const normalizedExplicitSpac = normalizeSec425RouterResult({
  ...normalized,
  display_type: "spac_transaction_status",
  route_case: "spac_business_combination",
  selected_source_block_ids: [explicitSpacSelectedId],
  source_blocks_used: [explicitSpacSelectedId],
}, explicitSpacParserOutput);
assert.equal(normalizedExplicitSpac.display_type, "spac_transaction_status");

console.log("sec 425 router fixtures passed");

function readFixture(name: string): Sec425ParseInput {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Sec425ParseInput;
}
