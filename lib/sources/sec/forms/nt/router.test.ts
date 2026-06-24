import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { SEC_NT_ADAPTER_KEY, SEC_NT_SUPPORTED_FORMS, secNtFormAdapter } from "./adapter";
import { parseNtFiling } from "./parser";
import { buildNtRouterPrompt, routeNtParserOutput } from "./routerPrompt";
import {
  NT_APPROVED_EVENT_TYPES,
  type NtFilingInput,
  type NtRequiredOutputJson,
} from "./types";

const CASES = [
  "routine-nt-10q",
  "accounting-delay-nt-10k",
  "material-sales-change-nt-10q",
  "foreign-issuer-nt-20f",
] as const;

test("NT router maps fixtures to approved event types", () => {
  for (const caseName of CASES) {
    const fixture = loadFixture(caseName);
    const expected = loadExpected(caseName);
    const parserOutput = parseNtFiling(fixture.source);
    const routerDecision = routeNtParserOutput(parserOutput);

    assert.ok(
      NT_APPROVED_EVENT_TYPES.includes(routerDecision.event_type),
      caseName,
    );
    assert.equal(
      routerDecision.event_type,
      expected.analysis_output.event_type,
      caseName,
    );
    assert.equal(routerDecision.display_type, expected.display_payload.display_type, caseName);
    assert.equal(routerDecision.display_version, expected.display_payload.display_version, caseName);
    assert.equal(
      routerDecision.score_band,
      scoreBandFor(expected.analysis_output.score),
      caseName,
    );
  }
});

test("routine case stops deterministically before analysis LLM", () => {
  const parserOutput = parseNtFiling(loadFixture("routine-nt-10q").source);
  const routerDecision = routeNtParserOutput(parserOutput);

  assert.equal(parserOutput.facts.deterministicClassification.router_required, false);
  assert.equal(parserOutput.facts.deterministicClassification.event_type, "other");
  assert.equal(routerDecision.event_type, "other");
  assert.equal(routerDecision.display_type, "generic");
  assert.equal(routerDecision.display_version, "nt_late_filing_v1");
  assert.equal(routerDecision.preliminary_action, "archive");
  assert.equal(routerDecision.analysis_needed, false);
  assert.equal(routerDecision.deterministic, true);
});

test("NT deterministic classifier handles source-backed non-routine cases before router fallback", () => {
  const accountingOutput = parseNtFiling(loadFixture("accounting-delay-nt-10k").source);
  const salesOutput = parseNtFiling(loadFixture("material-sales-change-nt-10q").source);

  assert.equal(accountingOutput.facts.deterministicClassification.router_required, false);
  assert.equal(accountingOutput.facts.deterministicClassification.event_type, "financial_risk");
  assert.equal(routeNtParserOutput(accountingOutput).deterministic, true);
  assert.equal(routeNtParserOutput(accountingOutput).event_type, "financial_risk");

  assert.equal(salesOutput.facts.deterministicClassification.router_required, false);
  assert.equal(salesOutput.facts.deterministicClassification.event_type, "sales_performance");
  assert.equal(routeNtParserOutput(salesOutput).deterministic, true);
  assert.equal(routeNtParserOutput(salesOutput).event_type, "sales_performance");
});

test("routine NT 10-K no-change case also stops deterministically", () => {
  const parserOutput = parseNtFiling(loadFixture("routine-nt-10k-no-change").source);
  const routerDecision = routeNtParserOutput(parserOutput);

  assert.equal(routerDecision.event_type, "other");
  assert.equal(routerDecision.preliminary_action, "archive");
  assert.equal(routerDecision.analysis_needed, false);
  assert.equal(routerDecision.deterministic, true);
});

test("transition, amendment, and restatement edge fixtures require analysis", () => {
  const transitionDecision = routeNtParserOutput(
    parseNtFiling(loadFixture("transition-nt-10q").source),
  );
  const amendmentDecision = routeNtParserOutput(
    parseNtFiling(loadFixture("amended-narrative-nt-10qa").source),
  );
  const restatementDecision = routeNtParserOutput(
    parseNtFiling(loadFixture("restatement-no-reliance-nt-10k").source),
  );

  assert.equal(transitionDecision.analysis_needed, true);
  assert.equal(transitionDecision.deterministic, false);
  assert.equal(amendmentDecision.analysis_needed, true);
  assert.equal(amendmentDecision.deterministic, false);
  assert.equal(restatementDecision.event_type, "financial_risk");
  assert.equal(restatementDecision.score_band, "75_or_above");
});

test("router prompt hard-limits event types and live calls", () => {
  const parserOutput = parseNtFiling(loadFixture("accounting-delay-nt-10k").source);
  const prompt = buildNtRouterPrompt(parserOutput);

  for (const eventType of NT_APPROVED_EVENT_TYPES) {
    assert.match(prompt, new RegExp(`\\b${eventType}\\b`));
  }

  assert.match(prompt, /Do not call live APIs/);
  assert.match(prompt, /Do not invent event types/);
  assert.match(prompt, /Use only cleaned_source_blocks supplied below/);
  assert.match(prompt, /Choose display_type and display_version/);
  assert.match(prompt, /below 50 archive, 50 to 74 feed, 75 or above alert/);
  assert.doesNotMatch(prompt, /textExcerpt/);
});

test("NT adapter exports runtime integration entrypoints", () => {
  assert.equal(secNtFormAdapter.adapterKey, SEC_NT_ADAPTER_KEY);
  assert.equal(secNtFormAdapter.parserGroup, "nt");
  assert.equal(secNtFormAdapter.analysisMode, "deterministic-first-router-fallback");
  assert.deepEqual([...secNtFormAdapter.supportedForms], [...SEC_NT_SUPPORTED_FORMS]);
  assert.ok(secNtFormAdapter.supportedForms.includes("NT 10-K/A"));
  assert.equal(secNtFormAdapter.parse, parseNtFiling);
  assert.equal(typeof secNtFormAdapter.buildRouterPrompt, "function");
  assert.equal(typeof secNtFormAdapter.routeParserOutput, "function");
  assert.equal(typeof secNtFormAdapter.buildDisplayPayload, "function");
  assert.equal(typeof secNtFormAdapter.buildAnalysisPrompt, "function");
});

interface NtFixture {
  source: NtFilingInput;
}

function scoreBandFor(score: number) {
  if (score < 50) return "below_50";
  if (score < 75) return "50_to_74";
  return "75_or_above";
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
