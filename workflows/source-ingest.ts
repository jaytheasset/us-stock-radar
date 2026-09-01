import { createHash } from "node:crypto";
import {
  FatalError,
  RetryableError,
  getStepMetadata,
  getWorkflowMetadata,
} from "workflow";
import {
  renewIngestWorkflowLock,
  releaseIngestWorkflowLock,
  type IngestWorkflowLock,
} from "@/lib/ingestWorkflowLock";
import {
  runAccesswireNewsIngestWithFallback,
  runFdaNewsIngestWithFallback,
} from "@/lib/newsIngestFallbacks";
import {
  runBusinessWireNewsIngest,
  runDeaNewsIngest,
  runDojNewsIngest,
  runGlobeNewsIngest,
  runNasdaqCorporateActionsNewsIngest,
  runNasdaqTraderNewsIngest,
  runNewsfileNewsIngest,
  runOfacNewsIngest,
  runPRNewswireNewsIngest,
  runWhiteHouseNewsIngest,
} from "@/lib/newsIngest";
import { runSecFilingAnalysisIngest } from "@/lib/secFilingAnalysisIngest";
import {
  extractProspectusOsRawItemIds,
  runSecProspectusOsTriggerBridge,
} from "@/lib/secProspectusOsTriggerBridge";
import {
  SEC_PERIODIC_OS_TRIGGER_FORMS,
  extractPeriodicOsIssuerCiks,
  runSecPeriodicOsTriggerBridge,
} from "@/lib/secPeriodicOsTriggerBridge";
import {
  buildOfferingMonitorJobIdentity,
  type OfferingMonitorJobIdentity,
} from "@/lib/offeringMonitorJobFoundation";
import { enqueueOfferingMonitorJob } from "@/lib/offeringMonitorJobStarter";
import { runSecRawIngest } from "@/lib/secIngest";
import {
  SEC_FORM_ROOM_MANIFEST,
  SEC_PRODUCTION_INGEST_SCHEDULE,
} from "@/lib/sources/sec/forms/common/forms";
import {
  SEC_WORKFLOW_CONFIG,
  SOURCE_INGEST_WORKFLOW_SOURCES,
  type WorkflowNewsSource,
} from "@/lib/sourceWorkflowConfig";
import type { WorkflowSourceRunAttempt } from "@/lib/sourceRunState";
import { supabaseSelect, supabaseUpdate } from "@/lib/supabase";

export type WorkflowTrigger = IngestWorkflowLock & {
  triggerId: string;
};

export type SecIngestWorkflowInput = WorkflowTrigger & {
  groupId: string;
};

export type NewsIngestWorkflowInput = WorkflowTrigger & {
  source: WorkflowNewsSource;
};

export async function secSourceIngestWorkflow(input: SecIngestWorkflowInput) {
  "use workflow";

  console.log(
    `[secSourceIngestWorkflow] START triggerId=${input.triggerId} groupId=${input.groupId}`,
  );

  try {
    await ensureWorkflowLockStep(input, SEC_WORKFLOW_CONFIG.lockTtlSeconds);
    const raw = await runSecGroupRawIngestStep(input);
    console.log(
      `[secSourceIngestWorkflow] RAW_DONE groupId=${input.groupId} pendingAnalysis=${raw.rawItemIds.length}`,
    );

    let osCollection;
    if (raw.periodicOsIssuerCiks.length > 0) {
      await ensureWorkflowLockStep(input, SEC_WORKFLOW_CONFIG.lockTtlSeconds);
      osCollection = await runSecPeriodicOsCollectorStep(raw.periodicOsIssuerCiks);
    } else {
      osCollection = {
        ok: true,
        status: "skipped" as const,
        mode: "incremental" as const,
        requestedCiks: [],
        issuerResults: [],
        failures: [],
      };
    }

    let prospectusOsCollection;
    if (raw.prospectusOsRawItemIds.length > 0) {
      await ensureWorkflowLockStep(input, SEC_WORKFLOW_CONFIG.lockTtlSeconds);
      prospectusOsCollection = await runSecProspectusOsCollectorStep(raw.prospectusOsRawItemIds);
    } else {
      prospectusOsCollection = {
        ok: true,
        status: "skipped" as const,
        requestedRawItemIds: [],
        results: [],
      };
    }

    const analyses = [];
    const monitorJobs = [];
    for (const rawItemId of raw.rawItemIds) {
      await ensureWorkflowLockStep(input, SEC_WORKFLOW_CONFIG.lockTtlSeconds);
      const analysis = await runSecRawAnalysisStep(input.groupId, rawItemId);
      analyses.push(analysis);
      if (analysis.monitorJobIdentity) {
        monitorJobs.push(
          await enqueueOfferingMonitorJobStep(analysis.monitorJobIdentity),
        );
      }
    }

    console.log(
      `[secSourceIngestWorkflow] DONE triggerId=${input.triggerId} groupId=${input.groupId} analyzed=${analyses.length}`,
    );
    return {
      ok: analyses.every((item) => item.ok),
      triggerId: input.triggerId,
      groupId: input.groupId,
      raw,
      osCollection,
      prospectusOsCollection,
      analyses,
      monitorJobs,
    };
  } finally {
    await releaseWorkflowLockStep(input);
  }
}

export async function newsSourceIngestWorkflow(input: NewsIngestWorkflowInput) {
  "use workflow";

  const config = SOURCE_INGEST_WORKFLOW_SOURCES[input.source];
  const startedAtMs = Date.now();
  console.log(JSON.stringify({
    event: "news_source_ingest_workflow",
    phase: "START",
    success: null,
    duration_ms: 0,
    trigger_id: input.triggerId,
    source: input.source,
    run_id: null,
    stats: {},
  }));

  try {
    await ensureWorkflowLockStep(input, config.lockTtlSeconds);
    const result = await runNewsSourceIngestStep(input, config.limit);
    console.log(JSON.stringify({
      event: "news_source_ingest_workflow",
      phase: "DONE",
      success: true,
      duration_ms: Math.max(0, Date.now() - startedAtMs),
      trigger_id: input.triggerId,
      source: input.source,
      run_id: result.runId,
      stats: result.stats,
    }));
    return {
      ok: true,
      triggerId: input.triggerId,
      source: input.source,
      result,
    };
  } catch (error) {
    console.error(JSON.stringify({
      event: "news_source_ingest_workflow",
      phase: "FAIL",
      success: false,
      duration_ms: Math.max(0, Date.now() - startedAtMs),
      trigger_id: input.triggerId,
      source: input.source,
      run_id: null,
      stats: {},
      error:
        error instanceof Error
          ? error.message
          : String(error),
    }));
    throw error;
  } finally {
    await releaseWorkflowLockStep(input);
  }
}

async function ensureWorkflowLockStep(
  lock: IngestWorkflowLock,
  ttlSeconds: number,
) {
  "use step";

  const metadata = getStepMetadata();
  console.log(
    `[ensureWorkflowLockStep] START stepId=${metadata.stepId} attempt=${metadata.attempt} lockKey=${lock.lockKey}`,
  );
  const result = await renewIngestWorkflowLock(lock, ttlSeconds);
  if (!result.ok) {
    throw retryableStepError(
      `Could not renew ingest lock ${lock.lockKey}: ${result.error || "unknown Supabase error"}`,
      metadata.attempt,
    );
  }
  if (!result.renewed) {
    throw new FatalError(`Ingest lock ${lock.lockKey} expired or changed owner`);
  }
  console.log(
    `[ensureWorkflowLockStep] DONE stepId=${metadata.stepId} lockKey=${lock.lockKey}`,
  );
}
ensureWorkflowLockStep.maxRetries = 3;

async function releaseWorkflowLockStep(lock: IngestWorkflowLock) {
  "use step";

  const metadata = getStepMetadata();
  console.log(
    `[releaseWorkflowLockStep] START stepId=${metadata.stepId} attempt=${metadata.attempt} lockKey=${lock.lockKey}`,
  );
  const result = await releaseIngestWorkflowLock(lock);
  if (!result.ok) {
    throw retryableStepError(
      `Could not release ingest lock ${lock.lockKey}: ${result.error || "unknown Supabase error"}`,
      metadata.attempt,
    );
  }
  console.log(
    `[releaseWorkflowLockStep] DONE stepId=${metadata.stepId} lockKey=${lock.lockKey} released=${result.released}`,
  );
  return result.released;
}
releaseWorkflowLockStep.maxRetries = 3;

async function runNewsSourceIngestStep(
  input: NewsIngestWorkflowInput,
  limit: number,
) {
  "use step";

  const source = input.source;
  const metadata = getStepMetadata();
  const workflowMetadata = getWorkflowMetadata();
  const sourceRun = buildWorkflowSourceRunAttempt(input, metadata, workflowMetadata.workflowRunId);
  const startedAtMs = Date.now();
  let runId: string | null = null;
  let stats: Record<string, number> = {};
  console.log(JSON.stringify({
    event: "news_source_ingest_step",
    phase: "START",
    success: null,
    duration_ms: 0,
    step_id: metadata.stepId,
    attempt: metadata.attempt,
    source,
    limit,
    run_id: runId,
    stats,
  }));

  const runner = NEWS_SOURCE_RUNNERS[source];
  if (!runner) {
    throw new FatalError(`Unknown Workflow news source: ${source}`);
  }

  try {
    const result = await runner({
      limit,
      dryRun: false,
      force: false,
      sourceRun,
    });
    const record = readRecord(result);
    runId = nullableString(record?.runId);
    stats = numericStats(record?.stats);
    if (!isSuccessfulIngestResult(record)) {
      throwStepFailure(
        `${source} ingest failed at ${stringValue(record?.stage) || "unknown"}: ${readResultError(record)}`,
        readNumber(record?.status),
        metadata.attempt,
      );
    }

    const summary = {
      ok: true,
      source,
      runId,
      stage: stringValue(record?.stage) || "complete",
      stats,
      durationMs: Math.max(0, Date.now() - startedAtMs),
      eventIds: uniqueStrings(readRecords(record?.items).map((item) => item.event_id)),
      rawItemIds: uniqueStrings(readRecords(record?.items).map((item) => item.raw_item_id)),
    };
    console.log(JSON.stringify({
      event: "news_source_ingest_step",
      phase: "DONE",
      success: true,
      duration_ms: summary.durationMs,
      step_id: metadata.stepId,
      attempt: metadata.attempt,
      source,
      run_id: summary.runId,
      stage: summary.stage,
      stats: summary.stats,
    }));
    return summary;
  } catch (error) {
    console.error(JSON.stringify({
      event: "news_source_ingest_step",
      phase: "FAIL",
      success: false,
      duration_ms: Math.max(0, Date.now() - startedAtMs),
      step_id: metadata.stepId,
      attempt: metadata.attempt,
      source,
      run_id: runId,
      stats,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    }));
    if (error instanceof FatalError || error instanceof RetryableError) throw error;
    throw retryableStepError(
      error instanceof Error ? error.message : `${source} ingest failed`,
      metadata.attempt,
    );
  }
}
runNewsSourceIngestStep.maxRetries = 3;

async function runSecGroupRawIngestStep(input: SecIngestWorkflowInput) {
  "use step";

  const groupId = input.groupId;
  const metadata = getStepMetadata();
  const workflowMetadata = getWorkflowMetadata();
  const sourceRun = buildWorkflowSourceRunAttempt(input, metadata, workflowMetadata.workflowRunId);
  console.log(
    `[runSecGroupRawIngestStep] START stepId=${metadata.stepId} attempt=${metadata.attempt} groupId=${groupId}`,
  );
  const group = SEC_PRODUCTION_INGEST_SCHEDULE.find((item) => item.id === groupId);
  if (!group) {
    throw new FatalError(`Unknown SEC production ingest group: ${groupId}`);
  }

  const rooms = new Map(SEC_FORM_ROOM_MANIFEST.map((room) => [room.slug, room]));
  const formTypes = [
    ...new Set(
      [...group.rooms.flatMap((slug) => {
        const room = rooms.get(slug);
        return room ? [...room.forms] : [];
      }), ...((group.rooms as readonly string[]).includes("periodic-reports")
        ? SEC_PERIODIC_OS_TRIGGER_FORMS.filter((form) => form.startsWith("40-F"))
        : [])],
    ),
  ];

  try {
    const result = await runSecRawIngest({
      formTypes,
      countPerForm: group.countPerForm,
      limit: Math.min(50, Math.max(1, formTypes.length * group.countPerForm)),
      attachmentLimit: group.attachmentLimit,
      includeDocuments: true,
      dryRun: false,
      force: false,
      sourceRun,
    });
    const record = readRecord(result);
    if (!isSuccessfulIngestResult(record)) {
      throwStepFailure(
        `SEC raw ingest ${groupId} failed at ${stringValue(record?.stage) || "unknown"}: ${readResultError(record)}`,
        readNumber(record?.status),
        metadata.attempt,
      );
    }

    const ingestedItems = readRecords(record?.items);
    const candidateIds = uniqueStrings(ingestedItems
      .filter((item) => !stringValue(item.form_type).toUpperCase().startsWith("40-F"))
      .map((item) => item.raw_item_id));
    const periodicOsIssuerCiks = extractPeriodicOsIssuerCiks(
      ingestedItems,
    );
    const prospectusOsRawItemIds = extractProspectusOsRawItemIds(ingestedItems);
    const rawItemIds = await findPendingSecAnalysisIds(candidateIds);
    const summary = {
      ok: true,
      groupId,
      formTypes,
      sourceRunId: nullableString(record?.runId),
      stats: numericStats(record?.stats),
      rawItemIds,
      periodicOsIssuerCiks,
      prospectusOsRawItemIds,
    };
    console.log(
      `[runSecGroupRawIngestStep] DONE stepId=${metadata.stepId} groupId=${groupId} pendingAnalysis=${rawItemIds.length} stats=${JSON.stringify(summary.stats)}`,
    );
    return summary;
  } catch (error) {
    console.error(
      `[runSecGroupRawIngestStep] FAIL stepId=${metadata.stepId} groupId=${groupId} error=${error instanceof Error ? error.message : String(error)}`,
    );
    if (error instanceof FatalError || error instanceof RetryableError) throw error;
    throw retryableStepError(
      error instanceof Error ? error.message : `SEC raw ingest ${groupId} failed`,
      metadata.attempt,
    );
  }
}
runSecGroupRawIngestStep.maxRetries = 3;

async function runSecPeriodicOsCollectorStep(ciks: string[]) {
  "use step";

  const metadata = getStepMetadata();
  console.log(
    `[runSecPeriodicOsCollectorStep] START stepId=${metadata.stepId} attempt=${metadata.attempt} issuers=${ciks.length}`,
  );
  const result = await runSecPeriodicOsTriggerBridge({ ciks });
  console.log(
    `[runSecPeriodicOsCollectorStep] DONE stepId=${metadata.stepId} status=${result.status} issuers=${result.issuerResults.length} failures=${result.failures.length}`,
  );
  return result;
}
runSecPeriodicOsCollectorStep.maxRetries = 3;

async function runSecProspectusOsCollectorStep(rawItemIds: string[]) {
  "use step";

  const metadata = getStepMetadata();
  console.log(
    `[runSecProspectusOsCollectorStep] START stepId=${metadata.stepId} attempt=${metadata.attempt} filings=${rawItemIds.length}`,
  );
  const result = await runSecProspectusOsTriggerBridge({ rawItemIds });
  console.log(
    `[runSecProspectusOsCollectorStep] DONE stepId=${metadata.stepId} status=${result.status} results=${result.results.length}`,
  );
  return result;
}
runSecProspectusOsCollectorStep.maxRetries = 3;

async function runSecRawAnalysisStep(groupId: string, rawItemId: string) {
  "use step";

  const metadata = getStepMetadata();
  console.log(
    `[runSecRawAnalysisStep] START stepId=${metadata.stepId} attempt=${metadata.attempt} groupId=${groupId} rawItemId=${rawItemId}`,
  );

  try {
    const existing = await readSecAnalysisDisposition(rawItemId);
    if (existing.status === "completed" || existing.status === "skipped") {
      console.log(
        `[runSecRawAnalysisStep] DONE stepId=${metadata.stepId} rawItemId=${rawItemId} reused=${existing.status}`,
      );
      return {
        ok: true,
        groupId,
        rawItemId,
        eventId: existing.eventId,
        stage: existing.status,
        reused: true,
        monitorJobIdentity: null,
      };
    }

    const result = await runSecFilingAnalysisIngest({
      rawItemId,
      dryRun: false,
      force: false,
    });
    const record = readRecord(result);
    if (record?.ok !== true) {
      throwStepFailure(
        `SEC analysis ${rawItemId} failed at ${stringValue(record?.stage) || "unknown"}: ${readResultError(record)}`,
        readNumber(record?.status),
        metadata.attempt,
      );
    }

    const status = record.skipped === true || record.stage === "skipped"
      ? "skipped"
      : "completed";
    const eventId = nullableString(readRecord(record.event)?.id);
    const monitorJobIdentity = buildOfferingMonitorJobIdentity(record);
    await markSecAnalysisDisposition(rawItemId, status, eventId);

    console.log(
      `[runSecRawAnalysisStep] DONE stepId=${metadata.stepId} rawItemId=${rawItemId} status=${status} eventId=${eventId || "none"}`,
    );
    return {
      ok: true,
      groupId,
      rawItemId,
      eventId,
      stage: status,
      reused: false,
      monitorJobIdentity,
    };
  } catch (error) {
    console.error(
      `[runSecRawAnalysisStep] FAIL stepId=${metadata.stepId} rawItemId=${rawItemId} error=${error instanceof Error ? error.message : String(error)}`,
    );
    if (error instanceof FatalError || error instanceof RetryableError) throw error;
    throw retryableStepError(
      error instanceof Error ? error.message : `SEC analysis ${rawItemId} failed`,
      metadata.attempt,
    );
  }
}
runSecRawAnalysisStep.maxRetries = 3;

async function enqueueOfferingMonitorJobStep(identity: OfferingMonitorJobIdentity) {
  "use step";

  return enqueueOfferingMonitorJob(identity);
}
enqueueOfferingMonitorJobStep.maxRetries = 3;

const NEWS_SOURCE_RUNNERS: Record<
  WorkflowNewsSource,
  (options: {
    limit: number;
    dryRun: boolean;
    force: boolean;
    sourceRun: WorkflowSourceRunAttempt;
  }) => Promise<unknown>
> = {
  globe: runGlobeNewsIngest,
  businesswire: runBusinessWireNewsIngest,
  prnewswire: runPRNewswireNewsIngest,
  newsfile: runNewsfileNewsIngest,
  accesswire: runAccesswireNewsIngestWithFallback,
  nasdaq_trader: runNasdaqTraderNewsIngest,
  nasdaq_corporate_actions: runNasdaqCorporateActionsNewsIngest,
  ofac: runOfacNewsIngest,
  doj: runDojNewsIngest,
  dea: runDeaNewsIngest,
  whitehouse: runWhiteHouseNewsIngest,
  fda: runFdaNewsIngestWithFallback,
};

function buildWorkflowSourceRunAttempt(
  trigger: WorkflowTrigger,
  step: ReturnType<typeof getStepMetadata>,
  workflowRunId: string,
): WorkflowSourceRunAttempt {
  return {
    sourceRunId: deterministicSourceRunId([
      workflowRunId,
      step.stepId,
      String(step.attempt),
    ]),
    workflowRunId,
    workflowStepId: step.stepId,
    workflowAttempt: step.attempt,
    triggerId: trigger.triggerId,
    lockKey: trigger.lockKey,
    lockOwner: trigger.lockOwner,
  };
}

function deterministicSourceRunId(parts: readonly string[]) {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function findPendingSecAnalysisIds(rawItemIds: string[]) {
  if (!rawItemIds.length) return [];

  const rawResult = await supabaseSelect("raw_items", {
    select: "id,metadata",
    id: `in.(${rawItemIds.join(",")})`,
    limit: String(rawItemIds.length),
  });
  if (!rawResult.ok) {
    throw new Error(`Could not read SEC raw analysis state: ${rawResult.error || `HTTP ${rawResult.status}`}`);
  }

  const eventResult = await supabaseSelect("events", {
    select: "id,raw_item_id",
    raw_item_id: `in.(${rawItemIds.join(",")})`,
    limit: String(rawItemIds.length),
  });
  if (!eventResult.ok) {
    throw new Error(`Could not read SEC event state: ${eventResult.error || `HTTP ${eventResult.status}`}`);
  }

  const completedIds = new Set(
    readRecords(eventResult.data).map((row) => stringValue(row.raw_item_id)).filter(Boolean),
  );
  return readRecords(rawResult.data)
    .filter((row) => {
      const rawItemId = stringValue(row.id);
      if (!rawItemId || completedIds.has(rawItemId)) return false;
      const status = stringValue(readRecord(row.metadata)?.workflow_analysis_status);
      return status !== "completed" && status !== "skipped";
    })
    .map((row) => stringValue(row.id));
}

async function readSecAnalysisDisposition(rawItemId: string) {
  const eventResult = await supabaseSelect("events", {
    select: "id",
    raw_item_id: `eq.${rawItemId}`,
    limit: "1",
  });
  if (!eventResult.ok) {
    throw new Error(`Could not read SEC event state: ${eventResult.error || `HTTP ${eventResult.status}`}`);
  }
  const event = readRecords(eventResult.data)[0];
  if (event) {
    return { status: "completed" as const, eventId: nullableString(event.id) };
  }

  const rawResult = await supabaseSelect("raw_items", {
    select: "metadata",
    id: `eq.${rawItemId}`,
    limit: "1",
  });
  if (!rawResult.ok) {
    throw new Error(`Could not read SEC raw analysis state: ${rawResult.error || `HTTP ${rawResult.status}`}`);
  }
  const raw = readRecords(rawResult.data)[0];
  const metadata = readRecord(raw?.metadata);
  const status = stringValue(metadata?.workflow_analysis_status);
  return {
    status: status === "completed" || status === "skipped" ? status : "pending",
    eventId: nullableString(metadata?.workflow_event_id),
  };
}

async function markSecAnalysisDisposition(
  rawItemId: string,
  status: "completed" | "skipped",
  eventId: string | null,
) {
  const rawResult = await supabaseSelect("raw_items", {
    select: "metadata",
    id: `eq.${rawItemId}`,
    limit: "1",
  });
  if (!rawResult.ok) {
    throw new Error(`Could not read SEC raw metadata: ${rawResult.error || `HTTP ${rawResult.status}`}`);
  }
  const raw = readRecords(rawResult.data)[0];
  if (!raw) throw new FatalError(`SEC raw item ${rawItemId} no longer exists`);

  const result = await supabaseUpdate(
    "raw_items",
    { id: `eq.${rawItemId}` },
    {
      metadata: {
        ...(readRecord(raw.metadata) || {}),
        event_created: status === "completed",
        workflow_analysis_status: status,
        workflow_analysis_updated_at: new Date().toISOString(),
        workflow_event_id: eventId,
      },
    },
  );
  if (!result.ok) {
    throw new Error(`Could not persist SEC raw analysis state: ${result.error || `HTTP ${result.status}`}`);
  }
}

function isSuccessfulIngestResult(record: Record<string, unknown> | null) {
  if (!record) return false;
  if (record.ok === true || record.partial === true) return true;
  const stats = readRecord(record.stats);
  const stage = stringValue(record.stage);
  return (
    (stage === "complete" || stage === "dry_run") &&
    (readNumber(stats?.event_upserted_count) > 0 || readNumber(stats?.raw_upserted_count) > 0)
  );
}

function throwStepFailure(
  message: string,
  status: number,
  attempt: number,
): never {
  if (status >= 400 && status < 500 && ![408, 409, 425, 429].includes(status)) {
    throw new FatalError(message);
  }
  throw retryableStepError(message, attempt);
}

function retryableStepError(message: string, attempt: number) {
  const retryAfter = Math.min(5 * 60_000, 15_000 * (2 ** Math.max(0, attempt - 1)));
  return new RetryableError(message, { retryAfter });
}

function readResultError(record: Record<string, unknown> | null) {
  return (
    stringValue(record?.error) ||
    stringValue(readRecord(record?.rawResult)?.error) ||
    "unknown ingest error"
  );
}

function numericStats(value: unknown) {
  const record = readRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter(([, item]) => typeof item === "number" && Number.isFinite(item)),
  ) as Record<string, number>;
}

function readRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(values.map((value) => stringValue(value)).filter(Boolean))];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function nullableString(value: unknown) {
  return stringValue(value) || null;
}

function readNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
