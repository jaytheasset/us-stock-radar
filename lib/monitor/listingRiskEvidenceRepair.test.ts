import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { GeminiStructuredJsonRun } from "../ai/geminiStructuredJson.ts";
import { runListingRiskDomainAnalyzerPreview } from "../ai/listingRiskDomainAnalyzerPreview.ts";
import {
  LISTING_SOURCE_EVIDENCE_MAX_LENGTH,
  LISTING_RISK_EVENT_FACTS_VERSION,
  type ListingRiskEventFacts,
} from "./listingRiskFacts.ts";
import {
  buildListingRiskEvidenceRepairPlan,
  LISTING_RISK_EVIDENCE_REPAIR_SCHEMA,
} from "./listingRiskEvidenceRepair.ts";
import {
  type ListingRiskAnalyzerInput,
  validateListingRiskAnalyzerProviderResult,
} from "./listingRiskAnalyzer.ts";
import { adaptNewsListingRiskSource } from "./listingRiskSourceAdapters.ts";

const here = dirname(fileURLToPath(import.meta.url));
const longEvidence = "Evidence from the supplied source. ".repeat(20);

test("T1 valid result bypasses repair and remains unchanged", async () => {
  const analyzerInput = input();
  const facts = validFacts(analyzerInput, "Compliant evidence");
  let repairCalls = 0;
  const result = await runListingRiskDomainAnalyzerPreview(analyzerInput, {
    apiKey: "test-key",
    runPrompt: async () => run({ status: "applicable", applicable_facts: [facts] }),
    runRepairPrompt: async () => {
      repairCalls += 1;
      return run(null);
    },
  });

  assert.equal(result.stage, "complete");
  assert.equal(repairCalls, 0);
  assert.equal(result.repair, null);
  assert.deepEqual(result.result, { status: "applicable", facts });
});

test("T2 evidence-only overlength is repair eligible", () => {
  const analyzerInput = input();
  const providerResult = provider(analyzerInput, longEvidence);
  const errors = validateListingRiskAnalyzerProviderResult(providerResult, analyzerInput);
  const plan = buildListingRiskEvidenceRepairPlan(providerResult, analyzerInput);

  assert.equal(errors.length, 1);
  assert.match(errors[0], /sources\[0\]\.evidence must be 520 characters or fewer/);
  assert.equal(plan?.targets.length, 1);
  assert.equal(plan?.targets[0]?.original_length, Array.from(longEvidence).length);
});

test("T3 evidence overlength plus another validation error is not repair eligible", () => {
  const analyzerInput = input();
  const providerResult = provider(analyzerInput, longEvidence);
  providerResult.applicable_facts[0].sources[0].source_family = "sec";

  assert.equal(buildListingRiskEvidenceRepairPlan(providerResult, analyzerInput), null);
  assert.ok(validateListingRiskAnalyzerProviderResult(providerResult, analyzerInput).length > 1);
});

test("T4 missing source_ref is not repair eligible", () => {
  const analyzerInput = input();
  const providerResult = provider(analyzerInput, longEvidence);
  providerResult.applicable_facts[0].sources[0].source_ref = "missing-source";

  assert.equal(buildListingRiskEvidenceRepairPlan(providerResult, analyzerInput), null);
  assert.match(validateListingRiskAnalyzerProviderResult(providerResult, analyzerInput).join("; "), /source_ref/);
});

test("T5 invalid semantic enum is not repair eligible", () => {
  const analyzerInput = input();
  const providerResult = provider(analyzerInput, longEvidence);
  providerResult.applicable_facts[0].classification.event_kind = "invented_kind" as never;

  assert.equal(buildListingRiskEvidenceRepairPlan(providerResult, analyzerInput), null);
  assert.match(validateListingRiskAnalyzerProviderResult(providerResult, analyzerInput).join("; "), /event_kind/);
});

test("T6 successful repair changes only evidence and passes the canonical validator", async () => {
  const analyzerInput = input();
  const original = provider(analyzerInput, longEvidence);
  const repairedEvidence = "Additional source context supporting the same current event.";
  let repairCalls = 0;
  const result = await runListingRiskDomainAnalyzerPreview(analyzerInput, {
    apiKey: "test-key",
    runPrompt: async () => run(original),
    runRepairPrompt: async (request) => {
      repairCalls += 1;
      assert.equal(request.responseSchema, LISTING_RISK_EVIDENCE_REPAIR_SCHEMA);
      assert.doesNotMatch(request.prompt.user, /"event_kind"|"event_outcome"|"dates"|"confidence"/);
      return run({ evidence_repairs: [{ source_ref: sourceRef(analyzerInput), evidence: repairedEvidence }] });
    },
  });

  assert.equal(result.stage, "complete");
  assert.equal(repairCalls, 1);
  assert.equal(result.repair?.max_attempts, 1);
  assert.deepEqual(result.repair?.final_validation_errors, []);
  assert.equal(result.repair?.semantic_facts_changed, false);
  assert.deepEqual(result.result, {
    status: "applicable",
    facts: validFacts(analyzerInput, repairedEvidence),
  });
  assert.deepEqual(
    semanticFactsWithoutEvidence((result.result as { status: "applicable"; facts: ListingRiskEventFacts }).facts),
    semanticFactsWithoutEvidence(original.applicable_facts[0]),
  );
});

test("T7 still-overlength repair fails closed after one call", async () => {
  const analyzerInput = input();
  let repairCalls = 0;
  const result = await runListingRiskDomainAnalyzerPreview(analyzerInput, {
    apiKey: "test-key",
    runPrompt: async () => run(provider(analyzerInput, longEvidence)),
    runRepairPrompt: async () => {
      repairCalls += 1;
      return run({ evidence_repairs: [{ source_ref: sourceRef(analyzerInput), evidence: longEvidence }] });
    },
  });

  assert.equal(result.stage, "repair_error");
  assert.equal(result.result, null);
  assert.equal(repairCalls, 1);
  assert.match(result.error, /520 characters or fewer/);
});

test("T8 invalid repair shape fails closed", async () => {
  const analyzerInput = input();
  let repairCalls = 0;
  const result = await runListingRiskDomainAnalyzerPreview(analyzerInput, {
    apiKey: "test-key",
    runPrompt: async () => run(provider(analyzerInput, longEvidence)),
    runRepairPrompt: async () => {
      repairCalls += 1;
      return run({ evidence: "short" });
    },
  });

  assert.equal(result.stage, "repair_error");
  assert.equal(result.result, null);
  assert.equal(repairCalls, 1);
});

test("repair evidence absent from the supplied source fails closed", async () => {
  const analyzerInput = input();
  let repairCalls = 0;
  const result = await runListingRiskDomainAnalyzerPreview(analyzerInput, {
    apiKey: "test-key",
    runPrompt: async () => run(provider(analyzerInput, longEvidence)),
    runRepairPrompt: async () => {
      repairCalls += 1;
      return run({
        evidence_repairs: [{
          source_ref: sourceRef(analyzerInput),
          evidence: "This sentence was not present in the supplied source.",
        }],
      });
    },
  });

  assert.equal(result.stage, "repair_error");
  assert.equal(repairCalls, 1);
  assert.match(result.error, /contiguous excerpt/);
});

test("T9 not_applicable bypasses repair", async () => {
  let repairCalls = 0;
  const result = await runListingRiskDomainAnalyzerPreview(input(), {
    apiKey: "test-key",
    runPrompt: async () => run({ status: "not_applicable", applicable_facts: [] }),
    runRepairPrompt: async () => {
      repairCalls += 1;
      return run(null);
    },
  });

  assert.equal(result.stage, "complete");
  assert.deepEqual(result.result, { status: "not_applicable" });
  assert.equal(repairCalls, 0);
});

test("repair implementation contains no deterministic evidence truncation", () => {
  for (const file of [
    join(here, "listingRiskEvidenceRepair.ts"),
    join(here, "..", "prompts", "listingRiskEvidenceRepair.ts"),
    join(here, "..", "ai", "listingRiskDomainAnalyzerPreview.ts"),
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\.slice\s*\(|\.substring\s*\(/);
  }
});

function input() {
  return adaptNewsListingRiskSource({
    source_unique_id: "repair-news",
    source_url: "https://example.com/repair-news",
    published_at: "2026-05-01",
    title: "Repair source",
    body_text: `${longEvidence} Additional source context supporting the same current event.`,
  });
}

function provider(analyzerInput: ListingRiskAnalyzerInput, evidence: string) {
  return {
    status: "applicable" as const,
    applicable_facts: [validFacts(analyzerInput, evidence)],
  };
}

function sourceRef(analyzerInput: ListingRiskAnalyzerInput) {
  return analyzerInput.source_documents[0].source_ref;
}

function validFacts(analyzerInput: ListingRiskAnalyzerInput, evidence: string): ListingRiskEventFacts {
  const ref = sourceRef(analyzerInput);
  const unavailableText = () => ({
    value: null,
    availability: "unavailable" as const,
    value_quality: "unknown" as const,
    source_ref: null,
  });
  const unavailableDate = () => ({ ...unavailableText(), date_status: "unknown" as const });
  const unavailableBoolean = () => ({
    value: null,
    availability: "unavailable" as const,
    value_quality: "unknown" as const,
    source_ref: null,
  });
  return {
    version: LISTING_RISK_EVENT_FACTS_VERSION,
    classification: { event_kind: "other", event_outcome: "unknown", source_ref: ref },
    exchange: unavailableText(),
    affected_security: {
      title: unavailableText(),
      ticker: unavailableText(),
      security_basis: unavailableText(),
    },
    listing_rule: unavailableText(),
    listing_requirement: unavailableText(),
    compliance_period: unavailableText(),
    proceeding: { kind: "unknown", status: "unknown", source_ref: null },
    dates: {
      notice_date: unavailableDate(),
      compliance_deadline: unavailableDate(),
      hearing_date: unavailableDate(),
      appeal_deadline: unavailableDate(),
      trading_suspension_date: unavailableDate(),
      removal_effective_date: unavailableDate(),
    },
    continued_trading: { continues: unavailableBoolean(), venue: unavailableText() },
    as_of: unavailableDate(),
    confidence: "high",
    sources: [{
      source_family: analyzerInput.source_family,
      source_id: analyzerInput.source_id,
      source_url: analyzerInput.source_url,
      source_ref: ref,
      evidence,
    }],
  };
}

function semanticFactsWithoutEvidence(facts: ListingRiskEventFacts) {
  return {
    ...facts,
    sources: facts.sources.map(({ evidence: _evidence, ...source }) => source),
  };
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
