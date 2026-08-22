import assert from "node:assert/strict";
import test from "node:test";
import type { GeminiStructuredJsonRun } from "./geminiStructuredJson.ts";
import { runCorporateActionCanonicalAnalyzerPreview } from "./corporateActionCanonicalAnalyzerPreview.ts";
import { adaptNasdaqCorporateActionSource, adaptSec8k6kCorporateActionSource } from "../monitor/corporateActionSourceAdapters.ts";
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
        affected_security: {
          availability: "unavailable",
          reason: "issuer_identity_unavailable",
          source_ref: null,
          evidence: null,
        },
        effective_timing: { availability: "unavailable", reason: "date_only" },
        source_ref: "nasdaq_notice_body",
        evidence: "A one-for-ten reverse split will become effective on August 8, 2026.",
        confidence: "high",
        as_of: { availability: "available", value: "2026-08-08" },
      });
    },
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0]?.responseSchema, CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA);
  assert.equal(JSON.stringify(CORPORATE_ACTION_CANONICAL_RESPONSE_SCHEMA).length < 5_000, true);
  assert.equal(requests[0]?.maxOutputTokens, 1_200);
  assert.equal(result.stage, "complete");
  assert.equal(result.repair, null);
  assert.equal(result.stage === "complete" ? result.result.applicable : false, true);
  if (result.stage === "complete" && result.result.applicable) {
    assert.equal(result.result.facts.applicability?.affected_security.availability, "unavailable");
    assert.deepEqual(result.result.facts.ratio.exact_source_components, {
      availability: "available", old_share_units: "10", new_share_units: "1",
    });
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

test("SEC action identity decision remains inside the same single provider call", async () => {
  const eventId = "10000000-0000-4000-8000-000000000001";
  const cik = "0001234567";
  const source = "The company will effect a 1-for-10 reverse stock split of its common stock on August 25, 2026.";
  const secInput = adaptSec8k6kCorporateActionSource({
    accession_number: "0001234567-26-000010",
    source_url: "https://www.sec.gov/Archives/edgar/data/1234567/fixture.htm",
    filed_at: "2026-08-18T12:00:00Z",
    title: "Current report",
    cleaned_source_blocks: [{ block_id: "sec-cover", source_ref: "fixture.htm", text: source }],
    issuer_context: {
      availability: "available",
      issuer_cik: cik,
      accession_number: "0001234567-26-000010",
      accepted_at: "2026-08-18T12:00:00Z",
      provenance: "sec_filing_ledger",
    },
    security_class_candidates: [{
      canonical_security_class_id: `sc:v1:${cik}:common_stock:single`,
      security_type: "common_stock",
      security_class_basis: "SINGLE_COMMON_STOCK_CLASS",
      source_member_local_name: null,
      supporting_accessions: ["0001234567-26-000009"],
    }],
    origin_event_id: eventId,
    reverse_split_action_candidates: [],
  });
  let calls = 0;
  const result = await runCorporateActionCanonicalAnalyzerPreview(secInput, {
    apiKey: "test-key",
    runPrompt: async () => {
      calls += 1;
      return run({
        applicable: true,
        event_kind: "reverse_split",
        action_stage: "scheduled",
        effective_date: { availability: "available", value: "2026-08-25" },
        ratio: { availability: "available", old_shares: "10", new_shares: "1" },
        affected_security: {
          availability: "available",
          canonical_security_class_id: `sc:v1:${cik}:common_stock:single`,
          security_type: "common_stock",
          source_security_title: "common stock",
          source_ref: "sec-cover",
          evidence: "reverse stock split of its common stock",
        },
        effective_timing: { availability: "unavailable", reason: "date_only" },
        action_link: {
          decision: "NEW_ACTION",
          existing_action_id: null,
          source_ref: "sec-cover",
          evidence: source,
          unresolved_reason: null,
        },
        source_ref: "sec-cover",
        evidence: source,
        confidence: "high",
        as_of: { availability: "available", value: "2026-08-25" },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.stage, "complete");
  assert.equal(result.stage === "complete" && result.result.applicable
    ? result.result.facts.action_identity?.reverse_split_action_id : null,
  `rsa:v1:${cik}:${eventId}`);
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
