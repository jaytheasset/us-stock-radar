import assert from "node:assert/strict";
import test from "node:test";
import type { MonitorConditionOperator } from "./conditionRegistry.ts";
import {
  NaturalLanguageConditionCompilerError,
  validateNaturalLanguageConditionCompilerOutput,
} from "./naturalLanguageConditionCompiler.ts";
import {
  buildNaturalLanguageMonitorDraft,
  formatNaturalLanguageMonitorDraftCondition,
  NATURAL_LANGUAGE_MONITOR_DRAFT_VERSION,
} from "./naturalLanguageMonitorDraft.ts";

test("preview formats Listing enum, text, boolean, fixed date, relative date, and set operators", () => {
  const cases = [
    [condition("listing.event_kind", "eq", "deficiency_notice"), "Listing event — Listing deficiency notice"],
    [condition("listing.event_outcome", "eq", "adverse"), "Listing outcome — Unfavorable"],
    [condition("listing.exchange", "eq", "Nasdaq"), "Exchange — Nasdaq"],
    [condition("listing.exchange", "neq", "NYSE"), "Exchange — Does not equal NYSE"],
    [condition("listing.exchange", "in", ["Nasdaq", "NYSE"]), "Exchange — Any of: Nasdaq, NYSE"],
    [condition("listing.exchange", "not_in", ["Nasdaq", "NYSE"]), "Exchange — None of: Nasdaq, NYSE"],
    [condition("listing.continued_trading", "eq", false), "Continued trading — No"],
    [condition("listing.continued_trading", "neq", true), "Continued trading — Does not equal Yes"],
    [condition("listing.compliance_deadline", "eq", "2026-08-20"), "Compliance deadline — On Aug 20, 2026"],
    [condition("listing.compliance_deadline", "neq", "2026-08-20"), "Compliance deadline — Not on Aug 20, 2026"],
    [condition("listing.compliance_deadline", "before", "2026-08-20"), "Compliance deadline — Before Aug 20, 2026"],
    [condition("listing.compliance_deadline", "after", "2026-08-20"), "Compliance deadline — After Aug 20, 2026"],
    [condition("listing.compliance_deadline", "within_days", 1), "Compliance deadline — Within 1 day"],
    [condition("listing.compliance_deadline", "within_days", 30), "Compliance deadline — Within 30 days"],
    [condition("listing.proceeding_status", "in", ["requested", "pending"]), "Proceeding status — Any of: Requested, Pending"],
  ] as const;

  cases.forEach(([candidate, expected], index) => {
    assert.equal(formatNaturalLanguageMonitorDraftCondition({ id: `c${index + 1}`, ...candidate }).text, expected);
  });
});

test("draft preserves canonical conditions unchanged while hiding raw codes from human preview", () => {
  const text = "Alert me when a Nasdaq company receives a listing deficiency and has a compliance deadline within 30 days.";
  const result = validate(providerOutput([
    requirement("a Nasdaq company", "mapped", [condition("listing.exchange", "eq", "Nasdaq")]),
    requirement("receives a listing deficiency", "mapped", [
      condition("listing.event_kind", "eq", "deficiency_notice"),
      condition("listing.event_outcome", "eq", "adverse"),
    ]),
    requirement("has a compliance deadline within 30 days", "mapped", [
      condition("listing.compliance_deadline", "within_days", 30),
    ]),
  ]), text);
  const canonicalBefore = JSON.parse(JSON.stringify(result.conditions));
  const draft = buildNaturalLanguageMonitorDraft(result, text);

  assert.equal(draft.version, NATURAL_LANGUAGE_MONITOR_DRAFT_VERSION);
  assert.equal(draft.draftStatus, "READY_FOR_REVIEW");
  assert.equal(draft.compilerStatus, "VALID");
  assert.deepEqual(draft.conditions, canonicalBefore);
  assert.deepEqual(result.conditions, canonicalBefore);
  assert.deepEqual(draft.mapped.flatMap((item) => item.conditions.map((preview) => preview.text)), [
    "Exchange — Nasdaq",
    "Listing event — Listing deficiency notice",
    "Listing outcome — Unfavorable",
    "Compliance deadline — Within 30 days",
  ]);
  const humanPreview = JSON.stringify(draft.mapped);
  assert.doesNotMatch(humanPreview, /deficiency_notice|adverse|within_days|listing\./);
  assert.match(JSON.stringify(draft.conditions), /deficiency_notice|adverse|within_days/);
});

test("unsupported and ambiguous requirements remain separate, visible, and attention-gated", () => {
  const text = "below $3 listing deficiency and a listing event";
  const result = validate(providerOutput([
    requirement("below $3", "unsupported", [], "The Registry has no stock-price condition."),
    requirement("listing deficiency", "mapped", [condition("listing.event_kind", "eq", "deficiency_notice")]),
    requirement("a listing event", "ambiguous", [], null, "Which listing event should be monitored?"),
  ]), text);
  const draft = buildNaturalLanguageMonitorDraft(result, text);

  assert.equal(draft.compilerStatus, "UNSUPPORTED");
  assert.equal(draft.draftStatus, "NEEDS_ATTENTION");
  assert.deepEqual(draft.mapped, [{
    sourceText: "listing deficiency",
    conditions: [{
      label: "Listing event",
      value: "Listing deficiency notice",
      text: "Listing event — Listing deficiency notice",
    }],
  }]);
  assert.deepEqual(draft.unsupported, [{
    sourceText: "below $3",
    status: "Unsupported",
    reason: "The Registry has no stock-price condition.",
  }]);
  assert.deepEqual(draft.ambiguous, [{
    sourceText: "a listing event",
    status: "Needs clarification",
    question: "Which listing event should be monitored?",
  }]);
});

test("ambiguous-only and contradictory Compiler results never become ready drafts", () => {
  const ambiguousText = "something with a listing";
  const ambiguous = buildNaturalLanguageMonitorDraft(validate(providerOutput([
    requirement(ambiguousText, "ambiguous", [], null, "Which listing event?"),
  ]), ambiguousText), ambiguousText);
  assert.equal(ambiguous.draftStatus, "NEEDS_ATTENTION");
  assert.deepEqual(ambiguous.conditions, []);

  const contradictoryText = "listing deficiency and compliance recovery";
  const contradictory = buildNaturalLanguageMonitorDraft(validate(providerOutput([
    requirement("listing deficiency", "mapped", [condition("listing.event_kind", "eq", "deficiency_notice")]),
    requirement("compliance recovery", "mapped", [condition("listing.event_kind", "eq", "compliance_recovery")]),
  ]), contradictoryText), contradictoryText);
  assert.equal(contradictory.compilerStatus, "CONTRADICTORY");
  assert.equal(contradictory.draftStatus, "NEEDS_ATTENTION");
});

test("invalid Registry data, malformed references, and empty ready drafts fail closed", () => {
  for (const candidate of [
    condition("listing.invented", "eq", "anything"),
    condition("listing.event_kind", "gt", "deficiency_notice"),
    condition("listing.event_kind", "eq", "invented"),
  ]) {
    assert.throws(
      () => formatNaturalLanguageMonitorDraftCondition({ id: "c1", ...candidate }),
      compilerOutputInvalid,
    );
  }

  const text = "listing deficiency";
  const valid = validate(providerOutput([
    requirement(text, "mapped", [condition("listing.event_kind", "eq", "deficiency_notice")]),
  ]), text);
  const emptyReady = {
    ...valid,
    conditions: [],
    ledger: { ...valid.ledger, conditions: [] },
  } as typeof valid;
  assert.throws(() => buildNaturalLanguageMonitorDraft(emptyReady, text), compilerOutputInvalid);
});

function validate(value: unknown, text: string) {
  return validateNaturalLanguageConditionCompilerOutput(value, text);
}

function providerOutput(requirements: readonly Record<string, unknown>[]) {
  return { requirements };
}

function requirement(
  sourceText: string,
  decision: "mapped" | "unsupported" | "ambiguous",
  conditions: readonly Record<string, unknown>[],
  reason: string | null = null,
  question: string | null = null,
) {
  return { source_text: sourceText, decision, conditions, reason, question };
}

function condition(key: string, operator: MonitorConditionOperator, value: unknown) {
  return { key, operator, value };
}

function compilerOutputInvalid(error: unknown) {
  return error instanceof NaturalLanguageConditionCompilerError
    && error.code === "CONDITION_COMPILER_OUTPUT_INVALID";
}
