import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { GeminiStructuredJsonRun } from "./geminiStructuredJson.ts";
import { runListingRiskDomainAnalyzerPreview } from "./listingRiskDomainAnalyzerPreview.ts";
import { adaptNewsListingRiskSource, adaptSec8k6kListingRiskSource } from "../monitor/listingRiskSourceAdapters.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("non-persisting preview returns standalone not_applicable with no Gemini response schema", async () => {
  const requests: Array<{ model: string; responseSchema?: Record<string, unknown> }> = [];
  const result = await runListingRiskDomainAnalyzerPreview(input(), {
    apiKey: "test-key",
    model: "configured-model",
    runPrompt: async (value) => {
      requests.push(value);
      return providerRun({
        status: "not_applicable",
        core_facts: [],
        agent_context: { fact_provenance: [], as_of: { availability: "unavailable" }, confidence: "unknown", sources: [] },
      });
    },
  });
  assert.equal(result.stage, "complete");
  assert.deepEqual(result.result, { status: "not_applicable" });
  assert.equal(requests[0]?.model, "configured-model");
  assert.equal(requests[0]?.responseSchema, undefined);
});

test("preview keeps invalid provider output separate from not_applicable", async () => {
  const result = await runListingRiskDomainAnalyzerPreview(input(), {
    apiKey: "test-key",
    runPrompt: async () => providerRun({
      status: "not_applicable",
      core_facts: [{}],
      agent_context: { fact_provenance: [], as_of: { availability: "unavailable" }, confidence: "unknown", sources: [] },
    }),
  });
  assert.equal(result.stage, "validation_error");
  assert.equal(result.result, null);
  assert.ok(result.validation_errors?.length);
});

test("preview keeps provider failure separate from semantic results", async () => {
  const failedRun = run(null, { responseOk: false, ok: false, error: "provider unavailable" });
  const result = await runListingRiskDomainAnalyzerPreview(input(), {
    apiKey: "test-key",
    runPrompt: async () => failedRun,
  });
  assert.equal(result.stage, "provider_error");
  assert.equal(result.result, null);
  assert.equal(result.error, "provider unavailable");
});

test("SEC Listing uses the same one provider call and returns an independent O/S sidecar without changing Listing output", async () => {
  const evidence = "As of August 18, 2026, 27,500,000 shares of common stock were outstanding.";
  const secInput = adaptSec8k6kListingRiskSource({
    accession_number: "0000000099-26-000010",
    source_url: "https://www.sec.gov/Archives/edgar/data/99/fixture.htm",
    filed_at: "2026-08-18T12:00:00Z",
    title: "Current report",
    cleaned_source_blocks: [{ block_id: "sec-cover", source_ref: "fixture.htm", text: evidence }],
  });
  let calls = 0;
  const result = await runListingRiskDomainAnalyzerPreview(secInput, {
    apiKey: "test-key",
    runPrompt: async () => {
      calls += 1;
      return providerRun({
        status: "not_applicable",
        core_facts: [],
        agent_context: { fact_provenance: [], as_of: { availability: "unavailable" }, confidence: "unknown", sources: [] },
        share_count_observation: {
          observation_type: "source_stated",
          shares_outstanding: "27500000",
          as_of: "2026-08-18",
          security_class_title: "common stock",
          source_ref: "sec-cover",
          evidence,
        },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.stage, "complete");
  assert.deepEqual(result.result, { status: "not_applicable" });
  assert.equal(result.stage === "complete" ? result.shareCountObservation?.sharesOutstanding : null, "27500000");
});

test("preview module has no persistence, enqueue, fan-out, or worker integration", () => {
  const source = readFileSync(join(here, "listingRiskDomainAnalyzerPreview.ts"), "utf8");
  assert.doesNotMatch(source, /supabase|ai_runs|ai_outputs|enqueue|workflow|worker|monitor_routes/i);
});

function input() {
  return adaptNewsListingRiskSource({
    source_unique_id: "preview-news",
    source_url: "https://example.com/preview-news",
    published_at: "2026-05-01",
    title: "Preview source",
    body_text: "Company announces a corporate action with no listing action.",
  });
}

function providerRun(transport: Record<string, unknown>) {
  return run(transport);
}

function run(
  parsed: Record<string, unknown> | null,
  overrides: Partial<GeminiStructuredJsonRun> = {},
): GeminiStructuredJsonRun {
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
