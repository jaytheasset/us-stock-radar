import {
  FatalError,
  RetryableError,
  getStepMetadata,
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
import { runSecRawIngest } from "@/lib/secIngest";
import {
  SEC_FORM_ROOM_MANIFEST,
  SEC_PRODUCTION_INGEST_SCHEDULE,
} from "@/lib/sources/sec/forms/common/forms";
import {
  SEC_WORKFLOW_CONFIG,
  SOURCE_INGEST_WORKFLOW_LANES,
  type NewsWorkflowLane,
  type WorkflowNewsSource,
} from "@/lib/sourceWorkflowConfig";
import { supabaseSelect, supabaseUpdate } from "@/lib/supabase";

export type WorkflowTrigger = IngestWorkflowLock & {
  triggerId: string;
};

export type SecIngestWorkflowInput = WorkflowTrigger & {
  groupId: string;
};

export type NewsIngestWorkflowInput = WorkflowTrigger & {
  lane: NewsWorkflowLane;
};

export async function secSourceIngestWorkflow(input: SecIngestWorkflowInput) {
  "use workflow";

  console.log(
    `[secSourceIngestWorkflow] START triggerId=${input.triggerId} groupId=${input.groupId}`,
  );

  try {
    await ensureWorkflowLockStep(input, SEC_WORKFLOW_CONFIG.lockTtlSeconds);
    const raw = await runSecGroupRawIngestStep(input.groupId);
    console.log(
      `[secSourceIngestWorkflow] RAW_DONE groupId=${input.groupId} pendingAnalysis=${raw.rawItemIds.length}`,
    );

    const analyses = [];
    for (const rawItemId of raw.rawItemIds) {
      await ensureWorkflowLockStep(input, SEC_WORKFLOW_CONFIG.lockTtlSeconds);
      analyses.push(
        await runSecRawAnalysisStep(input.groupId, rawItemId),
      );
    }

    console.log(
      `[secSourceIngestWorkflow] DONE triggerId=${input.triggerId} groupId=${input.groupId} analyzed=${analyses.length}`,
    );
    return {
      ok: analyses.every((item) => item.ok),
      triggerId: input.triggerId,
      groupId: input.groupId,
      raw,
      analyses,
    };
  } finally {
    await releaseWorkflowLockStep(input);
  }
}

export async function newsSourceIngestWorkflow(input: NewsIngestWorkflowInput) {
  "use workflow";

  const config = SOURCE_INGEST_WORKFLOW_LANES[input.lane];
  console.log(
    `[newsSourceIngestWorkflow] START triggerId=${input.triggerId} lane=${input.lane}`,
  );

  try {
    const results = [];
    const failures: string[] = [];

    for (const source of config.sourceIds) {
      await ensureWorkflowLockStep(input, config.lockTtlSeconds);
      try {
        const result = await runNewsSourceIngestStep(source, config.limit);
        results.push(result);
        console.log(
          `[newsSourceIngestWorkflow] SOURCE_DONE lane=${input.lane} source=${source}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${source}: ${message}`);
        console.error(
          `[newsSourceIngestWorkflow] SOURCE_FAIL lane=${input.lane} source=${source} error=${message}`,
        );
      }
    }

    if (failures.length) {
      throw new Error(
        `News workflow ${input.lane} failed for ${failures.length} source(s): ${failures.join("; ")}`,
      );
    }

    console.log(
      `[newsSourceIngestWorkflow] DONE triggerId=${input.triggerId} lane=${input.lane} sources=${results.length}`,
    );
    return {
      ok: true,
      triggerId: input.triggerId,
      lane: input.lane,
      results,
    };
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
  source: WorkflowNewsSource,
  limit: number,
) {
  "use step";

  const metadata = getStepMetadata();
  console.log(
    `[runNewsSourceIngestStep] START stepId=${metadata.stepId} attempt=${metadata.attempt} source=${source} limit=${limit}`,
  );

  const runner = NEWS_SOURCE_RUNNERS[source];
  if (!runner) {
    throw new FatalError(`Unknown Workflow news source: ${source}`);
  }

  try {
    const result = await runner({
      limit,
      dryRun: false,
      force: false,
    });
    const record = readRecord(result);
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
      runId: nullableString(record?.runId),
      stage: stringValue(record?.stage) || "complete",
      stats: numericStats(record?.stats),
      eventIds: uniqueStrings(readRecords(record?.items).map((item) => item.event_id)),
      rawItemIds: uniqueStrings(readRecords(record?.items).map((item) => item.raw_item_id)),
    };
    console.log(
      `[runNewsSourceIngestStep] DONE stepId=${metadata.stepId} source=${source} stats=${JSON.stringify(summary.stats)}`,
    );
    return summary;
  } catch (error) {
    console.error(
      `[runNewsSourceIngestStep] FAIL stepId=${metadata.stepId} source=${source} error=${error instanceof Error ? error.message : String(error)}`,
    );
    if (error instanceof FatalError || error instanceof RetryableError) throw error;
    throw retryableStepError(
      error instanceof Error ? error.message : `${source} ingest failed`,
      metadata.attempt,
    );
  }
}
runNewsSourceIngestStep.maxRetries = 3;

async function runSecGroupRawIngestStep(groupId: string) {
  "use step";

  const metadata = getStepMetadata();
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
      group.rooms.flatMap((slug) => {
        const room = rooms.get(slug);
        return room ? [...room.forms] : [];
      }),
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
    });
    const record = readRecord(result);
    if (!isSuccessfulIngestResult(record)) {
      throwStepFailure(
        `SEC raw ingest ${groupId} failed at ${stringValue(record?.stage) || "unknown"}: ${readResultError(record)}`,
        readNumber(record?.status),
        metadata.attempt,
      );
    }

    const candidateIds = uniqueStrings(
      readRecords(record?.items).map((item) => item.raw_item_id),
    );
    const rawItemIds = await findPendingSecAnalysisIds(candidateIds);
    const summary = {
      ok: true,
      groupId,
      formTypes,
      sourceRunId: nullableString(record?.runId),
      stats: numericStats(record?.stats),
      rawItemIds,
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

const NEWS_SOURCE_RUNNERS: Record<
  WorkflowNewsSource,
  (options: {
    limit: number;
    dryRun: boolean;
    force: boolean;
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
  );
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
