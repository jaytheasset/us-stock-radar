import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SecFilingAnalysisInput } from "@/lib/prompts/secFilingAnalysis";
import {
  adaptSecS4F4AnalysisPromptResultForAnalysis,
  buildSecS4F4AnalysisPromptForInput,
  collectS4F4RuntimeAnalysisWarnings,
  collectS4F4RuntimeDisplayPayloadWarnings,
} from "@/lib/ai/secS4F4AnalysisAdapter";

describe("S-4/F-4 Primary analysis validation", () => {
  it("keeps missing structural data as warnings instead of a repair target", () => {
    const warnings = collectS4F4RuntimeDisplayPayloadWarnings({
      display_type: "generic",
      data: { filing_summary: "", key_terms: null },
      evidence: [],
      notes: [],
    });

    assert.ok(warnings.some((warning) => /filing_summary/i.test(warning)));
    assert.ok(warnings.some((warning) => /key_terms/i.test(warning)));
  });

  it("persists remaining generic UI warnings instead of failing the analysis", () => {
    const input = buildS4F4Input();
    const result = adaptSecS4F4AnalysisPromptResultForAnalysis(buildCompleteS4F4Analysis(), input);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const displayPayload = result.analysis.display_payload as Record<string, unknown>;
    const notes = displayPayload.notes as string[];
    assert.ok(notes.some((warning) => /filing_summary/i.test(warning)));
  });

  it("bounds Key Evidence in the response schema and catches provider violations", () => {
    const prompt = buildSecS4F4AnalysisPromptForInput(buildS4F4Input());
    const schema = prompt.responseFormat.json_schema.schema as Record<string, unknown>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const analysisOutput = properties.analysis_output;
    const analysisProperties = analysisOutput.properties as Record<string, Record<string, unknown>>;
    const keyEvidenceSchema = analysisProperties.key_evidence;

    assert.equal(keyEvidenceSchema.maxItems, 3);
    assert.match(String(keyEvidenceSchema.description), /Never return more than three items/i);

    const warnings = collectS4F4RuntimeAnalysisWarnings({
      key_evidence: [
        "First source-backed fact.",
        "Second source-backed fact.",
        "Third source-backed fact.",
        "Fourth source-backed fact.",
      ],
    });
    assert.ok(warnings.some((warning) => /no more than 3 items/i.test(warning)));
  });
});

function buildS4F4Input() {
  return {
    filing_package: {
      form_type: "S-4",
      hard_parsers: {
        s4_f4: {
          parserVersion: "s4-f4-v1",
          parserGroup: "s4-f4",
          formType: "S-4",
          accessionNumber: "0001000000-26-000200",
          isSupported: true,
          summary: "Acme proposed acquisition",
          cleaned_source_blocks: [
            {
              block_type: "primary_source_section",
              title: "Transaction summary",
              source: "primary filing",
              text: "Acme entered into a merger agreement to acquire Target Co. and will register common shares as consideration.",
            },
            {
              block_type: "primary_source_section",
              title: "Consideration",
              source: "primary filing",
              text: "Target shareholders will receive 0.50 Acme common shares for each Target share, subject to closing conditions.",
            },
          ],
          facts: {},
          signals: [],
          calendarItems: [],
          warnings: [],
          raw: {},
        },
      },
    },
  } as unknown as SecFilingAnalysisInput;
}

function buildCompleteS4F4Analysis(): Record<string, unknown> {
  return {
    analysis_output: {
      source_group: "filings",
      market_scope: "company",
      event_type: "strategic_transaction",
      event_title: "Acme files S-4 for proposed acquisition",
      primary_ticker: { ticker: "ACME", exchange: "NYSE" },
      tickers: [],
      sector: null,
      industry_group: null,
      theme_group: null,
      sub_theme: null,
      score: 68,
      score_reason: "The filing advances a pending acquisition without confirming closing.",
      signal: "volatile",
      quick_take: "Acme registered shares for its proposed acquisition of Target Co.",
      summary: "Acme plans to issue shares as merger consideration, subject to shareholder approval and closing conditions.",
      why_it_matters: "The exchange ratio and closing conditions determine the value and timing for shareholders.",
      bullish_points: [],
      bearish_points: [],
      key_evidence: [],
      what_to_watch_next: [],
      related_tickers: [],
      calendar_items: [],
      confidence: "medium",
      needs_human_review: false,
    },
    display_payload: {
      display_type: "generic",
      data: {
        display_version: "s4_f4_generic_v1",
        filing_summary: "",
        key_terms: [],
      },
      evidence: [],
      notes: [],
    },
  };
}
