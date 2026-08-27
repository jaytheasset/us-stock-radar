import assert from "node:assert/strict";
import test from "node:test";

import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import { adaptSec424bAnalysisPromptResultForAnalysis } from "@/lib/ai/sec424bAnalysisAdapter";
import { adaptSec8k6kAnalysisPromptResultForAnalysis } from "@/lib/ai/sec8k6kAnalysisAdapter";
import { adaptSecS1F1AnalysisPromptResultForAnalysis } from "@/lib/ai/secS1F1AnalysisAdapter";
import { adaptSecS3AnalysisPromptResultForAnalysis } from "@/lib/ai/secS3AnalysisAdapter";

const emptyInput = { filing_package: {} } as SecFilingAnalysisInput;

test("unreadable or missing required Primary structures still fail closed for every covered family", () => {
  const results = [
    adaptSec8k6kAnalysisPromptResultForAnalysis(null, emptyInput, {}),
    adaptSecS1F1AnalysisPromptResultForAnalysis({}, emptyInput),
    adaptSecS3AnalysisPromptResultForAnalysis({}, emptyInput),
    adaptSec424bAnalysisPromptResultForAnalysis({}, emptyInput),
  ];

  for (const result of results) {
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.match(result.error, /did not contain|missing|required/i);
  }
});
