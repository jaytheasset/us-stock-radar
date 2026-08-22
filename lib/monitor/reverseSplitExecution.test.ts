import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeCorporateActionAnalyzerResult,
  type CorporateActionAnalyzerTransportResult,
  type CorporateActionCanonicalFacts,
  type CorporateActionEffectiveTimingTransport,
  type CorporateActionStage,
} from "./corporateActionCanonicalFacts.ts";
import { adaptSec8k6kCorporateActionSource } from "./corporateActionSourceAdapters.ts";
import {
  readReverseSplitExecutions,
  reverseSplitExecutionActivationDecision,
  reverseSplitExecutionId,
} from "./reverseSplitExecution.ts";
import type { ReverseSplitHistoryItem, ReverseSplitHistoryReadResult } from "./reverseSplitHistory.ts";

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
  const first = await readWith(observations);
  const replay = await readWith([...observations, observations[1]!]);
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
  assert.equal(result.conflicts[0]?.observations.length, 2);
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

  for (const kind of ["market_open", "start_of_trading"] as const) {
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
});

test("exact timestamp remains timestamp-aware and unresolved timing fails closed", async () => {
  const exact = (await readWith([historyItem(1, factsFor({
    sequence: 1,
    timing: availableTiming("exact_timestamp", "2026-08-25T13:30:00Z"),
  }))])).executions[0]!;
  assert.equal(reverseSplitExecutionActivationDecision({ execution: exact, targetDate: "2026-08-25" }).status, "INDETERMINATE");
  assert.equal(reverseSplitExecutionActivationDecision({
    execution: exact,
    targetDate: "2026-08-25",
    targetAt: "2026-08-25T13:29:59Z",
  }).status, "NOT_APPLIED");
  assert.equal(reverseSplitExecutionActivationDecision({
    execution: exact,
    targetDate: "2026-08-25",
    targetAt: "2026-08-25T13:30:00Z",
  }).status, "APPLIED");
});

type FactsOptions = {
  sequence: number;
  stage?: CorporateActionStage;
  ratio?: [number, number] | null;
  effectiveDate?: string | null;
  canonicalSecurityClassId?: string;
  timing?: CorporateActionEffectiveTimingTransport;
};

function factsFor(options: FactsOptions): CorporateActionCanonicalFacts {
  const accession = accessionFor(options.sequence);
  const effectiveDate = options.effectiveDate === undefined ? "2026-08-25" : options.effectiveDate;
  const ratio = options.ratio === undefined ? [10, 1] as [number, number] : options.ratio;
  const classId = options.canonicalSecurityClassId ?? singleClassId;
  const source = "The Company will effect a 1-for-10 reverse stock split of its common stock effective August 25, 2026.";
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
  });
  const transport: CorporateActionAnalyzerTransportResult = {
    applicable: true,
    event_kind: "reverse_split",
    action_stage: options.stage ?? "scheduled",
    effective_date: effectiveDate
      ? { availability: "available", value: effectiveDate }
      : { availability: "unavailable" },
    ratio: ratio
      ? { availability: "available", old_shares: String(ratio[0]), new_shares: String(ratio[1]) }
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
) {
  return readReverseSplitExecutions({ cik, ...range }, {
    readHistory: async () => history(items, range),
  });
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
  kind: "market_open" | "start_of_trading" | "after_market_close" | "exact_timestamp",
  timestamp: string | null = null,
): CorporateActionEffectiveTimingTransport {
  return {
    availability: "available",
    kind,
    timestamp,
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
