import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalizeCorporateActionAnalyzerResult,
  readCorporateActionAnalyzerResult,
  type CorporateActionAnalyzerTransportResult,
  type CorporateActionCanonicalFacts,
  type CorporateActionEffectiveTimingTransport,
  type CorporateActionStage,
  type ForwardSplitExecutionCandidate,
  type ReverseSplitExecutionUpdateDecision,
} from "./corporateActionCanonicalFacts.ts";
import { adaptSec8k6kCorporateActionSource } from "./corporateActionSourceAdapters.ts";
import {
  readStockSplitExecutions,
  stockSplitExecutionActivationDecision,
  stockSplitExecutionId,
} from "./stockSplitExecution.ts";
import { reverseSplitExecutionId } from "./reverseSplitExecution.ts";
import type { ReverseSplitHistoryItem } from "./reverseSplitHistory.ts";
import type { ReverseSplitExecutionUpdateObservation } from "./reverseSplitExecutionUpdate.ts";

const cik = "0001234567";
const singleClassId = `sc:v1:${cik}:common_stock:single`;
const classAId = `sc:v1:${cik}:common_stock:us-gaap:CommonClassAMember`;
const classBId = `sc:v1:${cik}:common_stock:us-gaap:CommonClassBMember`;
const classCId = `sc:v1:${cik}:common_stock:us-gaap:CommonClassCMember`;

test("A/B. forward canonical extraction preserves 4-for-1 and 3-for-2 old/new orientation exactly", () => {
  const fourForOne = factsFor({ sequence: 1, ratio: [1, 4] });
  assert.equal(fourForOne.event_kind, "forward_split");
  assert.equal(fourForOne.version, "corporate_action_forward_split_facts_v1");
  const fourForOneExact = fourForOne.ratio.exact_source_components;
  assert.equal(fourForOneExact?.availability, "available");
  assert.equal(fourForOneExact?.availability === "available" ? fourForOneExact.old_share_units : null, "1");
  assert.equal(fourForOneExact?.availability === "available" ? fourForOneExact.new_share_units : null, "4");
  assert.deepEqual(fourForOne.ratio.old_shares_per_new_share, {
    availability: "available",
    value: 0.25,
  });
  const threeForTwo = factsFor({ sequence: 2, ratio: [2, 3] }).ratio.exact_source_components;
  assert.equal(threeForTwo?.availability === "available" ? threeForTwo.old_share_units : null, "2");
  assert.equal(threeForTwo?.availability === "available" ? threeForTwo.new_share_units : null, "3");

  const invalid = canonicalForward({
    sequence: 3,
    ratio: [4, 1],
    source: "The Company will effect a 4-for-1 forward stock split of its common stock effective August 25, 2026.",
  });
  assert.equal(invalid.result, null);
  assert.match(invalid.errors.join("; "), /forward-split old\/new orientation/);

  const forged = structuredClone(fourForOne);
  forged.ratio.exact_source_components = {
    availability: "available",
    old_share_units: "4",
    new_share_units: "1",
  };
  forged.ratio.old_shares_per_new_share = { availability: "available", value: 4 };
  assert.equal(readCorporateActionAnalyzerResult({ applicable: true, facts: forged }), null);
});

test("C/G. scheduled, effective, and later historical re-mention remain one execution", async () => {
  const scheduled = factsFor({ sequence: 10, stage: "scheduled" });
  const candidate = candidateFor(scheduled, "scheduled");
  const effective = factsFor({
    sequence: 11,
    stage: "effective",
    executionCandidates: [candidate],
    updateDecision: "KEEP_OR_CONFIRM",
    targetExecutionId: candidate.execution_id,
  });
  const historical = factsFor({
    sequence: 90,
    stage: "effective",
    executionCandidates: [candidate],
    updateDecision: "KEEP_OR_CONFIRM",
    targetExecutionId: candidate.execution_id,
  });
  const result = await readWith(
    [historyItem(10, scheduled), historyItem(11, effective), historyItem(90, historical)],
    [updateObservation(11, effective), updateObservation(90, historical)],
  );
  assert.equal(result.executions.length, 1);
  assert.equal(result.executions[0]?.observations.length, 3);
  assert.equal(result.inactiveExecutions.length, 0);
  assert.equal(result.executions[0]?.executionId, candidate.execution_id);
});

test("D/E. explicit ratio and date changes supersede the old tuple and leave the new tuple active", async () => {
  for (const change of [
    { sequence: 21, ratio: [2, 3] as [number, number], effectiveDate: "2026-08-25" },
    { sequence: 22, ratio: [1, 4] as [number, number], effectiveDate: "2026-09-01" },
  ]) {
    const scheduled = factsFor({ sequence: change.sequence - 10 });
    const candidate = candidateFor(scheduled, "scheduled");
    const source = `The Company changed its forward stock split of its common stock to ${change.ratio[1]}-for-${change.ratio[0]} effective ${change.effectiveDate}.`;
    const changed = factsFor({
      sequence: change.sequence,
      ratio: change.ratio,
      effectiveDate: change.effectiveDate,
      source,
      executionCandidates: [candidate],
      updateDecision: "SUPERSEDE_EXISTING_EXECUTION",
      targetExecutionId: candidate.execution_id,
      updateEvidence: source,
    });
    const result = await readWith(
      [historyItem(change.sequence - 10, scheduled), historyItem(change.sequence, changed)],
      [updateObservation(change.sequence, changed)],
    );
    assert.equal(result.executions.length, 1);
    assert.equal(result.inactiveExecutions.length, 1);
    assert.equal(result.inactiveExecutions[0]?.executionStatus, "superseded");
    assert.equal(result.inactiveExecutions[0]?.executionId, candidate.execution_id);
    assert.deepEqual(result.executions[0]?.exactRatio, {
      oldShareUnits: String(change.ratio[0]),
      newShareUnits: String(change.ratio[1]),
    });
    assert.equal(result.executions[0]?.effectiveDate, change.effectiveDate);
  }
});

test("F. explicit cancellation leaves zero active executions", async () => {
  const scheduled = factsFor({ sequence: 31 });
  const candidate = candidateFor(scheduled, "scheduled");
  const source = "The Company cancelled the previously scheduled forward stock split of its common stock.";
  const cancelled = factsFor({
    sequence: 32,
    stage: "unknown",
    ratio: null,
    effectiveDate: null,
    source,
    executionCandidates: [candidate],
    updateDecision: "CANCEL_EXISTING_EXECUTION",
    targetExecutionId: candidate.execution_id,
    updateEvidence: source,
  });
  const result = await readWith(
    [historyItem(31, scheduled)],
    [updateObservation(32, cancelled)],
  );
  assert.equal(result.executions.length, 0);
  assert.equal(result.inactiveExecutions.length, 1);
  assert.equal(result.inactiveExecutions[0]?.executionStatus, "cancelled");
});

test("source-backed split history that cannot materialize fails closed", async () => {
  const malformed = historyItem(33, factsFor({ sequence: 33 }));
  malformed.effectiveDate = "2026-08-26";

  await assert.rejects(
    () => readWith([malformed]),
    /source-backed evidence that cannot be materialized as an execution/,
  );
});

test("hindsight can separate the execution knowledge cutoff from the historical basis target", async () => {
  const facts = factsFor({ sequence: 74 });
  const lateMaterialized = historyItem(74, facts);
  lateMaterialized.persistedAt = "2027-01-02T00:00:00Z";
  assert.equal((await readWith([lateMaterialized])).executions.length, 0);
  const hindsight = await readWith([lateMaterialized], [], "2027-01-03T00:00:00Z");
  assert.equal(hindsight.targetAt, "2026-12-31T23:59:59Z");
  assert.equal(hindsight.executions.length, 1);
});

test("H. execution identity includes action kind and cannot collide with reverse", () => {
  const tuple = {
    issuerCik: cik,
    canonicalSecurityClassId: singleClassId,
    effectiveDate: "2026-08-25",
    oldShareUnits: "1",
    newShareUnits: "4",
  };
  const forwardId = stockSplitExecutionId({ actionKind: "forward_split", ...tuple });
  const reverseId = reverseSplitExecutionId(tuple);
  assert.match(forwardId, /^fse:v1:[0-9a-f]{64}$/);
  assert.match(reverseId, /^rse:v1:[0-9a-f]{64}$/);
  assert.notEqual(forwardId, reverseId);
});

test("I. exact multi-class applicability stays isolated for Class A, B, and C", async () => {
  const candidateClassIds = [classAId, classBId, classCId];
  const classA = factsFor({ sequence: 41, canonicalSecurityClassId: classAId, candidateClassIds });
  const classB = factsFor({ sequence: 42, canonicalSecurityClassId: classBId, candidateClassIds });
  const classC = factsFor({ sequence: 43, canonicalSecurityClassId: classCId, candidateClassIds });
  assert.equal(classA.applicability?.affected_security.availability === "available"
    ? classA.applicability.affected_security.canonical_security_class_id : null, classAId);
  assert.equal(classB.applicability?.affected_security.availability === "available"
    ? classB.applicability.affected_security.canonical_security_class_id : null, classBId);
  assert.equal(classC.applicability?.affected_security.availability === "available"
    ? classC.applicability.affected_security.canonical_security_class_id : null, classCId);
  const result = await readWith([
    historyItem(41, classA, classAId),
    historyItem(42, classB, classBId),
    historyItem(43, classC, classCId),
  ]);
  assert.deepEqual(
    result.executions.map((item) => item.canonicalSecurityClassId).sort(),
    [classAId, classBId, classCId],
  );
});

test("effective-date activation exactly reuses date-only/open/after-close semantics", async () => {
  const dateOnly = (await readWith([historyItem(51, factsFor({ sequence: 51 }))])).executions[0]!;
  assert.equal(stockSplitExecutionActivationDecision({ execution: dateOnly, targetDate: "2026-08-24" }).status, "NOT_APPLIED");
  assert.equal(stockSplitExecutionActivationDecision({ execution: dateOnly, targetDate: "2026-08-25" }).status, "APPLIED");
  assert.equal(stockSplitExecutionActivationDecision({ execution: dateOnly, targetDate: "2026-08-26" }).status, "APPLIED");

  for (const kind of ["date_only", "business_day_open", "market_open", "start_of_trading"] as const) {
    const execution = (await readWith([historyItem(52, factsFor({ sequence: 52, timing: availableTiming(kind) }))])).executions[0]!;
    assert.equal(stockSplitExecutionActivationDecision({ execution, targetDate: "2026-08-25" }).status, "APPLIED");
  }
  const afterClose = (await readWith([historyItem(53, factsFor({
    sequence: 53,
    timing: availableTiming("after_market_close"),
  }))])).executions[0]!;
  assert.equal(stockSplitExecutionActivationDecision({ execution: afterClose, targetDate: "2026-08-25" }).status, "NOT_APPLIED");

});

type FactsOptions = {
  sequence: number;
  stage?: CorporateActionStage;
  ratio?: [number, number] | null;
  effectiveDate?: string | null;
  canonicalSecurityClassId?: string;
  candidateClassIds?: string[];
  timing?: CorporateActionEffectiveTimingTransport;
  source?: string;
  executionCandidates?: ForwardSplitExecutionCandidate[];
  updateDecision?: ReverseSplitExecutionUpdateDecision;
  targetExecutionId?: string | null;
  updateEvidence?: string;
};

function canonicalForward(options: FactsOptions) {
  const accession = accessionFor(options.sequence);
  const effectiveDate = options.effectiveDate === undefined ? "2026-08-25" : options.effectiveDate;
  const ratio = options.ratio === undefined ? [1, 4] as [number, number] : options.ratio;
  const classId = options.canonicalSecurityClassId ?? singleClassId;
  const member = classMember(classId);
  const title = classTitle(classId);
  const source = options.source
    ?? `The Company will effect a ${ratio?.[1] ?? 4}-for-${ratio?.[0] ?? 1} forward stock split of its ${title} effective August 25, 2026.`;
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
    security_class_candidates: (options.candidateClassIds ?? [classId]).map((candidateClassId) => {
      const candidateMember = classMember(candidateClassId);
      return {
        canonical_security_class_id: candidateClassId,
        security_type: "common_stock" as const,
        security_class_basis: candidateMember
          ? "CLASS_SPECIFIC_COMMON_STOCK" as const : "SINGLE_COMMON_STOCK_CLASS" as const,
        source_member_local_name: candidateMember,
        supporting_accessions: [accession],
      };
    }),
    forward_split_execution_candidates: options.executionCandidates ?? [],
  });
  const transport: CorporateActionAnalyzerTransportResult = {
    applicable: true,
    event_kind: "forward_split",
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
      source_security_title: title,
      source_ref: "sec_block_1",
      evidence: `forward stock split of its ${title}`,
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
  return canonicalizeCorporateActionAnalyzerResult(transport, input);
}

function factsFor(options: FactsOptions): CorporateActionCanonicalFacts {
  const canonical = canonicalForward(options);
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
  updates: ReverseSplitExecutionUpdateObservation[] = [],
  knownAt?: string,
) {
  return readStockSplitExecutions({
    actionKind: "forward_split",
    cik,
    from: "2026-01-01",
    to: "2026-12-31",
    targetAt: "2026-12-31T23:59:59Z",
    ...(knownAt ? { knownAt } : {}),
  }, {
    readHistory: async ({ actionKind }) => {
      assert.equal(actionKind, "forward_split");
      return {
        status: "available",
        issuerCik: cik,
        canonicalSecurityClassId: null,
        from: "2026-01-01",
        to: "2026-12-31",
        basisChangeCoverage: "forward_split_only",
        items,
      };
    },
    readUpdates: async ({ actionKind, targetAt }) => {
      assert.equal(actionKind, "forward_split");
      return { status: "available", issuerCik: cik, targetAt, updates };
    },
  });
}

function candidateFor(
  facts: CorporateActionCanonicalFacts,
  calculationStatus: "scheduled" | "effective",
): ForwardSplitExecutionCandidate {
  assert.equal(facts.effective_date.availability, "available");
  assert.equal(facts.ratio.exact_source_components?.availability, "available");
  const affected = facts.applicability?.affected_security;
  assert.equal(affected?.availability, "available");
  const exact = facts.ratio.exact_source_components!;
  return {
    execution_id: stockSplitExecutionId({
      actionKind: "forward_split",
      issuerCik: cik,
      canonicalSecurityClassId: affected?.availability === "available"
        ? affected.canonical_security_class_id : "",
      effectiveDate: facts.effective_date.availability === "available"
        ? facts.effective_date.value : "",
      oldShareUnits: exact.availability === "available" ? exact.old_share_units : "",
      newShareUnits: exact.availability === "available" ? exact.new_share_units : "",
    }),
    issuer_cik: cik,
    canonical_security_class_id: affected?.availability === "available"
      ? affected.canonical_security_class_id : "",
    effective_date: facts.effective_date.availability === "available"
      ? facts.effective_date.value : "",
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
  return `2026-08-${String(Math.min(sequence, 28)).padStart(2, "0")}T12:00:00Z`;
}

function classMember(classId: string) {
  return classId === classAId ? "CommonClassAMember"
    : classId === classBId ? "CommonClassBMember"
    : classId === classCId ? "CommonClassCMember" : null;
}

function classTitle(classId: string) {
  const member = classMember(classId);
  return member === "CommonClassAMember" ? "Class A Common Stock"
    : member === "CommonClassBMember" ? "Class B Common Stock"
    : member === "CommonClassCMember" ? "Class C Common Stock" : "common stock";
}

function uuid(prefix: string, sequence: number) {
  return `${prefix}0000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}
