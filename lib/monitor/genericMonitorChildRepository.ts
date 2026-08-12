import {
  GENERIC_MONITOR_CHILD_OUTPUT_SCHEMA_VERSION,
  GENERIC_MONITOR_CHILD_OUTPUT_TYPE,
  GENERIC_MONITOR_CHILD_PROMPT_KEY,
  GENERIC_MONITOR_PRIMARY_PROMPT_KEYS,
  databaseStatusForGenericMonitorState,
  deterministicGenericMonitorOutputId,
  isAuthorizedGenericMonitorPrimary,
  type GenericMonitorChildExecutionState,
  type GenericMonitorChildIdentity,
  type GenericMonitorChildTerminalState,
  type GenericMonitorParentCurrentness,
} from "./genericMonitorChildExecution.ts";
import { readMonitorRoutingResultFromPrimaryOutput } from "./monitorRouting.ts";

type StoreResult = {
  ok: boolean;
  status: number;
  data?: unknown;
  error?: string;
};

export type GenericMonitorChildStore = {
  select(table: string, search: Record<string, string>): Promise<StoreResult>;
  upsert(
    table: string,
    payload: Record<string, unknown>,
    options?: { onConflict?: string; prefer?: string },
  ): Promise<StoreResult>;
  update(
    table: string,
    search: Record<string, string>,
    payload: Record<string, unknown>,
    options?: { prefer?: string },
  ): Promise<StoreResult>;
};

export type GenericMonitorExactParent = {
  aiRun: Record<string, unknown>;
  aiOutput: Record<string, unknown>;
  event: Record<string, unknown>;
  rawItem: Record<string, unknown>;
  analysis: Record<string, unknown>;
  currentness: GenericMonitorParentCurrentness;
};

export function createGenericMonitorChildRepository(store: GenericMonitorChildStore) {
  return {
    reserve: (identity: GenericMonitorChildIdentity) => reserveGenericMonitorChild(store, identity),
    claim: (identity: GenericMonitorChildIdentity) => claimGenericMonitorChild(store, identity),
    recordTerminal: (
      identity: GenericMonitorChildIdentity,
      state: GenericMonitorChildTerminalState,
      options?: { error?: unknown; finishedAt?: string },
    ) => recordGenericMonitorChildTerminalState(store, identity, state, options),
    loadExactParent: (identity: GenericMonitorChildIdentity) => loadGenericMonitorExactParent(store, identity),
  };
}

export async function reserveGenericMonitorChild(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
) {
  const result = await store.upsert("ai_runs", {
    id: identity.executionId,
    event_id: identity.eventId,
    raw_item_id: identity.rawItemId,
    prompt_key: GENERIC_MONITOR_CHILD_PROMPT_KEY,
    prompt_version: identity.analyzerContractVersion,
    model: "not_started",
    status: "pending",
    started_at: null,
    finished_at: null,
    usage: {},
    error_message: null,
    metadata: genericMonitorChildMetadata(identity, "reserved"),
  }, {
    onConflict: "id",
    prefer: "resolution=ignore-duplicates,return=representation",
  });
  assertStoreResult(result, "Generic Monitor child reservation");
  return {
    reserved: rows(result.data).length > 0,
    jobId: identity.executionId,
  };
}

export async function claimGenericMonitorChild(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
  startedAt = new Date().toISOString(),
) {
  const result = await store.update("ai_runs", {
    id: `eq.${identity.executionId}`,
    prompt_key: `eq.${GENERIC_MONITOR_CHILD_PROMPT_KEY}`,
    status: "eq.pending",
    "metadata->>execution_state": "eq.reserved",
  }, {
    status: "running",
    started_at: startedAt,
    finished_at: null,
    error_message: null,
    metadata: genericMonitorChildMetadata(identity, "running"),
  });
  assertStoreResult(result, "Generic Monitor child claim");
  return rows(result.data).length > 0;
}

export async function recordGenericMonitorChildTerminalState(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
  state: GenericMonitorChildTerminalState,
  options: { error?: unknown; finishedAt?: string } = {},
) {
  const finishedAt = options.finishedAt || new Date().toISOString();
  const result = await store.update("ai_runs", {
    id: `eq.${identity.executionId}`,
    prompt_key: `eq.${GENERIC_MONITOR_CHILD_PROMPT_KEY}`,
    status: "in.(pending,running)",
  }, {
    status: databaseStatusForGenericMonitorState(state),
    finished_at: finishedAt,
    error_message: state === "failed" ? errorMessage(options.error) : null,
    metadata: genericMonitorChildMetadata(identity, state),
  });
  assertStoreResult(result, `Generic Monitor child ${state} transition`);
  const changed = rows(result.data).length > 0;

  if (state === "succeeded_applicable" || state === "succeeded_not_applicable") {
    if (changed || await alreadyHasTerminalState(store, identity, state)) {
      await writeGenericMonitorTerminalOutput(store, identity, state);
    }
  }
  return { recorded: changed, jobId: identity.executionId, state };
}

export async function loadGenericMonitorExactParent(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
): Promise<GenericMonitorExactParent> {
  const runResult = await store.select("ai_runs", {
    select: "id,event_id,raw_item_id,prompt_key,prompt_version,model,status,started_at,finished_at,usage,error_message,metadata",
    id: `eq.${identity.parentPrimaryAiRunId}`,
    limit: "1",
  });
  assertStoreResult(runResult, "Generic Monitor exact parent ai_run read");
  const aiRun = exactlyOneRow(runResult.data, "exact parent ai_run");
  assertExactParentRun(identity, aiRun);

  const outputResult = await store.select("ai_outputs", {
    select: "id,ai_run_id,event_id,output_type,payload,created_at",
    ai_run_id: `eq.${identity.parentPrimaryAiRunId}`,
    order: "created_at.asc,id.asc",
    limit: "2",
  });
  assertStoreResult(outputResult, "Generic Monitor exact parent ai_output read");
  const aiOutput = exactlyOneRow(outputResult.data, "exact parent ai_output");

  const eventResult = await store.select("events", {
    select: "id,raw_item_id,source_code,source_group",
    id: `eq.${identity.eventId}`,
    limit: "1",
  });
  assertStoreResult(eventResult, "Generic Monitor exact event read");
  const event = exactlyOneRow(eventResult.data, "exact event");

  const rawResult = await store.select("raw_items", {
    select: "id,source_code,source_group,source_unique_id",
    id: `eq.${identity.rawItemId}`,
    limit: "1",
  });
  assertStoreResult(rawResult, "Generic Monitor exact raw item read");
  const rawItem = exactlyOneRow(rawResult.data, "exact raw item");

  assertExactLineage(identity, aiOutput, event, rawItem);
  const analysis = record(record(aiOutput.payload)?.analysis);
  if (!analysis) throw new Error("Generic Monitor exact parent output is missing analysis");
  const routing = readMonitorRoutingResultFromPrimaryOutput(analysis);
  if (!routing?.monitor_routes.some((route) => route.monitor_analyzer_key === identity.monitorAnalyzerKey)) {
    throw new Error("Generic Monitor exact parent output does not contain the reserved analyzer route");
  }

  const currentness = await readGenericMonitorParentCurrentness(store, identity);
  return { aiRun, aiOutput, event, rawItem, analysis, currentness };
}

export async function readGenericMonitorParentCurrentness(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
): Promise<GenericMonitorParentCurrentness> {
  const promptKeys = GENERIC_MONITOR_PRIMARY_PROMPT_KEYS[identity.sourceFamily];
  const result = await store.select("ai_runs", {
    select: "id",
    event_id: `eq.${identity.eventId}`,
    raw_item_id: `eq.${identity.rawItemId}`,
    prompt_key: `in.(${promptKeys.join(",")})`,
    status: "eq.completed",
    order: "finished_at.desc.nullslast,started_at.desc.nullslast,id.desc",
    limit: "1",
  });
  assertStoreResult(result, "Generic Monitor latest Primary authority read");
  const latestPrimaryAiRunId = stringValue(record(rows(result.data)[0])?.id);
  if (!latestPrimaryAiRunId) return { status: "missing", latestPrimaryAiRunId: null };
  return latestPrimaryAiRunId === identity.parentPrimaryAiRunId
    ? { status: "current", latestPrimaryAiRunId }
    : { status: "stale", latestPrimaryAiRunId };
}

export function genericMonitorChildMetadata(
  identity: GenericMonitorChildIdentity,
  state: GenericMonitorChildExecutionState,
) {
  return {
    child_schema_version: identity.schemaVersion,
    purpose: identity.purpose,
    logical_job_id: identity.logicalJobId,
    execution_id: identity.executionId,
    monitor_analyzer_key: identity.monitorAnalyzerKey,
    analyzer_contract_version: identity.analyzerContractVersion,
    attempt_kind: identity.attempt.kind,
    attempt_key: identity.attempt.key,
    parent_primary_ai_run_id: identity.parentPrimaryAiRunId,
    parent_prompt_key: identity.parentPromptKey,
    parent_prompt_version: identity.parentPromptVersion,
    source_family: identity.sourceFamily,
    source_group: identity.sourceGroup,
    source_code: identity.sourceCode,
    source_identity: identity.sourceIdentity,
    event_id: identity.eventId,
    raw_item_id: identity.rawItemId,
    reserved_at: identity.reservedAt,
    execution_state: state,
    phase: state === "reserved" ? "reserved_for_future_execution" : state,
  };
}

async function writeGenericMonitorTerminalOutput(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
  state: "succeeded_applicable" | "succeeded_not_applicable",
) {
  const result = await store.upsert("ai_outputs", {
    id: deterministicGenericMonitorOutputId(identity.executionId),
    ai_run_id: identity.executionId,
    event_id: identity.eventId,
    output_type: GENERIC_MONITOR_CHILD_OUTPUT_TYPE,
    payload: {
      schema_version: GENERIC_MONITOR_CHILD_OUTPUT_SCHEMA_VERSION,
      logical_job_id: identity.logicalJobId,
      execution_id: identity.executionId,
      parent_primary_ai_run_id: identity.parentPrimaryAiRunId,
      monitor_analyzer_key: identity.monitorAnalyzerKey,
      analyzer_contract_version: identity.analyzerContractVersion,
      result_classification: state,
    },
  }, {
    onConflict: "id",
    prefer: "resolution=ignore-duplicates,return=representation",
  });
  assertStoreResult(result, "Generic Monitor terminal execution output write");
}

async function alreadyHasTerminalState(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
  state: GenericMonitorChildTerminalState,
) {
  const result = await store.select("ai_runs", {
    select: "id,status,metadata",
    id: `eq.${identity.executionId}`,
    prompt_key: `eq.${GENERIC_MONITOR_CHILD_PROMPT_KEY}`,
    limit: "1",
  });
  assertStoreResult(result, "Generic Monitor terminal state recovery read");
  const row = record(rows(result.data)[0]);
  return stringValue(record(row?.metadata)?.execution_state) === state;
}

function assertExactParentRun(identity: GenericMonitorChildIdentity, aiRun: Record<string, unknown>) {
  if (
    stringValue(aiRun.id) !== identity.parentPrimaryAiRunId
    || stringValue(aiRun.event_id) !== identity.eventId
    || stringValue(aiRun.raw_item_id) !== identity.rawItemId
    || stringValue(aiRun.prompt_key) !== identity.parentPromptKey
    || stringValue(aiRun.prompt_version) !== identity.parentPromptVersion
    || stringValue(aiRun.status) !== "completed"
    || !isAuthorizedGenericMonitorPrimary(identity)
  ) {
    throw new Error("Generic Monitor exact parent ai_run lineage is invalid");
  }
}

function assertExactLineage(
  identity: GenericMonitorChildIdentity,
  aiOutput: Record<string, unknown>,
  event: Record<string, unknown>,
  rawItem: Record<string, unknown>,
) {
  const valid = stringValue(aiOutput.ai_run_id) === identity.parentPrimaryAiRunId
    && stringValue(aiOutput.event_id) === identity.eventId
    && stringValue(event.id) === identity.eventId
    && stringValue(event.raw_item_id) === identity.rawItemId
    && stringValue(event.source_group) === identity.sourceGroup
    && stringValue(event.source_code) === identity.sourceCode
    && stringValue(rawItem.id) === identity.rawItemId
    && stringValue(rawItem.source_group) === identity.sourceGroup
    && stringValue(rawItem.source_code) === identity.sourceCode
    && stringValue(rawItem.source_unique_id) === identity.sourceIdentity;
  if (!valid) throw new Error("Generic Monitor exact parent event/raw/source lineage is invalid");
}

function exactlyOneRow(value: unknown, label: string) {
  const candidates = rows(value);
  if (candidates.length !== 1 || !record(candidates[0])) {
    throw new Error(`Generic Monitor ${label} must resolve to exactly one row`);
  }
  return candidates[0] as Record<string, unknown>;
}

function assertStoreResult(result: StoreResult, label: string) {
  if (!result.ok) throw new Error(`${label} failed: ${result.error || result.status}`);
}

function rows(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" ? error : "Generic Monitor child failed";
}
