import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildNtAnalysisPrompt,
  validateNtRequiredOutputJson,
} from "./analysisPrompt";
import { buildNtDisplayPayload } from "./displayPayload";
import { parseNtFiling } from "./parser";
import { routeNtParserOutput } from "./routerPrompt";
import {
  NT_APPROVED_EVENT_TYPES,
  deriveNtDeliveryLevel,
  type NtFilingInput,
  type NtRequiredOutputJson,
} from "./types";

const CASES = [
  "routine-nt-10q",
  "accounting-delay-nt-10k",
  "material-sales-change-nt-10q",
  "foreign-issuer-nt-20f",
] as const;

test("expected outputs follow the required NT room JSON shape", () => {
  for (const caseName of CASES) {
    const expected = loadExpected(caseName);
    const errors = validateNtRequiredOutputJson(expected);

    assert.deepEqual(errors, [], caseName);
    assert.equal(expected.parser_output.parserGroup, "nt", caseName);
    assert.ok(
      NT_APPROVED_EVENT_TYPES.includes(expected.analysis_output.event_type),
      caseName,
    );
    assert.equal(
      expected.fixture_expected.expected_delivery_level,
      deriveNtDeliveryLevel(expected.analysis_output.score),
      caseName,
    );
  }
});

test("analysis prompt uses parser, router, and fixture market context only", () => {
  const fixture = loadFixture("material-sales-change-nt-10q");
  const parserOutput = parseNtFiling(fixture.source);
  const routerDecision = routeNtParserOutput(parserOutput);
  const displayPayload = buildNtDisplayPayload({ parserOutput, routerDecision });
  const prompt = buildNtAnalysisPrompt({
    parserOutput,
    routerDecision,
    displayPayload,
    marketContext: fixture.market_context,
  });

  assert.match(prompt, /Use only parser_output, router_decision, display_payload, and optional fixture market_context/);
  assert.match(prompt, /Do not call live APIs, FMP, SEC, databases, app\/UI code, alert delivery, or external market data/);
  assert.match(prompt, /Allowed event_type values are exactly/);
  assert.match(prompt, /Use router_decision\.event_type exactly/);
  assert.match(prompt, /Do not choose UI templates/);
  assert.match(prompt, /Treat amendments and follow-up NT filings as updates/);
  assert.match(prompt, /For transition reports, preserve transition report type/);
  assert.match(prompt, /Use accountant statements and Rule 12b-25\(c\) source text as evidence only/);
  assert.match(prompt, /"market_cap": 210000000/);
  assert.match(prompt, /"event_type": "sales_performance"/);
  assert.match(prompt, /"display_version": "nt_late_filing_v1"/);
});

test("display payload builder uses parser and router facts instead of analysis LLM fields", () => {
  const fixture = loadFixture("material-sales-change-nt-10q");
  const parserOutput = parseNtFiling(fixture.source);
  const routerDecision = routeNtParserOutput(parserOutput);
  const displayPayload = buildNtDisplayPayload({ parserOutput, routerDecision });

  assert.equal(displayPayload.display_type, routerDecision.display_type);
  assert.equal(displayPayload.display_version, "nt_late_filing_v1");
  assert.equal(displayPayload.data.selected_event_type, routerDecision.event_type);
  assert.equal(displayPayload.data.significant_change_expected, true);
  assert.match(String(displayPayload.data.significant_change_explanation), /revenue/i);
  assert.ok(displayPayload.notes.some((note) => note.includes("not analysis LLM output")));
});

test("analysis fixtures do not request unapproved display types or special UI", () => {
  for (const caseName of CASES) {
    const expected = loadExpected(caseName);

    assert.ok(
      ["generic", "offering_terms", "candidate_special"].includes(
        expected.display_payload.display_type,
      ),
      caseName,
    );
    assert.equal(expected.display_payload.display_version, "nt_late_filing_v1", caseName);
    assert.equal(expected.fixture_expected.special_ui_needed, false, caseName);
  }
});

interface NtFixture {
  source: NtFilingInput;
  market_context?: Record<string, unknown>;
}

function loadFixture(caseName: string): NtFixture {
  return loadJson<NtFixture>(`./fixtures/${caseName}.json`);
}

function loadExpected(caseName: string): NtRequiredOutputJson {
  return loadJson<NtRequiredOutputJson>(`./expected/${caseName}.expected.json`);
}

function loadJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  ) as T;
}
