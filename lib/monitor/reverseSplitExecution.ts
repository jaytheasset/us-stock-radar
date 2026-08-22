import { createHash } from "node:crypto";
import type {
  CorporateActionCanonicalFacts,
  CorporateActionEventKind,
  CorporateActionStage,
} from "./corporateActionCanonicalFacts.ts";
import {
  readReverseSplitHistory,
  readStockSplitHistory,
  type ReverseSplitHistoryItem,
  type ReverseSplitHistoryReadResult,
  type StockSplitHistoryReadResult,
} from "./reverseSplitHistory.ts";
import {
  readReverseSplitExecutionUpdates,
  readStockSplitExecutionUpdates,
  type ReverseSplitExecutionUpdateObservation,
  type ReverseSplitExecutionUpdateReadResult,
  type StockSplitExecutionUpdateReadResult,
} from "./reverseSplitExecutionUpdate.ts";

export const REVERSE_SPLIT_EXECUTION_VERSION = "reverse_split_execution_v1";
export const FORWARD_SPLIT_EXECUTION_VERSION = "forward_split_execution_v1";

type StockSplitExecutionVersion =
  | typeof REVERSE_SPLIT_EXECUTION_VERSION
  | typeof FORWARD_SPLIT_EXECUTION_VERSION;

type StockSplitExecutionContract = {
  actionKind: CorporateActionEventKind;
  errorLabel: "Reverse split" | "Stock split";
  executionVersion: StockSplitExecutionVersion;
  executionPrefix: "rse" | "fse";
  tupleConflictPrefix: "rsec" | "fsec";
  updateConflictPrefix: "rseuc" | "fseuc";
  basisChangeCoverage: "reverse_split_only" | "forward_split_only";
};

const REVERSE_SPLIT_CONTRACT: StockSplitExecutionContract = {
  actionKind: "reverse_split",
  errorLabel: "Reverse split",
  executionVersion: REVERSE_SPLIT_EXECUTION_VERSION,
  executionPrefix: "rse",
  tupleConflictPrefix: "rsec",
  updateConflictPrefix: "rseuc",
  basisChangeCoverage: "reverse_split_only",
};

const FORWARD_SPLIT_CONTRACT: StockSplitExecutionContract = {
  actionKind: "forward_split",
  errorLabel: "Stock split",
  executionVersion: FORWARD_SPLIT_EXECUTION_VERSION,
  executionPrefix: "fse",
  tupleConflictPrefix: "fsec",
  updateConflictPrefix: "fseuc",
  basisChangeCoverage: "forward_split_only",
};

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

export type ReverseSplitExecution<
  TVersion extends StockSplitExecutionVersion = typeof REVERSE_SPLIT_EXECUTION_VERSION,
> = {
  version: TVersion;
  status: "CALCULATION_ELIGIBLE";
  executionStatus: "scheduled" | "effective";
  executionId: string;
  issuerCik: string;
  canonicalSecurityClassId: string;
  effectiveDate: string;
  exactRatio: ExactRatio;
  effectiveTiming: EffectiveTiming;
  observations: ReverseSplitExecutionObservation[];
};

export type ForwardSplitExecutionObservation = ReverseSplitExecutionObservation;
export type StockSplitExecutionObservation = ReverseSplitExecutionObservation;

export type ForwardSplitExecution = ReverseSplitExecution<typeof FORWARD_SPLIT_EXECUTION_VERSION>;
export type StockSplitExecution = ReverseSplitExecution<StockSplitExecutionVersion>;

export type InactiveReverseSplitExecution<
  TVersion extends StockSplitExecutionVersion = typeof REVERSE_SPLIT_EXECUTION_VERSION,
> = Omit<
  ReverseSplitExecution<TVersion>,
  "status" | "executionStatus"
> & {
  status: "CALCULATION_INELIGIBLE";
  executionStatus: "superseded" | "cancelled";
  updateObservation: ReverseSplitExecutionUpdateObservation;
};

export type ReverseSplitExecutionTupleConflict<
  TVersion extends StockSplitExecutionVersion = typeof REVERSE_SPLIT_EXECUTION_VERSION,
> = {
  version: TVersion;
  status: "EXECUTION_CONFLICT";
  executionStatus: "conflict";
  conflictId: string;
  issuerCik: string;
  canonicalSecurityClassId: string;
  effectiveDate: string;
  reasons: Array<"FINAL_RATIO_CONFLICT" | "EFFECTIVE_TIMING_CONFLICT">;
  candidateExecutionIds: string[];
  observations: ReverseSplitExecutionObservation[];
};

export type ReverseSplitExecutionUpdateConflict<
  TVersion extends StockSplitExecutionVersion = typeof REVERSE_SPLIT_EXECUTION_VERSION,
> = {
  version: TVersion;
  status: "EXECUTION_CONFLICT";
  executionStatus: "conflict";
  conflictId: string;
  issuerCik: string;
  canonicalSecurityClassId: null;
  effectiveDate: null;
  reasons: Array<"UNRESOLVED_EXECUTION_UPDATE" | "TARGET_EXECUTION_NOT_FOUND">;
  candidateExecutionIds: string[];
  updateObservations: ReverseSplitExecutionUpdateObservation[];
};

export type ReverseSplitExecutionConflict<
  TVersion extends StockSplitExecutionVersion = typeof REVERSE_SPLIT_EXECUTION_VERSION,
> =
  | ReverseSplitExecutionTupleConflict<TVersion>
  | ReverseSplitExecutionUpdateConflict<TVersion>;

type InactiveStockSplitExecution = InactiveReverseSplitExecution<StockSplitExecutionVersion>;
type StockSplitExecutionTupleConflict = ReverseSplitExecutionTupleConflict<StockSplitExecutionVersion>;
type StockSplitExecutionUpdateConflict = ReverseSplitExecutionUpdateConflict<StockSplitExecutionVersion>;
type StockSplitExecutionConflict = ReverseSplitExecutionConflict<StockSplitExecutionVersion>;

export type ReverseSplitExecutionReadResult = {
  status: "available";
  issuerCik: string;
  canonicalSecurityClassId: string | null;
  from: string;
  to: string;
  targetAt: string;
  basisChangeCoverage: "reverse_split_only";
  executions: ReverseSplitExecution[];
  inactiveExecutions: InactiveReverseSplitExecution[];
  conflicts: ReverseSplitExecutionConflict[];
};

export type ForwardSplitExecutionReadResult = Omit<
  ReverseSplitExecutionReadResult,
  "basisChangeCoverage" | "executions" | "inactiveExecutions" | "conflicts"
> & {
  basisChangeCoverage: "forward_split_only";
  executions: ForwardSplitExecution[];
  inactiveExecutions: InactiveReverseSplitExecution<typeof FORWARD_SPLIT_EXECUTION_VERSION>[];
  conflicts: ReverseSplitExecutionConflict<typeof FORWARD_SPLIT_EXECUTION_VERSION>[];
};

export type StockSplitExecutionReadResult =
  | ReverseSplitExecutionReadResult
  | ForwardSplitExecutionReadResult;

type StockSplitExecutionProjectionResult = Omit<
  ReverseSplitExecutionReadResult,
  "basisChangeCoverage" | "executions" | "inactiveExecutions" | "conflicts"
> & {
  basisChangeCoverage: StockSplitExecutionContract["basisChangeCoverage"];
  executions: StockSplitExecution[];
  inactiveExecutions: InactiveStockSplitExecution[];
  conflicts: StockSplitExecutionConflict[];
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
  readUpdates(input: {
    cik: string;
    targetAt: string;
  }): Promise<ReverseSplitExecutionUpdateReadResult>;
};

type StockSplitExecutionDependencies = {
  readHistory(input: {
    actionKind: CorporateActionEventKind;
    cik: string;
    canonicalSecurityClassId?: string;
    from: string;
    to: string;
  }): Promise<StockSplitHistoryReadResult>;
  readUpdates(input: {
    actionKind: CorporateActionEventKind;
    cik: string;
    targetAt: string;
  }): Promise<StockSplitExecutionUpdateReadResult>;
};

type StockSplitProjectionDependencies = {
  readHistory(input: {
    cik: string;
    canonicalSecurityClassId?: string;
    from: string;
    to: string;
  }): Promise<StockSplitHistoryReadResult>;
  readUpdates(input: {
    cik: string;
    targetAt: string;
  }): Promise<StockSplitExecutionUpdateReadResult>;
};

const defaultDependencies: ReverseSplitExecutionDependencies = {
  readHistory: (input) => readReverseSplitHistory(input),
  readUpdates: (input) => readReverseSplitExecutionUpdates(input),
};

const defaultStockSplitDependencies: StockSplitExecutionDependencies = {
  readHistory: (input) => readStockSplitHistory(input),
  readUpdates: (input) => readStockSplitExecutionUpdates(input),
};

export async function readReverseSplitExecutions(
  filter: {
    cik: string;
    canonicalSecurityClassId?: string;
    from: string;
    to: string;
    targetAt: string;
    knownAt?: string;
  },
  dependencies: ReverseSplitExecutionDependencies = defaultDependencies,
): Promise<ReverseSplitExecutionReadResult> {
  return readStockSplitExecutionsInternal(
    REVERSE_SPLIT_CONTRACT,
    filter,
    dependencies,
  ) as Promise<ReverseSplitExecutionReadResult>;
}

export async function readStockSplitExecutions(
  filter: {
    actionKind: CorporateActionEventKind;
    cik: string;
    canonicalSecurityClassId?: string;
    from: string;
    to: string;
    targetAt: string;
    knownAt?: string;
  },
  dependencies: StockSplitExecutionDependencies = defaultStockSplitDependencies,
): Promise<StockSplitExecutionReadResult> {
  const contract = splitContract(filter.actionKind);
  return readStockSplitExecutionsInternal(contract, filter, {
    readHistory: (input) => dependencies.readHistory({ ...input, actionKind: contract.actionKind }),
    readUpdates: (input) => dependencies.readUpdates({ ...input, actionKind: contract.actionKind }),
  }) as Promise<StockSplitExecutionReadResult>;
}

async function readStockSplitExecutionsInternal(
  contract: StockSplitExecutionContract,
  filter: {
    cik: string;
    canonicalSecurityClassId?: string;
    from: string;
    to: string;
    targetAt: string;
    knownAt?: string;
  },
  dependencies: StockSplitProjectionDependencies,
): Promise<StockSplitExecutionProjectionResult> {
  if (!validTimestamp(filter.targetAt)) {
    throw new Error(`${contract.errorLabel} execution target timestamp is invalid`);
  }
  const knownAt = filter.knownAt ?? filter.targetAt;
  if (!validTimestamp(knownAt)) {
    throw new Error(`${contract.errorLabel} execution knowledge timestamp is invalid`);
  }
  const history = await dependencies.readHistory(filter);
  const updateHistory = await dependencies.readUpdates({ cik: filter.cik, targetAt: filter.targetAt });
  if (history.status !== "available" || history.issuerCik !== filter.cik
    || history.canonicalSecurityClassId !== (filter.canonicalSecurityClassId ?? null)
    || history.from !== filter.from || history.to !== filter.to
    || history.basisChangeCoverage !== contract.basisChangeCoverage) {
    throw new Error(`${contract.errorLabel} execution history response is invalid`);
  }
  if (updateHistory.status !== "available" || updateHistory.issuerCik !== filter.cik
    || updateHistory.targetAt !== filter.targetAt) {
    throw new Error(`${contract.errorLabel} execution update history response is invalid`);
  }

  const knownHistoryItems = history.items.filter((item) =>
    Date.parse(item.persistedAt) <= Date.parse(knownAt));
  const materializedObservations = knownHistoryItems.map((item) =>
    calculationObservation(item, contract.actionKind));
  if (materializedObservations.some((item, index) => item === null
    && hasCompleteCalculationEvidence(knownHistoryItems[index]!.facts, contract.actionKind))) {
    throw new Error(`${contract.errorLabel} history contains source-backed evidence that cannot be materialized as an execution`);
  }
  const observations = dedupeObservations(
    materializedObservations
      .filter((item): item is ReverseSplitExecutionObservation => item !== null)
      .filter((item) => Date.parse(item.acceptedAt) <= Date.parse(filter.targetAt)),
  );
  const exactTupleGroups = new Map<string, ReverseSplitExecutionObservation[]>();
  for (const observation of observations) {
    const key = stockSplitExecutionId({
      actionKind: contract.actionKind,
      issuerCik: observation.issuerCik,
      canonicalSecurityClassId: observation.canonicalSecurityClassId,
      effectiveDate: observation.effectiveDate,
      oldShareUnits: observation.exactRatio.oldShareUnits,
      newShareUnits: observation.exactRatio.newShareUnits,
    });
    const group = exactTupleGroups.get(key) ?? [];
    group.push(observation);
    exactTupleGroups.set(key, group);
  }

  const executions: StockSplitExecution[] = [];
  const conflicts: StockSplitExecutionConflict[] = [];
  for (const group of exactTupleGroups.values()) {
    const projection = projectExecutionGroup(group, filter.targetAt, contract);
    if (projection.status === "CALCULATION_ELIGIBLE") executions.push(projection);
    else conflicts.push(projection);
  }
  const updateProjection = applyExecutionUpdates(executions, updateHistory.updates, contract);
  conflicts.push(...updateProjection.conflicts);
  const dateProjection = resolveRemainingDateConflicts(updateProjection.executions, contract);
  conflicts.push(...dateProjection.conflicts);
  const activeExecutions = dateProjection.executions;
  const inactiveExecutions = updateProjection.inactiveExecutions;
  activeExecutions.sort(compareExecutions);
  inactiveExecutions.sort(compareInactiveExecutions);
  conflicts.sort(compareConflicts);
  return {
    status: "available",
    issuerCik: filter.cik,
    canonicalSecurityClassId: filter.canonicalSecurityClassId ?? null,
    from: filter.from,
    to: filter.to,
    targetAt: filter.targetAt,
    basisChangeCoverage: contract.basisChangeCoverage,
    executions: activeExecutions,
    inactiveExecutions,
    conflicts,
  };
}

function resolveRemainingDateConflicts(
  projected: readonly StockSplitExecution[],
  contract: StockSplitExecutionContract,
): {
  executions: StockSplitExecution[];
  conflicts: StockSplitExecutionTupleConflict[];
} {
  const groups = new Map<string, StockSplitExecution[]>();
  for (const execution of projected) {
    const key = dateGroupKey(execution.observations[0]!);
    const group = groups.get(key) ?? [];
    group.push(execution);
    groups.set(key, group);
  }
  const executions: StockSplitExecution[] = [];
  const conflicts: StockSplitExecutionTupleConflict[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      executions.push(group[0]!);
      continue;
    }
    const observations = group.flatMap((execution) => execution.observations).sort(compareObservations);
    const first = observations[0]!;
    conflicts.push({
      version: contract.executionVersion,
      status: "EXECUTION_CONFLICT",
      executionStatus: "conflict",
      conflictId: `${contract.tupleConflictPrefix}:v1:${sha256(dateGroupKey(first))}`,
      issuerCik: first.issuerCik,
      canonicalSecurityClassId: first.canonicalSecurityClassId,
      effectiveDate: first.effectiveDate,
      reasons: ["FINAL_RATIO_CONFLICT"],
      candidateExecutionIds: group.map((execution) => execution.executionId).sort(),
      observations,
    });
  }
  return { executions, conflicts };
}

export function reverseSplitExecutionActivationDecision(input: {
  execution: ReverseSplitExecution;
  targetDate: string;
  targetAt?: string;
}): ReverseSplitExecutionActivationDecision {
  return stockSplitExecutionActivationDecisionInternal(input, "Reverse split");
}

export function stockSplitExecutionActivationDecision(input: {
  execution: StockSplitExecution;
  targetDate: string;
  targetAt?: string;
}): ReverseSplitExecutionActivationDecision {
  return stockSplitExecutionActivationDecisionInternal(input, "Stock split");
}

function stockSplitExecutionActivationDecisionInternal(
  input: {
    execution: StockSplitExecution;
    targetDate: string;
    targetAt?: string;
  },
  errorLabel: "Reverse split" | "Stock split",
): ReverseSplitExecutionActivationDecision {
  if (!validDate(input.targetDate)) throw new Error(`${errorLabel} execution target date is invalid`);
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
  if (!validTimestamp(input.targetAt)) throw new Error(`${errorLabel} execution target timestamp is invalid`);
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
  const tuple = executionTuple({ actionKind: "reverse_split", ...input }, REVERSE_SPLIT_CONTRACT);
  if (!tuple) throw new Error("Reverse split execution identity input is invalid");
  return `rse:v1:${sha256(tuple)}`;
}

export function stockSplitExecutionId(input: {
  actionKind: CorporateActionEventKind;
  issuerCik: string;
  canonicalSecurityClassId: string;
  effectiveDate: string;
  oldShareUnits: string;
  newShareUnits: string;
}) {
  const contract = splitContract(input.actionKind);
  const tuple = executionTuple(input, contract);
  if (!tuple) throw new Error("Stock split execution identity input is invalid");
  return `${contract.executionPrefix}:v1:${sha256(tuple)}`;
}

function calculationObservation(
  item: ReverseSplitHistoryItem,
  actionKind: CorporateActionEventKind,
): ReverseSplitExecutionObservation | null {
  const facts = item.facts;
  const issuer = facts.applicability?.issuer;
  const affected = facts.applicability?.affected_security;
  const exact = facts.ratio.exact_source_components;
  if (facts.event_kind !== actionKind
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

function hasCompleteCalculationEvidence(
  facts: CorporateActionCanonicalFacts,
  actionKind: CorporateActionEventKind,
) {
  const issuer = facts.applicability?.issuer;
  const affected = facts.applicability?.affected_security;
  const exact = facts.ratio.exact_source_components;
  return facts.event_kind === actionKind
    && issuer?.availability === "available"
    && affected?.availability === "available"
    && validAccession(issuer.accession_number)
    && validTimestamp(issuer.accepted_at)
    && facts.source.source_family === "sec"
    && facts.source.source_id === issuer.accession_number
    && facts.effective_date.availability === "available"
    && exact?.availability === "available"
    && positiveDecimal(exact.old_share_units)
    && positiveDecimal(exact.new_share_units)
    && facts.evidence.availability === "available";
}

function projectExecutionGroup(
  observationsValue: readonly ReverseSplitExecutionObservation[],
  targetAt: string,
  contract: StockSplitExecutionContract,
): StockSplitExecution | StockSplitExecutionTupleConflict {
  if (!observationsValue.length) {
    throw new Error(`${contract.errorLabel} execution projection requires observations`);
  }
  const observations = [...observationsValue].sort(compareObservations);
  const first = observations[0]!;
  const ratioKeys = distinct(observations.map((item) => ratioKey(item.exactRatio)));
  const availableTimings = distinct(observations.flatMap((item) => item.effectiveTiming.availability === "available"
    ? [timingKey(item.effectiveTiming)] : []));
  const reasons: StockSplitExecutionTupleConflict["reasons"] = [];
  if (ratioKeys.length > 1) reasons.push("FINAL_RATIO_CONFLICT");
  if (availableTimings.length > 1) reasons.push("EFFECTIVE_TIMING_CONFLICT");
  if (reasons.length) {
    return {
      version: contract.executionVersion,
      status: "EXECUTION_CONFLICT",
      executionStatus: "conflict",
      conflictId: `${contract.tupleConflictPrefix}:v1:${sha256(dateGroupKey(first))}`,
      issuerCik: first.issuerCik,
      canonicalSecurityClassId: first.canonicalSecurityClassId,
      effectiveDate: first.effectiveDate,
      reasons,
      candidateExecutionIds: ratioKeys.map((key) => {
        const ratio = ratioFromKey(key);
        return stockSplitExecutionId({
          actionKind: contract.actionKind,
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
    version: contract.executionVersion,
    status: "CALCULATION_ELIGIBLE",
    executionStatus: calculationStatus(first.effectiveDate, targetAt),
    executionId: stockSplitExecutionId({
      actionKind: contract.actionKind,
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

function applyExecutionUpdates(
  projected: readonly StockSplitExecution[],
  updates: readonly ReverseSplitExecutionUpdateObservation[],
  contract: StockSplitExecutionContract,
): {
  executions: StockSplitExecution[];
  inactiveExecutions: InactiveStockSplitExecution[];
  conflicts: StockSplitExecutionUpdateConflict[];
} {
  const active = new Map(projected.map((execution) => [execution.executionId, execution]));
  const inactive = new Map<string, InactiveStockSplitExecution>();
  const conflicts: StockSplitExecutionUpdateConflict[] = [];
  for (const observation of updates) {
    const update = observation.update;
    if (update.decision === "KEEP_OR_CONFIRM" || update.decision === "NEW_EXECUTION") continue;
    if (update.decision === "UNRESOLVED_EXECUTION_UPDATE") {
      conflicts.push(updateConflict(observation, "UNRESOLVED_EXECUTION_UPDATE", contract));
      for (const [executionId, execution] of active) {
        if (executionWasKnownAt(execution, observation.acceptedAt)) active.delete(executionId);
      }
      continue;
    }
    const targetId = update.target_execution_id!;
    const target = active.get(targetId);
    if (!target) {
      if (!inactive.has(targetId)) {
        conflicts.push(updateConflict(observation, "TARGET_EXECUTION_NOT_FOUND", contract));
      }
      continue;
    }
    const executionStatus = update.decision === "SUPERSEDE_EXISTING_EXECUTION"
      ? "superseded" as const
      : "cancelled" as const;
    active.delete(targetId);
    inactive.set(targetId, {
      ...target,
      status: "CALCULATION_INELIGIBLE",
      executionStatus,
      updateObservation: observation,
    });
  }
  return {
    executions: [...active.values()],
    inactiveExecutions: [...inactive.values()],
    conflicts,
  };
}

function executionWasKnownAt(execution: StockSplitExecution, acceptedAt: string) {
  return execution.observations.some((observation) => Date.parse(observation.acceptedAt) <= Date.parse(acceptedAt));
}

function updateConflict(
  observation: ReverseSplitExecutionUpdateObservation,
  reason: StockSplitExecutionUpdateConflict["reasons"][number],
  contract: StockSplitExecutionContract,
): StockSplitExecutionUpdateConflict {
  return {
    version: contract.executionVersion,
    status: "EXECUTION_CONFLICT",
    executionStatus: "conflict",
    conflictId: `${contract.updateConflictPrefix}:v1:${sha256(`${observation.eventId}:${observation.sourceExecutionId}:${reason}`)}`,
    issuerCik: observation.issuerCik,
    canonicalSecurityClassId: null,
    effectiveDate: null,
    reasons: [reason],
    candidateExecutionIds: [...observation.update.candidate_execution_ids],
    updateObservations: [observation],
  };
}

function calculationStatus(effectiveDate: string, targetAt: string): "scheduled" | "effective" {
  return targetAt.slice(0, 10) < effectiveDate ? "scheduled" : "effective";
}

function dedupeObservations(observations: readonly ReverseSplitExecutionObservation[]) {
  const unique = new Map<string, ReverseSplitExecutionObservation>();
  for (const observation of observations) {
    unique.set(`${observation.eventId}:${observation.sourceExecutionId}`, observation);
  }
  return [...unique.values()];
}

function executionTuple(input: {
  actionKind: CorporateActionEventKind;
  issuerCik: string;
  canonicalSecurityClassId: string;
  effectiveDate: string;
  oldShareUnits: string;
  newShareUnits: string;
}, contract: StockSplitExecutionContract) {
  if (!/^\d{10}$/.test(input.issuerCik)
    || !canonicalClassId(input.canonicalSecurityClassId, input.issuerCik)
    || !validDate(input.effectiveDate)
    || !positiveDecimal(input.oldShareUnits) || !positiveDecimal(input.newShareUnits)) return null;
  return JSON.stringify([
    contract.executionVersion,
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

function compareExecutions(left: StockSplitExecution, right: StockSplitExecution) {
  return left.effectiveDate.localeCompare(right.effectiveDate)
    || left.canonicalSecurityClassId.localeCompare(right.canonicalSecurityClassId)
    || left.executionId.localeCompare(right.executionId);
}

function compareInactiveExecutions(left: InactiveStockSplitExecution, right: InactiveStockSplitExecution) {
  return left.effectiveDate.localeCompare(right.effectiveDate)
    || left.canonicalSecurityClassId.localeCompare(right.canonicalSecurityClassId)
    || left.executionId.localeCompare(right.executionId);
}

function compareConflicts(left: StockSplitExecutionConflict, right: StockSplitExecutionConflict) {
  return (left.effectiveDate ?? "").localeCompare(right.effectiveDate ?? "")
    || (left.canonicalSecurityClassId ?? "").localeCompare(right.canonicalSecurityClassId ?? "")
    || left.conflictId.localeCompare(right.conflictId);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function distinct<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function canonicalClassId(value: string, cik: string) {
  return new RegExp(`^sc:v1:${cik}:common_stock:(?:single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127}|custom:[0-9a-f]{64}:[A-Za-z][A-Za-z0-9_.-]{1,127})$`).test(value);
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

function splitContract(actionKind: CorporateActionEventKind) {
  if (actionKind === "reverse_split") return REVERSE_SPLIT_CONTRACT;
  if (actionKind === "forward_split") return FORWARD_SPLIT_CONTRACT;
  throw new Error("Stock split action kind is invalid");
}
