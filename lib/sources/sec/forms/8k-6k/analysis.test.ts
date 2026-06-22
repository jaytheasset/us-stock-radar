import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildSec8k6kAnalysisPromptDraft,
  SEC_8K_6K_ANALYSIS_PROMPT_KEY,
  SEC_8K_6K_ANALYSIS_PROMPT_VERSION,
  sec8k6kAnalysisResponseSchema,
  sec8k6kAnalysisSystemPrompt,
} from "./analysisPrompt";
import { parseSec8k6kFiling } from "./parser";
import {
  SEC_8K_6K_APPROVED_EVENT_TYPES,
  SEC_8K_6K_FORM_SCOPE,
  deriveSec8k6kDeliveryLevel,
  isSec8k6kApprovedEventType,
  type Sec8k6kParseInput,
  type Sec8k6kRoomExpectedOutput,
} from "./types";

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "8k-6k");
const fixturesDir = join(roomDir, "fixtures");
const expectedDir = join(roomDir, "expected");

const expectedNames = readdirSync(expectedDir)
  .filter((name: string) => name.endsWith(".expected.json"))
  .sort();

assert.equal(expectedNames.length, 15);

const coveredEventTypes = new Set<string>();

for (const expectedName of expectedNames) {
  const expected = readJson<Sec8k6kRoomExpectedOutput>(join(expectedDir, expectedName));
  const output = expected.analysis_output;
  const fixtureExpected = expected.fixture_expected;

  assert.equal(expected.parser_output.parserGroup, "8k-6k", expectedName);
  assert.equal(expected.parser_output.formType, SEC_8K_6K_FORM_SCOPE, expectedName);
  assert.equal(expected.parser_output.isSupported, true, expectedName);
  assertParserExpectedHasNoRoutingDecision(expected, expectedName);
  assert.equal(output.source_group, "filings", expectedName);
  assert.ok(isSec8k6kApprovedEventType(output.event_type), expectedName);
  assert.equal(deriveSec8k6kDeliveryLevel(output.score), fixtureExpected.expected_delivery_level, expectedName);
  assert.ok(["generic", "offering_terms", "spac_transaction_status", "candidate_special"].includes(expected.display_payload.display_type), expectedName);
  assert.equal(fixtureExpected.special_ui_needed, false, expectedName);
  assert.equal(Array.isArray(output.key_evidence), true, expectedName);
  assert.ok(output.key_evidence.length >= 1, expectedName);
  if (fixtureExpected.expected_delivery_level === "archive") {
    assertArchiveDisplayPayload(expected, expectedName);
  }
  coveredEventTypes.add(output.event_type);
}

for (const eventType of coveredEventTypes) {
  assert.ok(SEC_8K_6K_APPROVED_EVENT_TYPES.includes(eventType as (typeof SEC_8K_6K_APPROVED_EVENT_TYPES)[number]), eventType);
}
assert.ok(SEC_8K_6K_APPROVED_EVENT_TYPES.includes("ipo_listing"));

const fixture = readJson<Sec8k6kParseInput>(join(fixturesDir, "fda-clinical-6k.json"));
const parsed = parseSec8k6kFiling(fixture);
const prompt = buildSec8k6kAnalysisPromptDraft({
  filing_package: fixture as Record<string, unknown>,
  parser_output: parsed as unknown as Record<string, unknown>,
  filing_excerpt: fixture.bodyText || null,
  router_result: {
    event_type: "fda_clinical",
    route_case: "fda_or_clinical",
    score: 86,
    delivery_level: "alert",
    display_type: "generic",
    display_version: "sec_8k_6k_generic_v1",
  },
  market_context: null,
});
const analysisUserPayload = JSON.parse(prompt.user) as Record<string, any>;

assert.equal(prompt.key, SEC_8K_6K_ANALYSIS_PROMPT_KEY);
assert.equal(prompt.version, SEC_8K_6K_ANALYSIS_PROMPT_VERSION);
assert.equal(prompt.responseFormat.json_schema.name, "sec_8k_6k_analysis");
assert.equal(prompt.responseFormat.json_schema.strict, true);
assert.deepEqual(
  sec8k6kAnalysisResponseSchema.properties.analysis_output.properties.event_type.enum,
  SEC_8K_6K_APPROVED_EVENT_TYPES,
);
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Use exactly one approved event_type"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Base conclusions only on cleaned_source_blocks"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("parser facts, parser signals"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Do not assume missing exhibit text"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("do not treat a parser warning as negative news by itself"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("For 6-K and 6-K/A, do not expect 8-K Item numbers"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Use router_result.event_type as the analysis_output.event_type"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("router_result.score is an archive-gate score only"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Do not copy router_result.score into analysis_output.score"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("runtime may persist archive output using the router score"));
assert.equal(sec8k6kAnalysisSystemPrompt.includes("Use router_result.score as analysis_output.score"), false);
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Return that display_payload unchanged"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("ipo_listing"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Do not split traditional IPO and SPAC IPO"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("SPAC/de-SPAC transaction status"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("Routine amendment cases should stay below 50"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("do not manufacture bullish_points"));
assert.ok(sec8k6kAnalysisSystemPrompt.includes("compact archive handoff fields"));
assert.ok(prompt.user.includes("fda_clinical"));
assert.ok(prompt.user.includes("cleaned_source_blocks"));
assert.ok(prompt.user.includes("selected_source_snippets"));
assert.ok(prompt.user.includes("attachment_inventory"));
assert.equal(prompt.user.includes("\"facts\""), false);
assert.equal(prompt.user.includes("\"signals\""), false);
assert.equal(prompt.user.includes("\"classification\""), false);
assert.equal(analysisUserPayload.display_payload.display_type, "generic");
assert.equal(analysisUserPayload.display_payload.data.display_version, "sec_8k_6k_generic_v1");
assert.equal(analysisUserPayload.display_payload.data.event_type, "fda_clinical");
assert.equal(analysisUserPayload.display_payload.data.ipo_kind, null);
assert.equal(analysisUserPayload.display_payload.data.score_from_router, 86);
assert.equal(Array.isArray(analysisUserPayload.display_payload.data.attachment_inventory), true);
assert.equal(Array.isArray(analysisUserPayload.display_payload.data.selected_source_snippets), true);
assert.equal(Array.isArray(analysisUserPayload.display_payload.data.selected_tables), true);
assert.equal(prompt.user.includes("fixture_expected"), false);
assert.equal(prompt.user.includes("\"bodyText\""), false);
assert.equal(prompt.user.includes("\"rawPayload\""), false);
assert.equal(prompt.user.includes("\"attachment_texts\""), false);

const ipoPrompt = buildSec8k6kAnalysisPromptDraft({
  filing_package: fixture as Record<string, unknown>,
  parser_output: parsed as unknown as Record<string, unknown>,
  filing_excerpt: fixture.bodyText || null,
  router_result: {
    event_type: "ipo_listing",
    route_case: "ipo_listing",
    score: 72,
    display_type: "generic",
    display_version: "sec_8k_6k_generic_v1",
    ipo_kind: "spac",
  },
});
const ipoPayload = JSON.parse(ipoPrompt.user) as Record<string, any>;
assert.equal(ipoPayload.display_payload.data.event_type, "ipo_listing");
assert.equal(ipoPayload.display_payload.data.ipo_kind, "spac");

const spacStatusPrompt = buildSec8k6kAnalysisPromptDraft({
  filing_package: fixture as Record<string, unknown>,
  parser_output: parsed as unknown as Record<string, unknown>,
  filing_excerpt: fixture.bodyText || null,
  router_result: {
    event_type: "strategic_transaction",
    route_case: "strategic_transaction",
    score: 73,
    display_type: "spac_transaction_status",
    display_version: "sec_8k_6k_spac_transaction_status_v1",
    ipo_kind: null,
  },
});
const spacStatusPayload = JSON.parse(spacStatusPrompt.user) as Record<string, any>;
assert.equal(spacStatusPayload.display_payload.display_type, "spac_transaction_status");
assert.equal(spacStatusPayload.display_payload.data.display_version, "sec_8k_6k_spac_transaction_status_v1");
assert.ok(spacStatusPayload.display_payload.data.spac_transaction_status);

console.log("sec 8k-6k analysis expected-output checks passed");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function assertParserExpectedHasNoRoutingDecision(expected: Sec8k6kRoomExpectedOutput, label: string) {
  const facts = expected.parser_output.facts as unknown as Record<string, unknown>;
  assert.equal("primaryEventCandidate" in facts, false, label);
  assert.equal("eventCandidates" in facts, false, label);
  assert.equal("deterministicDecision" in facts, false, label);

  for (const signal of expected.parser_output.signals as unknown as Array<Record<string, unknown>>) {
    assert.equal("eventType" in signal, false, label);
    assert.equal("scoreHint" in signal, false, label);
    assert.equal("displayType" in signal, false, label);
  }
}

function assertArchiveDisplayPayload(expected: Sec8k6kRoomExpectedOutput, label: string) {
  const output = expected.analysis_output;
  const displayPayload = expected.display_payload;
  const data = displayPayload.data as Record<string, unknown>;
  const archiveSummary = typeof data.archive_summary === "string" ? data.archive_summary : "";

  assert.equal(displayPayload.display_type, "generic", label);
  assert.equal(output.bullish_points.length, 0, label);
  assert.equal(output.bearish_points.length, 0, label);
  assert.equal(output.what_to_watch_next.length, 0, label);
  assert.ok(archiveSummary.endsWith("Limited market impact detected. The original source is included below for reference."), label);
  assert.equal(typeof data.archive_reason, "string", label);
  assert.equal(typeof data.source_url, "string", label);
  assert.equal(Array.isArray(data.selected_source_snippets), true, label);
  assert.equal(Array.isArray(data.attachment_inventory), true, label);
}
