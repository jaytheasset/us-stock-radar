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
import { PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY } from "./periodicFinancialMonitor.ts";
import { FORM25_LISTING_CONTRACT_VERSION, FORM25_LISTING_FORMS } from "./form25ListingRisk.ts";
import { NT_LIFECYCLE_VERSION, NT_FORMS, NT_REPORT_FORMS } from "./ntLifecycle.ts";

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
    claimWorkflowStart: (identity: GenericMonitorChildIdentity) => claimGenericMonitorChildWorkflowStart(store, identity),
    releaseWorkflowStart: (identity: GenericMonitorChildIdentity, error?: unknown) =>
      releaseGenericMonitorChildWorkflowStart(store, identity, error),
    attachWorkflowRun: (identity: GenericMonitorChildIdentity, workflowRunId: string) =>
      attachGenericMonitorChildWorkflowRun(store, identity, workflowRunId),
    claim: (identity: GenericMonitorChildIdentity) => claimGenericMonitorChild(store, identity),
    releaseForRetry: (identity: GenericMonitorChildIdentity, error?: unknown) =>
      releaseGenericMonitorChildForRetry(store, identity, error),
    recoverWorkflowFailure: (identity: GenericMonitorChildIdentity, error?: unknown) =>
      recoverGenericMonitorChildWorkflowFailure(store, identity, error),
    recordTerminal: (
      identity: GenericMonitorChildIdentity,
      state: GenericMonitorChildTerminalState,
      options?: { error?: unknown; finishedAt?: string; outputPayload?: unknown },
    ) => recordGenericMonitorChildTerminalState(store, identity, state, options),
    loadExactParent: (identity: GenericMonitorChildIdentity) => loadGenericMonitorExactParent(store, identity),
  };
}

export async function recoverGenericMonitorChildWorkflowFailure(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
  error?: unknown,
) {
  if (await releaseGenericMonitorChildForRetry(store, identity, error)) return true;
  const result = await store.update("ai_runs", {
    id: `eq.${identity.executionId}`,
    prompt_key: `eq.${GENERIC_MONITOR_CHILD_PROMPT_KEY}`,
    status: "eq.pending",
    "metadata->>execution_state": "eq.reserved",
    "metadata->>workflow_start_state": "in.(starting,started)",
  }, {
    error_message: errorMessage(error),
    metadata: genericMonitorChildMetadata(identity, "reserved", {
      workflowStartState: "ready",
      workflowStartError: errorMessage(error),
    }),
  });
  assertStoreResult(result, "Generic Monitor workflow failure recovery");
  return rows(result.data).length > 0;
}

export async function releaseGenericMonitorChildForRetry(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
  error?: unknown,
) {
  const result = await store.update("ai_runs", {
    id: `eq.${identity.executionId}`,
    prompt_key: `eq.${GENERIC_MONITOR_CHILD_PROMPT_KEY}`,
    status: "eq.running",
    "metadata->>execution_state": "eq.running",
  }, {
    status: "pending",
    started_at: null,
    finished_at: null,
    error_message: errorMessage(error),
    metadata: genericMonitorChildMetadata(identity, "reserved", {
      workflowStartState: "ready",
      workflowStartError: errorMessage(error),
    }),
  });
  assertStoreResult(result, "Generic Monitor retryable execution release");
  return rows(result.data).length > 0;
}

export async function claimGenericMonitorChildWorkflowStart(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
) {
  const result = await store.update("ai_runs", {
    id: `eq.${identity.executionId}`,
    prompt_key: `eq.${GENERIC_MONITOR_CHILD_PROMPT_KEY}`,
    status: "eq.pending",
    "metadata->>execution_state": "eq.reserved",
    "metadata->>workflow_start_state": "eq.ready",
  }, {
    error_message: null,
    metadata: genericMonitorChildMetadata(identity, "reserved", {
      workflowStartState: "starting",
    }),
  });
  assertStoreResult(result, "Generic Monitor workflow-start claim");
  return rows(result.data).length > 0;
}

export async function releaseGenericMonitorChildWorkflowStart(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
  error?: unknown,
) {
  const result = await store.update("ai_runs", {
    id: `eq.${identity.executionId}`,
    prompt_key: `eq.${GENERIC_MONITOR_CHILD_PROMPT_KEY}`,
    status: "eq.pending",
    "metadata->>execution_state": "eq.reserved",
    "metadata->>workflow_start_state": "eq.starting",
  }, {
    error_message: errorMessage(error),
    metadata: genericMonitorChildMetadata(identity, "reserved", {
      workflowStartState: "ready",
      workflowStartError: errorMessage(error),
    }),
  });
  assertStoreResult(result, "Generic Monitor workflow-start release");
  return rows(result.data).length > 0;
}

export async function attachGenericMonitorChildWorkflowRun(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
  workflowRunId: string,
) {
  const normalizedRunId = stringValue(workflowRunId);
  if (!normalizedRunId) throw new Error("Generic Monitor workflow run id is invalid");
  const result = await store.update("ai_runs", {
    id: `eq.${identity.executionId}`,
    prompt_key: `eq.${GENERIC_MONITOR_CHILD_PROMPT_KEY}`,
    status: "eq.pending",
    "metadata->>execution_state": "eq.reserved",
    "metadata->>workflow_start_state": "eq.starting",
  }, {
    error_message: null,
    metadata: genericMonitorChildMetadata(identity, "reserved", {
      workflowStartState: "started",
      workflowRunId: normalizedRunId,
    }),
  });
  assertStoreResult(result, "Generic Monitor workflow run linkage");
  if (rows(result.data).length === 0) {
    throw new Error("Generic Monitor workflow run linkage lost its start claim");
  }
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
    model: identity.sourceFamily === "sec_form25" || identity.monitorAnalyzerKey === "nt_lifecycle" ? "deterministic" : "not_started",
    status: "pending",
    started_at: null,
    finished_at: null,
    usage: {},
    error_message: null,
    metadata: genericMonitorChildMetadata(identity, "reserved", { workflowStartState: "ready" }),
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
  options: { error?: unknown; finishedAt?: string; outputPayload?: unknown } = {},
) {
  const finishedAt = options.finishedAt || new Date().toISOString();
  const succeeded = state === "succeeded_applicable" || state === "succeeded_not_applicable";
  if (succeeded) {
    const eligibility = await readTerminalTransitionEligibility(store, identity, state);
    if (eligibility === "blocked") {
      return { recorded: false, jobId: identity.executionId, state };
    }
    await writeGenericMonitorTerminalOutput(store, identity, state, options.outputPayload);
    if (eligibility === "already_recorded") {
      return { recorded: false, jobId: identity.executionId, state };
    }
  }

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

  const expectedOutputType = expectedGenericMonitorPrimaryOutputType(identity);
  const outputResult = await store.select("ai_outputs", {
    select: "id,ai_run_id,event_id,output_type,payload,created_at",
    ai_run_id: `eq.${identity.parentPrimaryAiRunId}`,
    output_type: `eq.${expectedOutputType}`,
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
    select: "*",
    id: `eq.${identity.rawItemId}`,
    limit: "1",
  });
  assertStoreResult(rawResult, "Generic Monitor exact raw item read");
  const rawItem = exactlyOneRow(rawResult.data, "exact raw item");

  assertExactLineage(identity, expectedOutputType, aiOutput, event, rawItem);
  const analysis = record(record(aiOutput.payload)?.analysis);
  if (!analysis) throw new Error("Generic Monitor exact parent output is missing analysis");
  const routing = readMonitorRoutingResultFromPrimaryOutput(analysis);
  const isDeterministicPeriodicFinancial = identity.sourceFamily === "sec_periodic_reports"
    && identity.monitorAnalyzerKey === PERIODIC_FINANCIAL_MONITOR_ANALYZER_KEY;
  const isDeterministicForm25 = identity.sourceFamily === "sec_form25"
    && identity.monitorAnalyzerKey === "listing_risk"
    && identity.analyzerContractVersion === FORM25_LISTING_CONTRACT_VERSION
    && (FORM25_LISTING_FORMS as readonly string[]).includes(String(record(rawItem.raw_payload)?.form_type));
  if (identity.sourceFamily === "sec_form25" && !isDeterministicForm25) throw new Error("Invalid Form25 execution/source contract");
  const isDeterministicNt = identity.monitorAnalyzerKey === "nt_lifecycle"
    && identity.analyzerContractVersion === NT_LIFECYCLE_VERSION
    && ((identity.sourceFamily === "sec_nt" && NT_FORMS.includes(String(record(rawItem.raw_payload)?.form_type)))
      || (identity.sourceFamily === "sec_periodic_reports" && NT_REPORT_FORMS.includes(String(record(rawItem.raw_payload)?.form_type))));
  if ((identity.sourceFamily === "sec_nt" || identity.monitorAnalyzerKey === "nt_lifecycle") && !isDeterministicNt) throw new Error("Invalid NT execution/source contract");
  if (!isDeterministicPeriodicFinancial && !isDeterministicForm25 && !isDeterministicNt
    && !routing?.monitor_routes.some((route) => route.monitor_analyzer_key === identity.monitorAnalyzerKey)
    && !isSourceProvenSecAmendmentAuthorization(identity, analysis)) {
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
  workflow: {
    workflowStartState?: "ready" | "starting" | "started";
    workflowRunId?: string;
    workflowStartError?: string;
  } = {},
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
    ...(identity.secAmendmentLineage
      ? {
          alert_event_id: identity.alertEventId,
          sec_amendment_observation_key: identity.secAmendmentLineage.observation.observationKey,
          sec_amendment_operation: identity.secAmendmentLineage.operation,
          sec_amendment_root_raw_item_id: identity.secAmendmentLineage.root.rawItemId,
          sec_amendment_root_accession: identity.secAmendmentLineage.root.accessionNumber,
          sec_amendment_amendment_accession: identity.secAmendmentLineage.observation.amendment.accessionNumber,
          sec_amendment_issuer_cik: identity.secAmendmentLineage.root.issuerCik,
          sec_amendment_affected_fact_keys: [...identity.secAmendmentLineage.observation.affectedFactKeys],
        }
      : {}),
    ...(workflow.workflowStartState ? { workflow_start_state: workflow.workflowStartState } : {}),
    ...(workflow.workflowRunId ? { workflow_run_id: workflow.workflowRunId } : {}),
    ...(workflow.workflowStartError ? { workflow_start_error: workflow.workflowStartError } : {}),
  };
}

function isSourceProvenSecAmendmentAuthorization(
  identity: GenericMonitorChildIdentity,
  analysis: Record<string, unknown>,
) {
  const context = identity.secAmendmentLineage;
  const delta = record(analysis.sec_8k_6k_amendment_delta)
    || record(analysis.amendment_delta);
  return Boolean(
    context
    && identity.sourceFamily === "sec_8k_6k"
    && identity.sourceCode === "sec_edgar"
    && delta?.is_amendment === true
    && context.observation.status === "linked"
    && context.observation.amendment.rawItemId === identity.rawItemId
    && context.observation.amendment.accessionNumber === identity.sourceIdentity
    && context.observation.prior.rawItemId === context.root.rawItemId
    && context.observation.prior.accessionNumber === context.root.accessionNumber
    && context.observation.affectedFactKeys.includes(`monitor.${identity.monitorAnalyzerKey}`)
  );
}

export function expectedGenericMonitorPrimaryOutputType(identity: GenericMonitorChildIdentity) {
  return identity.sourceFamily === "sec_8k_6k" || identity.sourceFamily === "sec_periodic_reports" || identity.sourceFamily === "sec_form25" || identity.sourceFamily === "sec_nt"
    ? identity.parentPromptKey
    : "news_event_analysis";
}

async function writeGenericMonitorTerminalOutput(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
  state: "succeeded_applicable" | "succeeded_not_applicable",
  outputPayload?: unknown,
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
      ...(outputPayload === undefined ? {} : { analysis: outputPayload }),
    },
  }, {
    onConflict: "id",
    prefer: "resolution=ignore-duplicates,return=representation",
  });
  assertStoreResult(result, "Generic Monitor terminal execution output write");
}

async function readTerminalTransitionEligibility(
  store: GenericMonitorChildStore,
  identity: GenericMonitorChildIdentity,
  state: "succeeded_applicable" | "succeeded_not_applicable",
) {
  const result = await store.select("ai_runs", {
    select: "id,status,metadata",
    id: `eq.${identity.executionId}`,
    prompt_key: `eq.${GENERIC_MONITOR_CHILD_PROMPT_KEY}`,
    limit: "1",
  });
  assertStoreResult(result, "Generic Monitor terminal state recovery read");
  const row = record(rows(result.data)[0]);
  const status = stringValue(row?.status);
  if (status === "pending" || status === "running") return "ready" as const;
  return stringValue(record(row?.metadata)?.execution_state) === state
    ? "already_recorded" as const
    : "blocked" as const;
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
  expectedOutputType: string,
  aiOutput: Record<string, unknown>,
  event: Record<string, unknown>,
  rawItem: Record<string, unknown>,
) {
  const valid = stringValue(aiOutput.ai_run_id) === identity.parentPrimaryAiRunId
    && stringValue(aiOutput.event_id) === identity.eventId
    && stringValue(aiOutput.output_type) === expectedOutputType
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
