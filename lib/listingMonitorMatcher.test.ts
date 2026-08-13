import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateListingMonitorConditions,
  evaluateListingMonitorEvent,
  type ListingMonitorCondition,
} from "./listingMonitorMatcher.ts";
import type { CurrentListingRiskReadResult } from "./monitor/listingRiskPersistence.ts";
import {
  LISTING_RISK_EVENT_FACTS_VERSION,
  validateListingRiskEventFacts,
  type ListingDateFact,
  type ListingFactPath,
  type ListingRiskEventFacts,
} from "./monitor/listingRiskFacts.ts";

const EVENT_ID = "29f5fe0d-8171-458c-bfb0-baacb6495e13";
const EVALUATION_DATE = "2026-08-14";

test("free-form text supports exact eq, neq, in, and not_in without normalization", () => {
  const current = availableCurrent();
  for (const [operator, value, expected] of [
    ["eq", "Nasdaq", "match"],
    ["eq", "NASDAQ", "no_match"],
    ["neq", "NYSE", "match"],
    ["in", ["NYSE", "Nasdaq"], "match"],
    ["not_in", ["NYSE", "Cboe"], "match"],
    ["not_in", ["Nasdaq"], "no_match"],
  ] as const) {
    assert.equal(evaluate(current, [{ key: "listing.exchange", operator, value }]).status, expected);
  }
});

test("all categorical Listing conditions use Registry enums and exact canonical values", () => {
  const current = availableCurrent();
  for (const condition of [
    { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
    { key: "listing.event_kind", operator: "in", value: ["listing_removal", "deficiency_notice"] },
    { key: "listing.event_outcome", operator: "eq", value: "adverse" },
    { key: "listing.proceeding_kind", operator: "eq", value: "hearing" },
    { key: "listing.proceeding_status", operator: "in", value: ["pending", "decided"] },
  ]) {
    assert.equal(evaluate(current, [condition]).status, "match");
  }
  assert.equal(evaluate(current, [{ key: "listing.event_outcome", operator: "eq", value: "recovered" }]).status, "no_match");
});

test("boolean conditions preserve false and support eq and neq", () => {
  const current = availableCurrent();
  current.facts.continued_trading.continues.value = false;
  assert.equal(evaluate(current, [{ key: "listing.continued_trading", operator: "eq", value: false }]).status, "match");
  assert.equal(evaluate(current, [{ key: "listing.continued_trading", operator: "neq", value: true }]).status, "match");
  assert.equal(evaluate(current, [{ key: "listing.continued_trading", operator: "eq", value: true }]).status, "no_match");
});

test("fixed date eq, neq, before, and after retain their strict date-only meanings", () => {
  const current = availableCurrent();
  setDeadline(current, "2026-08-20");
  for (const [operator, value, expected] of [
    ["eq", "2026-08-20", "match"],
    ["neq", "2026-08-20", "no_match"],
    ["neq", "2026-08-21", "match"],
    ["before", "2026-08-21", "match"],
    ["before", "2026-08-20", "no_match"],
    ["after", "2026-08-19", "match"],
    ["after", "2026-08-20", "no_match"],
  ] as const) {
    assert.equal(evaluate(current, [{ key: "listing.compliance_deadline", operator, value }]).status, expected);
  }
});

test("within_days includes today and N, excludes N+1 and past dates", () => {
  const current = availableCurrent();
  for (const [factDate, days, expected] of [
    ["2026-08-14", 7, "match"],
    ["2026-08-21", 7, "match"],
    ["2026-08-22", 7, "no_match"],
    ["2026-08-13", 7, "no_match"],
    ["2026-08-14", 0, "match"],
    ["2026-08-15", 0, "no_match"],
  ] as const) {
    setDeadline(current, factDate);
    assert.equal(
      evaluate(current, [{ key: "listing.compliance_deadline", operator: "within_days", value: days }]).status,
      expected,
    );
  }
});

test("within_days is deterministic across date-only DST boundaries and injected dates", () => {
  const current = availableCurrent();
  setDeadline(current, "2026-03-09");
  const condition = [{ key: "listing.compliance_deadline", operator: "within_days", value: 1 }];
  assert.equal(evaluateListingMonitorConditions(current, condition, { evaluationDate: "2026-03-08" }).status, "match");
  assert.equal(evaluateListingMonitorConditions(current, condition, { evaluationDate: "2026-03-09" }).status, "match");
  assert.equal(evaluateListingMonitorConditions(current, condition, { evaluationDate: "2026-03-10" }).status, "no_match");
  assert.deepEqual(
    statusAndReason(evaluateListingMonitorConditions(current, condition, { evaluationDate: "2026-02-30" })),
    ["ineligible", "evaluation_date_invalid"],
  );
});

test("every Listing V1 Registry key is evaluated from its exact official fact path", () => {
  const current = availableCurrent();
  assert.deepEqual(validateListingRiskEventFacts(current.facts), []);
  const conditions: ListingMonitorCondition[] = [
    { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
    { key: "listing.event_outcome", operator: "eq", value: "adverse" },
    { key: "listing.exchange", operator: "eq", value: "Nasdaq" },
    { key: "listing.compliance_deadline", operator: "eq", value: "2026-08-20" },
    { key: "listing.hearing_date", operator: "eq", value: "2026-08-21" },
    { key: "listing.appeal_deadline", operator: "eq", value: "2026-08-22" },
    { key: "listing.suspension_date", operator: "eq", value: "2026-08-23" },
    { key: "listing.removal_effective_date", operator: "eq", value: "2026-08-24" },
    { key: "listing.continued_trading", operator: "eq", value: true },
    { key: "listing.proceeding_kind", operator: "eq", value: "hearing" },
    { key: "listing.proceeding_status", operator: "eq", value: "pending" },
  ];
  const result = evaluate(current, conditions);
  assert.equal(result.status, "match");
  assert.equal(result.conditions.length, conditions.length);
  assert.ok(result.conditions.every((condition) => condition.status === "match"));
});

test("reader not-ready and not-applicable states fail closed", () => {
  assert.deepEqual(
    statusAndReason(evaluateListingMonitorConditions(
      { status: "not_ready", reason: "parent_not_current" },
      [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }],
      { evaluationDate: EVALUATION_DATE },
    )),
    ["ineligible", "reader_not_ready"],
  );
  const current = availableCurrent();
  const { facts: _facts, factSchemaVersion: _factSchemaVersion, status: _status, ...lineage } = current;
  assert.deepEqual(
    statusAndReason(evaluateListingMonitorConditions(
      { status: "not_applicable", ...lineage },
      [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }],
      { evaluationDate: EVALUATION_DATE },
    )),
    ["ineligible", "reader_not_applicable"],
  );
});

test("unavailable facts, unknown quality, and invalid or unknown categorical values fail closed", () => {
  const unavailable = availableCurrent();
  unavailable.facts.exchange.availability = "unavailable";
  assert.deepEqual(
    statusAndReason(evaluate(unavailable, [{ key: "listing.exchange", operator: "eq", value: "Nasdaq" }])),
    ["ineligible", "fact_unavailable"],
  );

  const unknownQuality = availableCurrent();
  unknownQuality.facts.dates.compliance_deadline.value_quality = "unknown";
  assert.deepEqual(
    statusAndReason(evaluate(unknownQuality, [{ key: "listing.compliance_deadline", operator: "after", value: "2026-08-01" }])),
    ["ineligible", "fact_quality_unknown"],
  );

  const unknownCategorical = availableCurrent();
  unknownCategorical.facts.proceeding.status = "unknown";
  assert.deepEqual(
    statusAndReason(evaluate(unknownCategorical, [{ key: "listing.proceeding_status", operator: "eq", value: "pending" }])),
    ["ineligible", "fact_value_ineligible"],
  );

  const invalidCategorical = availableCurrent();
  (invalidCategorical.facts.classification as { event_kind: string }).event_kind = "delisted";
  assert.deepEqual(
    statusAndReason(evaluate(invalidCategorical, [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }])),
    ["ineligible", "fact_value_invalid"],
  );
});

test("invalid keys, operators, values, relative counts, and empty sets are rejected", () => {
  const current = availableCurrent();
  for (const [condition, reason] of [
    [{ key: "listing.made_up", operator: "eq", value: "x" }, "condition_key_unknown"],
    [{ key: "offering.side", operator: "eq", value: "primary" }, "condition_key_unknown"],
    [{ key: "listing.exchange", operator: "contains", value: "Nasdaq" }, "condition_operator_unknown"],
    [{ key: "listing.event_kind", operator: "eq", value: "delisted" }, "condition_value_invalid"],
    [{ key: "listing.continued_trading", operator: "eq", value: "true" }, "condition_value_invalid"],
    [{ key: "listing.compliance_deadline", operator: "eq", value: "2026-02-30" }, "condition_value_invalid"],
    [{ key: "listing.compliance_deadline", operator: "within_days", value: -1 }, "condition_value_invalid"],
    [{ key: "listing.compliance_deadline", operator: "within_days", value: 1.5 }, "condition_value_invalid"],
  ] as const) {
    assert.deepEqual(statusAndReason(evaluate(current, [condition])), ["ineligible", reason]);
  }
  assert.deepEqual(statusAndReason(evaluate(current, [])), ["ineligible", "condition_set_empty"]);
  assert.deepEqual(
    statusAndReason(evaluate(current, [null as unknown as ListingMonitorCondition])),
    ["ineligible", "condition_invalid"],
  );
});

test("AND aggregation reuses Offering precedence and the event wrapper reads official facts once", async () => {
  const mixed = evaluate(availableCurrent(), [
    { key: "listing.made_up", operator: "eq", value: "x" },
    { key: "listing.exchange", operator: "eq", value: "NYSE" },
  ]);
  assert.deepEqual(statusAndReason(mixed), ["no_match", "condition_not_met"]);
  assert.deepEqual(mixed.conditions.map((condition) => condition.status), ["ineligible", "no_match"]);

  let reads = 0;
  const eventResult = await evaluateListingMonitorEvent({
    eventId: EVENT_ID,
    evaluationDate: EVALUATION_DATE,
    conditionSets: [
      { id: "kind", conditions: [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }] },
      { id: "deadline", conditions: [{ key: "listing.compliance_deadline", operator: "within_days", value: 6 }] },
    ],
  }, {
    readFacts: async (eventId) => {
      reads += 1;
      assert.equal(eventId, EVENT_ID);
      return availableCurrent();
    },
  });
  assert.equal(reads, 1);
  assert.deepEqual(eventResult.evaluations.map((evaluation) => evaluation.result.status), ["match", "match"]);
});

test("ATPC and CUPR reader-shaped acceptance fixtures produce concrete deterministic results", () => {
  const atpc = availableCurrent();
  setDeadline(atpc, "2026-08-20");
  assert.deepEqual([
    evaluate(atpc, [
      { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
      { key: "listing.event_outcome", operator: "eq", value: "adverse" },
      { key: "listing.compliance_deadline", operator: "within_days", value: 6 },
    ]).status,
    evaluate(atpc, [{ key: "listing.compliance_deadline", operator: "within_days", value: 5 }]).status,
  ], ["match", "no_match"]);

  const cupr = availableCurrent();
  cupr.eventId = "920c6119-c33d-410c-9dff-18d1933b7bca";
  cupr.facts.classification.event_kind = "compliance_recovery";
  cupr.facts.classification.event_outcome = "recovered";
  cupr.facts.proceeding.kind = "hearing";
  cupr.facts.proceeding.status = "not_pursued";
  assert.deepEqual([
    evaluate(cupr, [
      { key: "listing.event_kind", operator: "eq", value: "compliance_recovery" },
      { key: "listing.event_outcome", operator: "eq", value: "recovered" },
      { key: "listing.proceeding_kind", operator: "eq", value: "hearing" },
      { key: "listing.proceeding_status", operator: "eq", value: "not_pursued" },
    ]).status,
    evaluate(cupr, [{ key: "listing.event_outcome", operator: "eq", value: "adverse" }]).status,
  ], ["match", "no_match"]);
});

test("reader failure is deterministic and the Matcher has no fallback, provenance, LLM, or delivery dependency", async () => {
  const eventResult = await evaluateListingMonitorEvent({
    eventId: EVENT_ID,
    evaluationDate: EVALUATION_DATE,
    conditionSets: [{
      id: "kind",
      conditions: [{ key: "listing.event_kind", operator: "eq", value: "deficiency_notice" }],
    }],
  }, { readFacts: async () => { throw new Error("offline"); } });
  assert.deepEqual(statusAndReason(eventResult.evaluations[0].result), ["ineligible", "reader_unavailable"]);

  const source = readFileSync(new URL("./listingMonitorMatcher.ts", import.meta.url), "utf8");
  assert.match(source, /readCurrentListingRiskFacts/);
  assert.doesNotMatch(source, /source_ref|fact_provenance|evidence|parser|Gemini|ai_runs|alert|notification|Telegram|Email/i);
});

function evaluate(current: CurrentListingRiskReadResult, conditions: readonly ListingMonitorCondition[]) {
  return evaluateListingMonitorConditions(current, conditions, { evaluationDate: EVALUATION_DATE });
}

function setDeadline(current: Extract<CurrentListingRiskReadResult, { status: "available" }>, value: string) {
  current.facts.dates.compliance_deadline.value = value;
}

function statusAndReason(value: { status: string; reasonCode: string }) {
  return [value.status, value.reasonCode];
}

function availableCurrent(): Extract<CurrentListingRiskReadResult, { status: "available" }> {
  return {
    status: "available",
    eventId: EVENT_ID,
    rawItemId: "81000000-0000-4000-8000-000000000002",
    parentPrimaryAiRunId: "81000000-0000-4000-8000-000000000003",
    sourceExecutionId: "594634a0-928b-5a4f-90c3-584b0ffd3b0b",
    monitorAnalyzerKey: "listing_risk",
    analyzerContractVersion: "listing_risk_domain_analyzer_v11",
    persistedAt: "2026-08-14T00:00:00.000Z",
    factSchemaVersion: LISTING_RISK_EVENT_FACTS_VERSION,
    facts: listingFacts(),
  };
}

function listingFacts(): ListingRiskEventFacts {
  const unavailableText = {
    value: null,
    availability: "unavailable" as const,
    value_quality: "unknown" as const,
    source_ref: null,
  };
  return {
    version: LISTING_RISK_EVENT_FACTS_VERSION,
    classification: {
      event_kind: "deficiency_notice",
      event_outcome: "adverse",
      source_ref: "source:block:1",
    },
    exchange: textFact("Nasdaq"),
    affected_security: {
      title: { ...unavailableText },
      ticker: textFact("ATPC"),
      security_basis: { ...unavailableText },
    },
    listing_rule: { ...unavailableText },
    listing_requirement: textFact("Minimum bid price requirement"),
    compliance_period: { ...unavailableText },
    proceeding: { kind: "hearing", status: "pending", source_ref: "source:block:1" },
    dates: {
      notice_date: dateFact("2026-08-12"),
      compliance_deadline: dateFact("2026-08-20"),
      hearing_date: dateFact("2026-08-21"),
      appeal_deadline: dateFact("2026-08-22"),
      trading_suspension_date: dateFact("2026-08-23"),
      removal_effective_date: dateFact("2026-08-24"),
    },
    continued_trading: {
      continues: {
        value: true,
        availability: "available",
        value_quality: "exact",
        source_ref: "source:block:1",
      },
      venue: textFact("Nasdaq"),
    },
    as_of: dateFact("2026-08-14"),
    confidence: "high",
    sources: [{
      source_family: "nasdaq",
      source_id: EVENT_ID,
      source_url: "https://example.com/listing-notice",
      source_ref: "source:block:1",
      evidence: "The issuer received a listing deficiency notice.",
    }],
    fact_provenance: ([
      "classification.event_kind",
      "classification.event_outcome",
      "exchange.value",
      "affected_security.ticker.value",
      "listing_requirement.value",
      "proceeding.kind",
      "proceeding.status",
      "dates.notice_date.value",
      "dates.compliance_deadline.value",
      "dates.hearing_date.value",
      "dates.appeal_deadline.value",
      "dates.trading_suspension_date.value",
      "dates.removal_effective_date.value",
      "continued_trading.continues.value",
      "continued_trading.venue.value",
    ] satisfies ListingFactPath[]).map((factPath) => ({
      fact_path: factPath,
      origin: factPath.startsWith("classification.") || factPath.startsWith("proceeding.")
        ? "domain_interpreted" as const
        : "source_stated" as const,
      source_ref: "source:block:1",
      evidence: "The issuer received a listing deficiency notice.",
      evidence_status: "available" as const,
      evidence_issue: null,
      confidence: "high" as const,
      as_of: "2026-08-14",
      formula_id: null,
      input_fact_paths: [],
    })),
  };
}

function textFact(value: string) {
  return {
    value,
    availability: "available" as const,
    value_quality: "exact" as const,
    source_ref: "source:block:1",
  };
}

function dateFact(value: string): ListingDateFact {
  return {
    value,
    availability: "available",
    value_quality: "exact",
    date_status: "scheduled",
    source_ref: "source:block:1",
  };
}
