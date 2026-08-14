import {
  CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION,
  CORPORATE_ACTION_FACTS_VERSION,
  readCorporateActionAnalyzerResult,
  type CorporateActionAnalyzerResult,
  type CorporateActionCanonicalFacts,
  validateCorporateActionAnalyzerResult,
} from "./corporateActionCanonicalFacts.ts";
import type {
  GenericMonitorChildIdentity,
  GenericMonitorChildTerminalState,
} from "./genericMonitorChildExecution.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CorporateActionPersistenceResult =
  | {
      status: "saved" | "idempotent";
      applicable: boolean;
      eventId: string;
      sourceExecutionId: string;
    }
  | { status: "stale" | "conflict" | "rejected"; reason: string };

type CurrentCorporateActionLineage = {
  eventId: string;
  rawItemId: string;
  parentPrimaryAiRunId: string;
  sourceExecutionId: string;
  monitorAnalyzerKey: "corporate_action";
  analyzerContractVersion: string;
  persistedAt: string;
};

export type CurrentCorporateActionReadResult =
  | ({ status: "available"; factSchemaVersion: string; facts: CorporateActionCanonicalFacts } & CurrentCorporateActionLineage)
  | ({ status: "not_applicable" } & CurrentCorporateActionLineage)
  | { status: "not_ready"; reason: string };

export type CorporateActionPersistenceDependencies = {
  rpc(functionName: string, payload: Record<string, unknown>): Promise<{
    ok: boolean;
    status: number;
    data: unknown;
    error?: string;
  }>;
};

const defaultDependencies: CorporateActionPersistenceDependencies = {
  rpc: async (functionName, payload) => {
    const repository = await import("../supabase.ts");
    return repository.supabaseRpc(functionName, payload);
  },
};

export async function persistCorporateActionAnalyzerResult(input: {
  identity: GenericMonitorChildIdentity;
  result: CorporateActionAnalyzerResult | unknown;
  dependencies?: CorporateActionPersistenceDependencies;
}): Promise<CorporateActionPersistenceResult> {
  const identityError = validatePersistenceIdentity(input.identity);
  if (identityError) return { status: "rejected", reason: identityError };
  const errors = validateCorporateActionAnalyzerResult(input.result);
  if (errors.length) return { status: "rejected", reason: `invalid_analyzer_result: ${errors.join("; ")}` };
  const result = input.result as CorporateActionAnalyzerResult;
  const response = await (input.dependencies || defaultDependencies).rpc(
    "persist_corporate_action_analyzer_result",
    {
      p_event_id: input.identity.eventId,
      p_source_execution_id: input.identity.executionId,
      p_expected_result: result,
    },
  );
  if (!response.ok) {
    throw new Error(`Corporate Action typed persistence failed: ${response.error || response.status}`);
  }
  return readPersistenceResult(response.data, result.applicable);
}

export function corporateActionTerminalStateAfterPersistence(
  analyzerResult: CorporateActionAnalyzerResult,
  persistenceResult: CorporateActionPersistenceResult,
): GenericMonitorChildTerminalState | null {
  if (
    (persistenceResult.status !== "saved" && persistenceResult.status !== "idempotent")
    || persistenceResult.applicable !== analyzerResult.applicable
  ) return null;
  return analyzerResult.applicable ? "succeeded_applicable" : "succeeded_not_applicable";
}

export async function readCurrentCorporateActionFacts(
  eventId: string,
  dependencies: CorporateActionPersistenceDependencies = defaultDependencies,
): Promise<CurrentCorporateActionReadResult> {
  if (!UUID_PATTERN.test(eventId)) return { status: "not_ready", reason: "invalid_event_id" };
  const response = await dependencies.rpc("read_current_event_corporate_action_facts", {
    p_event_id: eventId,
    p_analyzer_contract_version: CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION,
  });
  if (!response.ok) {
    throw new Error(`Corporate Action current reader failed: ${response.error || response.status}`);
  }
  return validateCurrentCorporateActionReadResult(response.data);
}

export function validateCurrentCorporateActionReadResult(value: unknown): CurrentCorporateActionReadResult {
  const row = record(value);
  if (!row) return { status: "not_ready", reason: "invalid_reader_response" };
  if (row.status === "not_ready") return { status: "not_ready", reason: stringValue(row.reason) || "unknown" };
  if (row.status !== "available" && row.status !== "not_applicable") {
    return { status: "not_ready", reason: "invalid_reader_status" };
  }
  const lineage = readLineage(row);
  if (!lineage) return { status: "not_ready", reason: "reader_lineage_validation_failed" };
  if (row.status === "not_applicable") return { status: "not_applicable", ...lineage };
  const canonical = readCorporateActionAnalyzerResult({ applicable: true, facts: row.facts });
  if (row.fact_schema_version !== CORPORATE_ACTION_FACTS_VERSION || !canonical?.applicable) {
    return { status: "not_ready", reason: "reader_facts_validation_failed" };
  }
  return {
    status: "available",
    ...lineage,
    factSchemaVersion: CORPORATE_ACTION_FACTS_VERSION,
    facts: canonical.facts,
  };
}

function validatePersistenceIdentity(identity: GenericMonitorChildIdentity) {
  if (
    !UUID_PATTERN.test(identity.eventId)
    || !UUID_PATTERN.test(identity.rawItemId)
    || !UUID_PATTERN.test(identity.parentPrimaryAiRunId)
    || !UUID_PATTERN.test(identity.logicalJobId)
    || !UUID_PATTERN.test(identity.executionId)
  ) return "invalid_execution_identity";
  if (identity.jobId !== identity.executionId) return "job_execution_identity_mismatch";
  if (identity.monitorAnalyzerKey !== "corporate_action") return "unexpected_monitor_analyzer_key";
  if (identity.analyzerContractVersion !== CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION) {
    return "unsupported_analyzer_contract_version";
  }
  return null;
}

function readPersistenceResult(value: unknown, expectedApplicable: boolean): CorporateActionPersistenceResult {
  const row = record(value);
  const status = stringValue(row?.status);
  if (status === "saved" || status === "idempotent") {
    const applicable = row?.applicable;
    const eventId = stringValue(row?.event_id);
    const sourceExecutionId = stringValue(row?.source_execution_id);
    if (applicable !== expectedApplicable || !UUID_PATTERN.test(eventId) || !UUID_PATTERN.test(sourceExecutionId)) {
      return { status: "rejected", reason: "invalid_persistence_response" };
    }
    return { status, applicable, eventId, sourceExecutionId };
  }
  if (status === "stale" || status === "conflict" || status === "rejected") {
    return { status, reason: stringValue(row?.reason) || "unknown" };
  }
  return { status: "rejected", reason: "invalid_persistence_response" };
}

function readLineage(row: Record<string, unknown>): CurrentCorporateActionLineage | null {
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
    || row.monitor_analyzer_key !== "corporate_action"
    || analyzerContractVersion !== CORPORATE_ACTION_ANALYZER_CONTRACT_VERSION
    || !Number.isFinite(Date.parse(persistedAt))
  ) return null;
  return {
    eventId,
    rawItemId,
    parentPrimaryAiRunId,
    sourceExecutionId,
    monitorAnalyzerKey: "corporate_action",
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
