import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReverseSplitActionId,
  canonicalizeCorporateActionAnalyzerResult,
  validateCorporateActionAnalyzerResult,
  type CorporateActionAnalyzerTransportResult,
  type CorporateActionCanonicalFacts,
  type ReverseSplitActionCandidate,
} from "./corporateActionCanonicalFacts.ts";
import { adaptSec8k6kCorporateActionSource } from "./corporateActionSourceAdapters.ts";
import {
  actionCandidatesFromObservations,
  projectReverseSplitAction,
  readReverseSplitActionCandidatesForAnalyzer,
  readReverseSplitActionHistory,
  reverseSplitSameDayApplicationDecision,
  type ReverseSplitActionObservation,
} from "./reverseSplitActionLifecycle.ts";
import type { CurrentCorporateActionReadResult } from "./corporateActionPersistence.ts";

const cik = "0001234567";
const singleClassId = `sc:v1:${cik}:common_stock:single`;
const classAId = `sc:v1:${cik}:common_stock:us-gaap:CommonClassAMember`;
const classBId = `sc:v1:${cik}:common_stock:us-gaap:CommonClassBMember`;
const eventOne = "10000000-0000-4000-8000-000000000001";
const eventTwo = "10000000-0000-4000-8000-000000000002";
const eventThree = "10000000-0000-4000-8000-000000000003";
const eventFour = "10000000-0000-4000-8000-000000000004";
const eventLater = "10000000-0000-4000-8000-000000000005";

test("new action identity is deterministic across replay and a later real action gets a distinct ID", () => {
  const first = factsFor({ eventId: eventOne, accessionSequence: 1, decision: "NEW_ACTION" });
  const replay = factsFor({ eventId: eventOne, accessionSequence: 1, decision: "NEW_ACTION" });
  const later = factsFor({ eventId: eventLater, accessionSequence: 9, decision: "NEW_ACTION" });
  assert.equal(first.action_identity?.link_status, "linked");
  assert.equal(first.action_identity?.reverse_split_action_id, buildReverseSplitActionId(cik, eventOne));
  assert.equal(replay.action_identity?.reverse_split_action_id, first.action_identity?.reverse_split_action_id);
  assert.notEqual(later.action_identity?.reverse_split_action_id, first.action_identity?.reverse_split_action_id);
});

test("shareholder approval, final ratio, scheduled and effective filings link to one candidate action", () => {
  const approval = factsFor({
    eventId: eventOne,
    accessionSequence: 1,
    decision: "NEW_ACTION",
    stage: "shareholder_approved",
    ratio: null,
    effectiveDate: null,
  });
  const approvalObservation = observation(eventOne, 1, approval);
  const candidateAfterApproval = actionCandidatesFromObservations([approvalObservation]);
  const finalRatio = factsFor({
    eventId: eventTwo,
    accessionSequence: 2,
    decision: "EXISTING_ACTION_ID",
    existing: candidateAfterApproval,
    stage: "board_approved",
  });
  const ratioObservation = observation(eventTwo, 2, finalRatio);
  const candidateAfterRatio = actionCandidatesFromObservations([approvalObservation, ratioObservation]);
  const scheduled = factsFor({
    eventId: eventThree,
    accessionSequence: 3,
    decision: "EXISTING_ACTION_ID",
    existing: candidateAfterRatio,
    stage: "scheduled",
  });
  const scheduledObservation = observation(eventThree, 3, scheduled);
  const candidateAfterSchedule = actionCandidatesFromObservations([
    approvalObservation,
    ratioObservation,
    scheduledObservation,
  ]);
  const effective = factsFor({
    eventId: eventFour,
    accessionSequence: 4,
    decision: "EXISTING_ACTION_ID",
    existing: candidateAfterSchedule,
    stage: "effective",
  });
  const actionIds = [approval, finalRatio, scheduled, effective]
    .map((facts) => facts.action_identity?.reverse_split_action_id);
  assert.deepEqual([...new Set(actionIds)], [buildReverseSplitActionId(cik, eventOne)]);
  const projection = projectReverseSplitAction([
    approvalObservation,
    ratioObservation,
    scheduledObservation,
    observation(eventFour, 4, effective),
  ]);
  assert.equal(projection.status, "ACTION_AVAILABLE");
  assert.equal(projection.currentStage, "effective");
  assert.equal(projection.observations.length, 4);
  assert.deepEqual(projection.ratio, { availability: "available", old_shares: "10", new_shares: "1" });
  assert.deepEqual(projection.effectiveDate, { availability: "available", value: "2026-08-25" });
});

test("existing link is candidate-bound, class-isolated, and ambiguous links stay unresolved", () => {
  const classA = factsFor({
    eventId: eventOne,
    accessionSequence: 1,
    decision: "NEW_ACTION",
    canonicalSecurityClassId: classAId,
    candidates: [securityCandidate(classAId, "CommonClassAMember")],
  });
  const supplied = actionCandidatesFromObservations([
    observation(eventOne, 1, classA, classAId),
  ]);
  const wrongClass = canonicalResult({
    eventId: eventTwo,
    accessionSequence: 2,
    decision: "EXISTING_ACTION_ID",
    existing: supplied,
    canonicalSecurityClassId: classBId,
    candidates: [
      securityCandidate(classAId, "CommonClassAMember"),
      securityCandidate(classBId, "CommonClassBMember"),
    ],
  });
  assert.equal(wrongClass.result, null);
  assert.match(wrongClass.errors.join("; "), /issuer or security class does not match/);

  const foreignId = canonicalResult({
    eventId: eventTwo,
    accessionSequence: 2,
    decision: "EXISTING_ACTION_ID",
    existing: [],
    existingActionId: buildReverseSplitActionId(cik, eventOne),
  });
  assert.equal(foreignId.result, null);
  assert.match(foreignId.errors.join("; "), /one supplied action candidate/);

  const unresolved = factsFor({
    eventId: eventTwo,
    accessionSequence: 2,
    decision: "UNRESOLVED_ACTION_LINK",
    existing: supplied,
    canonicalSecurityClassId: classAId,
    candidates: [securityCandidate(classAId, "CommonClassAMember")],
  });
  assert.equal(unresolved.action_identity?.link_status, "unresolved");
  assert.equal(unresolved.action_identity?.reverse_split_action_id, null);
  assert.deepEqual(validateCorporateActionAnalyzerResult({ applicable: true, facts: unresolved }), []);
});

test("two current accessions for one split produce one action while a later NEW_ACTION remains separate", async () => {
  const scheduled = factsFor({ eventId: eventOne, accessionSequence: 1, decision: "NEW_ACTION" });
  const scheduledObservation = observation(eventOne, 1, scheduled);
  const existing = actionCandidatesFromObservations([scheduledObservation]);
  const effective = factsFor({
    eventId: eventTwo,
    accessionSequence: 2,
    decision: "EXISTING_ACTION_ID",
    existing,
    stage: "effective",
  });
  const later = factsFor({
    eventId: eventLater,
    accessionSequence: 9,
    decision: "NEW_ACTION",
    effectiveDate: "2026-12-01",
  });
  const reads = new Map<string, CurrentCorporateActionReadResult>([
    [eventOne, currentRead(eventOne, 1, scheduled)],
    [eventTwo, currentRead(eventTwo, 2, effective)],
    [eventLater, currentRead(eventLater, 9, later)],
  ]);
  const history = await readReverseSplitActionHistory({
    cik,
    canonicalSecurityClassId: singleClassId,
    from: "2026-01-01",
    to: "2026-12-31",
  }, {
    rpc: async () => ({
      ok: true,
      status: 200,
      data: {
        status: "available",
        issuer_cik: cik,
        canonical_security_class_id: singleClassId,
        candidates: [
          historyCandidate(eventOne, 1, scheduled),
          historyCandidate(eventTwo, 2, effective),
          historyCandidate(eventLater, 9, later),
        ],
      },
    }),
    readCurrent: async (eventId) => reads.get(eventId)!,
  });
  assert.equal(history.actions.length, 2);
  assert.deepEqual(history.actions.map((action) => action.observations.length), [2, 1]);
  assert.equal(history.actions[0]?.actionId, buildReverseSplitActionId(cik, eventOne));
  assert.equal(history.actions[1]?.actionId, buildReverseSplitActionId(cik, eventLater));
});

test("analyzer candidate context is bounded to supplied issuer classes and current lineage", async () => {
  const facts = factsFor({ eventId: eventOne, accessionSequence: 1, decision: "NEW_ACTION" });
  const current = currentRead(eventOne, 1, facts);
  const candidates = await readReverseSplitActionCandidatesForAnalyzer({
    issuerCik: cik,
    acceptedAt: "2026-08-10T16:30:00Z",
    allowedSecurityClassIds: [singleClassId],
  }, {
    rpc: async () => ({
      ok: true,
      status: 200,
      data: {
        status: "available",
        issuer_cik: cik,
        before_accepted_at: "2026-08-10T16:30:00Z",
        candidates: [historyCandidate(eventOne, 1, facts)],
      },
    }),
    readCurrent: async () => current,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.action_id, buildReverseSplitActionId(cik, eventOne));
  assert.equal(candidates[0]?.canonical_security_class_id, singleClassId);
  assert.equal(candidates[0]?.prior_observations.length, 1);
});

test("analyzer candidate cutoff compares accepted instants instead of timestamp text", async () => {
  const facts = factsFor({ eventId: eventOne, accessionSequence: 10, decision: "NEW_ACTION" });
  const current = currentRead(eventOne, 10, facts);
  const cutoff = "2026-08-10T12:30:00-04:00";
  const candidates = await readReverseSplitActionCandidatesForAnalyzer({
    issuerCik: cik,
    acceptedAt: cutoff,
    allowedSecurityClassIds: [singleClassId],
  }, {
    rpc: async () => ({
      ok: true,
      status: 200,
      data: {
        status: "available",
        issuer_cik: cik,
        before_accepted_at: cutoff,
        candidates: [historyCandidate(eventOne, 10, facts)],
      },
    }),
    readCurrent: async () => current,
  });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.action_id, buildReverseSplitActionId(cik, eventOne));
});

test("same-action final ratio/date conflicts fail closed without choosing a winner", () => {
  const first = factsFor({ eventId: eventOne, accessionSequence: 1, decision: "NEW_ACTION" });
  const firstObservation = observation(eventOne, 1, first);
  const existing = actionCandidatesFromObservations([firstObservation]);
  const conflict = factsFor({
    eventId: eventTwo,
    accessionSequence: 2,
    decision: "EXISTING_ACTION_ID",
    existing,
    ratio: [20, 1],
    effectiveDate: "2026-08-26",
  });
  const projection = projectReverseSplitAction([
    firstObservation,
    observation(eventTwo, 2, conflict),
  ]);
  assert.equal(projection.status, "ACTION_UNRESOLVED");
  assert.deepEqual(projection.unresolvedReasons, [
    "ACTION_EFFECTIVE_DATE_CONFLICT",
    "ACTION_RATIO_CONFLICT",
  ]);
  assert.deepEqual(projection.ratio, { availability: "unavailable" });
  assert.deepEqual(projection.effectiveDate, { availability: "unavailable" });
});

test("same-day ordering is deterministic only for exact timestamp", () => {
  const common = {
    targetAt: "2026-08-25T14:00:00Z",
    targetCalendarDate: "2026-08-25",
    effectiveDate: "2026-08-25",
  };
  assert.equal(reverseSplitSameDayApplicationDecision({
    ...common,
    effectiveTiming: { availability: "unavailable", reason: "date_only" },
  }), "SAME_DAY_ORDER_INDETERMINATE");
  for (const kind of ["market_open", "start_of_trading", "after_market_close"] as const) {
    assert.equal(reverseSplitSameDayApplicationDecision({
      ...common,
      effectiveTiming: {
        availability: "available",
        kind,
        timestamp: null,
        source_ref: "sec_block_1",
        evidence: { availability: "available", value: "effective timing" },
      },
    }), "SAME_DAY_ORDER_INDETERMINATE");
  }
  assert.equal(reverseSplitSameDayApplicationDecision({
    ...common,
    effectiveTiming: {
      availability: "available",
      kind: "exact_timestamp",
      timestamp: "2026-08-25T13:30:00Z",
      source_ref: "sec_block_1",
      evidence: { availability: "available", value: "effective timing" },
    },
  }), "APPLIED");
  assert.equal(reverseSplitSameDayApplicationDecision({
    ...common,
    targetCalendarDate: "2026-08-24",
    effectiveTiming: { availability: "unavailable", reason: "date_only" },
  }), "NOT_APPLIED");
});

type FactsOptions = {
  eventId: string;
  accessionSequence: number;
  decision: "NEW_ACTION" | "EXISTING_ACTION_ID" | "UNRESOLVED_ACTION_LINK";
  existing?: ReverseSplitActionCandidate[];
  existingActionId?: string;
  stage?: "announced" | "board_approved" | "shareholder_approved" | "scheduled" | "effective";
  ratio?: [number, number] | null;
  effectiveDate?: string | null;
  canonicalSecurityClassId?: string;
  candidates?: ReturnType<typeof securityCandidate>[];
};

function factsFor(options: FactsOptions): CorporateActionCanonicalFacts {
  const canonical = canonicalResult(options);
  assert.deepEqual(canonical.errors, []);
  assert.equal(canonical.result?.applicable, true);
  return (canonical.result as { applicable: true; facts: CorporateActionCanonicalFacts }).facts;
}

function canonicalResult(options: FactsOptions) {
  const actionClass = options.canonicalSecurityClassId ?? singleClassId;
  const date = options.effectiveDate === undefined ? "2026-08-25" : options.effectiveDate;
  const ratio = options.ratio === undefined ? [10, 1] as [number, number] : options.ratio;
  const accession = accessionFor(options.accessionSequence);
  const source = "The filing establishes a reverse stock split of its common stock for this lifecycle.";
  const input = adaptSec8k6kCorporateActionSource({
    accession_number: accession,
    source_url: `https://www.sec.gov/Archives/edgar/data/1234567/${accession.replaceAll("-", "")}/filing.htm`,
    filed_at: acceptedAt(options.accessionSequence),
    title: "8-K",
    cleaned_source_blocks: [{ block_id: "sec_block_1", text: source }],
    issuer_context: {
      availability: "available",
      issuer_cik: cik,
      accession_number: accession,
      accepted_at: acceptedAt(options.accessionSequence),
      provenance: "sec_filing_ledger",
    },
    security_class_candidates: options.candidates ?? [securityCandidate(singleClassId, null)],
    origin_event_id: options.eventId,
    reverse_split_action_candidates: options.existing ?? [],
  });
  const decision = options.decision;
  const transport: CorporateActionAnalyzerTransportResult = {
    applicable: true,
    event_kind: "reverse_split",
    action_stage: options.stage ?? "scheduled",
    effective_date: date ? { availability: "available", value: date } : { availability: "unavailable" },
    ratio: ratio
      ? { availability: "available", old_shares: String(ratio[0]), new_shares: String(ratio[1]) }
      : { availability: "unavailable" },
    affected_security: {
      availability: "available",
      canonical_security_class_id: actionClass,
      security_type: "common_stock",
      source_security_title: "common stock",
      source_ref: "sec_block_1",
      evidence: "reverse stock split of its common stock",
    },
    effective_timing: { availability: "unavailable", reason: date ? "date_only" : "not_provided" },
    action_link: {
      decision,
      existing_action_id: decision === "EXISTING_ACTION_ID"
        ? options.existingActionId ?? options.existing?.[0]?.action_id ?? null : null,
      source_ref: decision === "UNRESOLVED_ACTION_LINK" ? null : "sec_block_1",
      evidence: decision === "UNRESOLVED_ACTION_LINK" ? null : source,
      unresolved_reason: decision === "UNRESOLVED_ACTION_LINK" ? "ambiguous_candidate_match" : null,
    },
    source_ref: "sec_block_1",
    evidence: source,
    confidence: "high",
    as_of: date ? { availability: "available", value: date } : { availability: "available", value: "2026-08-01" },
  };
  return canonicalizeCorporateActionAnalyzerResult(transport, input);
}

function securityCandidate(classId: string, member: string | null) {
  return {
    canonical_security_class_id: classId,
    security_type: "common_stock" as const,
    security_class_basis: member ? "CLASS_SPECIFIC_COMMON_STOCK" as const : "SINGLE_COMMON_STOCK_CLASS" as const,
    source_member_local_name: member,
    supporting_accessions: ["0001234567-26-000000"],
  };
}

function observation(
  eventId: string,
  sequence: number,
  facts: CorporateActionCanonicalFacts,
  canonicalSecurityClassId = singleClassId,
): ReverseSplitActionObservation {
  const identity = facts.action_identity;
  assert.equal(identity?.link_status, "linked");
  const exact = facts.ratio.exact_source_components;
  return {
    actionId: identity!.reverse_split_action_id!,
    originEventId: identity!.origin_event_id!,
    eventId,
    sourceExecutionId: executionId(sequence),
    issuerCik: cik,
    canonicalSecurityClassId,
    accessionNumber: accessionFor(sequence),
    acceptedAt: acceptedAt(sequence),
    actionStage: facts.action_stage,
    ratio: exact?.availability === "available"
      ? { availability: "available", old_shares: exact.old_share_units, new_shares: exact.new_share_units }
      : { availability: "unavailable" },
    effectiveDate: facts.effective_date,
    effectiveTiming: facts.effective_timing!,
    evidence: facts.evidence,
    facts,
    persistedAt: acceptedAt(sequence),
  };
}

function currentRead(
  eventId: string,
  sequence: number,
  facts: CorporateActionCanonicalFacts,
): CurrentCorporateActionReadResult {
  return {
    status: "available",
    eventId,
    rawItemId: "30000000-0000-4000-8000-000000000001",
    parentPrimaryAiRunId: "40000000-0000-4000-8000-000000000001",
    sourceExecutionId: executionId(sequence),
    monitorAnalyzerKey: "corporate_action",
    analyzerContractVersion: "corporate_action_reverse_split_analyzer_v1",
    factSchemaVersion: "corporate_action_reverse_split_facts_v1",
    facts,
    persistedAt: acceptedAt(sequence),
  };
}

function historyCandidate(eventId: string, sequence: number, facts: CorporateActionCanonicalFacts) {
  const identity = facts.action_identity;
  assert.equal(identity?.link_status, "linked");
  return {
    event_id: eventId,
    source_execution_id: executionId(sequence),
    reverse_split_action_id: identity!.reverse_split_action_id,
    action_origin_event_id: identity!.origin_event_id,
    issuer_cik: cik,
    canonical_security_class_id: singleClassId,
    accession_number: accessionFor(sequence),
    accepted_at: acceptedAt(sequence),
  };
}

function accessionFor(sequence: number) {
  return `0001234567-26-${String(sequence).padStart(6, "0")}`;
}

function acceptedAt(sequence: number) {
  return `2026-08-${String(sequence).padStart(2, "0")}T16:30:00Z`;
}

function executionId(sequence: number) {
  return `20000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
