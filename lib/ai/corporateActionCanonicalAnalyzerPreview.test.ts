import assert from "node:assert/strict";
import test from "node:test";
import type { GeminiStructuredJsonRun } from "./geminiStructuredJson.ts";
import { runCorporateActionCanonicalAnalyzerPreview } from "./corporateActionCanonicalAnalyzerPreview.ts";
import { adaptNasdaqCorporateActionSource } from "../monitor/corporateActionSourceAdapters.ts";
import { CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA } from "../prompts/corporateActionCanonicalAnalysis.ts";

const input = adaptNasdaqCorporateActionSource({
  source_unique_id: "ECA-provider-test",
  source_url: "https://example.com/provider-test",
  published_at: "2026-08-01",
  title: "Official notice",
  body_text: "A one-for-ten reverse split will become effective on August 8, 2026.",
});

test("analyzer makes one bounded provider call with a small plain response schema and no repair", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const result = await runCorporateActionCanonicalAnalyzerPreview(input, {
    apiKey: "test-key",
    model: "configured-model",
    runPrompt: async (request) => {
      requests.push(request);
      return run({
        applicable: true,
        event_kind: "reverse_split",
        action_stage: "scheduled",
        effective_date: { availability: "available", value: "2026-08-08" },
        ratio: { availability: "available", old_shares: "10", new_shares: "1" },
        source_ref: "nasdaq_notice_body",
        evidence: "A one-for-ten reverse split will become effective on August 8, 2026.",
        confidence: "high",
        as_of: { availability: "available", value: "2026-08-08" },
      });
    },
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.responseSchema, CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA);
  assert.equal(JSON.stringify(CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA).length < 2_500, true);
  assert.equal(requests[0]?.maxOutputTokens, 1_200);
  assert.equal(result.stage, "complete");
  assert.equal(result.repair, null);
});

test("provider, invalid output, and semantic not-applicable remain separate", async () => {
  const providerFailure = await runCorporateActionCanonicalAnalyzerPreview(input, {
    apiKey: "test-key",
    runPrompt: async () => run(null, { responseOk: false, ok: false, error: "provider unavailable" }),
  });
  assert.equal(providerFailure.stage, "provider_error");

  const invalid = await runCorporateActionCanonicalAnalyzerPreview(input, {
    apiKey: "test-key",
    runPrompt: async () => run({ applicable: true, event_kind: "reverse_split" }),
  });
  assert.equal(invalid.stage, "validation_error");

  const negative = await runCorporateActionCanonicalAnalyzerPreview(input, {
    apiKey: "test-key",
    runPrompt: async () => run({ applicable: false }),
  });
  assert.equal(negative.stage, "complete");
  assert.deepEqual(negative.result, { applicable: false });
});

function run(parsed: Record<string, unknown> | null, overrides: Partial<GeminiStructuredJsonRun> = {}): GeminiStructuredJsonRun {
  return {
    ok: true,
    responseOk: true,
    status: 200,
    statusText: "OK",
    model: "configured-model",
    responseId: "response-id",
    outputText: parsed ? JSON.stringify(parsed) : "",
    parsed,
    usage: null,
    body: null,
    ...overrides,
  };
}
