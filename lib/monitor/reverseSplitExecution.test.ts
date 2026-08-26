import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeCorporateActionAnalyzerResult,
  type CorporateActionAnalyzerTransportResult,
  type CorporateActionCanonicalFacts,
  type CorporateActionEffectiveTimingTransport,
  type CorporateActionStage,
  type ReverseSplitExecutionCandidate,
  type ReverseSplitExecutionUpdateDecision,
} from "./corporateActionCanonicalFacts.ts";
import { adaptSec8k6kCorporateActionSource } from "./corporateActionSourceAdapters.ts";
import {
  readReverseSplitExecutions,
  reverseSplitExecutionActivationDecision,
  reverseSplitExecutionId,
} from "./reverseSplitExecution.ts";
import type { ReverseSplitHistoryItem, ReverseSplitHistoryReadResult } from "./reverseSplitHistory.ts";
import type { ReverseSplitExecutionUpdateObservation } from "./reverseSplitExecutionUpdate.ts";

const cik = "0001234567";
const singleClassId = `sc:v1:${cik}:common_stock:single`;
const classAId = `sc:v1:${cik}:common_stock:us-gaap:CommonClassAMember`;
const classBId = `sc:v1:${cik}:common_stock:us-gaap:CommonClassBMember`;

test("Alert lifecycle stages remain independent while incomplete stages create no calculation execution", async () => {
  const stages: CorporateActionStage[] = [
    "announced",
    "shareholder_approved",
    "board_approved",
    "scheduled",
    "effective",
  ];
  assert.deepEqual(stages.map((stage, index) => factsFor({
    sequence: index + 1,
    stage,
    ratio: null,
    effectiveDate: null,
  }).action_stage), stages);

  const indeterminateDate = factsFor({
    sequence: 9,
    ratio: [10, 1],
    effectiveDate: null,
  });
  assert.equal(indeterminateDate.calculation_activation?.state, "INDETERMINATE");

  const rangeOnly = factsFor({ sequence: 10, stage: "shareholder_approved", ratio: null });
  const result = await readWith([historyItem(10, rangeOnly)]);
  assert.equal(result.executions.length, 0);
  assert.equal(result.conflicts.length, 0);
});

test("source-backed final ratio, class and effective date register one future execution regardless of stage", async () => {
  const scheduled = factsFor({ sequence: 1, stage: "scheduled" });
  assert.equal("action_identity" in scheduled, false);
  const result = await readWith([historyItem(1, scheduled)]);
  assert.equal(result.executions.length, 1);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.executions[0]?.effectiveDate, "2026-08-25");
  assert.deepEqual(result.executions[0]?.exactRatio, { oldShareUnits: "10", newShareUnits: "1" });
  assert.equal(result.executions[0]?.observations[0]?.actionStage, "scheduled");
});

test("8-K, effective filing and later 10-Q with the same exact tuple dedupe to one stable execution", async () => {
  const observations = [
    historyItem(1, factsFor({ sequence: 1, stage: "scheduled" })),
    historyItem(2, factsFor({ sequence: 2, stage: "effective" })),
    historyItem(90, factsFor({ sequence: 90, stage: "effective" })),
  ];
  const target = { targetAt: "2026-11-30T23:00:00Z" };
  const first = await readWith(observations, undefined, target);
  const replay = await readWith([...observations, observations[1]!], undefined, target);
  assert.equal(first.executions.length, 1);
  assert.equal(first.executions[0]?.observations.length, 3);
  assert.equal(replay.executions.length, 1);
  assert.equal(replay.executions[0]?.observations.length, 3);
  assert.equal(replay.executions[0]?.executionId, first.executions[0]?.executionId);
  assert.equal(first.executions[0]?.executionId, reverseSplitExecutionId({
    issuerCik: cik,
    canonicalSecurityClassId: singleClassId,
    effectiveDate: "2026-08-25",
    oldShareUnits: "10",
    newShareUnits: "1",
  }));
});

test("an unchanged confirmation preserves one execution", async () => {
  const scheduled = factsFor({ sequence: 15 });
  const target = candidateFor(scheduled, "scheduled");
  const confirmed = factsFor({
    sequence: 22,
    stage: "scheduled",
    executionCandidates: [target],
    updateDecision: "KEEP_OR_CONFIRM",
    targetExecutionId: target.execution_id,
  });
  const result = await readWith(
    [historyItem(15, scheduled), historyItem(22, confirmed)],
    { from: "2026-08-01", to: "2026-08-31" },
    { targetAt: "2026-08-24T23:00:00Z", updates: [updateObservation(22, confirmed)] },
  );
  assert.equal(result.executions.length, 1);
  assert.equal(result.inactiveExecutions.length, 0);
  assert.equal(result.executions[0]?.executionId, target.execution_id);
  assert.equal(result.executions[0]?.observations.length, 2);
});

test("an explicit effective-date change supersedes the old execution and leaves one active execution", async () => {
  const scheduled = factsFor({ sequence: 15 });
  const target = candidateFor(scheduled, "scheduled");
  const changedSource = "The Company changed its 1-for-10 reverse stock split of its common stock from August 25, 2026 to September 1, 2026.";
  const changed = factsFor({
    sequence: 22,
    effectiveDate: "2026-09-01",
    source: changedSource,
    executionCandidates: [target],
    updateDecision: "SUPERSEDE_EXISTING_EXECUTION",
    targetExecutionId: target.execution_id,
    updateEvidence: changedSource,
  });
  const result = await readWith(
    [historyItem(15, scheduled), historyItem(22, changed)],
    { from: "2026-08-01", to: "2026-09-30" },
    { targetAt: "2026-08-24T23:00:00Z", updates: [updateObservation(22, changed)] },
  );
  assert.deepEqual(result.executions.map((item) => item.effectiveDate), ["2026-09-01"]);
  assert.equal(result.inactiveExecutions.length, 1);
  assert.equal(result.inactiveExecutions[0]?.executionId, target.execution_id);
  assert.equal(result.inactiveExecutions[0]?.executionStatus, "superseded");
});

test("an explicit ratio change supersedes the old tuple before same-date conflict evaluation", async () => {
  const scheduled = factsFor({ sequence: 15 });
  const target = candidateFor(scheduled, "scheduled");
  const changedSource = "The Company changed its August 25, 2026 reverse stock split of its common stock from 1-for-10 to 1-for-20.";
  const changed = factsFor({
    sequence: 22,
    ratio: [20, 1],
    source: changedSource,
    executionCandidates: [target],
    updateDecision: "SUPERSEDE_EXISTING_EXECUTION",
    targetExecutionId: target.execution_id,
    updateEvidence: changedSource,
  });
  const result = await readWith(
    [historyItem(15, scheduled), historyItem(22, changed)],
    { from: "2026-08-01", to: "2026-08-31" },
    { targetAt: "2026-08-24T23:00:00Z", updates: [updateObservation(22, changed)] },
  );
  assert.deepEqual(result.executions.map((item) => item.exactRatio), [
    { oldShareUnits: "20", newShareUnits: "1" },
  ]);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.inactiveExecutions.length, 1);
  assert.equal(result.inactiveExecutions[0]?.executionId, target.execution_id);
  assert.equal(result.inactiveExecutions[0]?.executionStatus, "superseded");
});

test("an explicit cancellation removes the scheduled execution from calculation eligibility", async () => {
  const scheduled = factsFor({ sequence: 15 });
  const target = candidateFor(scheduled, "scheduled");
  const cancelledSource = "The Company cancelled the previously scheduled reverse stock split of its common stock.";
  const cancelled = factsFor({
    sequence: 23,
    stage: "unknown",
    ratio: null,
    effectiveDate: null,
    source: cancelledSource,
    executionCandidates: [target],
    updateDecision: "CANCEL_EXISTING_EXECUTION",
    targetExecutionId: target.execution_id,
    updateEvidence: cancelledSource,
  });
  const result = await readWith(
    [historyItem(15, scheduled)],
    { from: "2026-08-01", to: "2026-08-31" },
    { targetAt: "2026-08-24T23:00:00Z", updates: [updateObservation(23, cancelled)] },
  );
  assert.equal(result.executions.length, 0);
  assert.equal(result.inactiveExecutions.length, 1);
  assert.equal(result.inactiveExecutions[0]?.executionStatus, "cancelled");
});

test("a historical re-mention confirms the exact prior execution without creating a new one", async () => {
  const effective = factsFor({ sequence: 15, stage: "effective" });
  const target = candidateFor(effective, "effective");
  const historical = factsFor({
    sequence: 90,
    stage: "effective",
    executionCandidates: [target],
    updateDecision: "KEEP_OR_CONFIRM",
    targetExecutionId: target.execution_id,
  });
  const result = await readWith(
    [historyItem(15, effective), historyItem(90, historical)],
    { from: "2026-01-01", to: "2026-12-31" },
    { targetAt: "2026-11-30T23:00:00Z", updates: [updateObservation(90, historical)] },
  );
  assert.equal(result.executions.length, 1);
  assert.equal(result.executions[0]?.observations.length, 2);
});

test("a genuinely new reverse split remains a separate execution", async () => {
  const first = factsFor({ sequence: 15, stage: "effective" });
  const second = factsFor({ sequence: 120, effectiveDate: "2026-12-20", ratio: [20, 1] });
  const result = await readWith(
    [historyItem(15, first), historyItem(120, second)],
    { from: "2026-01-01", to: "2026-12-31" },
    { targetAt: "2026-12-31T23:00:00Z", updates: [updateObservation(120, second)] },
  );
  assert.deepEqual(result.executions.map((item) => item.effectiveDate), ["2026-08-25", "2026-12-20"]);
});

test("an unresolved update fails closed without arbitrarily mutating one execution", async () => {
  const scheduled = factsFor({ sequence: 15 });
  const later = factsFor({ sequence: 30, effectiveDate: "2026-12-20", ratio: [20, 1] });
  const target = candidateFor(scheduled, "scheduled");
  const unclearSource = "The Company changed or cancelled a previously disclosed reverse stock split of its common stock, but the affected schedule is not identified.";
  const unresolved = factsFor({
    sequence: 23,
    stage: "unknown",
    ratio: null,
    effectiveDate: null,
    source: unclearSource,
    executionCandidates: [target],
    updateDecision: "UNRESOLVED_EXECUTION_UPDATE",
    targetExecutionId: null,
    updateEvidence: unclearSource,
  });
  const result = await readWith(
    [historyItem(15, scheduled), historyItem(30, later)],
    { from: "2026-08-01", to: "2026-12-31" },
    { targetAt: "2026-12-31T23:00:00Z", updates: [updateObservation(23, unresolved)] },
  );
  assert.deepEqual(result.executions.map((item) => item.effectiveDate), ["2026-12-20"]);
  assert.equal(result.inactiveExecutions.length, 0);
  assert.deepEqual(result.conflicts[0]?.reasons, ["UNRESOLVED_EXECUTION_UPDATE"]);
  assert.deepEqual(result.conflicts[0]?.candidateExecutionIds, [target.execution_id]);
});

test("a genuinely later split is separate while elapsed time alone never creates an execution", async () => {
  const result = await readWith([
    historyItem(1, factsFor({ sequence: 1 })),
    historyItem(90, factsFor({ sequence: 90 })),
    historyItem(120, factsFor({ sequence: 120, effectiveDate: "2026-12-20", ratio: [20, 1] })),
  ], { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(result.executions.length, 2);
  assert.deepEqual(result.executions.map((item) => item.effectiveDate), ["2026-08-25", "2026-12-20"]);
  assert.deepEqual(result.executions.map((item) => item.observations.length), [2, 1]);
});

test("same class and effective date with conflicting final ratios is ineligible without a winner", async () => {
  const result = await readWith([
    historyItem(1, factsFor({ sequence: 1, ratio: [10, 1] })),
    historyItem(2, factsFor({ sequence: 2, ratio: [20, 1] })),
  ]);
  assert.equal(result.executions.length, 0);
  assert.equal(result.conflicts.length, 1);
  assert.deepEqual(result.conflicts[0]?.reasons, ["FINAL_RATIO_CONFLICT"]);
  assert.equal(result.conflicts[0]?.candidateExecutionIds.length, 2);
  assert.equal("observations" in result.conflicts[0]!, true);
  if ("observations" in result.conflicts[0]!) {
    assert.equal(result.conflicts[0].observations.length, 2);
  }
});

test("canonical security classes remain isolated and ambiguous applicability produces no input observation", async () => {
  const classA = factsFor({ sequence: 1, canonicalSecurityClassId: classAId });
  const classB = factsFor({ sequence: 2, canonicalSecurityClassId: classBId });
  const result = await readWith([
    historyItem(1, classA, classAId),
    historyItem(2, classB, classBId),
  ]);
  assert.equal(result.executions.length, 2);
  assert.deepEqual(result.executions.map((item) => item.canonicalSecurityClassId).sort(), [classAId, classBId]);

  const noMappedHistory = await readWith([]);
  assert.equal(noMappedHistory.executions.length, 0);
});

test("day-basis activates date-only/opening executions on effective date and preserves after-close semantics", async () => {
  const dateOnly = (await readWith([historyItem(1, factsFor({ sequence: 1 }))])).executions[0]!;
  assert.deepEqual(reverseSplitExecutionActivationDecision({ execution: dateOnly, targetDate: "2026-08-24" }), {
    status: "NOT_APPLIED", reason: "target_before_effective_date",
  });
  assert.deepEqual(reverseSplitExecutionActivationDecision({ execution: dateOnly, targetDate: "2026-08-25" }), {
    status: "APPLIED", reason: "effective_date_day_basis",
  });
  assert.deepEqual(reverseSplitExecutionActivationDecision({ execution: dateOnly, targetDate: "2026-08-26" }), {
    status: "APPLIED", reason: "target_after_effective_date",
  });

  for (const kind of ["date_only", "business_day_open", "market_open", "start_of_trading"] as const) {
    const execution = (await readWith([historyItem(2, factsFor({
      sequence: 2,
      timing: availableTiming(kind),
    }))])).executions[0]!;
    assert.equal(reverseSplitExecutionActivationDecision({ execution, targetDate: "2026-08-25" }).status, "APPLIED");
  }
  const afterClose = (await readWith([historyItem(3, factsFor({
    sequence: 3,
    timing: availableTiming("after_market_close"),
  }))])).executions[0]!;
  assert.deepEqual(reverseSplitExecutionActivationDecision({ execution: afterClose, targetDate: "2026-08-25" }), {
    status: "NOT_APPLIED", reason: "after_market_close_same_day",
  });
  assert.deepEqual(reverseSplitExecutionActivationDecision({ execution: afterClose, targetDate: "2026-08-26" }), {
    status: "APPLIED", reason: "target_after_effective_date",
  });

  const sourceTimingAmbiguous = (await readWith([historyItem(4, factsFor({
    sequence: 4,
    timing: { availability: "unavailable", reason: "ambiguous" },
  }))])).executions[0]!;
  assert.equal(sourceTimingAmbiguous.calculationActivation?.state, "ON_EFFECTIVE_DATE");
  assert.equal(reverseSplitExecutionActivationDecision({
    execution: sourceTimingAmbiguous,
    targetDate: "2026-08-25",
  }).status, "APPLIED");
});

test("calculation dedupes richer opening meanings that share one day-basis activation", async () => {
  const result = await readWith([
    historyItem(5, factsFor({ sequence: 5, timing: availableTiming("market_open") })),
    historyItem(6, factsFor({ sequence: 6, timing: availableTiming("start_of_trading") })),
  ]);
  assert.equal(result.executions.length, 1);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.executions[0]?.calculationActivation?.state, "ON_EFFECTIVE_DATE");
  assert.equal(result.executions[0]?.observations.length, 2);
});

type FactsOptions = {
  sequence: number;
  stage?: CorporateActionStage;
  ratio?: [number, number] | null;
  effectiveDate?: string | null;
  canonicalSecurityClassId?: string;
  timing?: CorporateActionEffectiveTimingTransport;
  source?: string;
  executionCandidates?: ReverseSplitExecutionCandidate[];
  updateDecision?: ReverseSplitExecutionUpdateDecision;
  targetExecutionId?: string | null;
  updateEvidence?: string;
};

function factsFor(options: FactsOptions): CorporateActionCanonicalFacts {
  const accession = accessionFor(options.sequence);
  const effectiveDate = options.effectiveDate === undefined ? "2026-08-25" : options.effectiveDate;
  const ratio = options.ratio === undefined ? [10, 1] as [number, number] : options.ratio;
  const classId = options.canonicalSecurityClassId ?? singleClassId;
  const source = options.source
    ?? "The Company will effect a 1-for-10 reverse stock split of its common stock effective August 25, 2026.";
  const member = classId === classAId ? "CommonClassAMember" : classId === classBId ? "CommonClassBMember" : null;
  const input = adaptSec8k6kCorporateActionSource({
    accession_number: accession,
    source_url: `https://www.sec.gov/Archives/edgar/data/1234567/${accession.replaceAll("-", "")}/filing.htm`,
    filed_at: acceptedAt(options.sequence),
    title: "SEC filing",
    cleaned_source_blocks: [{ block_id: "sec_block_1", text: source }],
    issuer_context: {
      availability: "available",
      issuer_cik: cik,
      accession_number: accession,
      accepted_at: acceptedAt(options.sequence),
      provenance: "sec_filing_ledger",
    },
    security_class_candidates: [{
      canonical_security_class_id: classId,
      security_type: "common_stock",
      security_class_basis: member ? "CLASS_SPECIFIC_COMMON_STOCK" : "SINGLE_COMMON_STOCK_CLASS",
      source_member_local_name: member,
      supporting_accessions: [accession],
    }],
    reverse_split_execution_candidates: options.executionCandidates ?? [],
  });
  const transport: CorporateActionAnalyzerTransportResult = {
    applicable: true,
    event_kind: "reverse_split",
    action_stage: options.stage ?? "scheduled",
    effective_date: effectiveDate
      ? {
          availability: "available",
          value: effectiveDate,
          source_ref: "sec_block_1",
          evidence: source,
        }
      : { availability: "unavailable" },
    ratio: ratio
      ? {
          availability: "available",
          old_shares: String(ratio[0]),
          new_shares: String(ratio[1]),
          source_ref: "sec_block_1",
          evidence: source,
        }
      : { availability: "unavailable" },
    affected_security: {
      availability: "available",
      canonical_security_class_id: classId,
      security_type: "common_stock",
      source_security_title: "common stock",
      source_ref: "sec_block_1",
      evidence: "reverse stock split of its common stock",
    },
    effective_timing: options.timing ?? {
      availability: "unavailable",
      reason: effectiveDate ? "date_only" : "not_provided",
    },
    execution_update: {
      decision: options.updateDecision ?? "NEW_EXECUTION",
      target_execution_id: options.targetExecutionId ?? null,
      source_ref: "sec_block_1",
      evidence: options.updateEvidence ?? source,
    },
    source_ref: "sec_block_1",
    evidence: source,
    confidence: "high",
    as_of: effectiveDate
      ? { availability: "available", value: effectiveDate }
      : { availability: "available", value: "2026-08-01" },
  };
  const canonical = canonicalizeCorporateActionAnalyzerResult(transport, input);
  assert.deepEqual(canonical.errors, []);
  assert.equal(canonical.result?.applicable, true);
  return (canonical.result as { applicable: true; facts: CorporateActionCanonicalFacts }).facts;
}

function historyItem(
  sequence: number,
  facts: CorporateActionCanonicalFacts,
  canonicalSecurityClassId = singleClassId,
): ReverseSplitHistoryItem {
  assert.equal(facts.effective_date.availability, "available");
  return {
    eventId: uuid("1", sequence),
    sourceExecutionId: uuid("2", sequence),
    issuerCik: cik,
    canonicalSecurityClassId,
    effectiveDate: facts.effective_date.availability === "available" ? facts.effective_date.value : "",
    effectiveTiming: facts.effective_timing!,
    sameDayOrdering: facts.effective_timing?.availability === "available"
      ? "explicit_source_timing" : "indeterminate",
    facts,
    persistedAt: acceptedAt(sequence),
  };
}

async function readWith(
  items: ReverseSplitHistoryItem[],
  range: { from: string; to: string } = { from: "2026-08-01", to: "2026-08-31" },
  options: { targetAt?: string; updates?: ReverseSplitExecutionUpdateObservation[] } = {},
) {
  const targetAt = options.targetAt ?? `${range.to}T23:59:59Z`;
  return readReverseSplitExecutions({ cik, ...range, targetAt }, {
    readHistory: async () => history(items, range),
    readUpdates: async ({ targetAt }) => ({
      status: "available",
      issuerCik: cik,
      targetAt,
      updates: options.updates ?? [],
    }),
  });
}

function candidateFor(
  facts: CorporateActionCanonicalFacts,
  calculationStatus: "scheduled" | "effective",
): ReverseSplitExecutionCandidate {
  assert.equal(facts.effective_date.availability, "available");
  assert.equal(facts.ratio.exact_source_components?.availability, "available");
  const affected = facts.applicability?.affected_security;
  assert.equal(affected?.availability, "available");
  const exact = facts.ratio.exact_source_components!;
  const classId = affected!.availability === "available" ? affected!.canonical_security_class_id : "";
  return {
    execution_id: reverseSplitExecutionId({
      issuerCik: cik,
      canonicalSecurityClassId: classId,
      effectiveDate: facts.effective_date.availability === "available" ? facts.effective_date.value : "",
      oldShareUnits: exact.availability === "available" ? exact.old_share_units : "",
      newShareUnits: exact.availability === "available" ? exact.new_share_units : "",
    }),
    issuer_cik: cik,
    canonical_security_class_id: classId,
    effective_date: facts.effective_date.availability === "available" ? facts.effective_date.value : "",
    old_share_units: exact.availability === "available" ? exact.old_share_units : "",
    new_share_units: exact.availability === "available" ? exact.new_share_units : "",
    calculation_status: calculationStatus,
  };
}

function updateObservation(
  sequence: number,
  facts: CorporateActionCanonicalFacts,
): ReverseSplitExecutionUpdateObservation {
  assert.ok(facts.execution_update);
  return {
    eventId: uuid("1", sequence),
    sourceExecutionId: uuid("2", sequence),
    issuerCik: cik,
    acceptedAt: acceptedAt(sequence),
    persistedAt: acceptedAt(sequence),
    update: facts.execution_update!,
    facts,
  };
}

function history(
  items: ReverseSplitHistoryItem[],
  range: { from: string; to: string },
): ReverseSplitHistoryReadResult {
  return {
    status: "available",
    issuerCik: cik,
    canonicalSecurityClassId: null,
    from: range.from,
    to: range.to,
    basisChangeCoverage: "reverse_split_only",
    items,
  };
}

function availableTiming(
  kind: "date_only" | "business_day_open" | "market_open" | "start_of_trading" | "after_market_close",
): CorporateActionEffectiveTimingTransport {
  return {
    availability: "available",
    kind,
    timestamp: null,
    source_ref: "sec_block_1",
    evidence: "effective August 25, 2026",
  };
}

function accessionFor(sequence: number) {
  return `0001234567-26-${String(sequence).padStart(6, "0")}`;
}

function acceptedAt(sequence: number) {
  const day = Math.min(sequence, 28);
  const month = sequence > 100 ? "12" : sequence > 60 ? "11" : "08";
  return `2026-${month}-${String(day).padStart(2, "0")}T16:30:00Z`;
}

function uuid(prefix: string, sequence: number) {
  return `${prefix}0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
