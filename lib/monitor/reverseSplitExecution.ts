import { createHash } from "node:crypto";
import type {
  CorporateActionCanonicalFacts,
  CorporateActionStage,
} from "./corporateActionCanonicalFacts.ts";
import {
  readReverseSplitHistory,
  type ReverseSplitHistoryItem,
  type ReverseSplitHistoryReadResult,
} from "./reverseSplitHistory.ts";

export const REVERSE_SPLIT_EXECUTION_VERSION = "reverse_split_execution_v1";

type ExactRatio = {
  oldShareUnits: string;
  newShareUnits: string;
};

type EffectiveTiming = NonNullable<CorporateActionCanonicalFacts["effective_timing"]>;

export type ReverseSplitExecutionObservation = {
  eventId: string;
  sourceExecutionId: string;
  issuerCik: string;
  canonicalSecurityClassId: string;
  accessionNumber: string;
  acceptedAt: string;
  actionStage: CorporateActionStage;
  exactRatio: ExactRatio;
  effectiveDate: string;
  effectiveTiming: EffectiveTiming;
  sourceRef: string;
  evidence: Extract<CorporateActionCanonicalFacts["evidence"], { availability: "available" }>;
  source: CorporateActionCanonicalFacts["source"];
  persistedAt: string;
  facts: CorporateActionCanonicalFacts;
};

export type ReverseSplitExecution = {
  version: typeof REVERSE_SPLIT_EXECUTION_VERSION;
  status: "CALCULATION_ELIGIBLE";
  executionId: string;
  issuerCik: string;
  canonicalSecurityClassId: string;
  effectiveDate: string;
  exactRatio: ExactRatio;
  effectiveTiming: EffectiveTiming;
  observations: ReverseSplitExecutionObservation[];
};

export type ReverseSplitExecutionConflict = {
  version: typeof REVERSE_SPLIT_EXECUTION_VERSION;
  status: "EXECUTION_CONFLICT";
  conflictId: string;
  issuerCik: string;
  canonicalSecurityClassId: string;
  effectiveDate: string;
  reasons: Array<"FINAL_RATIO_CONFLICT" | "EFFECTIVE_TIMING_CONFLICT">;
  candidateExecutionIds: string[];
  observations: ReverseSplitExecutionObservation[];
};

export type ReverseSplitExecutionReadResult = {
  status: "available";
  issuerCik: string;
  canonicalSecurityClassId: string | null;
  from: string;
  to: string;
  basisChangeCoverage: "reverse_split_only";
  executions: ReverseSplitExecution[];
  conflicts: ReverseSplitExecutionConflict[];
};

export type ReverseSplitExecutionActivationDecision =
  | {
      status: "APPLIED";
      reason:
        | "target_after_effective_date"
        | "effective_date_day_basis"
        | "exact_timestamp_reached";
    }
  | {
      status: "NOT_APPLIED";
      reason:
        | "target_before_effective_date"
        | "after_market_close_same_day"
        | "exact_timestamp_not_reached";
    }
  | {
      status: "INDETERMINATE";
      reason: "exact_timestamp_requires_target_at" | "effective_timing_unresolved";
    };

type ReverseSplitExecutionDependencies = {
  readHistory(input: {
    cik: string;
    canonicalSecurityClassId?: string;
    from: string;
    to: string;
  }): Promise<ReverseSplitHistoryReadResult>;
};

const defaultDependencies: ReverseSplitExecutionDependencies = {
  readHistory: (input) => readReverseSplitHistory(input),
};

export async function readReverseSplitExecutions(
  filter: {
    cik: string;
    canonicalSecurityClassId?: string;
    from: string;
    to: string;
  },
  dependencies: ReverseSplitExecutionDependencies = defaultDependencies,
): Promise<ReverseSplitExecutionReadResult> {
  const history = await dependencies.readHistory(filter);
  if (history.status !== "available" || history.issuerCik !== filter.cik
    || history.canonicalSecurityClassId !== (filter.canonicalSecurityClassId ?? null)
    || history.from !== filter.from || history.to !== filter.to
    || history.basisChangeCoverage !== "reverse_split_only") {
    throw new Error("Reverse split execution history response is invalid");
  }

  const observations = dedupeObservations(history.items
    .map(calculationObservation)
    .filter((item): item is ReverseSplitExecutionObservation => item !== null));
  const effectiveDateGroups = new Map<string, ReverseSplitExecutionObservation[]>();
  for (const observation of observations) {
    const key = dateGroupKey(observation);
    const group = effectiveDateGroups.get(key) ?? [];
    group.push(observation);
    effectiveDateGroups.set(key, group);
  }

  const executions: ReverseSplitExecution[] = [];
  const conflicts: ReverseSplitExecutionConflict[] = [];
  for (const group of effectiveDateGroups.values()) {
    const projection = projectExecutionGroup(group);
    if (projection.status === "CALCULATION_ELIGIBLE") executions.push(projection);
    else conflicts.push(projection);
  }
  executions.sort(compareExecutions);
  conflicts.sort(compareConflicts);
  return {
    status: "available",
    issuerCik: filter.cik,
    canonicalSecurityClassId: filter.canonicalSecurityClassId ?? null,
    from: filter.from,
    to: filter.to,
    basisChangeCoverage: "reverse_split_only",
    executions,
    conflicts,
  };
}

export function reverseSplitExecutionActivationDecision(input: {
  execution: ReverseSplitExecution;
  targetDate: string;
  targetAt?: string;
}): ReverseSplitExecutionActivationDecision {
  if (!validDate(input.targetDate)) throw new Error("Reverse split execution target date is invalid");
  if (input.targetDate < input.execution.effectiveDate) {
    return { status: "NOT_APPLIED", reason: "target_before_effective_date" };
  }
  if (input.targetDate > input.execution.effectiveDate) {
    return { status: "APPLIED", reason: "target_after_effective_date" };
  }

  const timing = input.execution.effectiveTiming;
  if (timing.availability === "unavailable") {
    return timing.reason === "date_only"
      ? { status: "APPLIED", reason: "effective_date_day_basis" }
      : { status: "INDETERMINATE", reason: "effective_timing_unresolved" };
  }
  if (timing.kind === "market_open" || timing.kind === "start_of_trading") {
    return { status: "APPLIED", reason: "effective_date_day_basis" };
  }
  if (timing.kind === "after_market_close") {
    return { status: "NOT_APPLIED", reason: "after_market_close_same_day" };
  }
  if (!input.targetAt) {
    return { status: "INDETERMINATE", reason: "exact_timestamp_requires_target_at" };
  }
  if (!validTimestamp(input.targetAt)) throw new Error("Reverse split execution target timestamp is invalid");
  return Date.parse(input.targetAt) >= Date.parse(timing.timestamp!)
    ? { status: "APPLIED", reason: "exact_timestamp_reached" }
    : { status: "NOT_APPLIED", reason: "exact_timestamp_not_reached" };
}

export function reverseSplitExecutionId(input: {
  issuerCik: string;
  canonicalSecurityClassId: string;
  effectiveDate: string;
  oldShareUnits: string;
  newShareUnits: string;
}) {
  const tuple = executionTuple(input);
  if (!tuple) throw new Error("Reverse split execution identity input is invalid");
  return `rse:v1:${sha256(tuple)}`;
}

function calculationObservation(item: ReverseSplitHistoryItem): ReverseSplitExecutionObservation | null {
  const facts = item.facts;
  const issuer = facts.applicability?.issuer;
  const affected = facts.applicability?.affected_security;
  const exact = facts.ratio.exact_source_components;
  if (facts.event_kind !== "reverse_split"
    || issuer?.availability !== "available" || affected?.availability !== "available"
    || issuer.issuer_cik !== item.issuerCik
    || affected.canonical_security_class_id !== item.canonicalSecurityClassId
    || !validAccession(issuer.accession_number) || !validTimestamp(issuer.accepted_at)
    || facts.source.source_family !== "sec" || facts.source.source_id !== issuer.accession_number
    || facts.effective_date.availability !== "available"
    || facts.effective_date.value !== item.effectiveDate
    || exact?.availability !== "available"
    || !positiveDecimal(exact.old_share_units) || !positiveDecimal(exact.new_share_units)
    || facts.evidence.availability !== "available") {
    return null;
  }
  return {
    eventId: item.eventId,
    sourceExecutionId: item.sourceExecutionId,
    issuerCik: item.issuerCik,
    canonicalSecurityClassId: item.canonicalSecurityClassId,
    accessionNumber: issuer.accession_number,
    acceptedAt: issuer.accepted_at!,
    actionStage: facts.action_stage,
    exactRatio: {
      oldShareUnits: exact.old_share_units,
      newShareUnits: exact.new_share_units,
    },
    effectiveDate: item.effectiveDate,
    effectiveTiming: item.effectiveTiming,
    sourceRef: facts.source_ref,
    evidence: facts.evidence,
    source: { ...facts.source },
    persistedAt: item.persistedAt,
    facts,
  };
}

function projectExecutionGroup(
  observationsValue: readonly ReverseSplitExecutionObservation[],
): ReverseSplitExecution | ReverseSplitExecutionConflict {
  if (!observationsValue.length) throw new Error("Reverse split execution projection requires observations");
  const observations = [...observationsValue].sort(compareObservations);
  const first = observations[0]!;
  const ratioKeys = distinct(observations.map((item) => ratioKey(item.exactRatio)));
  const availableTimings = distinct(observations.flatMap((item) => item.effectiveTiming.availability === "available"
    ? [timingKey(item.effectiveTiming)] : []));
  const reasons: ReverseSplitExecutionConflict["reasons"] = [];
  if (ratioKeys.length > 1) reasons.push("FINAL_RATIO_CONFLICT");
  if (availableTimings.length > 1) reasons.push("EFFECTIVE_TIMING_CONFLICT");
  if (reasons.length) {
    return {
      version: REVERSE_SPLIT_EXECUTION_VERSION,
      status: "EXECUTION_CONFLICT",
      conflictId: `rsec:v1:${sha256(dateGroupKey(first))}`,
      issuerCik: first.issuerCik,
      canonicalSecurityClassId: first.canonicalSecurityClassId,
      effectiveDate: first.effectiveDate,
      reasons,
      candidateExecutionIds: ratioKeys.map((key) => {
        const ratio = ratioFromKey(key);
        return reverseSplitExecutionId({
          issuerCik: first.issuerCik,
          canonicalSecurityClassId: first.canonicalSecurityClassId,
          effectiveDate: first.effectiveDate,
          oldShareUnits: ratio.oldShareUnits,
          newShareUnits: ratio.newShareUnits,
        });
      }).sort(),
      observations,
    };
  }
  const exactRatio = ratioFromKey(ratioKeys[0]!);
  return {
    version: REVERSE_SPLIT_EXECUTION_VERSION,
    status: "CALCULATION_ELIGIBLE",
    executionId: reverseSplitExecutionId({
      issuerCik: first.issuerCik,
      canonicalSecurityClassId: first.canonicalSecurityClassId,
      effectiveDate: first.effectiveDate,
      oldShareUnits: exactRatio.oldShareUnits,
      newShareUnits: exactRatio.newShareUnits,
    }),
    issuerCik: first.issuerCik,
    canonicalSecurityClassId: first.canonicalSecurityClassId,
    effectiveDate: first.effectiveDate,
    exactRatio,
    effectiveTiming: availableTimings.length === 1
      ? timingFromKey(availableTimings[0]!, observations)
      : unavailableTimingProjection(observations),
    observations,
  };
}

function dedupeObservations(observations: readonly ReverseSplitExecutionObservation[]) {
  const unique = new Map<string, ReverseSplitExecutionObservation>();
  for (const observation of observations) {
    unique.set(`${observation.eventId}:${observation.sourceExecutionId}`, observation);
  }
  return [...unique.values()];
}

function executionTuple(input: {
  issuerCik: string;
  canonicalSecurityClassId: string;
  effectiveDate: string;
  oldShareUnits: string;
  newShareUnits: string;
}) {
  if (!/^\d{10}$/.test(input.issuerCik)
    || !canonicalClassId(input.canonicalSecurityClassId, input.issuerCik)
    || !validDate(input.effectiveDate)
    || !positiveDecimal(input.oldShareUnits) || !positiveDecimal(input.newShareUnits)) return null;
  return JSON.stringify([
    REVERSE_SPLIT_EXECUTION_VERSION,
    input.issuerCik,
    input.canonicalSecurityClassId,
    input.effectiveDate,
    input.oldShareUnits,
    input.newShareUnits,
  ]);
}

function unavailableTimingProjection(observations: readonly ReverseSplitExecutionObservation[]): EffectiveTiming {
  const reasons = distinct(observations.flatMap((item) => item.effectiveTiming.availability === "unavailable"
    ? [item.effectiveTiming.reason] : []));
  return reasons.length === 1
    ? { availability: "unavailable", reason: reasons[0]! }
    : { availability: "unavailable", reason: "ambiguous" };
}

function timingKey(timing: Extract<EffectiveTiming, { availability: "available" }>) {
  return timing.kind === "exact_timestamp"
    ? `${timing.kind}:${new Date(timing.timestamp!).toISOString()}`
    : timing.kind;
}

function timingFromKey(
  key: string,
  observations: readonly ReverseSplitExecutionObservation[],
): EffectiveTiming {
  return observations.find((item) => item.effectiveTiming.availability === "available"
    && timingKey(item.effectiveTiming) === key)!.effectiveTiming;
}

function ratioKey(ratio: ExactRatio) {
  return `${ratio.oldShareUnits}:${ratio.newShareUnits}`;
}

function ratioFromKey(key: string): ExactRatio {
  const separator = key.indexOf(":");
  return { oldShareUnits: key.slice(0, separator), newShareUnits: key.slice(separator + 1) };
}

function dateGroupKey(observation: Pick<
  ReverseSplitExecutionObservation,
  "issuerCik" | "canonicalSecurityClassId" | "effectiveDate"
>) {
  return JSON.stringify([
    observation.issuerCik,
    observation.canonicalSecurityClassId,
    observation.effectiveDate,
  ]);
}

function compareObservations(left: ReverseSplitExecutionObservation, right: ReverseSplitExecutionObservation) {
  return Date.parse(left.acceptedAt) - Date.parse(right.acceptedAt)
    || left.accessionNumber.localeCompare(right.accessionNumber)
    || left.sourceExecutionId.localeCompare(right.sourceExecutionId);
}

function compareExecutions(left: ReverseSplitExecution, right: ReverseSplitExecution) {
  return left.effectiveDate.localeCompare(right.effectiveDate)
    || left.canonicalSecurityClassId.localeCompare(right.canonicalSecurityClassId)
    || left.executionId.localeCompare(right.executionId);
}

function compareConflicts(left: ReverseSplitExecutionConflict, right: ReverseSplitExecutionConflict) {
  return left.effectiveDate.localeCompare(right.effectiveDate)
    || left.canonicalSecurityClassId.localeCompare(right.canonicalSecurityClassId)
    || left.conflictId.localeCompare(right.conflictId);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function distinct<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function canonicalClassId(value: string, cik: string) {
  return new RegExp(`^sc:v1:${cik}:common_stock:(?:single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127})$`).test(value);
}

function positiveDecimal(value: string) {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function validAccession(value: string) {
  return /^\d{10}-\d{2}-\d{6}$/.test(value);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: string | null) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}
