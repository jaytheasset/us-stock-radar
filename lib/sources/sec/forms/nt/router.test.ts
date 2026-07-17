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

test("routine case still continues to the analysis LLM", () => {
  const parserOutput = parseNtFiling(loadFixture("routine-nt-10q").source);
  const routerDecision = routeNtParserOutput(parserOutput);

  assert.equal(routerDecision.event_type, "other");
  assert.equal(routerDecision.display_type, "generic");
  assert.equal(routerDecision.display_version, "nt_late_filing_v1");
  assert.equal(routerDecision.preliminary_action, "archive");
  assert.equal(routerDecision.analysis_needed, true);
  assert.equal(routerDecision.deterministic, false);
});

test("NT route candidates never bypass analysis", () => {
  const accountingOutput = parseNtFiling(loadFixture("accounting-delay-nt-10k").source);
  const salesOutput = parseNtFiling(loadFixture("material-sales-change-nt-10q").source);

  const accountingDecision = routeNtParserOutput(accountingOutput);
  assert.equal(accountingDecision.deterministic, false);
  assert.equal(accountingDecision.analysis_needed, true);
  assert.equal(accountingDecision.event_type, "financial_risk");

  const salesDecision = routeNtParserOutput(salesOutput);
  assert.equal(salesDecision.deterministic, false);
  assert.equal(salesDecision.analysis_needed, true);
  assert.equal(salesDecision.event_type, "sales_performance");
});

test("routine NT 10-K no-change case also continues to analysis", () => {
  const parserOutput = parseNtFiling(loadFixture("routine-nt-10k-no-change").source);
  const routerDecision = routeNtParserOutput(parserOutput);

  assert.equal(routerDecision.event_type, "other");
  assert.equal(routerDecision.preliminary_action, "archive");
  assert.equal(routerDecision.analysis_needed, true);
  assert.equal(routerDecision.deterministic, false);
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
  assert.match(prompt, /Every supported NT filing must continue to the analysis LLM/);
  assert.match(prompt, /Always return analysis_needed true and deterministic false/);
  assert.match(prompt, /Choose display_type and display_version/);
  assert.match(prompt, /below 50 archive, 50 to 74 feed, 75 or above alert/);
  assert.doesNotMatch(prompt, /textExcerpt/);
});

test("NT adapter exports runtime integration entrypoints", () => {
  assert.equal(secNtFormAdapter.adapterKey, SEC_NT_ADAPTER_KEY);
  assert.equal(secNtFormAdapter.parserGroup, "nt");
  assert.equal(secNtFormAdapter.analysisMode, "router_then_analysis");
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
