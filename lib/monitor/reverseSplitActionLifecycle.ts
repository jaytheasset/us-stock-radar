import {
  reverseSplitActionId,
  type CorporateActionCanonicalFacts,
  type CorporateActionStage,
  type ReverseSplitActionCandidate,
} from "./corporateActionCanonicalFacts.ts";
import {
  readCurrentCorporateActionFacts,
  type CorporateActionPersistenceDependencies,
  type CurrentCorporateActionReadResult,
} from "./corporateActionPersistence.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CIK_PATTERN = /^\d{10}$/;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;

export type ReverseSplitActionObservation = {
  actionId: string;
  originEventId: string;
  eventId: string;
  sourceExecutionId: string;
  issuerCik: string;
  canonicalSecurityClassId: string;
  accessionNumber: string;
  acceptedAt: string;
  actionStage: CorporateActionStage;
  ratio: ReverseSplitActionCandidate["known_ratio"];
  effectiveDate: ReverseSplitActionCandidate["known_effective_date"];
  effectiveTiming: NonNullable<CorporateActionCanonicalFacts["effective_timing"]>;
  evidence: CorporateActionCanonicalFacts["evidence"];
  facts: CorporateActionCanonicalFacts;
  persistedAt: string;
};

export type ReverseSplitActionProjection = {
  status: "ACTION_AVAILABLE" | "ACTION_UNRESOLVED";
  actionId: string;
  originEventId: string;
  issuerCik: string;
  canonicalSecurityClassId: string;
  currentStage: CorporateActionStage | null;
  ratio: ReverseSplitActionCandidate["known_ratio"];
  effectiveDate: ReverseSplitActionCandidate["known_effective_date"];
  effectiveTiming: NonNullable<CorporateActionCanonicalFacts["effective_timing"]>;
  unresolvedReasons: Array<
    "ACTION_IDENTITY_CONFLICT"
    | "ACTION_RATIO_CONFLICT"
    | "ACTION_EFFECTIVE_DATE_CONFLICT"
    | "ACTION_EFFECTIVE_TIMING_CONFLICT"
    | "ACTION_STAGE_CHRONOLOGY_CONFLICT"
  >;
  observations: ReverseSplitActionObservation[];
};

export type ReverseSplitActionHistoryReadResult = {
  status: "available";
  issuerCik: string;
  canonicalSecurityClassId: string | null;
  from: string;
  to: string;
  basisChangeCoverage: "reverse_split_only";
  actions: ReverseSplitActionProjection[];
};

type ActionCandidateDependencies = CorporateActionPersistenceDependencies & {
  readCurrent(eventId: string): Promise<CurrentCorporateActionReadResult>;
};

const defaultDependencies: ActionCandidateDependencies = {
  rpc: async (functionName, payload) => {
    const repository = await import("../supabase.ts");
    return repository.supabaseRpc(functionName, payload);
  },
  readCurrent: (eventId) => readCurrentCorporateActionFacts(eventId),
};

export async function readReverseSplitActionCandidatesForAnalyzer(
  input: {
    issuerCik: string;
    acceptedAt: string | null;
    allowedSecurityClassIds: readonly string[];
  },
  dependencies: ActionCandidateDependencies = defaultDependencies,
): Promise<ReverseSplitActionCandidate[]> {
  if (!CIK_PATTERN.test(input.issuerCik) || !input.acceptedAt
    || !validTimestamp(input.acceptedAt) || input.allowedSecurityClassIds.length > 24) return [];
  const acceptedAt = input.acceptedAt;
  const allowedClasses = new Set(input.allowedSecurityClassIds);
  if ([...allowedClasses].some((value) => !canonicalClassId(value, input.issuerCik))) return [];
  const response = await dependencies.rpc("read_reverse_split_action_link_candidates", {
    p_issuer_cik: input.issuerCik,
    p_before_accepted_at: acceptedAt,
  });
  if (!response.ok) {
    throw new Error(`Reverse split action candidate reader failed: ${response.error || response.status}`);
  }
  const rawCandidates = validateActionObservationCandidateResponse(response.data, {
    issuerCik: input.issuerCik,
    acceptedAt,
  });
  const observations: ReverseSplitActionObservation[] = [];
  for (const candidate of rawCandidates) {
    if (!allowedClasses.has(candidate.canonicalSecurityClassId)) continue;
    const current = await dependencies.readCurrent(candidate.eventId);
    const observation = currentObservation(current, candidate);
    if (observation) observations.push(observation);
  }
  return actionCandidatesFromObservations(observations);
}

export async function readReverseSplitActionHistory(
  filter: {
    cik: string;
    canonicalSecurityClassId?: string;
    from: string;
    to: string;
  },
  dependencies: ActionCandidateDependencies = defaultDependencies,
): Promise<ReverseSplitActionHistoryReadResult> {
  if (!CIK_PATTERN.test(filter.cik) || !validDate(filter.from) || !validDate(filter.to)
    || filter.from > filter.to || (filter.canonicalSecurityClassId !== undefined
      && !canonicalClassId(filter.canonicalSecurityClassId, filter.cik))) {
    throw new Error("Reverse split action history filter is invalid");
  }
  const response = await dependencies.rpc("read_reverse_split_action_history_candidates", {
    p_issuer_cik: filter.cik,
    p_canonical_security_class_id: filter.canonicalSecurityClassId ?? null,
  });
  if (!response.ok) {
    throw new Error(`Reverse split action history candidate reader failed: ${response.error || response.status}`);
  }
  const rawCandidates = validateActionHistoryCandidateResponse(response.data, filter);
  const observations: ReverseSplitActionObservation[] = [];
  for (const candidate of rawCandidates) {
    const current = await dependencies.readCurrent(candidate.eventId);
    const observation = currentObservation(current, candidate);
    if (observation) observations.push(observation);
  }
  const groups = new Map<string, ReverseSplitActionObservation[]>();
  for (const observation of observations) {
    const group = groups.get(observation.actionId) ?? [];
    group.push(observation);
    groups.set(observation.actionId, group);
  }
  const actions = [...groups.values()].map(projectReverseSplitAction)
    .filter((action) => action.observations.some((observation) =>
      observation.effectiveDate.availability === "available"
      && observation.effectiveDate.value >= filter.from
      && observation.effectiveDate.value <= filter.to))
    .sort((left, right) => {
      const leftDate = left.effectiveDate.availability === "available" ? left.effectiveDate.value : "9999-12-31";
      const rightDate = right.effectiveDate.availability === "available" ? right.effectiveDate.value : "9999-12-31";
      return leftDate.localeCompare(rightDate) || left.actionId.localeCompare(right.actionId);
    });
  return {
    status: "available",
    issuerCik: filter.cik,
    canonicalSecurityClassId: filter.canonicalSecurityClassId ?? null,
    from: filter.from,
    to: filter.to,
    basisChangeCoverage: "reverse_split_only",
    actions,
  };
}

export function projectReverseSplitAction(
  observationsValue: readonly ReverseSplitActionObservation[],
): ReverseSplitActionProjection {
  if (observationsValue.length < 1) throw new Error("Reverse split action projection requires observations");
  const observations = [...observationsValue].sort(compareObservationChronology);
  const first = observations[0]!;
  const reasons = new Set<ReverseSplitActionProjection["unresolvedReasons"][number]>();
  for (const observation of observations) {
    if (observation.actionId !== first.actionId || observation.originEventId !== first.originEventId
      || observation.issuerCik !== first.issuerCik
      || observation.canonicalSecurityClassId !== first.canonicalSecurityClassId) {
      reasons.add("ACTION_IDENTITY_CONFLICT");
    }
  }
  const availableRatios = distinct(observations.flatMap((item) => item.ratio.availability === "available"
    ? [`${item.ratio.old_shares}:${item.ratio.new_shares}`] : []));
  if (availableRatios.length > 1) reasons.add("ACTION_RATIO_CONFLICT");
  const availableDates = distinct(observations.flatMap((item) => item.effectiveDate.availability === "available"
    ? [item.effectiveDate.value] : []));
  if (availableDates.length > 1) reasons.add("ACTION_EFFECTIVE_DATE_CONFLICT");
  const availableTimings = distinct(observations.flatMap((item) => item.effectiveTiming.availability === "available"
    ? [`${item.effectiveTiming.kind}:${item.effectiveTiming.timestamp ?? ""}`] : []));
  if (availableTimings.length > 1) reasons.add("ACTION_EFFECTIVE_TIMING_CONFLICT");

  const latestAcceptedAt = Date.parse(observations.at(-1)!.acceptedAt);
  const latest = observations.filter((item) => Date.parse(item.acceptedAt) === latestAcceptedAt);
  const latestStages = distinct(latest.map((item) => item.actionStage));
  if (latestStages.length > 1) reasons.add("ACTION_STAGE_CHRONOLOGY_CONFLICT");

  const ratio = availableRatios.length === 1
    ? ratioFromKey(availableRatios[0]!)
    : { availability: "unavailable" as const };
  const effectiveDate = availableDates.length === 1
    ? { availability: "available" as const, value: availableDates[0]! }
    : { availability: "unavailable" as const };
  const effectiveTiming = availableTimings.length === 1
    ? timingFromKey(availableTimings[0]!, observations)
    : availableTimings.length === 0
      ? observations.at(-1)!.effectiveTiming
      : { availability: "unavailable" as const, reason: "ambiguous" as const };
  return {
    status: reasons.size ? "ACTION_UNRESOLVED" : "ACTION_AVAILABLE",
    actionId: first.actionId,
    originEventId: first.originEventId,
    issuerCik: first.issuerCik,
    canonicalSecurityClassId: first.canonicalSecurityClassId,
    currentStage: latestStages.length === 1 ? latestStages[0]! : null,
    ratio,
    effectiveDate,
    effectiveTiming,
    unresolvedReasons: [...reasons].sort(),
    observations,
  };
}

export function actionCandidatesFromObservations(
  observations: readonly ReverseSplitActionObservation[],
): ReverseSplitActionCandidate[] {
  const groups = new Map<string, ReverseSplitActionObservation[]>();
  for (const observation of observations) {
    const group = groups.get(observation.actionId) ?? [];
    group.push(observation);
    groups.set(observation.actionId, group);
  }
  return [...groups.values()]
    .map(projectReverseSplitAction)
    .sort((left, right) => {
      const accepted = Date.parse(right.observations.at(-1)!.acceptedAt)
        - Date.parse(left.observations.at(-1)!.acceptedAt);
      return accepted || left.actionId.localeCompare(right.actionId);
    })
    .slice(0, 12)
    .map((projection) => ({
      action_id: projection.actionId,
      origin_event_id: projection.originEventId,
      issuer_cik: projection.issuerCik,
      canonical_security_class_id: projection.canonicalSecurityClassId,
      projection_status: projection.status,
      current_stage: projection.currentStage,
      known_ratio: projection.ratio,
      known_effective_date: projection.effectiveDate,
      prior_observations: projection.observations.slice(-4).map((observation) => ({
        accession_number: observation.accessionNumber,
        accepted_at: observation.acceptedAt,
        action_stage: observation.actionStage,
        ratio: observation.ratio,
        effective_date: observation.effectiveDate,
        evidence_summary: observation.evidence.availability === "available"
          ? Array.from(observation.evidence.value).slice(0, 240).join("") : null,
      })),
    }));
}

export function reverseSplitSameDayApplicationDecision(input: {
  targetAt: string;
  targetCalendarDate: string;
  effectiveDate: string;
  effectiveTiming: NonNullable<CorporateActionCanonicalFacts["effective_timing"]>;
}): "APPLIED" | "NOT_APPLIED" | "SAME_DAY_ORDER_INDETERMINATE" {
  if (!validTimestamp(input.targetAt) || !validDate(input.targetCalendarDate) || !validDate(input.effectiveDate)) {
    throw new Error("Reverse split same-day comparison input is invalid");
  }
  if (input.targetCalendarDate < input.effectiveDate) return "NOT_APPLIED";
  if (input.targetCalendarDate > input.effectiveDate) return "APPLIED";
  if (input.effectiveTiming.availability !== "available"
    || input.effectiveTiming.kind !== "exact_timestamp" || !input.effectiveTiming.timestamp) {
    return "SAME_DAY_ORDER_INDETERMINATE";
  }
  return Date.parse(input.targetAt) >= Date.parse(input.effectiveTiming.timestamp) ? "APPLIED" : "NOT_APPLIED";
}

function currentObservation(
  current: CurrentCorporateActionReadResult,
  candidate: ReturnType<typeof validateActionObservationCandidateResponse>[number],
): ReverseSplitActionObservation | null {
  if (current.status !== "available" || current.eventId !== candidate.eventId
    || current.sourceExecutionId !== candidate.sourceExecutionId) return null;
  const identity = current.facts.action_identity;
  const applicability = current.facts.applicability;
  const issuer = applicability?.issuer;
  const affected = applicability?.affected_security;
  if (!identity || identity.link_status !== "linked"
    || identity.reverse_split_action_id !== candidate.actionId
    || identity.origin_event_id !== candidate.originEventId
    || issuer?.availability !== "available" || affected?.availability !== "available"
    || issuer.issuer_cik !== candidate.issuerCik
    || issuer.accession_number !== candidate.accessionNumber
    || issuer.accepted_at !== candidate.acceptedAt
    || affected.canonical_security_class_id !== candidate.canonicalSecurityClassId) return null;
  const exact = current.facts.ratio.exact_source_components;
  const ratio = exact?.availability === "available"
    ? { availability: "available" as const, old_shares: exact.old_share_units, new_shares: exact.new_share_units }
    : { availability: "unavailable" as const };
  return {
    actionId: identity.reverse_split_action_id,
    originEventId: identity.origin_event_id,
    eventId: current.eventId,
    sourceExecutionId: current.sourceExecutionId,
    issuerCik: issuer.issuer_cik,
    canonicalSecurityClassId: affected.canonical_security_class_id,
    accessionNumber: issuer.accession_number,
    acceptedAt: issuer.accepted_at!,
    actionStage: current.facts.action_stage,
    ratio,
    effectiveDate: current.facts.effective_date,
    effectiveTiming: current.facts.effective_timing
      ?? { availability: "unavailable", reason: "date_only" },
    evidence: current.facts.evidence,
    facts: current.facts,
    persistedAt: current.persistedAt,
  };
}

function validateActionObservationCandidateResponse(
  value: unknown,
  input: { issuerCik: string; acceptedAt: string },
) {
  const root = record(value);
  if (!root || root.status !== "available" || root.issuer_cik !== input.issuerCik
    || root.before_accepted_at !== input.acceptedAt || !Array.isArray(root.candidates)
    || root.candidates.length > 96) {
    throw new Error("Reverse split action candidate response is invalid");
  }
  return root.candidates.map((candidateValue, index) => {
    const candidate = record(candidateValue);
    const eventId = text(candidate?.event_id);
    const sourceExecutionId = text(candidate?.source_execution_id);
    const actionId = text(candidate?.reverse_split_action_id);
    const originEventId = text(candidate?.action_origin_event_id);
    const issuerCik = text(candidate?.issuer_cik);
    const canonicalSecurityClassId = text(candidate?.canonical_security_class_id);
    const accessionNumber = text(candidate?.accession_number);
    const acceptedAt = text(candidate?.accepted_at);
    if (!UUID_PATTERN.test(eventId) || !UUID_PATTERN.test(sourceExecutionId)
      || issuerCik !== input.issuerCik || !reverseSplitActionId(actionId, issuerCik, originEventId)
      || !canonicalClassId(canonicalSecurityClassId, issuerCik)
      || !ACCESSION_PATTERN.test(accessionNumber) || !validTimestamp(acceptedAt)
      || Date.parse(acceptedAt) > Date.parse(input.acceptedAt)) {
      throw new Error(`Reverse split action candidate ${index} is invalid`);
    }
    return {
      eventId,
      sourceExecutionId,
      actionId,
      originEventId,
      issuerCik,
      canonicalSecurityClassId,
      accessionNumber,
      acceptedAt,
    };
  });
}

function validateActionHistoryCandidateResponse(
  value: unknown,
  filter: { cik: string; canonicalSecurityClassId?: string },
) {
  const root = record(value);
  if (!root || root.status !== "available" || root.issuer_cik !== filter.cik
    || (root.canonical_security_class_id ?? null) !== (filter.canonicalSecurityClassId ?? null)
    || !Array.isArray(root.candidates) || root.candidates.length > 2_000) {
    throw new Error("Reverse split action history candidate response is invalid");
  }
  return root.candidates.map((candidateValue, index) => {
    const candidate = record(candidateValue);
    const eventId = text(candidate?.event_id);
    const sourceExecutionId = text(candidate?.source_execution_id);
    const actionId = text(candidate?.reverse_split_action_id);
    const originEventId = text(candidate?.action_origin_event_id);
    const issuerCik = text(candidate?.issuer_cik);
    const canonicalSecurityClassId = text(candidate?.canonical_security_class_id);
    const accessionNumber = text(candidate?.accession_number);
    const acceptedAt = text(candidate?.accepted_at);
    if (!UUID_PATTERN.test(eventId) || !UUID_PATTERN.test(sourceExecutionId)
      || issuerCik !== filter.cik || !reverseSplitActionId(actionId, issuerCik, originEventId)
      || !canonicalClassId(canonicalSecurityClassId, issuerCik)
      || (filter.canonicalSecurityClassId && canonicalSecurityClassId !== filter.canonicalSecurityClassId)
      || !ACCESSION_PATTERN.test(accessionNumber) || !validTimestamp(acceptedAt)) {
      throw new Error(`Reverse split action history candidate ${index} is invalid`);
    }
    return {
      eventId,
      sourceExecutionId,
      actionId,
      originEventId,
      issuerCik,
      canonicalSecurityClassId,
      accessionNumber,
      acceptedAt,
    };
  });
}

function compareObservationChronology(left: ReverseSplitActionObservation, right: ReverseSplitActionObservation) {
  const accepted = Date.parse(left.acceptedAt) - Date.parse(right.acceptedAt);
  return accepted || left.accessionNumber.localeCompare(right.accessionNumber)
    || left.sourceExecutionId.localeCompare(right.sourceExecutionId);
}

function ratioFromKey(value: string): ReverseSplitActionCandidate["known_ratio"] {
  const separator = value.indexOf(":");
  return {
    availability: "available",
    old_shares: value.slice(0, separator),
    new_shares: value.slice(separator + 1),
  };
}

function timingFromKey(
  value: string,
  observations: readonly ReverseSplitActionObservation[],
): NonNullable<CorporateActionCanonicalFacts["effective_timing"]> {
  return observations.find((item) => item.effectiveTiming.availability === "available"
    && `${item.effectiveTiming.kind}:${item.effectiveTiming.timestamp ?? ""}` === value)!.effectiveTiming;
}

function distinct<T>(values: readonly T[]) {
  return [...new Set(values)];
}

function canonicalClassId(value: string, cik: string) {
  return new RegExp(`^sc:v1:${cik}:common_stock:(?:single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127})$`).test(value);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTimestamp(value: string) {
  return Number.isFinite(Date.parse(value));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
