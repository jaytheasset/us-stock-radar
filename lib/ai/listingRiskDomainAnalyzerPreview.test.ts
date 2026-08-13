import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { GeminiStructuredJsonRun } from "./geminiStructuredJson.ts";
import { runListingRiskDomainAnalyzerPreview } from "./listingRiskDomainAnalyzerPreview.ts";
import { LISTING_RISK_ANALYZER_PROVIDER_SCHEMA } from "../monitor/listingRiskAnalyzer.ts";
import { adaptNewsListingRiskSource } from "../monitor/listingRiskSourceAdapters.ts";

const here = dirname(fileURLToPath(import.meta.url));

test("non-persisting preview returns standalone not_applicable and sends the direct schema", async () => {
  const requests: Array<{ model: string; responseSchema?: Record<string, unknown> }> = [];
  const result = await runListingRiskDomainAnalyzerPreview(input(), {
    apiKey: "test-key",
    model: "configured-model",
    runPrompt: async (value) => {
      requests.push(value);
      return run({ status: "not_applicable", facts: [] });
    },
  });
  assert.equal(result.stage, "complete");
  assert.deepEqual(result.result, { status: "not_applicable" });
  assert.equal(requests[0]?.model, "configured-model");
  assert.equal(requests[0]?.responseSchema, LISTING_RISK_ANALYZER_PROVIDER_SCHEMA);
});

test("preview keeps invalid provider output separate from not_applicable", async () => {
  const result = await runListingRiskDomainAnalyzerPreview(input(), {
    apiKey: "test-key",
    runPrompt: async () => run({ status: "not_applicable", facts: [{}] }),
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
