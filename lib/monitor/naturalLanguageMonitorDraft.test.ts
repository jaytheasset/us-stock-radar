import assert from "node:assert/strict";
import test from "node:test";
import { handleListingMonitorConfirmationPost } from "../../app/api/monitors/listing/confirm/handler.ts";
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
import {
  applyNaturalLanguageMonitorConfirmation,
  NaturalLanguageMonitorConfirmationError,
  parseNaturalLanguageMonitorConfirmationRequest,
} from "./naturalLanguageMonitorConfirmation.ts";

test("preview formats Listing enum, text, boolean, fixed date, relative date, and set operators", () => {
  const cases = [
    [condition("market.price", "lt", 1), "Price — Below $1"],
    [condition("market.price", "lte", 1), "Price — $1 or less"],
    [condition("market.price", "gt", 1), "Price — Above $1"],
    [condition("market.price", "gte", 1), "Price — $1 or more"],
    [condition("corporate_action.event_kind", "eq", "reverse_split"), "Corporate action — Reverse stock split"],
    [condition("corporate_action.action_stage", "eq", "scheduled"), "Corporate action stage — Scheduled"],
    [condition("corporate_action.action_stage", "eq", "effective"), "Corporate action stage — Effective"],
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

test("reverse-split drafts preserve event-only and explicit lifecycle-stage semantics without raw codes", () => {
  const simpleText = "Alert me about reverse splits.";
  const simple = buildNaturalLanguageMonitorDraft(validate(providerOutput([
    requirement("reverse splits", "mapped", [
      condition("corporate_action.event_kind", "eq", "reverse_split"),
    ]),
  ]), simpleText), simpleText);
  assert.deepEqual(simple.conditions, [
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
  ]);
  assert.deepEqual(simple.mapped.flatMap((item) => item.conditions.map((item) => item.text)), [
    "Corporate action — Reverse stock split",
  ]);

  const effectiveText = "Alert me when a reverse split becomes effective.";
  const effective = buildNaturalLanguageMonitorDraft(validate(providerOutput([
    requirement("a reverse split becomes effective", "mapped", [
      condition("corporate_action.event_kind", "eq", "reverse_split"),
      condition("corporate_action.action_stage", "eq", "effective"),
    ]),
  ]), effectiveText), effectiveText);
  assert.equal(effective.draftStatus, "NEEDS_CONFIRMATION");
  assert.deepEqual(effective.conditions, [
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
  ]);
  assert.deepEqual(effective.mapped[0].conditions.map((item) => item.text), [
    "Corporate action — Reverse stock split",
  ]);
  assert.equal(effective.proposed[0].preview.text, "Corporate action stage — Effective");
  assert.equal(effective.unsupported.length, 0);
  assert.doesNotMatch(JSON.stringify(effective.mapped), /reverse_split|corporate_action|market\.price|\blt\b/);
});

test("price plus listing deficiency draft is Registry-mapped and hides internal names", () => {
  const text = "Alert me when a stock is below $1 and receives a listing deficiency.";
  const result = validate(providerOutput([
    requirement("a stock is below $1", "mapped", [condition("market.price", "lt", 1)]),
    requirement("receives a listing deficiency", "mapped", [
      condition("listing.event_kind", "eq", "deficiency_notice"),
    ]),
  ]), text);
  const draft = buildNaturalLanguageMonitorDraft(result, text);
  assert.equal(draft.draftStatus, "READY_FOR_REVIEW");
  assert.deepEqual(draft.mapped.flatMap((item) => item.conditions.map((preview) => preview.text)), [
    "Price — Below $1",
    "Listing event — Listing deficiency notice",
  ]);
  assert.equal(draft.unsupported.length, 0);
  assert.doesNotMatch(JSON.stringify(draft.mapped), /market\.price|\blt\b|deficiency_notice/);
  assert.deepEqual(draft.conditions, [
    { key: "market.price", operator: "lt", value: 1 },
    { key: "listing.event_kind", operator: "eq", value: "deficiency_notice" },
  ]);
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
  const text = "daily volume above 1m listing deficiency and a listing event";
  const result = validate(providerOutput([
    requirement("daily volume above 1m", "unsupported", [], "The Registry has no daily-volume condition."),
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
    sourceText: "daily volume above 1m",
    status: "Unsupported",
    reason: "The Registry has no daily-volume condition.",
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

test("Registry confirmation partitions stage, applies omit or exact use with zero Compiler calls, and fails forged input", () => {
  const text = "Alert me when a stock below $1 announces a reverse split.";
  const draft = buildNaturalLanguageMonitorDraft(validate(providerOutput([
    requirement("a stock below $1", "mapped", [condition("market.price", "lt", 1)]),
    requirement("announces a reverse split", "mapped", [
      condition("corporate_action.event_kind", "eq", "reverse_split"),
      condition("corporate_action.action_stage", "eq", "announced"),
    ]),
  ]), text), text);
  assert.equal(draft.draftStatus, "NEEDS_CONFIRMATION");
  assert.deepEqual(draft.conditions, [
    { key: "market.price", operator: "lt", value: 1 },
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
  ]);
  assert.deepEqual(draft.proposed[0], {
    id: "p1",
    condition: { key: "corporate_action.action_stage", operator: "eq", value: "announced" },
    preview: {
      label: "Corporate action stage",
      value: "Initial plan announced",
      text: "Corporate action stage — Initial plan announced",
    },
    choices: [
      { id: "use", label: "Use this filter" },
      { id: "omit", label: "Any stage" },
    ],
    state: "pending",
  });

  const any = applyNaturalLanguageMonitorConfirmation(parseNaturalLanguageMonitorConfirmationRequest({
    draft,
    proposalId: "p1",
    choiceId: "omit",
  }));
  assert.equal(any.draftStatus, "READY_FOR_REVIEW");
  assert.deepEqual(any.conditions, [
    { key: "market.price", operator: "lt", value: 1 },
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
  ]);
  assert.deepEqual(any.mapped[0].conditions.map((item) => item.text), [
    "Price — Below $1",
    "Corporate action — Reverse stock split",
  ]);

  assert.equal(any.unresolvedCount, 0);
  assert.equal(any.proposed[0].state, "omitted");

  const use = applyNaturalLanguageMonitorConfirmation(parseNaturalLanguageMonitorConfirmationRequest({
    draft,
    proposalId: "p1",
    choiceId: "use",
  }));
  assert.deepEqual(use.conditions.at(-1), {
    key: "corporate_action.action_stage",
    operator: "eq",
    value: "announced",
  });
  assert.equal(use.proposed[0].state, "used");
  assert.throws(() => applyNaturalLanguageMonitorConfirmation(
    parseNaturalLanguageMonitorConfirmationRequest({
      draft,
      proposalId: "p1",
      choiceId: "scheduled",
    }),
  ), (error) => error instanceof NaturalLanguageMonitorConfirmationError);
  assert.throws(() => parseNaturalLanguageMonitorConfirmationRequest({
    draft: {
      ...draft,
      proposed: [{
        ...draft.proposed[0],
        condition: { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
      }],
    },
    proposalId: "p1",
    choiceId: "omit",
  }), (error) => error instanceof NaturalLanguageMonitorConfirmationError);
});

test("confirmation API enforces origin and auth and applies an exact Registry proposal without a Compiler dependency", async () => {
  const text = "reverse split announcement";
  const draft = buildNaturalLanguageMonitorDraft(validate(providerOutput([
    requirement("reverse split announcement", "mapped", [
      condition("corporate_action.event_kind", "eq", "reverse_split"),
      condition("corporate_action.action_stage", "eq", "announced"),
    ]),
  ]), text), text);
  const body = { draft, proposalId: "p1", choiceId: "use" };
  const loggedOut = await handleListingMonitorConfirmationPost(apiRequest(body), {
    resolveUserId: async () => null,
  });
  assert.equal(loggedOut.status, 401);
  const crossOrigin = await handleListingMonitorConfirmationPost(apiRequest(body, "https://foreign.example"), {
    resolveUserId: async () => "10000000-0000-4000-8000-000000000001",
  });
  assert.equal(crossOrigin.status, 403);
  const accepted = await handleListingMonitorConfirmationPost(apiRequest(body), {
    resolveUserId: async () => "10000000-0000-4000-8000-000000000001",
  });
  assert.equal(accepted.status, 200);
  const payload = await accepted.json();
  assert.equal(payload.data.draftStatus, "READY_FOR_REVIEW");
  assert.deepEqual(payload.data.conditions, [
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
    { key: "corporate_action.action_stage", operator: "eq", value: "announced" },
  ]);
});

test("effective narrowing is pending until exact approval and unknown is never proposal-eligible", () => {
  const text = "Alert me when a reverse split becomes effective.";
  const draft = buildNaturalLanguageMonitorDraft(validate(providerOutput([
    requirement("a reverse split becomes effective", "mapped", [
      condition("corporate_action.event_kind", "eq", "reverse_split"),
      condition("corporate_action.action_stage", "eq", "effective"),
    ]),
  ]), text), text);
  assert.equal(draft.draftStatus, "NEEDS_CONFIRMATION");
  assert.deepEqual(draft.conditions, [
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
  ]);
  assert.equal(draft.proposed[0].preview.value, "Effective");
  const approved = applyNaturalLanguageMonitorConfirmation(parseNaturalLanguageMonitorConfirmationRequest({
    draft,
    proposalId: "p1",
    choiceId: "use",
  }));
  assert.deepEqual(approved.conditions, [
    { key: "corporate_action.event_kind", operator: "eq", value: "reverse_split" },
    { key: "corporate_action.action_stage", operator: "eq", value: "effective" },
  ]);
  assert.throws(() => parseNaturalLanguageMonitorConfirmationRequest({
    draft: {
      ...draft,
      proposed: [{
        ...draft.proposed[0],
        condition: { key: "corporate_action.action_stage", operator: "eq", value: "unknown" },
      }],
    },
    proposalId: "p1",
    choiceId: "use",
  }), (error) => error instanceof NaturalLanguageMonitorConfirmationError);
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

function apiRequest(body: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/monitors/listing/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
}
