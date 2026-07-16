import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SecPeriodicReportParseInput } from "./parser";
import {
  SEC_PERIODIC_REPORTS_ADAPTER_KEY,
  SEC_PERIODIC_REPORTS_ANALYSIS_MODE,
  secPeriodicReportsAdapter,
} from "./adapter";
import {
  PERIODIC_REPORT_DISPLAY_TYPES,
  PERIODIC_REPORTS_FORM_SCOPE,
  PERIODIC_REPORTS_PARSER_GROUP,
  SUPPORTED_PERIODIC_REPORT_FORMS,
} from "./types";


type Fixture = {
  filing: SecPeriodicReportParseInput;
  expected_event_type?: string;
};

const roomDir = join(process.cwd(), "lib", "sources", "sec", "forms", "periodic-reports");
const fixture = readJson<Fixture>(join(roomDir, "fixtures", "routine-10q-earnings.json"));

assert.equal(secPeriodicReportsAdapter.key, SEC_PERIODIC_REPORTS_ADAPTER_KEY, "adapter key");
assert.equal(secPeriodicReportsAdapter.key, "sec-periodic-reports", "stable adapter key");
assert.equal(secPeriodicReportsAdapter.parserGroup, PERIODIC_REPORTS_PARSER_GROUP, "parser group");
assert.equal(secPeriodicReportsAdapter.formScope, PERIODIC_REPORTS_FORM_SCOPE, "form scope");
assert.deepEqual(secPeriodicReportsAdapter.supportedForms, SUPPORTED_PERIODIC_REPORT_FORMS, "supported forms");
assert.equal(secPeriodicReportsAdapter.analysisMode, SEC_PERIODIC_REPORTS_ANALYSIS_MODE, "analysis mode");
assert.equal(secPeriodicReportsAdapter.analysisMode, "analysis_only", "stable analysis mode");
assert.deepEqual(secPeriodicReportsAdapter.displayTypes, PERIODIC_REPORT_DISPLAY_TYPES, "display types");
assert.equal(typeof secPeriodicReportsAdapter.parse, "function", "parse export");
assert.equal(typeof secPeriodicReportsAdapter.parser, "function", "parser export");
assert.equal("buildRouterPrompt" in secPeriodicReportsAdapter, false, "router prompt removed");
assert.equal(typeof secPeriodicReportsAdapter.buildAnalysisPrompt, "function", "analysis prompt export");
assert.equal(typeof secPeriodicReportsAdapter.buildDisplayPayload, "function", "display payload export");

const parserOutput = secPeriodicReportsAdapter.parse(fixture.filing);
assert.equal(parserOutput.parserGroup, PERIODIC_REPORTS_PARSER_GROUP, "adapter parser output group");
assert.equal(parserOutput.formType, "10-Q", "adapter parser output form");

const displayPayload = secPeriodicReportsAdapter.buildDisplayPayload({
  parser_output: parserOutput,
});
assert.equal(displayPayload.display_type, "generic", "display payload type");
assert.equal(displayPayload.data.version, secPeriodicReportsAdapter.displayPayloadVersion, "display payload version");

const analysisPrompt = secPeriodicReportsAdapter.buildAnalysisPrompt({
  parser_output: parserOutput,
  display_payload: displayPayload,
  filing_excerpt: fixture.filing.bodyText,
  market_context: null,
});
assert.ok(analysisPrompt.user.includes(secPeriodicReportsAdapter.displayPayloadVersion), "analysis prompt receives display payload");
assert.ok(Array.isArray(JSON.parse(analysisPrompt.user).cleaned_source_blocks), "analysis prompt receives source blocks");

console.log("sec periodic reports adapter contract passed");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
