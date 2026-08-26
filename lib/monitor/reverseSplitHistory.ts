import {
  CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION,
  readCorporateActionAnalyzerResult,
  type CorporateActionEventKind,
  type CorporateActionCanonicalFacts,
} from "./corporateActionCanonicalFacts.ts";
import {
  readCurrentCorporateActionFacts,
  type CurrentCorporateActionReadResult,
  type CorporateActionPersistenceDependencies,
} from "./corporateActionPersistence.ts";
import {
  readStockSplitMaterializationDiagnostic,
  STOCK_SPLIT_MATERIALIZATION_ERROR_PREFIX,
  type StockSplitMaterializationDiagnostic,
} from "./stockSplitMaterialization.ts";

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

type ReverseSplitHistoryAvailable = {
  status: "available";
  materializationStatus?: "NO_SPLIT_EVIDENCE" | "SPLIT_EXECUTIONS_AVAILABLE";
  issuerCik: string;
  canonicalSecurityClassId: string | null;
  from: string;
  to: string;
  basisChangeCoverage: "reverse_split_only";
  items: ReverseSplitHistoryItem[];
};

export type StockSplitHistoryMaterializationUnavailable = {
  status: "materialization_unavailable";
  materializationStatus: "SPLIT_MATERIALIZATION_FAILED";
  issuerCik: string;
  canonicalSecurityClassId: string | null;
  from: string;
  to: string;
  basisChangeCoverage: "reverse_split_only" | "forward_split_only";
  items: never[];
  failures: StockSplitMaterializationDiagnostic[];
};

export type ReverseSplitHistoryReadResult =
  | ReverseSplitHistoryAvailable
  | (StockSplitHistoryMaterializationUnavailable & { basisChangeCoverage: "reverse_split_only" });

export type ForwardSplitHistoryItem = ReverseSplitHistoryItem;

export type ForwardSplitHistoryReadResult = Omit<
  ReverseSplitHistoryAvailable,
  "basisChangeCoverage" | "items"
> & {
  basisChangeCoverage: "forward_split_only";
  items: ForwardSplitHistoryItem[];
} | (StockSplitHistoryMaterializationUnavailable & { basisChangeCoverage: "forward_split_only" });

export type StockSplitHistoryFilter = ReverseSplitHistoryFilter & {
  actionKind: CorporateActionEventKind;
};

export type StockSplitHistoryReadResult = ReverseSplitHistoryReadResult | ForwardSplitHistoryReadResult;

type ReverseSplitHistoryDependencies = CorporateActionPersistenceDependencies & {
  readCurrent(eventId: string): Promise<CurrentCorporateActionReadResult>;
  readMaterializationFailures?(): Promise<StockSplitMaterializationDiagnostic[]>;
};

const defaultDependencies: ReverseSplitHistoryDependencies = {
  rpc: async (functionName, payload) => {
    const repository = await import("../supabase.ts");
    return repository.supabaseRpc(functionName, payload);
  },
  readCurrent: (eventId) => readCurrentCorporateActionFacts(eventId),
  readMaterializationFailures: readPersistedStockSplitMaterializationFailures,
};

export async function readReverseSplitHistory(
  filter: ReverseSplitHistoryFilter,
  dependencies: ReverseSplitHistoryDependencies = defaultDependencies,
): Promise<ReverseSplitHistoryReadResult> {
  return readStockSplitHistoryInternal(
    { ...filter, actionKind: "reverse_split" },
    dependencies,
    "read_reverse_split_history_candidates",
    false,
  ) as Promise<ReverseSplitHistoryReadResult>;
}

export async function readStockSplitHistory(
  filter: StockSplitHistoryFilter,
  dependencies: ReverseSplitHistoryDependencies = defaultDependencies,
): Promise<StockSplitHistoryReadResult> {
  return readStockSplitHistoryInternal(
    filter,
    dependencies,
    "read_stock_split_history_candidates",
    true,
  );
}

async function readStockSplitHistoryInternal(
  filter: StockSplitHistoryFilter,
  dependencies: ReverseSplitHistoryDependencies,
  rpcFunction: string,
  genericRpc: boolean,
): Promise<StockSplitHistoryReadResult> {
  const errorLabel = genericRpc ? "Stock split" : "Reverse split";
  validateFilter(filter, errorLabel);
  const response = await dependencies.rpc(rpcFunction, {
    ...(genericRpc ? { p_action_kind: filter.actionKind } : {}),
    p_issuer_cik: filter.cik,
    p_canonical_security_class_id: filter.canonicalSecurityClassId ?? null,
    p_from: filter.from,
    p_to: filter.to,
  });
  if (!response.ok) throw new Error(`${errorLabel} history candidate reader failed: ${response.error || response.status}`);
  const candidates = validateCandidateResponse(response.data, filter, genericRpc, errorLabel);
  const items: ReverseSplitHistoryItem[] = [];
  for (const candidate of candidates) {
    const current = await dependencies.readCurrent(candidate.eventId);
    if (current.status !== "available" || current.sourceExecutionId !== candidate.sourceExecutionId) continue;
    const applicability = current.facts.applicability;
    const affected = applicability?.affected_security;
    if (!applicability || applicability.issuer.availability !== "available"
      || affected?.availability !== "available"
      || current.facts.event_kind !== filter.actionKind
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
  const persistedFailures = dependencies.readMaterializationFailures
    ? await dependencies.readMaterializationFailures()
    : [];
  const failures = persistedFailures.filter((failure) =>
    failure.actionKind === filter.actionKind
    && failure.issuerCik === filter.cik
    && failure.effectiveDate >= filter.from && failure.effectiveDate <= filter.to
    && (!filter.canonicalSecurityClassId
      || failure.canonicalSecurityClassId === filter.canonicalSecurityClassId)
    && !items.some((item) => item.facts.calculation_activation !== undefined
      && materializesFailure(item, failure)));
  if (failures.length > 0) {
    return {
      status: "materialization_unavailable",
      materializationStatus: "SPLIT_MATERIALIZATION_FAILED",
      issuerCik: filter.cik,
      canonicalSecurityClassId: filter.canonicalSecurityClassId ?? null,
      from: filter.from,
      to: filter.to,
      basisChangeCoverage: filter.actionKind === "reverse_split"
        ? "reverse_split_only" : "forward_split_only",
      items: [],
      failures: structuredClone(failures),
    } as StockSplitHistoryReadResult;
  }
  return {
    status: "available",
    materializationStatus: items.length ? "SPLIT_EXECUTIONS_AVAILABLE" : "NO_SPLIT_EVIDENCE",
    issuerCik: filter.cik,
    canonicalSecurityClassId: filter.canonicalSecurityClassId ?? null,
    from: filter.from,
    to: filter.to,
    basisChangeCoverage: filter.actionKind === "reverse_split"
      ? "reverse_split_only" : "forward_split_only",
    items,
  } as StockSplitHistoryReadResult;
}

function validateCandidateResponse(
  value: unknown,
  filter: StockSplitHistoryFilter,
  genericRpc: boolean,
  errorLabel: "Reverse split" | "Stock split",
) {
  const root = record(value);
  if (!root || root.status !== "available" || root.issuer_cik !== filter.cik
    || (genericRpc && root.action_kind !== filter.actionKind)
    || (root.canonical_security_class_id ?? null) !== (filter.canonicalSecurityClassId ?? null)
    || root.from !== filter.from || root.to !== filter.to || !Array.isArray(root.candidates)) {
    throw new Error(`${errorLabel} history candidate response is invalid`);
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
      || !canonical?.applicable
      || canonical.facts.event_kind !== filter.actionKind) {
      throw new Error(`${errorLabel} history candidate ${index} is invalid`);
    }
    return { eventId, sourceExecutionId, canonicalSecurityClassId, effectiveDate };
  });
}

function validateFilter(
  filter: StockSplitHistoryFilter,
  errorLabel: "Reverse split" | "Stock split",
) {
  if (!CIK_PATTERN.test(filter.cik) || !validDate(filter.from) || !validDate(filter.to)
    || (filter.actionKind !== "reverse_split" && filter.actionKind !== "forward_split")
    || filter.from > filter.to
    || (filter.canonicalSecurityClassId !== undefined
      && !canonicalClassId(filter.canonicalSecurityClassId, filter.cik))) {
    throw new Error(`${errorLabel} history filter is invalid`);
  }
}

function compareHistoryItems(left: ReverseSplitHistoryItem, right: ReverseSplitHistoryItem) {
  const date = left.effectiveDate.localeCompare(right.effectiveDate);
  if (date !== 0) return date;
  return left.sourceExecutionId.localeCompare(right.sourceExecutionId);
}

async function readPersistedStockSplitMaterializationFailures() {
  const repository = await import("../supabase.ts");
  const response = await repository.supabaseSelect("ai_runs", {
    select: "error_message",
    prompt_key: "eq.domain_monitor_child",
    prompt_version: `eq.${CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION}`,
    "metadata->>monitor_analyzer_key": "eq.corporate_action",
    status: "in.(pending,failed)",
    error_message: `like.${STOCK_SPLIT_MATERIALIZATION_ERROR_PREFIX}*`,
    order: "started_at.desc.nullslast,id.desc",
    limit: "1000",
  });
  if (!response.ok || !Array.isArray(response.data)) {
    throw new Error(`Stock split materialization diagnostic read failed: ${response.error || response.status}`);
  }
  return response.data.flatMap((value) => {
    const diagnostic = readStockSplitMaterializationDiagnostic(record(value)?.error_message);
    return diagnostic ? [diagnostic] : [];
  });
}

function materializesFailure(
  item: ReverseSplitHistoryItem,
  failure: StockSplitMaterializationDiagnostic,
) {
  const exact = item.facts.ratio.exact_source_components;
  const issuer = item.facts.applicability?.issuer;
  return item.facts.event_kind === failure.actionKind
    && item.issuerCik === failure.issuerCik
    && item.canonicalSecurityClassId === failure.canonicalSecurityClassId
    && item.effectiveDate === failure.effectiveDate
    && issuer?.availability === "available"
    && issuer.accession_number === failure.accessionNumber
    && exact?.availability === "available"
    && exact.old_share_units === failure.oldShareUnits
    && exact.new_share_units === failure.newShareUnits;
}

function canonicalClassId(value: string, cik: string) {
  return new RegExp(`^sc:v1:${cik}:common_stock:(?:single|us-gaap:[A-Za-z][A-Za-z0-9_.-]{1,127}|custom:[0-9a-f]{64}:[A-Za-z][A-Za-z0-9_.-]{1,127})$`).test(value);
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
