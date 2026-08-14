import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getReadyMonitorConditions } from "./conditionRegistry.ts";
import {
  changeListingMonitorDraftConditionKey,
  changeListingMonitorDraftConditionOperator,
  createListingMonitorDraftReview,
  formatListingMonitorConditionPreview,
  getListingMonitorConditionEditorCatalog,
  getListingMonitorDraftCreateGate,
  removeListingMonitorDraftCondition,
  replaceListingMonitorDraftCondition,
  setListingMonitorDraftIssueAbandoned,
} from "./listingMonitorDraftReview.ts";

const NASDAQ = Object.freeze({ key: "listing.exchange", operator: "eq" as const, value: "Nasdaq" });
const DEFICIENCY = Object.freeze({ key: "listing.event_kind", operator: "eq" as const, value: "deficiency_notice" });
const ADVERSE = Object.freeze({ key: "listing.event_outcome", operator: "eq" as const, value: "adverse" });
const DEADLINE = Object.freeze({ key: "listing.compliance_deadline", operator: "within_days" as const, value: 30 });
const PRICE = Object.freeze({ key: "market.price", operator: "lt" as const, value: 1 });

test("Listing editor catalog is complete and derives all visible labels from Registry metadata", () => {
  const definitions = getReadyMonitorConditions().filter((definition) => definition.monitorDomains?.includes("listing"));
  const catalog = getListingMonitorConditionEditorCatalog();
  assert.equal(catalog.length, definitions.length);
  assert.deepEqual(catalog.map((item) => item.key), definitions.map((item) => item.key));
  for (const item of catalog) {
    const definition = definitions.find((candidate) => candidate.key === item.key)!;
    assert.equal(item.label, definition.display?.label);
    assert.deepEqual(item.operators.map((operator) => operator.value), definition.allowedOperators);
    if (definition.enumValues) {
      assert.deepEqual(
        item.values,
        definition.enumValues
          .filter((value) => !definition.eligibility?.ineligibleValues?.includes(value))
          .map((value) => ({ value, label: definition.display?.enumValueLabels?.[value] })),
      );
    }
    assert.ok(item.label.trim());
    assert.ok(item.operators.every((operator) => operator.label.trim()));
    assert.ok(item.values.every((value) => value.label.trim()));
  }
});

test("A draft exposes every mapped condition and adverse removal produces the exact final three", () => {
  let review = createListingMonitorDraftReview(draft({
    draftStatus: "READY_FOR_REVIEW",
    compilerStatus: "VALID",
    conditions: [NASDAQ, DEFICIENCY, ADVERSE, DEADLINE],
  }));
  assert.deepEqual(review.conditions.map((condition) => formatListingMonitorConditionPreview(condition).text), [
    "Exchange — Nasdaq",
    "Listing event — Listing deficiency notice",
    "Listing outcome — Unfavorable",
    "Compliance deadline — Within 30 days",
  ]);
  review = removeListingMonitorDraftCondition(review, 2);
  const gate = getListingMonitorDraftCreateGate(review);
  assert.equal(gate.ready, true);
  assert.deepEqual(gate.conditions, [NASDAQ, DEFICIENCY, DEADLINE]);
  assert.equal(new Set<string>(gate.conditions.map((condition) => condition.key)).has("listing.event_outcome"), false);
});

test("Price draft is supported, editable, removable, and positive-number gated", () => {
  let review = createListingMonitorDraftReview(draft({
    draftStatus: "READY_FOR_REVIEW",
    compilerStatus: "VALID",
    conditions: [PRICE, DEFICIENCY],
  }));
  assert.deepEqual(review.conditions.map((condition) => formatListingMonitorConditionPreview(condition).text), [
    "Price — Below $1",
    "Listing event — Listing deficiency notice",
  ]);
  assert.equal(getListingMonitorDraftCreateGate(review).ready, true);

  const invalid = replaceListingMonitorDraftCondition(review, 0, { ...PRICE, value: 0 });
  assert.equal(getListingMonitorDraftCreateGate(invalid).ready, false);
  assert.equal(formatListingMonitorConditionPreview(invalid.conditions[0]).text, "Condition — Choose a valid value");

  review = replaceListingMonitorDraftCondition(review, 0, { ...PRICE, value: 0.75 });
  assert.equal(formatListingMonitorConditionPreview(review.conditions[0]).text, "Price — Below $0.75");
  review = removeListingMonitorDraftCondition(review, 0);
  const gate = getListingMonitorDraftCreateGate(review);
  assert.equal(gate.ready, true);
  assert.deepEqual(gate.conditions, [DEFICIENCY]);
  assert.equal(gate.conditions.some((condition) => condition.key.includes("price")), false);
  assert.equal(new Set<string>(gate.conditions.map((condition) => condition.key)).has("listing.event_outcome"), false);
});

test("mapped edit uses Registry key/operator/value choices and delete of the final condition blocks create", () => {
  let review = createListingMonitorDraftReview(draft({
    draftStatus: "READY_FOR_REVIEW",
    compilerStatus: "VALID",
    conditions: [DEFICIENCY],
  }));
  const recovery = replaceListingMonitorDraftCondition(review, 0, {
    key: "listing.event_kind",
    operator: "eq",
    value: "compliance_recovery",
  });
  assert.equal(getListingMonitorDraftCreateGate(recovery).ready, true);
  assert.equal(formatListingMonitorConditionPreview(recovery.conditions[0]).text, "Listing event — Compliance recovery");

  const textCondition = changeListingMonitorDraftConditionKey(recovery.conditions[0], "listing.exchange");
  assert.deepEqual(textCondition, { key: "listing.exchange", operator: "eq", value: "" });
  assert.equal(formatListingMonitorConditionPreview(textCondition).text, "Condition — Choose a valid value");

  const dateCondition = changeListingMonitorDraftConditionKey(recovery.conditions[0], "listing.compliance_deadline");
  const withinDays = changeListingMonitorDraftConditionOperator(dateCondition, "within_days");
  const edited = replaceListingMonitorDraftCondition(recovery, 0, { ...withinDays, value: 14 });
  assert.equal(getListingMonitorDraftCreateGate(edited).ready, true);
  assert.equal(formatListingMonitorConditionPreview(edited.conditions[0]).text, "Compliance deadline — Within 14 days");

  review = removeListingMonitorDraftCondition(review, 0);
  const emptyGate = getListingMonitorDraftCreateGate(review);
  assert.equal(emptyGate.ready, false);
  assert.ok(emptyGate.errors.includes("condition_set_empty"));
});

test("invalid edits, malformed drafts, empty ready drafts, and contradictions fail closed", () => {
  const valid = createListingMonitorDraftReview(draft({
    draftStatus: "READY_FOR_REVIEW",
    compilerStatus: "VALID",
    conditions: [DEFICIENCY],
  }));
  for (const condition of [
    { key: "listing.not_registered", operator: "eq" as const, value: "anything" },
    { key: "listing.event_kind", operator: "within_days" as const, value: 30 },
    { key: "listing.event_kind", operator: "eq" as const, value: "not_a_kind" },
  ]) {
    const invalid = replaceListingMonitorDraftCondition(valid, 0, condition);
    assert.equal(getListingMonitorDraftCreateGate(invalid).ready, false);
    assert.equal(formatListingMonitorConditionPreview(condition).text, "Condition — Choose a valid value");
  }
  const contradictory = replaceListingMonitorDraftCondition(
    createListingMonitorDraftReview(draft({
      draftStatus: "READY_FOR_REVIEW",
      compilerStatus: "VALID",
      conditions: [DEFICIENCY, DEFICIENCY],
    })),
    1,
    { key: "listing.event_kind", operator: "eq", value: "compliance_recovery" },
  );
  assert.equal(getListingMonitorDraftCreateGate(contradictory).ready, false);
  assert.throws(() => createListingMonitorDraftReview({}), /invalid/i);
  assert.throws(() => createListingMonitorDraftReview(draft({
    draftStatus: "READY_FOR_REVIEW",
    compilerStatus: "VALID",
    conditions: [],
  })), /readiness/i);
});

test("ambiguous requirements remain visible and require explicit abandonment", () => {
  let review = createListingMonitorDraftReview(draft({
    draftStatus: "NEEDS_ATTENTION",
    compilerStatus: "AMBIGUOUS",
    conditions: [DEFICIENCY],
    ambiguous: [{
      sourceText: "something happens with a company's listing",
      status: "Needs clarification",
      question: "Which listing event should be monitored?",
    }],
  }));
  assert.equal(review.issues[0].detail, "Which listing event should be monitored?");
  assert.equal(getListingMonitorDraftCreateGate(review).ready, false);
  review = setListingMonitorDraftIssueAbandoned(review, review.issues[0].id, true);
  assert.equal(getListingMonitorDraftCreateGate(review).ready, true);
});

test("human presentation covers price operators and Listing values without raw literals", () => {
  const previews = [
    formatListingMonitorConditionPreview(PRICE).text,
    formatListingMonitorConditionPreview({ ...PRICE, operator: "lte" }).text,
    formatListingMonitorConditionPreview({ ...PRICE, operator: "gt" }).text,
    formatListingMonitorConditionPreview({ ...PRICE, operator: "gte" }).text,
    formatListingMonitorConditionPreview(DEFICIENCY).text,
    formatListingMonitorConditionPreview(NASDAQ).text,
    formatListingMonitorConditionPreview({ key: "listing.continued_trading", operator: "eq", value: true }).text,
    formatListingMonitorConditionPreview({ key: "listing.hearing_date", operator: "eq", value: "2026-08-20" }).text,
    formatListingMonitorConditionPreview(DEADLINE).text,
  ];
  assert.deepEqual(previews, [
    "Price — Below $1",
    "Price — $1 or less",
    "Price — Above $1",
    "Price — $1 or more",
    "Listing event — Listing deficiency notice",
    "Exchange — Nasdaq",
    "Continued trading — Yes",
    "Hearing date — On Aug 20, 2026",
    "Compliance deadline — Within 30 days",
  ]);
  assert.doesNotMatch(previews.join("\n"), /market\.price|\blt\b|\blte\b|deficiency_notice|within_days|\badverse\b/);
});

test("AI Monitor UI invokes Compiler only from submit and creates only from explicit confirmation", () => {
  const component = readProjectFile("components/alerts-v2/ListingMonitorDraftBuilder.tsx");
  const parent = readProjectFile("components/alerts-v2/StockRadarAlertsV2.tsx");
  const monitorPage = readProjectFile("app/monitor/page.tsx");
  assert.equal((component.match(/fetch\("\/api\/monitors\/listing\/compile"/g) ?? []).length, 1);
  assert.equal((component.match(/fetch\("\/api\/monitors\/listing", \{/g) ?? []).length, 2);
  assert.match(component, /onSubmit=\{compileDraft\}/);
  assert.match(component, /Create this monitor/);
  assert.match(component, /body: JSON\.stringify\(\{ conditions: createGate\.conditions \}\)/);
  assert.match(component, /\{issue\.abandoned \? "Restore" : "Remove"\}/);
  assert.match(component, /createGate\?\.ready/);
  assert.match(component, /\/login\?next=%2Fmonitor/);
  assert.match(parent, /<ListingMonitorManagement \/>/);
  assert.match(parent, /href="\/monitor">Open AI Monitor/);
  assert.match(monitorPage, /<ListingMonitorDraftBuilder \/>/);
  assert.match(monitorPage, /Tell Stock Radar what to watch\./);
  assert.doesNotMatch(component, /Requirements needing a decision|Explicit confirmation required|Abandon requirement|Review mapped conditions|Build draft preview/);
  assert.doesNotMatch(component, /supabase|userId|service_role|IndependentCoverageVerifier|second LLM/i);
  assert.doesNotMatch(component, /deficiency_notice|compliance_recovery|\badverse\b/);
  assert.match(component, /editor\.valueType === "number"/);
  assert.match(component, /type="number"/);
});

function draft({
  draftStatus,
  compilerStatus,
  conditions,
  unsupported = [],
  ambiguous = [],
}: {
  draftStatus: "READY_FOR_REVIEW" | "NEEDS_ATTENTION";
  compilerStatus: "VALID" | "UNSUPPORTED" | "AMBIGUOUS";
  conditions: readonly Record<string, unknown>[];
  unsupported?: readonly Record<string, unknown>[];
  ambiguous?: readonly Record<string, unknown>[];
}) {
  return {
    version: "natural_language_monitor_draft_v1",
    draftStatus,
    compilerStatus,
    conditions,
    mapped: [],
    unsupported,
    ambiguous,
    message: "Review this draft.",
  };
}

function readProjectFile(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}
