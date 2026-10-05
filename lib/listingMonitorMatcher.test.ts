import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  evaluateListingMonitorConditions,
  evaluateListingMonitorEvent,
  evaluateMonitorConditions,
  type ListingMonitorCondition,
} from "./listingMonitorMatcher.ts";
import type { CurrentListingRiskReadResult } from "./monitor/listingRiskPersistence.ts";
import type { CurrentCorporateActionReadResult } from "./monitor/corporateActionPersistence.ts";
import type { CurrentPrice, CurrentPriceDataMode } from "./market-data/marketDataProvider.ts";
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

test("ATPC and CUPR captured official-reader facts produce concrete deterministic results", () => {
  const evaluationDate = "2026-07-01";
  const atpc = availableCurrent();
  setDeadline(atpc, "2026-07-27");
  assert.deepEqual([
    evaluateListingMonitorConditions(atpc, [
      { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
      { key: "listing.event_outcome", operator: "eq", value: "adverse" },
      { key: "listing.compliance_deadline", operator: "within_days", value: 26 },
    ], { evaluationDate }).status,
    evaluateListingMonitorConditions(atpc, [
      { key: "listing.compliance_deadline", operator: "within_days", value: 25 },
    ], { evaluationDate }).status,
  ], ["match", "no_match"]);

  const cupr = availableCurrent();
  cupr.eventId = "920c6119-c33d-410c-9dff-18d1933b7bca";
  cupr.facts.classification.event_kind = "compliance_recovery";
  cupr.facts.classification.event_outcome = "recovered";
  cupr.facts.proceeding.kind = "hearing";
  cupr.facts.proceeding.status = "not_pursued";
  cupr.facts.dates.hearing_date.value = "2026-07-07";
  assert.deepEqual([
    evaluateListingMonitorConditions(cupr, [
      { key: "listing.event_kind", operator: "eq", value: "compliance_recovery" },
      { key: "listing.event_outcome", operator: "eq", value: "recovered" },
      { key: "listing.hearing_date", operator: "within_days", value: 6 },
      { key: "listing.proceeding_kind", operator: "eq", value: "hearing" },
      { key: "listing.proceeding_status", operator: "eq", value: "not_pursued" },
    ], { evaluationDate }).status,
    evaluateListingMonitorConditions(cupr, [
      { key: "listing.hearing_date", operator: "within_days", value: 5 },
    ], { evaluationDate }).status,
  ], ["match", "no_match"]);
});

test("current price boundaries are deterministic and require realtime current-enough data", () => {
  const current = availableCurrent();
  const input = {
    evaluationDate: EVALUATION_DATE,
    evaluatedAt: "2026-08-14T12:00:00.000Z",
  };
  for (const [actual, operator, expected] of [
    [0.99, "lt", "match"],
    [1, "lt", "no_match"],
    [1, "lte", "match"],
    [1.01, "gt", "match"],
    [1, "gte", "match"],
  ] as const) {
    const result = evaluateListingMonitorConditions(current, [
      { key: "market.price", operator, value: 1 },
    ], { ...input, currentPrice: price(actual) });
    assert.equal(result.status, expected);
  }

  assert.deepEqual(statusAndReason(evaluateListingMonitorConditions(current, [
    { key: "market.price", operator: "lt", value: 1 },
  ], { ...input, currentPrice: price(0.99, "end-of-day") })), [
    "ineligible", "market_price_data_mode_ineligible",
  ]);
  assert.deepEqual(statusAndReason(evaluateListingMonitorConditions(current, [
    { key: "market.price", operator: "lt", value: 1 },
  ], {
    ...input,
    currentPrice: { asOf: null, availability: "unavailable", dataMode: null, price: null, symbol: "ATPC" },
  })), ["ineligible", "market_price_unavailable"]);
  assert.deepEqual(statusAndReason(evaluateListingMonitorConditions(current, [
    { key: "market.price", operator: "lt", value: 1 },
  ], { ...input, currentPrice: price(0.99, "realtime", "2026-08-14T11:54:59.999Z") })), [
    "ineligible", "market_price_stale",
  ]);
});

test("price and Listing conditions use AND with NO_MATCH precedence", () => {
  const current = availableCurrent();
  const conditions: ListingMonitorCondition[] = [
    { key: "market.price", operator: "lt", value: 1 },
    { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
  ];
  const input = {
    evaluationDate: EVALUATION_DATE,
    evaluatedAt: "2026-08-14T12:00:00.000Z",
  };
  assert.equal(evaluateListingMonitorConditions(current, conditions, {
    ...input,
    currentPrice: price(0.99),
  }).status, "match");
  assert.equal(evaluateListingMonitorConditions(current, conditions, {
    ...input,
    currentPrice: price(1),
  }).status, "no_match");

  current.facts.classification.event_kind = "deficiency_notice";
  const unavailableListing = availableCurrent();
  unavailableListing.facts.exchange.availability = "unavailable";
  const mixed = [
    { key: "market.price", operator: "lt", value: 1 },
    { key: "listing.exchange", operator: "eq", value: "Nasdaq" },
  ] satisfies ListingMonitorCondition[];
  assert.equal(evaluateListingMonitorConditions(unavailableListing, mixed, {
    ...input,
    currentPrice: price(1),
  }).status, "no_match");
  assert.equal(evaluateListingMonitorConditions(unavailableListing, mixed, {
    ...input,
    currentPrice: price(0.99),
  }).status, "ineligible");
});

test("official Corporate Action reader facts deterministically match AEMD and exclude EA/MEDS", () => {
  const condition = [{
    key: "corporate_action.event_kind",
    operator: "eq",
    value: "reverse_split",
  }] satisfies ListingMonitorCondition[];
  assert.deepEqual(statusAndReason(evaluateCorporate(availableCorporateAction(), condition)), [
    "match",
    "all_conditions_match",
  ]);
  for (const reason of ["ea_merger", "meds_spin_off"]) {
    assert.deepEqual(statusAndReason(evaluateCorporate({
      status: "not_applicable",
      ...corporateActionLineage(),
    }, condition)), ["ineligible", "reader_not_applicable"], reason);
  }
  assert.deepEqual(statusAndReason(evaluateCorporate({
    status: "not_ready",
    reason: "current_successful_result_missing",
  }, condition)), ["ineligible", "reader_not_ready"]);
});

test("Corporate Action stage is an exact lifecycle restriction while event kind alone never narrows stage", () => {
  const scheduled = availableCorporateAction("scheduled");
  assert.equal(scheduled.facts.action_stage, "scheduled");
  assert.equal(evaluateCorporate(scheduled, [
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
  ]).status, "match");
  assert.equal(evaluateCorporate(scheduled, [
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
    { key: "corporate_action.action_stage", operator: "eq", value: "scheduled" },
  ]).status, "match");
  assert.equal(evaluateCorporate(scheduled, [
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
    { key: "corporate_action.action_stage", operator: "eq", value: "effective" },
  ]).status, "no_match");
  assert.equal(evaluateCorporate(scheduled, [
    { key: "market.price", operator: "lt", value: 1 },
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
    { key: "corporate_action.action_stage", operator: "eq", value: "announced" },
  ], price(0.82, "realtime")).status, "no_match");
  assert.equal(evaluateCorporate(availableCorporateAction("effective"), [
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
    { key: "corporate_action.action_stage", operator: "eq", value: "effective" },
  ]).status, "match");
});

test("source-backed forward split facts match the same Corporate Action Alert lifecycle semantics", () => {
  const scheduled = availableCorporateAction("scheduled", "forward_split");
  assert.equal(evaluateCorporate(scheduled, [
    { key: "corporate_action.event_kind", operator: "eq", value: "forward_split" },
  ]).status, "match");
  assert.equal(evaluateCorporate(scheduled, [
    { key: "corporate_action.event_kind", operator: "eq", value: "forward_split" },
    { key: "corporate_action.action_stage", operator: "eq", value: "scheduled" },
  ]).status, "match");
  assert.equal(evaluateCorporate(scheduled, [
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
  ]).status, "no_match");
});

test("price plus reverse split uses common AND semantics and fails closed for unusable prices", () => {
  const conditions = [
    { key: "market.price", operator: "lt", value: 1 },
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
  ] satisfies ListingMonitorCondition[];
  const input = { evaluationDate: EVALUATION_DATE, evaluatedAt: "2026-08-14T12:00:00.000Z" };
  assert.equal(evaluateCorporate(availableCorporateAction(), conditions, price(0.82, "realtime")).status, "match");
  assert.equal(evaluateCorporate(availableCorporateAction(), conditions, price(1.20, "realtime")).status, "no_match");
  assert.deepEqual(statusAndReason(evaluateCorporate(
    availableCorporateAction(),
    conditions,
    price(0.82, "end-of-day"),
  )), ["ineligible", "market_price_data_mode_ineligible"]);
  assert.deepEqual(statusAndReason(evaluateCorporate(
    availableCorporateAction(),
    conditions,
    price(0.82, "realtime", "2026-08-14T11:54:59.999Z"),
  )), ["ineligible", "market_price_stale"]);
  assert.deepEqual(statusAndReason(evaluateCorporate(
    availableCorporateAction(),
    conditions,
    { asOf: null, availability: "unavailable", dataMode: null, price: null, symbol: "AEMD" },
  )), ["ineligible", "market_price_unavailable"]);
});

test("event matcher reads the official Corporate Action fact and provider-neutral price once", async () => {
  let listingReads = 0;
  let corporateActionReads = 0;
  let tickerReads = 0;
  let priceReads = 0;
  const result = await evaluateListingMonitorEvent({
    eventId: EVENT_ID,
    evaluationDate: EVALUATION_DATE,
    evaluatedAt: "2026-08-14T12:00:00.000Z",
    conditionSets: [
      {
        id: "aemd-under-one",
        conditions: [
          { key: "market.price", operator: "lt", value: 1 },
          { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
        ],
      },
      {
        id: "aemd-scheduled",
        conditions: [
          { key: "market.price", operator: "gte", value: 0.5 },
          { key: "corporate_action.action_stage", operator: "eq", value: "scheduled" },
        ],
      },
    ],
  }, {
    readFacts: async () => {
      listingReads += 1;
      return availableCurrent();
    },
    readCorporateActionFacts: async () => {
      corporateActionReads += 1;
      return availableCorporateAction();
    },
    readEventTicker: async () => {
      tickerReads += 1;
      return "AEMD";
    },
    readCurrentPrice: async (symbol) => {
      priceReads += 1;
      assert.equal(symbol, "AEMD");
      return { ...price(0.82), symbol };
    },
  });
  assert.equal(listingReads, 0, "unrequested Listing facts are not read");
  assert.equal(corporateActionReads, 1);
  assert.equal(tickerReads, 1);
  assert.equal(priceReads, 1);
  assert.deepEqual(result.evaluations.map((item) => item.result.status), ["match", "match"]);
});

test("event matcher reads one provider-neutral price for every price condition", async () => {
  let factReads = 0;
  let priceReads = 0;
  const eventResult = await evaluateListingMonitorEvent({
    eventId: EVENT_ID,
    evaluationDate: EVALUATION_DATE,
    evaluatedAt: "2026-08-14T12:00:00.000Z",
    conditionSets: [{
      id: "combined",
      conditions: [
        { key: "market.price", operator: "lt", value: 1 },
        { key: "market.price", operator: "gte", value: 0.5 },
        { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
      ],
    }],
  }, {
    readFacts: async () => {
      factReads += 1;
      return availableCurrent();
    },
    readCurrentPrice: async (symbol) => {
      priceReads += 1;
      assert.equal(symbol, "ATPC");
      return price(0.99);
    },
  });
  assert.equal(factReads, 1);
  assert.equal(priceReads, 1);
  assert.equal(eventResult.evaluations[0].result.status, "match");
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
  // Typed provenance names (e.g. Form4PurchaseMatchEvidence) are permitted;
  // the matcher must not invoke providers, parse documents or deliver alerts.
  assert.doesNotMatch(source, /\bfetch\s*\(|generateContent|runOpenAiJsonPrompt|parseSec\w*\s*\(|createListingMonitorAlert\s*\(|sendTelegram\s*\(/);
});

function evaluate(current: CurrentListingRiskReadResult, conditions: readonly ListingMonitorCondition[]) {
  return evaluateListingMonitorConditions(current, conditions, { evaluationDate: EVALUATION_DATE });
}

function evaluateCorporate(
  current: CurrentCorporateActionReadResult,
  conditions: readonly ListingMonitorCondition[],
  currentPrice?: CurrentPrice,
) {
  return evaluateMonitorConditions({
    listing: { status: "not_ready", reason: "reader_not_requested" },
    corporateAction: current,
    ownership: { status: "not_ready", reason: "reader_not_requested" },
  }, conditions, {
    evaluationDate: EVALUATION_DATE,
    evaluatedAt: "2026-08-14T12:00:00.000Z",
    ...(currentPrice ? { currentPrice } : {}),
  });
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

function corporateActionLineage() {
  return {
    eventId: EVENT_ID,
    rawItemId: "82000000-0000-4000-8000-000000000002",
    parentPrimaryAiRunId: "82000000-0000-4000-8000-000000000003",
    sourceExecutionId: "82000000-0000-4000-8000-000000000004",
    monitorAnalyzerKey: "corporate_action" as const,
    analyzerContractVersion: "corporate_action_reverse_split_analyzer_v1",
    persistedAt: "2026-08-14T00:00:00.000Z",
  };
}

function availableCorporateAction(
  actionStage: "announced" | "board_approved" | "shareholder_approved" | "scheduled" | "effective" = "scheduled",
  eventKind: "reverse_split" | "forward_split" = "reverse_split",
): Extract<CurrentCorporateActionReadResult, { status: "available" }> {
  const version = eventKind === "reverse_split"
    ? "corporate_action_reverse_split_facts_v1" as const
    : "corporate_action_forward_split_facts_v1" as const;
  return {
    status: "available",
    ...corporateActionLineage(),
    factSchemaVersion: version,
    facts: {
      version,
      event_kind: eventKind,
      action_stage: actionStage,
      effective_date: { availability: "available", value: "2026-08-18" },
      ratio: { old_shares_per_new_share: { availability: "available", value: 20 } },
      source_ref: "aemd_source",
      evidence: { availability: "available", value: `AEMD announced a ${eventKind === "reverse_split" ? "reverse" : "forward"} stock split.` },
      confidence: "high",
      as_of: { availability: "available", value: "2026-08-14" },
      source: { source_family: "news", source_id: "AEMD", source_url: "https://example.com/aemd" },
    },
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

function price(
  value: number,
  dataMode: CurrentPriceDataMode = "realtime",
  asOf = "2026-08-14T11:59:00.000Z",
): CurrentPrice {
  return {
    asOf,
    availability: "available",
    dataMode,
    price: value,
    symbol: "ATPC",
  };
}
