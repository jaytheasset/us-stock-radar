import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { GeminiStructuredJsonRun } from "../ai/geminiStructuredJson.ts";
import { runListingRiskDomainAnalyzerPreview } from "../ai/listingRiskDomainAnalyzerPreview.ts";
import {
  LISTING_RISK_EVENT_FACTS_VERSION,
  LISTING_SOURCE_EVIDENCE_MAX_LENGTH,
  type ListingRiskEventFacts,
} from "./listingRiskFacts.ts";
import {
  applyListingRiskEvidenceRepair,
  buildListingRiskEvidenceRepairPlan,
  readListingRiskEvidenceRepairOutput,
  type ListingRiskEvidenceRepairPlan,
} from "./listingRiskEvidenceRepair.ts";
import {
  LISTING_RISK_PROVIDER_FACT_KEYS,
  type ListingRiskAnalyzerInput,
  validateListingRiskAnalyzerProviderResult,
} from "./listingRiskAnalyzer.ts";
import { adaptNewsListingRiskSource } from "./listingRiskSourceAdapters.ts";
import {
  LISTING_RISK_EVIDENCE_REPAIR_PROMPT_VERSION,
  LISTING_RISK_EVIDENCE_REPAIR_SYSTEM_PROMPT,
  buildListingRiskEvidenceRepairPrompt,
} from "../prompts/listingRiskEvidenceRepair.ts";

const here = dirname(fileURLToPath(import.meta.url));
const longEvidence = `${"Evidence from the supplied source. ".repeat(20)}${"x".repeat(27)}`;
const shortEvidence = "Additional source context supporting the same current event.";

test("evidence repair v3 selects exact fact-level spans without changing semantics", () => {
  assert.equal(LISTING_RISK_EVIDENCE_REPAIR_PROMPT_VERSION, "listing_risk_evidence_repair_v3");
  assert.equal(Array.from(longEvidence).length, 727);
  assert.match(LISTING_RISK_EVIDENCE_REPAIR_SYSTEM_PROMPT, /SELECT AND COPY exact substrings/i);
  assert.match(LISTING_RISK_EVIDENCE_REPAIR_SYSTEM_PROMPT, /source_document\.text\.includes\(evidence\) === true/);
  assert.match(LISTING_RISK_EVIDENCE_REPAIR_SYSTEM_PROMPT, /Do not summarize, paraphrase, rewrite, normalize, retype/i);
  assert.match(LISTING_RISK_EVIDENCE_REPAIR_SYSTEM_PROMPT, /fact-level provenance metadata[\s\S]+immutable/i);
  const prompt = buildListingRiskEvidenceRepairPrompt(repairPlan(input()));
  assert.equal(prompt.version, "listing_risk_evidence_repair_v3");
  assert.match(prompt.user, /"target_kind": "fact"/);
  assert.match(prompt.user, /"fact_path": "classification\.event_kind"/);
});

test("exact contiguous evidence passes while punctuation, paraphrase, and non-contiguous joins fail", () => {
  const analyzerInput = inputWithBody("Nasdaq issued notice. Intervening current facts. Compliance was restored.");
  const joined = "Nasdaq issued notice. Compliance was restored.";
  const plan = repairPlan(analyzerInput, joined);
  assert.match(readListingRiskEvidenceRepairOutput(repairItems(plan, joined), plan).errors.join("; "), /contiguous excerpt/);

  const exact = "Compliance was restored.";
  assert.deepEqual(readListingRiskEvidenceRepairOutput(repairItems(plan, exact), plan).errors, []);
  assert.match(
    readListingRiskEvidenceRepairOutput(repairItems(plan, "Compliance was restored,"), plan).errors.join("; "),
    /contiguous excerpt/,
  );
  assert.match(
    readListingRiskEvidenceRepairOutput(repairItems(plan, "The company regained compliance."), plan).errors.join("; "),
    /contiguous excerpt/,
  );
});

test("short exact spans and 520 characters pass while 521 characters fail", () => {
  const shortInput = inputWithBody("Nasdaq: compliance restored.");
  const shortPlan = repairPlan(shortInput, "not present initially");
  assert.deepEqual(
    readListingRiskEvidenceRepairOutput(repairItems(shortPlan, "compliance restored"), shortPlan).errors,
    [],
  );

  const sourceText = "z".repeat(LISTING_SOURCE_EVIDENCE_MAX_LENGTH + 1);
  const maxInput = inputWithBody(sourceText);
  const maxPlan = repairPlan(maxInput, sourceText);
  assert.deepEqual(
    readListingRiskEvidenceRepairOutput(repairItems(maxPlan, "z".repeat(520)), maxPlan).errors,
    [],
  );
  assert.match(
    readListingRiskEvidenceRepairOutput(repairItems(maxPlan, sourceText), maxPlan).errors.join("; "),
    /520 characters or fewer/,
  );
});

test("repair target_key and source_ref are immutable", () => {
  const plan = repairPlan(input());
  const wrongKey = repairItems(plan, shortEvidence);
  wrongKey.evidence_repairs[0].target_key = "fact:exchange.value";
  assert.match(readListingRiskEvidenceRepairOutput(wrongKey, plan).errors.join("; "), /target_key/);

  const wrongRef = repairItems(plan, shortEvidence);
  wrongRef.evidence_repairs[0].source_ref = "different-source";
  assert.match(readListingRiskEvidenceRepairOutput(wrongRef, plan).errors.join("; "), /source_ref must match/);
});

test("V10 production uses one Listing call and keeps valid exact evidence", async () => {
  const analyzerInput = input();
  const original = provider(analyzerInput, longEvidence);
  let providerCalls = 0;
  const result = await runListingRiskDomainAnalyzerPreview(analyzerInput, {
    apiKey: "test-key",
    runPrompt: async () => {
      providerCalls += 1;
      return runProvider(transport(analyzerInput, shortEvidence));
    },
  });
  assert.equal(result.stage, "complete");
  assert.equal(providerCalls, 1);
  assert.equal(result.repair, null);
  assert.equal(result.result?.status, "applicable");
  if (result.result?.status === "applicable") {
    assert.deepEqual(semanticFactsWithoutEvidence(result.result.facts), semanticFactsWithoutEvidence(original.applicable_facts[0]));
    assert.ok(result.result.facts.fact_provenance.every((entry) => entry.evidence === shortEvidence));
  }
});

test("V10 one-call evidence formatting failures preserve Core facts with explicit unavailable issues", async () => {
  const cases = [
    { input: input(), evidence: longEvidence, issue: "too_long" },
    {
      input: inputWithBody("Nasdaq issued notice. Intervening facts. Compliance was restored."),
      evidence: "Nasdaq issued notice. Compliance was restored.",
      issue: "not_exact_span",
    },
    { input: input(), evidence: null, issue: "not_provided" },
  ] as const;
  for (const item of cases) {
    let providerCalls = 0;
    const result = await runListingRiskDomainAnalyzerPreview(item.input, {
      apiKey: "test-key",
      runPrompt: async () => {
        providerCalls += 1;
        return runProvider(transport(item.input, item.evidence));
      },
    });
    assert.equal(providerCalls, 1);
    assert.equal(result.stage, "complete");
    assert.equal(result.repair, null);
    if (result.result?.status === "applicable") {
      assert.equal(result.result.facts.classification.event_kind, "other");
      assert.ok(result.result.facts.fact_provenance.every((entry) => entry.evidence === null));
      assert.ok(result.result.facts.fact_provenance.every((entry) => entry.evidence_status === "unavailable"));
      assert.ok(result.result.facts.fact_provenance.every((entry) => entry.evidence_issue === item.issue));
    } else {
      assert.fail("expected applicable facts");
    }
  }
});

test("semantic and source identity failures remain hard and do not enter repair", () => {
  const analyzerInput = input();
  const invalidSemantic = provider(analyzerInput, longEvidence);
  invalidSemantic.applicable_facts[0].classification.event_kind = "invented" as never;
  assert.equal(buildListingRiskEvidenceRepairPlan(invalidSemantic, analyzerInput), null);

  const invalidSource = provider(analyzerInput, longEvidence);
  invalidSource.applicable_facts[0].fact_provenance[0].source_ref = "missing-document";
  assert.equal(buildListingRiskEvidenceRepairPlan(invalidSource, analyzerInput), null);
  assert.match(validateListingRiskAnalyzerProviderResult(invalidSource, analyzerInput).join("; "), /source_ref/);
});

test("valid applicable and not_applicable results each use one call and no repair", async () => {
  for (const parsed of [
    transport(input(), shortEvidence),
    { status: "not_applicable", core_facts: [], agent_context: { fact_provenance: [], as_of: { availability: "unavailable" }, confidence: "unknown", sources: [] } },
  ]) {
    let providerCalls = 0;
    const result = await runListingRiskDomainAnalyzerPreview(input(), {
      apiKey: "test-key",
      runPrompt: async () => {
        providerCalls += 1;
        return runProvider(parsed);
      },
    });
    assert.equal(result.stage, "complete");
    assert.equal(providerCalls, 1);
    assert.equal(result.repair, null);
  }
});

test("repair implementation contains no deterministic evidence truncation", () => {
  for (const file of [
    join(here, "listingRiskEvidenceRepair.ts"),
    join(here, "..", "prompts", "listingRiskEvidenceRepair.ts"),
    join(here, "..", "ai", "listingRiskDomainAnalyzerPreview.ts"),
  ]) {
    assert.doesNotMatch(readFileSync(file, "utf8"), /\.slice\s*\(|\.substring\s*\(/);
  }
});

function input() {
  return inputWithBody(`${longEvidence} ${shortEvidence}`);
}

function inputWithBody(bodyText: string) {
  return adaptNewsListingRiskSource({
    source_unique_id: "repair-news",
    source_url: "https://example.com/repair-news",
    published_at: "2026-05-01",
    title: "Repair source",
    body_text: bodyText,
  });
}

function repairPlan(analyzerInput: ListingRiskAnalyzerInput, evidence = longEvidence) {
  const plan = buildListingRiskEvidenceRepairPlan(provider(analyzerInput, evidence), analyzerInput);
  assert.ok(plan);
  return plan;
}

function repairItems(plan: ListingRiskEvidenceRepairPlan, evidence: string | null) {
  return {
    evidence_repairs: plan.targets.map((target) => ({
      target_key: target.target_key,
      source_ref: target.source_ref,
      evidence,
    })),
  };
}

function provider(analyzerInput: ListingRiskAnalyzerInput, evidence: string) {
  return { status: "applicable" as const, applicable_facts: [validFacts(analyzerInput, evidence)] };
}

function transport(analyzerInput: ListingRiskAnalyzerInput, evidence: string | null) {
  const ref = analyzerInput.source_documents[0].source_ref;
  const agentFact = (key: "classification_event_kind" | "classification_event_outcome") => ({
    key,
    origin: "domain_interpreted" as const,
    source_ref: ref,
    evidence,
    confidence: "high" as const,
    as_of: null,
  });
  return {
    status: "applicable" as const,
    core_facts: [
      { key: "classification_event_kind", availability: "available" as const, value: "other", date_status: "not_applicable" as const, source_ref: ref },
      { key: "classification_event_outcome", availability: "available" as const, value: "unknown", date_status: "not_applicable" as const, source_ref: ref },
      ...LISTING_RISK_PROVIDER_FACT_KEYS
        .filter((key) => key !== "classification_event_kind" && key !== "classification_event_outcome")
        .map((key) => ({ key, availability: "unavailable" as const })),
    ],
    agent_context: {
      fact_provenance: [agentFact("classification_event_kind"), agentFact("classification_event_outcome")],
      as_of: { availability: "unavailable" as const },
      confidence: "high" as const,
      sources: [{ source_ref: ref }],
    },
  };
}

function validFacts(analyzerInput: ListingRiskAnalyzerInput, evidence: string): ListingRiskEventFacts {
  const ref = analyzerInput.source_documents[0].source_ref;
  const unavailableText = () => ({ value: null, availability: "unavailable" as const, value_quality: "unknown" as const, source_ref: null });
  const unavailableDate = () => ({ ...unavailableText(), date_status: "unknown" as const });
  return {
    version: LISTING_RISK_EVENT_FACTS_VERSION,
    classification: { event_kind: "other", event_outcome: "unknown", source_ref: ref },
    exchange: unavailableText(),
    affected_security: { title: unavailableText(), ticker: unavailableText(), security_basis: unavailableText() },
    listing_rule: unavailableText(),
    listing_requirement: unavailableText(),
    compliance_period: unavailableText(),
    proceeding: { kind: "unknown", status: "unknown", source_ref: null },
    dates: {
      notice_date: unavailableDate(), compliance_deadline: unavailableDate(), hearing_date: unavailableDate(),
      appeal_deadline: unavailableDate(), trading_suspension_date: unavailableDate(), removal_effective_date: unavailableDate(),
    },
    continued_trading: { continues: { ...unavailableText(), value: null }, venue: unavailableText() },
    as_of: unavailableDate(),
    confidence: "high",
    sources: [{
      source_family: analyzerInput.source_family,
      source_id: analyzerInput.source_id,
      source_url: analyzerInput.source_url,
      source_ref: ref,
      evidence: shortEvidence,
    }],
    fact_provenance: [
      provenance("classification.event_kind", ref, evidence),
      provenance("classification.event_outcome", ref, evidence),
    ],
  };
}

function provenance(
  factPath: "classification.event_kind" | "classification.event_outcome",
  sourceRef: string,
  evidence: string,
) {
  return {
    fact_path: factPath,
    origin: "domain_interpreted" as const,
    source_ref: sourceRef,
    evidence,
    evidence_status: "available" as const,
    evidence_issue: null,
    confidence: "high" as const,
    as_of: null,
    formula_id: null,
    input_fact_paths: [],
  };
}

function semanticFactsWithoutEvidence(facts: ListingRiskEventFacts) {
  return {
    ...facts,
    sources: facts.sources.map(({ evidence: _evidence, ...source }) => source),
    fact_provenance: facts.fact_provenance.map(({ evidence: _evidence, evidence_status: _status, evidence_issue: _issue, ...entry }) => entry),
  };
}

function run(parsed: Record<string, unknown> | null): GeminiStructuredJsonRun {
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
  };
}

function runProvider(transport: Record<string, unknown>): GeminiStructuredJsonRun {
  return run(transport);
}
