import {
  readCorporateActionAnalyzerResult,
  type CorporateActionCanonicalFacts,
} from "./corporateActionCanonicalFacts.ts";
import {
  readCurrentCorporateActionFacts,
  type CurrentCorporateActionReadResult,
  type CorporateActionPersistenceDependencies,
} from "./corporateActionPersistence.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CIK_PATTERN = /^\d{10}$/;

export type ReverseSplitHistoryFilter = {
  cik: string;
  canonicalSecurityClassId?: string;
  from: string;
  to: string;
};

export type ReverseSplitHistoryItem = {
  eventId: string;
  sourceExecutionId: string;
  issuerCik: string;
  canonicalSecurityClassId: string;
  effectiveDate: string;
  effectiveTiming: NonNullable<CorporateActionCanonicalFacts["effective_timing"]>;
  sameDayOrdering: "explicit_source_timing" | "indeterminate";
  facts: CorporateActionCanonicalFacts;
  persistedAt: string;
};

export type ReverseSplitHistoryReadResult = {
  status: "available";
  issuerCik: string;
  canonicalSecurityClassId: string | null;
  from: string;
  to: string;
  basisChangeCoverage: "reverse_split_only";
  items: ReverseSplitHistoryItem[];
};

type ReverseSplitHistoryDependencies = CorporateActionPersistenceDependencies & {
  readCurrent(eventId: string): Promise<CurrentCorporateActionReadResult>;
};

const defaultDependencies: ReverseSplitHistoryDependencies = {
  rpc: async (functionName, payload) => {
    const repository = await import("../supabase.ts");
    return repository.supabaseRpc(functionName, payload);
  },
  readCurrent: (eventId) => readCurrentCorporateActionFacts(eventId),
};

export async function readReverseSplitHistory(
  filter: ReverseSplitHistoryFilter,
  dependencies: ReverseSplitHistoryDependencies = defaultDependencies,
): Promise<ReverseSplitHistoryReadResult> {
  validateFilter(filter);
  const response = await dependencies.rpc("read_reverse_split_history_candidates", {
    p_issuer_cik: filter.cik,
    p_canonical_security_class_id: filter.canonicalSecurityClassId ?? null,
    p_from: filter.from,
    p_to: filter.to,
  });
  if (!response.ok) throw new Error(`Reverse split history candidate reader failed: ${response.error || response.status}`);
  const candidates = validateCandidateResponse(response.data, filter);
  const items: ReverseSplitHistoryItem[] = [];
  for (const candidate of candidates) {
    const current = await dependencies.readCurrent(candidate.eventId);
    if (current.status !== "available" || current.sourceExecutionId !== candidate.sourceExecutionId) continue;
    const applicability = current.facts.applicability;
    const affected = applicability?.affected_security;
    if (!applicability || applicability.issuer.availability !== "available"
      || affected?.availability !== "available"
      || applicability.issuer.issuer_cik !== filter.cik
      || affected.canonical_security_class_id !== candidate.canonicalSecurityClassId
      || (filter.canonicalSecurityClassId
        && affected.canonical_security_class_id !== filter.canonicalSecurityClassId)
      || current.facts.effective_date.availability !== "available"
      || current.facts.effective_date.value !== candidate.effectiveDate) continue;
    const effectiveTiming = current.facts.effective_timing
      ?? { availability: "unavailable" as const, reason: "date_only" as const };
    items.push({
      eventId: current.eventId,
      sourceExecutionId: current.sourceExecutionId,
      issuerCik: filter.cik,
      canonicalSecurityClassId: affected.canonical_security_class_id,
      effectiveDate: current.facts.effective_date.value,
      effectiveTiming,
      sameDayOrdering: effectiveTiming.availability === "available"
        ? "explicit_source_timing" : "indeterminate",
      facts: current.facts,
      persistedAt: current.persistedAt,
    });
  }
  items.sort(compareHistoryItems);
  return {
    status: "available",
    issuerCik: filter.cik,
    canonicalSecurityClassId: filter.canonicalSecurityClassId ?? null,
    from: filter.from,
    to: filter.to,
    basisChangeCoverage: "reverse_split_only",
    items,
  };
}

function validateCandidateResponse(value: unknown, filter: ReverseSplitHistoryFilter) {
  const root = record(value);
  if (!root || root.status !== "available" || root.issuer_cik !== filter.cik
    || (root.canonical_security_class_id ?? null) !== (filter.canonicalSecurityClassId ?? null)
    || root.from !== filter.from || root.to !== filter.to || !Array.isArray(root.candidates)) {
    throw new Error("Reverse split history candidate response is invalid");
  }
  return root.candidates.map((candidateValue, index) => {
    const candidate = record(candidateValue);
    const eventId = stringValue(candidate?.event_id);
    const sourceExecutionId = stringValue(candidate?.source_execution_id);
    const issuerCik = stringValue(candidate?.issuer_cik);
    const canonicalSecurityClassId = stringValue(candidate?.canonical_security_class_id);
    const effectiveDate = stringValue(candidate?.effective_date);
    const persistedAt = stringValue(candidate?.persisted_at);
    const canonical = readCorporateActionAnalyzerResult({ applicable: true, facts: candidate?.facts });
    if (!UUID_PATTERN.test(eventId) || !UUID_PATTERN.test(sourceExecutionId)
      || issuerCik !== filter.cik
      || !canonicalClassId(canonicalSecurityClassId, filter.cik)
      || !validDate(effectiveDate)
      || effectiveDate < filter.from || effectiveDate > filter.to
      || !Number.isFinite(Date.parse(persistedAt))
      || !canonical?.applicable) {
      throw new Error(`Reverse split history candidate ${index} is invalid`);
    }
    return { eventId, sourceExecutionId, canonicalSecurityClassId, effectiveDate };
  });
}

function validateFilter(filter: ReverseSplitHistoryFilter) {
  if (!CIK_PATTERN.test(filter.cik) || !validDate(filter.from) || !validDate(filter.to)
    || filter.from > filter.to
    || (filter.canonicalSecurityClassId !== undefined
      && !canonicalClassId(filter.canonicalSecurityClassId, filter.cik))) {
    throw new Error("Reverse split history filter is invalid");
  }
}

function compareHistoryItems(left: ReverseSplitHistoryItem, right: ReverseSplitHistoryItem) {
  const date = left.effectiveDate.localeCompare(right.effectiveDate);
  if (date !== 0) return date;
  const leftTimestamp = left.effectiveTiming.availability === "available"
    && left.effectiveTiming.kind === "exact_timestamp" ? left.effectiveTiming.timestamp : null;
  const rightTimestamp = right.effectiveTiming.availability === "available"
    && right.effectiveTiming.kind === "exact_timestamp" ? right.effectiveTiming.timestamp : null;
  if (leftTimestamp && rightTimestamp) {
    const timestamp = leftTimestamp.localeCompare(rightTimestamp);
    if (timestamp !== 0) return timestamp;
  }
  return left.sourceExecutionId.localeCompare(right.sourceExecutionId);
}

function canonicalClassId(value: string, cik: string) {
  return new RegExp(`^sc:v1:${cik}:common_stock:(?:single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127})$`).test(value);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
