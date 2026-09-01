import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SecPeriodicReportParseInput } from "./parser.ts";
import {
  SEC_PERIODIC_REPORTS_ADAPTER_KEY,
  SEC_PERIODIC_REPORTS_ANALYSIS_MODE,
  secPeriodicReportsAdapter,
} from "./adapter.ts";
import {
  PERIODIC_REPORT_DISPLAY_TYPES,
  PERIODIC_REPORTS_FORM_SCOPE,
  PERIODIC_REPORTS_PARSER_GROUP,
  SUPPORTED_PERIODIC_REPORT_FORMS,
} from "./types.ts";


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
  filing_excerpt: fixture.filing.bodyText,
  market_context: null,
});
const analysisPromptPayload = JSON.parse(analysisPrompt.user);
assert.ok(Array.isArray(analysisPromptPayload.cleaned_source_blocks), "analysis prompt receives source blocks");
assert.equal(analysisPromptPayload.display_payload, undefined, "analysis prompt omits display payload");
assert.equal(analysisPromptPayload.parser_output, undefined, "analysis prompt omits parser output");

assert.ok(SUPPORTED_PERIODIC_REPORT_FORMS.includes("40-F"), "40-F routes through the periodic-report worker");
assert.ok(SUPPORTED_PERIODIC_REPORT_FORMS.includes("40-F/A"), "40-F amendments route through the periodic-report worker");

const barrick40f = secPeriodicReportsAdapter.parse({
  rawItemId: "barrick-40f-0001193125-26-079253",
  sourceUniqueId: "0001193125-26-079253",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/756894/000119312526079253/0001193125-26-079253-index.htm",
  title: "Barrick Mining Corporation Form 40-F",
  bodyText: "FORM 40-F. For the fiscal year ended December 31, 2025. Principal Documents.",
  rawPayload: {
    accession_number: "0001193125-26-079253",
    company_name: "Barrick Mining Corporation",
    exchange: "NYSE",
    form_type: "40-F",
    reporting_period: "2025-12-31",
    ticker: "B",
    documents: [
      { document: "d833573d40f.htm", isPrimary: true, text: "FORM 40-F. Principal Documents.", type: "40-F" },
      { description: "EX-99.1", document: "d833573dex991.htm", type: "EX-99.1" },
      { description: "EX-99.3", document: "d833573dex993.htm", type: "EX-99.3" },
    ],
    attachment_texts: [{
      description: "EX-99.3",
      filename: "d833573dex993.htm",
      text: "AUDITED CONSOLIDATED FINANCIAL STATEMENTS. Revenue increased compared with 2024 and management discusses operating performance and liquidity.",
      type: "EX-99.3",
    }],
  },
});
assert.equal(barrick40f.isSupported, true, "real SEC 40-F form identity is supported");
assert.equal(barrick40f.formType, "40-F", "40-F identity survives parser normalization");
assert.equal(barrick40f.facts.isForeignIssuerAnnualReport, true, "40-F uses the foreign annual-report analytical frame");
assert.equal(barrick40f.facts.sourcePackage.attachmentTextCount, 1, "40-F annual materials stay in the source package");

const barrick40fa = secPeriodicReportsAdapter.parse({
  rawItemId: "barrick-40fa-contract",
  sourceUniqueId: "0001193125-26-079253-amendment",
  title: "Barrick Mining Corporation Form 40-F/A",
  bodyText: "FORM 40-F/A. EXPLANATORY NOTE. This amendment updates one exhibit and makes no other changes.",
  rawPayload: {
    accession_number: "0001193125-26-079253-amendment",
    company_name: "Barrick Mining Corporation",
    form_type: "40-F/A",
    reporting_period: "2025-12-31",
  },
});
assert.equal(barrick40fa.isSupported, true, "40-F/A is supported");
assert.equal(barrick40fa.facts.isAmendment, true, "40-F/A keeps amendment-only semantics");

console.log("sec periodic reports adapter contract passed");

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}
