import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SEC_424B5_MATERIAL_EVENTS_PROMPT_VERSION,
  SEC_424B_SECTIONED_ANALYSIS_PROMPT_VERSION,
  buildSec424bAnalysisPromptForInput,
} from "../../../../ai/sec424bAnalysisAdapter.ts";
import {
  SEC_S1_F1_ANALYSIS_PROMPT_VERSION,
  buildSecS1F1AnalysisPromptForInput,
} from "../../../../ai/secS1F1AnalysisAdapter.ts";
import { getPromptRegistry } from "../../../../promptRegistry.ts";
import type { SecFilingAnalysisInput } from "../../../../prompts/secFilingAnalysis.ts";
import {
  SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
  SEC_S3_OFFERING_ANALYSIS_PROMPT_VERSION,
  SEC_S3_MATERIAL_EVENTS_PROMPT_VERSION,
  buildSecS3OfferingAnalysisPrompt,
  secS3RequiredOutputSystemPrompt,
} from "../../../../prompts/secS3OfferingAnalysis.ts";
import { build424bAnalysisPrompt } from "../424b/analysisPrompt.ts";
import { parse424bFiling } from "../424b/parser.ts";
import { buildS1F1AnalysisPrompt } from "../s1-f1/analysisPrompt.ts";
import { parseS1F1Filing } from "../s1-f1/parser.ts";

const ATM_UNIT_PRINCIPLES = [
  "ATM is a transaction method, not a capacity unit.",
  "If the source filing states a fixed share or ADS ATM limit, express a percentage only when the source filing also states an outstanding denominator of the same security type.",
  "If the source filing states a dollar ATM limit, express a percentage only when the source filing also states a compatible dollar company-value denominator.",
  "Never convert between or mix shares, ADSs, and dollars to create an ATM ratio or percentage.",
  "When the source filing lacks a compatible denominator, do not force an ATM percentage; state the source ATM limit and clearly explain that the filing does not provide a compatible basis.",
] as const;

function assertAtmUnitPrinciples(prompt: string) {
  for (const principle of ATM_UNIT_PRINCIPLES) {
    assert.ok(prompt.includes(principle), `missing ATM unit principle: ${principle}`);
  }
}

describe("SEC first-analysis ATM unit prompts", () => {
  it("registers the shared ATM unit principles in all three runtime prompts", () => {
    const filingText = "We may sell up to 5,000,000 shares from time to time in at-the-market offerings.";
    const prompt424b = build424bAnalysisPrompt(parse424bFiling({ formType: "424B5", filingText }));
    const promptS1F1 = buildS1F1AnalysisPrompt(parseS1F1Filing({ formType: "S-1", filingText }));

    assertAtmUnitPrinciples(prompt424b);
    assertAtmUnitPrinciples(promptS1F1);
    assertAtmUnitPrinciples(secS3RequiredOutputSystemPrompt);
  });

  it("exposes the bumped first-analysis versions through the existing runtime and registry paths", () => {
    const filingText = "We may sell up to $75,000,000 from time to time in at-the-market offerings.";
    const parser424b = parse424bFiling({ formType: "424B5", filingText });
    const parserS1F1 = parseS1F1Filing({ formType: "S-1", filingText });
    const input424b = { filing_package: { hard_parsers: { "424b": parser424b } } } as unknown as SecFilingAnalysisInput;
    const inputS1F1 = { filing_package: { hard_parsers: { "s1-f1": parserS1F1 } } } as unknown as SecFilingAnalysisInput;
    const inputS3 = { filing_package: { form_type: "S-3", llm_text: filingText } } as unknown as SecFilingAnalysisInput;
    const registeredS3 = getPromptRegistry().prompts.find(
      (prompt) => prompt.key === SEC_S3_OFFERING_ANALYSIS_PROMPT_KEY,
    );

    assert.equal(SEC_424B_SECTIONED_ANALYSIS_PROMPT_VERSION, "v41-news-style-taxonomy-schema");
    assert.equal(SEC_424B5_MATERIAL_EVENTS_PROMPT_VERSION, "v42-material-events");
    assert.equal(buildSec424bAnalysisPromptForInput(input424b).version, SEC_424B5_MATERIAL_EVENTS_PROMPT_VERSION);
    assert.equal(SEC_S1_F1_ANALYSIS_PROMPT_VERSION, "v32-pending-terms-default");
    assert.equal(buildSecS1F1AnalysisPromptForInput(inputS1F1).version, SEC_S1_F1_ANALYSIS_PROMPT_VERSION);
    assert.equal(SEC_S3_OFFERING_ANALYSIS_PROMPT_VERSION, "v63-news-style-taxonomy-schema");
    assert.equal(SEC_S3_MATERIAL_EVENTS_PROMPT_VERSION, "v64-material-events");
    assert.equal(buildSecS3OfferingAnalysisPrompt(inputS3).version, SEC_S3_MATERIAL_EVENTS_PROMPT_VERSION);
    assert.equal(registeredS3?.version, SEC_S3_OFFERING_ANALYSIS_PROMPT_VERSION);
  });
});
