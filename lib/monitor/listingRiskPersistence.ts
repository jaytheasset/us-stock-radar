import {
  LISTING_RISK_ANALYZER_PROMPT_VERSION,
  type ListingRiskAnalyzerResult,
  validateListingRiskAnalyzerResult,
} from "./listingRiskAnalyzer.ts";
import {
  LISTING_RISK_EVENT_FACTS_VERSION,
  readListingRiskEventFacts,
  type ListingRiskEventFacts,
} from "./listingRiskFacts.ts";
import type {
  GenericMonitorChildIdentity,
  GenericMonitorChildTerminalState,
} from "./genericMonitorChildExecution.ts";
import { readForm25AnalysisReviewForConsumer, type Form25AnalysisReviewRead } from "../sec-form25-analysis-review/consumer.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ListingRiskPersistenceResult =
  | {
      status: "saved" | "idempotent";
      resultStatus: ListingRiskAnalyzerResult["status"];
      eventId: string;
      sourceExecutionId: string;
    }
  | { status: "stale" | "conflict" | "rejected"; reason: string };

type CurrentListingRiskLineage = {
  eventId: string;
  rawItemId: string;
  parentPrimaryAiRunId: string;
  sourceExecutionId: string;
  monitorAnalyzerKey: "listing_risk";
  analyzerContractVersion: string;
  persistedAt: string;
};

export type CurrentListingRiskReadResult = (
  | ({ status: "available"; factSchemaVersion: string; facts: ListingRiskEventFacts } & CurrentListingRiskLineage)
  | ({ status: "not_applicable" } & CurrentListingRiskLineage)
  | { status: "not_ready"; reason: string }
) & { form25HumanReview?: Form25AnalysisReviewRead };

export type ListingRiskPersistenceDependencies = {
  readForm25Review?(eventId: string): Promise<Form25AnalysisReviewRead>;
  rpc(functionName: string, payload: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
    error?: string;
  }>;
};

const defaultDependencies: ListingRiskPersistenceDependencies = {
  readForm25Review: readForm25AnalysisReviewForConsumer,
  rpc: async (functionName, payload) => {
    const repository = await import("../supabase.ts");
    return repository.supabaseRpc(functionName, payload);
  },
};

/**
 * Persists only an already validated analyzer result for one exact generic
 * child identity. The database rechecks event/raw/parent/currentness lineage.
 * No production caller is connected in Phase 1I.
 */
export async function persistListingRiskAnalyzerResult(input: {
  identity: GenericMonitorChildIdentity;
  result: ListingRiskAnalyzerResult | unknown;
  dependencies?: ListingRiskPersistenceDependencies;
}): Promise<ListingRiskPersistenceResult> {
  const identityError = validatePersistenceIdentity(input.identity);
  if (identityError) return { status: "rejected", reason: identityError };

  const validationErrors = validateListingRiskAnalyzerResult(input.result);
  if (validationErrors.length) {
    return { status: "rejected", reason: `invalid_analyzer_result: ${validationErrors.join("; ")}` };
  }
  const result = input.result as ListingRiskAnalyzerResult;
  const dependencies = input.dependencies || defaultDependencies;
  const response = await dependencies.rpc("persist_listing_risk_analyzer_result", {
    p_event_id: input.identity.eventId,
    p_source_execution_id: input.identity.executionId,
    p_expected_result: result,
  });
  if (!response.ok) {
    throw new Error(`Listing Risk typed persistence failed: ${response.error || response.status}`);
  }
  return readPersistenceResult(response.data, result.status);
}

/**
 * The future handler may record terminal success only after persistence returns
 * saved/idempotent for the same semantic result. Failure, conflict, rejection,
 * and stale outcomes deliberately produce no successful terminal state.
 */
export function listingRiskTerminalStateAfterPersistence(
  analyzerResult: ListingRiskAnalyzerResult,
  persistenceResult: ListingRiskPersistenceResult,
): GenericMonitorChildTerminalState | null {
  if (
    (persistenceResult.status !== "saved" && persistenceResult.status !== "idempotent")
    || persistenceResult.resultStatus !== analyzerResult.status
  ) {
    return null;
  }
  return analyzerResult.status === "applicable"
    ? "succeeded_applicable"
    : "succeeded_not_applicable";
}

/**
 * Official downstream reader. Original typed facts retain their RPC lineage.
 * Form25 Human corrections are a separate source/version-bound overlay, never
 * inferred from event summaries or inserted as analyzer facts.
 */
export async function readCurrentListingRiskFacts(
  eventId: string,
  dependencies: ListingRiskPersistenceDependencies = defaultDependencies,
): Promise<CurrentListingRiskReadResult> {
  if (!UUID_PATTERN.test(eventId)) return { status: "not_ready", reason: "invalid_event_id" };
  const response = await dependencies.rpc("read_current_event_listing_risk_facts", {
    p_event_id: eventId,
    p_analyzer_contract_version: LISTING_RISK_ANALYZER_PROMPT_VERSION,
  });
  const humanReview = dependencies.readForm25Review ? await dependencies.readForm25Review(eventId) : null;
  if (!response.ok) {
    if (humanReview && humanReview.status !== "not_applicable") return {
      status: "not_ready", reason: "listing_risk_reader_unavailable", form25HumanReview: humanReview,
    };
    throw new Error(`Listing Risk current reader failed: ${response.error || response.status}`);
  }
  const original = validateCurrentListingRiskReadResult(response.data);
  return humanReview && humanReview.status !== "not_applicable"
    ? { ...original, form25HumanReview: humanReview } : original;
}

export function validateCurrentListingRiskReadResult(value: unknown): CurrentListingRiskReadResult {
  const row = record(value);
  if (!row) return { status: "not_ready", reason: "invalid_reader_response" };
  if (row.status === "not_ready") {
    return { status: "not_ready", reason: stringValue(row.reason) || "unknown" };
  }
  if (row.status !== "available" && row.status !== "not_applicable") {
    return { status: "not_ready", reason: "invalid_reader_status" };
  }

  const lineage = readLineage(row);
  if (!lineage) return { status: "not_ready", reason: "reader_lineage_validation_failed" };
  if (row.status === "not_applicable") return { status: "not_applicable", ...lineage };

  const facts = readListingRiskEventFacts(row.facts);
  if (row.fact_schema_version !== LISTING_RISK_EVENT_FACTS_VERSION || !facts) {
    return { status: "not_ready", reason: "reader_facts_validation_failed" };
  }
  return {
    status: "available",
    ...lineage,
    factSchemaVersion: LISTING_RISK_EVENT_FACTS_VERSION,
    facts,
  };
}

function validatePersistenceIdentity(identity: GenericMonitorChildIdentity) {
  if (
    !UUID_PATTERN.test(identity.eventId)
    || !UUID_PATTERN.test(identity.rawItemId)
    || !UUID_PATTERN.test(identity.parentPrimaryAiRunId)
    || !UUID_PATTERN.test(identity.logicalJobId)
    || !UUID_PATTERN.test(identity.executionId)
  ) {
    return "invalid_execution_identity";
  }
  if (identity.jobId !== identity.executionId) return "job_execution_identity_mismatch";
  if (identity.monitorAnalyzerKey !== "listing_risk") return "unexpected_monitor_analyzer_key";
  if (identity.analyzerContractVersion !== LISTING_RISK_ANALYZER_PROMPT_VERSION) {
    return "unsupported_analyzer_contract_version";
  }
  return null;
}

function readPersistenceResult(
  value: unknown,
  expectedResultStatus: ListingRiskAnalyzerResult["status"],
): ListingRiskPersistenceResult {
  const row = record(value);
  const status = stringValue(row?.status);
  if (status === "saved" || status === "idempotent") {
    const resultStatus = stringValue(row?.result_status);
    const eventId = stringValue(row?.event_id);
    const sourceExecutionId = stringValue(row?.source_execution_id);
    if (
      resultStatus !== expectedResultStatus
      || !UUID_PATTERN.test(eventId)
      || !UUID_PATTERN.test(sourceExecutionId)
    ) {
      return { status: "rejected", reason: "invalid_persistence_response" };
    }
    return {
      status,
      resultStatus: resultStatus as ListingRiskAnalyzerResult["status"],
      eventId,
      sourceExecutionId,
    };
  }
  if (status === "stale" || status === "conflict" || status === "rejected") {
    return { status, reason: stringValue(row?.reason) || "unknown" };
  }
  return { status: "rejected", reason: "invalid_persistence_response" };
}

function readLineage(row: Record<string, unknown>): CurrentListingRiskLineage | null {
  const eventId = stringValue(row.event_id);
  const rawItemId = stringValue(row.raw_item_id);
  const parentPrimaryAiRunId = stringValue(row.parent_primary_ai_run_id);
  const sourceExecutionId = stringValue(row.source_execution_id);
  const analyzerContractVersion = stringValue(row.analyzer_contract_version);
  const persistedAt = stringValue(row.persisted_at);
  if (
    !UUID_PATTERN.test(eventId)
    || !UUID_PATTERN.test(rawItemId)
    || !UUID_PATTERN.test(parentPrimaryAiRunId)
    || !UUID_PATTERN.test(sourceExecutionId)
    || row.monitor_analyzer_key !== "listing_risk"
    || analyzerContractVersion !== LISTING_RISK_ANALYZER_PROMPT_VERSION
    || !Number.isFinite(Date.parse(persistedAt))
  ) {
    return null;
  }
  return {
    eventId,
    rawItemId,
    parentPrimaryAiRunId,
    sourceExecutionId,
    monitorAnalyzerKey: "listing_risk",
    analyzerContractVersion,
    persistedAt,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
