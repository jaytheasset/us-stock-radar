import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildS8AnalysisPrompt,
  buildS8CompactAnalysisInput,
  validateS8RequiredFixtureOutput,
} from "./analysisPrompt.ts";
import { parseS8Filing } from "./parser.ts";
import { routeS8Filing } from "./routerPrompt.ts";
import { S8_APPROVED_EVENT_TYPES, S8_UI_MODES, scoreToS8DeliveryLevel } from "./types.ts";
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

test("expected analysis JSON follows required S-8 output shape", () => {
  for (const name of fixtureNames) {
    const expected = readExpected(name);

    assert.deepEqual(validateS8RequiredFixtureOutput(expected), [], name);
    assert.equal(expected.parser_output.parserGroup, "s8", name);
    assert.equal(expected.analysis_output.source_group, "filings", name);
    assert.equal(S8_APPROVED_EVENT_TYPES.includes(expected.analysis_output.event_type), true, name);
    assert.equal(
      scoreToS8DeliveryLevel(expected.analysis_output.score),
      expected.fixture_expected.expected_delivery_level,
      name,
    );
    assert.equal(
      S8_UI_MODES.includes(expected.display_payload.data.s8_ui_mode as (typeof S8_UI_MODES)[number]),
      true,
      name,
    );
    assert.doesNotMatch(
      JSON.stringify({
        analysis_output: expected.analysis_output,
        display_payload: expected.display_payload,
      }),
      /route_action|s8_bucket|analysis_reason|score_hint|send_to_analysis|finalize_archive/,
      name,
    );
  }
});

test("analysis prompt uses source blocks instead of parser classification authority", () => {
  const expected = readExpected("s8a-additional-shares-parent-context");
  const routerDecision = routeS8Filing(expected.parser_output);
  const prompt = buildS8AnalysisPrompt({
    parserOutput: expected.parser_output,
    routerDecision,
    marketContext: expected.parser_output.raw.marketContext,
  });

  assert.match(prompt, /Cleaned source blocks:/);
  assert.match(prompt, /Choose analysis_output\.event_type by reading cleaned_source_blocks/);
  assert.match(prompt, /Approved event types: listing_risk, ipo_listing, dilution_risk, earnings/);
  assert.match(prompt, /below 50 archive, 50 to 74 feed, 75 or above alert/);
  assert.match(prompt, /Output score only\. Do not output or choose delivery_level independently from score/);
  assert.match(prompt, /Do not call live market APIs/);
  assert.match(prompt, /Do not query live DB or require filing_context/);
  assert.match(prompt, /display_payload\.display_type must be one of generic, offering_terms, or candidate_special/);
  assert.match(prompt, /display_payload\.data\.s8_ui_mode must be one of plan_registration/);
  assert.doesNotMatch(prompt, /Use selected_classification\.event_type as analysis_output\.event_type/);
  assert.doesNotMatch(prompt, /Use selected_display_payload as the display_payload/);
  assert.doesNotMatch(prompt, /Parser routing context \(deterministic, not Router LLM\):/);
  assert.doesNotMatch(prompt, /"route_action"\s*:/);
  assert.doesNotMatch(prompt, /"s8_bucket"\s*:/);
  assert.doesNotMatch(prompt, /"score_hint"\s*:/);
});

test("dilution analysis prompt keeps scoring rules but reads only source blocks", () => {
  const expected = readExpected("large-dilution-market-context");
  const routerDecision = routeS8Filing(expected.parser_output);
  const prompt = buildS8AnalysisPrompt({
    parserOutput: expected.parser_output,
    routerDecision,
    marketContext: expected.parser_output.raw.marketContext,
  });

  assert.match(prompt, /final investor-facing analysis/);
  assert.match(prompt, /registered shares, additional shares, assumed award shares/);
  assert.match(prompt, /Do not use registered shares as shares outstanding/);
  assert.match(prompt, /Do not treat Exhibit 107 fee-table amount as company proceeds/);
  assert.match(prompt, /Do not copy parser-generated facts, signals, classification/);
  assert.match(prompt, /Use 75\+ rarely for S-8/);
  assert.match(prompt, /Cleaned source blocks:/);
  assert.doesNotMatch(prompt, /Parser routing context/);
});

test("compact analysis input is now only cleaned source blocks", () => {
  const parsed = parseS8Filing(readFixture("douglas-elliman-evergreen-s8"));
  const routerDecision = routeS8Filing(parsed);
  const compactInput = buildS8CompactAnalysisInput({
    parserOutput: parsed,
    routerDecision,
    marketContext: parsed.raw.marketContext,
  });
  const serialized = JSON.stringify(compactInput);

  assert.equal(Array.isArray(compactInput.cleaned_source_blocks), true);
  assert.equal(compactInput.cleaned_source_blocks.length > 0, true);
  assert.equal(Object.hasOwn(compactInput, "facts"), false);
  assert.equal(Object.hasOwn(compactInput, "signals"), false);
  assert.equal(Object.hasOwn(compactInput, "selected_classification"), false);
  assert.equal(Object.hasOwn(compactInput, "selected_display_payload"), false);
  assert.equal(Object.hasOwn(compactInput, "routing_context"), false);
  assert.doesNotMatch(serialized, /<ix:|<html|<table/i);

  const sourceKeys = collectKeys(compactInput);
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
    assert.equal(sourceKeys.has(key), false, `compact source block input must not expose ${key}`);
  }
});

test("administrative S-8 cases still hand off to analysis without parser archive output", () => {
  const admin = parseS8Filing(readFixture("s8-pos-deregistration-only"));
  const decision = routeS8Filing(admin);
  const prompt = buildS8AnalysisPrompt({
    parserOutput: admin,
    routerDecision: decision,
    marketContext: admin.raw.marketContext,
  });

  assert.equal(decision.route_action, "send_to_analysis");
  assert.equal(decision.final_output, undefined);
  assert.match(prompt, /Do not rely on parser-finalized archive output/);
  assert.doesNotMatch(JSON.stringify(admin), /routingHints|routeAction|scoreHint|finalize_archive/);
});

test("source block input preserves inventory, warnings, and site context without raw attachment text", () => {
  const parsed = parseS8Filing(readFixture("routine-small-plan"));
  parsed.raw.attachments = [
    {
      documentType: "EX-99.1",
      description: "Image-only plan appendix",
      text: null,
    },
  ];
  parsed.warnings.push("Attachment listed without parser text: EX-99.1 image-only plan appendix.");
  parsed.raw.marketContext = { price: 1.25, market_cap: 125000000 };

  const input = buildS8CompactAnalysisInput({
    parserOutput: parsed,
    routerDecision: routeS8Filing(parsed),
    marketContext: parsed.raw.marketContext,
  });

  assert.equal(input.cleaned_source_blocks.some((block) => block.block_type === "document_inventory"), true);
  assert.equal(input.cleaned_source_blocks.some((block) => block.block_type === "attachment_inventory"), true);
  assert.equal(input.cleaned_source_blocks.some((block) => block.block_type === "parser_warnings"), true);
  assert.equal(input.cleaned_source_blocks.some((block) => block.block_type === "site_market_context"), true);
  assert.doesNotMatch(JSON.stringify(input), /"text":\s*null/);
});

test("analysis validation rejects unsupported signal labels", () => {
  const expected = readExpected("large-dilution-market-context");
  const invalid = structuredClone(expected);

  invalid.analysis_output.signal = "caution" as S8RequiredFixtureOutput["analysis_output"]["signal"];

  assert.deepEqual(validateS8RequiredFixtureOutput(invalid), [
    "analysis_output.signal is not approved: caution.",
  ]);
});

test("analysis validation rejects filing_context in required fixture output", () => {
  const expected = readExpected("routine-small-plan");
  const invalid = structuredClone(expected) as S8RequiredFixtureOutput & Record<string, unknown>;

  invalid.filing_context = {
    ownership: {
      same_insider_12m_trades: [],
      company_90d_insider_flow: null,
      recent_30d_cluster: null,
    },
    context_as_of: null,
    source_notes: [],
  };

  assert.deepEqual(validateS8RequiredFixtureOutput(invalid), [
    "filing_context must not be part of required fixture output.",
  ]);
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

function readExpected(name: string): S8RequiredFixtureOutput {
  return readJson(join("expected", `${name}.expected.json`));
}

function readFixture(name: string): S8FixtureInput {
  return readJson(join("fixtures", `${name}.json`));
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(roomDir, relativePath), "utf8")) as T;
}
