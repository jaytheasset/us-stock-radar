import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildNtAnalysisPromptDraft,
  SEC_NT_ANALYSIS_PROMPT_KEY,
} from "./analysisPrompt";
import { parseNtFiling } from "./parser";
import type { NtFilingInput } from "./types";

const CASES = [
  "routine-nt-10q",
  "accounting-delay-nt-10k",
  "material-sales-change-nt-10q",
  "foreign-issuer-nt-20f",
] as const;

test("analysis prompt uses bounded original source blocks and no parser route", () => {
  const fixture = loadFixture("material-sales-change-nt-10q");
  const parserOutput = parseNtFiling(fixture.source);
  const prompt = buildNtAnalysisPromptDraft({
    input: {
      filing_package: {
        form_type: fixture.source.formType,
        company_name: fixture.source.companyName,
        ticker: fixture.source.ticker,
        market_context: fixture.market_context,
        hard_parsers: { nt: parserOutput },
      },
    },
    parserOutput,
  });
  const payload = JSON.parse(prompt.user) as Record<string, unknown>;
  const blocks = payload.cleaned_source_blocks as Array<Record<string, unknown>>;

  assert.equal(prompt.key, SEC_NT_ANALYSIS_PROMPT_KEY);
  assert.match(prompt.system, /Use current_filing and current-filing original cleaned_source_blocks/);
  assert.match(prompt.system, /10-24 for a technical amendment/);
  assert.match(prompt.system, /85-94 is reserved for explicit non-reliance\/restatement risk/);
  assert.match(prompt.system, /Neutral signal must have score below 75/);
  assert.doesNotMatch(prompt.user, /router_decision|sourceTextFlags|significantChangeExpected/);
  assert.ok(blocks.length <= 12);
  assert.ok(blocks.some((block) => block.block_type === "nt_part_iii"));
  assert.ok(blocks.every((block) => String(block.text || "").length <= 4_003));
  assert.ok(blocks.every((block) => block.block_type !== "parser_warnings"));
  const responseSchema = prompt.responseFormat.json_schema.schema;
  assert.ok(responseSchema.required.includes("nt_scoring_assessment"));
  assert.ok(responseSchema.required.includes("nt_snapshot"));
  assert.ok(responseSchema.required.includes("score_explanation"));
  assert.equal(responseSchema.properties.nt_snapshot.properties.reason_for_delay.properties.value.maxLength, 56);
  assert.equal(responseSchema.properties.nt_snapshot.properties.expected_results_impact.properties.note.maxLength, 120);
});

test("NT parser emits context-preserving analysis source blocks", () => {
  for (const caseName of CASES) {
    const parserOutput = parseNtFiling(loadFixture(caseName).source);
    const blocks = parserOutput.raw.cleanedSourceBlocks || [];
    assert.ok(blocks.length >= 3, caseName);
    assert.ok(blocks.some((block) => block.block_type === "nt_part_iii"), caseName);
  }
});

interface NtFixture {
  source: NtFilingInput;
  market_context?: Record<string, unknown>;
}

function loadFixture(caseName: string): NtFixture {
  return loadJson<NtFixture>(`./fixtures/${caseName}.json`);
}

function loadJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  ) as T;
}
