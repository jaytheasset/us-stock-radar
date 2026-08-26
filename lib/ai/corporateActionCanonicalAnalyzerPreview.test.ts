import assert from "node:assert/strict";
import test from "node:test";
import type { GeminiStructuredJsonRun } from "./geminiStructuredJson.ts";
import { runCorporateActionCanonicalAnalyzerPreview } from "./corporateActionCanonicalAnalyzerPreview.ts";
import { adaptNasdaqCorporateActionSource, adaptSec8k6kCorporateActionSource } from "../monitor/corporateActionSourceAdapters.ts";
import {
  buildCorporateActionCanonicalResponseSchema,
  CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA,
} from "../prompts/corporateActionCanonicalAnalysis.ts";

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
        effective_date: {
          availability: "available", value: "2026-08-08", source_ref: "nasdaq_notice_body",
          evidence: "will become effective on August 8, 2026",
        },
        ratio: {
          availability: "available", old_shares: "10", new_shares: "1",
          source_ref: "nasdaq_notice_body", evidence: "one-for-ten reverse split",
        },
        affected_security: {
          availability: "unavailable",
          reason: "issuer_identity_unavailable",
          source_ref: null,
          evidence: null,
        },
        effective_timing: { availability: "unavailable", reason: "date_only" },
        execution_update: {
          decision: "NEW_EXECUTION",
          target_execution_id: null,
          source_ref: "nasdaq_notice_body",
          evidence: "A one-for-ten reverse split will become effective on August 8, 2026.",
        },
        source_ref: "nasdaq_notice_body",
        evidence: "A one-for-ten reverse split will become effective on August 8, 2026.",
        confidence: "high",
        as_of: { availability: "available", value: "2026-08-08" },
      });
    },
  });
  assert.equal(requests.length, 1);
  const expectedSchema = buildCorporateActionCanonicalResponseSchema(input);
  assert.deepEqual(requests[0]?.responseSchema, expectedSchema);
  assert.deepEqual(
    ((expectedSchema.anyOf as Array<{ properties: Record<string, { enum?: string[] }> }>)[1]
      .properties.source_ref.enum),
    ["nasdaq_notice_body"],
  );
  assert.equal(JSON.stringify(CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA).includes("maxLength"), false);
  assert.equal(JSON.stringify(CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA).length < 6_000, true);
  assert.equal(requests[0]?.maxOutputTokens, 2_400);
  assert.equal(result.stage, "complete");
  assert.equal(result.repair, null);
  assert.equal(result.stage === "complete" ? result.result.applicable : false, true);
  if (result.stage === "complete" && result.result.applicable) {
    assert.equal(result.result.facts.applicability?.affected_security.availability, "unavailable");
    const exact = result.result.facts.ratio.exact_source_components;
    assert.equal(exact?.availability, "available");
    assert.equal(exact?.availability === "available" ? exact.old_share_units : null, "10");
    assert.equal(exact?.availability === "available" ? exact.new_share_units : null, "1");
  }
});

test("forward split uses the same single provider call with no verifier or repair call", async () => {
  const forwardInput = adaptNasdaqCorporateActionSource({
    source_unique_id: "ECA-forward-provider-test",
    source_url: "https://example.com/forward-provider-test",
    published_at: "2026-08-01",
    title: "Official notice",
    body_text: "A 4-for-1 forward stock split will become effective on August 8, 2026.",
  });
  let calls = 0;
  const result = await runCorporateActionCanonicalAnalyzerPreview(forwardInput, {
    apiKey: "test-key",
    runPrompt: async () => {
      calls += 1;
      return run({
        applicable: true,
        event_kind: "forward_split",
        action_stage: "scheduled",
        effective_date: {
          availability: "available", value: "2026-08-08", source_ref: "nasdaq_notice_body",
          evidence: "will become effective on August 8, 2026",
        },
        ratio: {
          availability: "available", old_shares: "1", new_shares: "4",
          source_ref: "nasdaq_notice_body", evidence: "4-for-1 forward stock split",
        },
        affected_security: {
          availability: "unavailable",
          reason: "issuer_identity_unavailable",
          source_ref: null,
          evidence: null,
        },
        effective_timing: { availability: "unavailable", reason: "date_only" },
        execution_update: {
          decision: "NEW_EXECUTION",
          target_execution_id: null,
          source_ref: "nasdaq_notice_body",
          evidence: "A 4-for-1 forward stock split will become effective on August 8, 2026.",
        },
        source_ref: "nasdaq_notice_body",
        evidence: "A 4-for-1 forward stock split will become effective on August 8, 2026.",
        confidence: "high",
        as_of: { availability: "available", value: "2026-08-08" },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.stage, "complete");
  assert.equal(result.stage === "complete" ? result.repair : undefined, null);
  if (result.stage === "complete" && result.result.applicable) {
    assert.equal(result.result.facts.event_kind, "forward_split");
    const exact = result.result.facts.ratio.exact_source_components;
    assert.equal(exact?.availability, "available");
    assert.equal(exact?.availability === "available" ? exact.old_share_units : null, "1");
    assert.equal(exact?.availability === "available" ? exact.new_share_units : null, "4");
  }
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

test("timing transport keeps one call, preserves bounded failure detail, and normalizes optional non-exact timestamps", async () => {
  let nonExactCalls = 0;
  const nonExact = await runCorporateActionCanonicalAnalyzerPreview(input, {
    apiKey: "test-key",
    runPrompt: async () => {
      nonExactCalls += 1;
      return run(applicablePayload({
        availability: "available",
        kind: "date_only",
        timestamp: "2026-08-08T00:00:00Z",
        source_ref: "nasdaq_notice_body",
        evidence: "will become effective on August 8, 2026",
      }));
    },
  });
  assert.equal(nonExactCalls, 1);
  assert.equal(nonExact.stage, "complete");
  if (nonExact.stage === "complete" && nonExact.result.applicable
    && nonExact.result.facts.effective_timing?.availability === "available") {
    assert.equal(nonExact.result.facts.effective_timing.timestamp, null);
    assert.deepEqual(nonExact.result.facts.effective_timing.timestamp_diagnostic, {
      reason: "non_exact_timestamp_normalized_to_null",
      raw_timestamp: "2026-08-08T00:00:00Z",
      raw_timestamp_truncated: false,
    });
  }

  let exactCalls = 0;
  const malformedExact = await runCorporateActionCanonicalAnalyzerPreview(input, {
    apiKey: "test-key",
    runPrompt: async () => {
      exactCalls += 1;
      return run(applicablePayload({
        availability: "available",
        kind: "exact_timestamp",
        timestamp: "12:07 P.M.",
        source_ref: "nasdaq_notice_body",
        evidence: "will become effective on August 8, 2026",
      }));
    },
  });
  assert.equal(exactCalls, 1);
  assert.equal(malformedExact.stage, "validation_error");
  if (malformedExact.stage === "validation_error") {
    assert.deepEqual(malformedExact.timing_diagnostic, {
      timing_kind: "exact_timestamp",
      raw_timestamp: "12:07 P.M.",
      raw_timestamp_truncated: false,
      effective_date: "2026-08-08",
      validation_reason: "result.effective_timing.kind is invalid",
    });
    assert.match(malformedExact.error, /effective_timing_diagnostic=/);
    assert.doesNotMatch(malformedExact.error, /A one-for-ten reverse split.*A one-for-ten reverse split/);
  }
});

test("SEC Corporate Action uses the same one provider call and returns O/S without changing Corporate Action output", async () => {
  const evidence = "As of August 18, 2026, 27,500,000 shares of common stock were outstanding.";
  const secInput = adaptSec8k6kCorporateActionSource({
    accession_number: "0000000099-26-000010",
    source_url: "https://www.sec.gov/Archives/edgar/data/99/fixture.htm",
    filed_at: "2026-08-18T12:00:00Z",
    title: "Current report",
    cleaned_source_blocks: [{ block_id: "sec-cover", source_ref: "fixture.htm", text: evidence }],
  });
  let calls = 0;
  const result = await runCorporateActionCanonicalAnalyzerPreview(secInput, {
    apiKey: "test-key",
    runPrompt: async () => {
      calls += 1;
      return run({
        applicable: false,
        share_count_observation: {
          observation_type: "source_stated",
          shares_outstanding: "27500000",
          as_of: "2026-08-18",
          security_class_kind: "common_stock",
          security_class_title: "common stock",
          source_ref: "sec-cover",
          evidence,
        },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.stage, "complete");
  assert.deepEqual(result.result, { applicable: false });
  assert.equal(result.stage === "complete" ? result.shareCountObservation?.sharesOutstanding : null, "27500000");
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

function applicablePayload(effectiveTiming: Record<string, unknown>) {
  return {
    applicable: true,
    event_kind: "reverse_split",
    action_stage: "scheduled",
    effective_date: {
      availability: "available", value: "2026-08-08", source_ref: "nasdaq_notice_body",
      evidence: "will become effective on August 8, 2026",
    },
    ratio: {
      availability: "available", old_shares: "10", new_shares: "1",
      source_ref: "nasdaq_notice_body", evidence: "one-for-ten reverse split",
    },
    affected_security: {
      availability: "unavailable",
      reason: "issuer_identity_unavailable",
      source_ref: null,
      evidence: null,
    },
    effective_timing: effectiveTiming,
    execution_update: {
      decision: "NEW_EXECUTION",
      target_execution_id: null,
      source_ref: "nasdaq_notice_body",
      evidence: "A one-for-ten reverse split will become effective on August 8, 2026.",
    },
    source_ref: "nasdaq_notice_body",
    evidence: "A one-for-ten reverse split will become effective on August 8, 2026.",
    confidence: "high",
    as_of: { availability: "available", value: "2026-08-08" },
  };
}
