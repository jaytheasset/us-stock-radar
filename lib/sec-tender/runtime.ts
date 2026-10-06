import { getServerEnv } from "../env.ts";
import { runTenderStructuredAnalyzer } from "./analyzer.ts";
import { hash, stable, TENDER_STRUCTURED_MODEL } from "./source.ts";
import {
  loadTenderStructuredInput,
  readTenderRun,
  reserveTenderStructured,
  tenderRepository,
  tenderRpc,
  type TenderRepository,
  rows,
} from "./persistence.ts";
import { isTenderStructuredForm } from "./source.ts";

export type TenderStructuredJob = {
  rawItemId: string;
  executionId: string;
};

export async function enqueueTenderStructured(
  rawItemId: string,
  options: {
    repository?: TenderRepository;
    start?: (job: TenderStructuredJob) => Promise<{ runId: string }>;
  } = {},
) {
  const repo = options.repository ?? await tenderRepository();
  const raw = rows(await repo.select("raw_items", {select:"raw_payload",id:`eq.${rawItemId}`,limit:"1"}))[0];
  if (!raw || !isTenderStructuredForm((raw.raw_payload as Record<string, unknown>)?.form_type)) return {status:"not_applicable" as const};
  const input = await reserveTenderStructured(rawItemId, repo);
  const scheduled = await tenderRpc(repo, "sec_tender_transition", {
    p_id: input.executionId,
    p_action: "schedule",
  });
  if (scheduled.claimed !== true) {
    return { status: "duplicate" as const, executionId: input.executionId };
  }
  const job: TenderStructuredJob = {
    rawItemId,
    executionId: input.executionId,
  };
  try {
    const start = options.start ?? (async (scheduledJob: TenderStructuredJob) => {
      const { start: workflowStart } = await import("workflow/api");
      const { tenderStructuredWorkflow } = await import("../../workflows/tender-structured.ts");
      return workflowStart(tenderStructuredWorkflow, [scheduledJob]);
    });
    const run = await start(job);
    await tenderRpc(repo, "sec_tender_transition", {
      p_id: input.executionId,
      p_action: "link",
      p_value: { token: scheduled.token, workflowRunId: run.runId },
    });
    return { status: "enqueued" as const, executionId: input.executionId, workflowRunId: run.runId };
  } catch (error) {
    return { status: "enqueue_uncertain" as const, executionId: input.executionId, error: String(error) };
  }
}

export async function processTenderStructured(
  job: TenderStructuredJob,
  options: {
    repository?: TenderRepository;
    fetchImpl?: typeof fetch;
    apiKey?: string;
  } = {},
) {
  const repo = options.repository ?? await tenderRepository();
  const run = await readTenderRun(repo, job.executionId);
  if (!run || run.raw_item_id !== job.rawItemId) throw new Error("tender_job_identity_invalid");
  if (["succeeded", "failed", "stale"].includes(String(run.status))) {
    return { status: String((run.metadata as Record<string, unknown>)?.state ?? run.status) };
  }

  const input = await loadTenderStructuredInput(job.rawItemId, repo);
  const metadata = (run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata))
    ? run.metadata as Record<string, unknown>
    : {};
  if (input.executionId !== job.executionId || stable(metadata.binding) !== stable(input.binding)) {
    return tenderRpc(repo, "finish_sec_tender_structured", {
      p_id: job.executionId,
      p_status: "stale",
      p_payload: {
        binding: metadata.binding,
        outputText: "",
        outputSha256: hash(""),
        canonical: null,
        canonicalHash: hash(stable(null)),
        error: "tender_source_changed",
        usage: null,
      },
    });
  }

  let blocked: string | null = null;
  let infrastructureError: unknown;
  let physicalCalls = 0;
  const transportFetch: typeof fetch = async (url, init) => {
    const requestText = String(init?.body ?? "");
    const requestHash = hash(requestText);
    let claim;
    try { claim = await tenderRpc(repo, "sec_tender_transition", {
      p_id: job.executionId,
      p_action: "begin",
      p_value: {
        stage: "structured",
        requestHash,
        request: JSON.parse(requestText),
        mode: options.fetchImpl ? "injected_response_replay" : "provider",
      },
    }); } catch (error) { infrastructureError = error; throw error; }
    if (claim.checkpoint) {
      const checkpoint = claim.checkpoint as Record<string, unknown>;
      const response = checkpoint.response as Record<string, unknown>;
      const responseBody = String(response.body ?? "");
      if (response.bodyHash !== hash(responseBody)) throw new Error("tender_checkpoint_corrupt");
      return new Response(responseBody, { status: Number(response.status) });
    }
    if (claim.claimed !== true) {
      blocked = String(claim.status ?? "busy");
      throw new Error(`tender_${blocked}`);
    }

    physicalCalls += 1;
    const startedAt = Date.now();
    let response: Response;
    let responseBody: string;
    try {
      response = await (options.fetchImpl ?? fetch)(url, {
        ...init,
        signal: AbortSignal.timeout(60_000),
      });
      responseBody = await response.text();
    } catch {
      blocked = "uncertain";
      await tenderRpc(repo, "sec_tender_transition", {
        p_id: job.executionId,
        p_action: "uncertain",
        p_value: { stage: "structured", token: claim.token },
      });
      throw new Error("tender_provider_outcome_unknown");
    }

    try { await tenderRpc(repo, "sec_tender_transition", {
      p_id: job.executionId,
      p_action: "checkpoint",
      p_value: {
        stage: "structured",
        token: claim.token,
        response: {
          status: response.status,
          body: responseBody,
          bodyHash: hash(responseBody),
          latencyMs: Date.now() - startedAt,
        },
      },
    }); } catch (error) { infrastructureError = error; throw error; }
    return new Response(responseBody, { status: response.status });
  };

  const apiKey = options.apiKey ?? getServerEnv().geminiApiKey;
  const analysis = await runTenderStructuredAnalyzer(input.source, input.providerSource, {
    apiKey,
    fetchImpl: transportFetch,
  });
  if (infrastructureError) throw infrastructureError;
  if (blocked) return { status: blocked, physicalCalls };

  const currentRun = await readTenderRun(repo, job.executionId);
  const currentMetadata = currentRun?.metadata && typeof currentRun.metadata === "object" && !Array.isArray(currentRun.metadata)
    ? currentRun.metadata as Record<string, unknown>
    : {};
  const stages = currentMetadata.stages && typeof currentMetadata.stages === "object" && !Array.isArray(currentMetadata.stages)
    ? currentMetadata.stages as Record<string, unknown>
    : {};
  const stage = stages.structured && typeof stages.structured === "object" && !Array.isArray(stages.structured)
    ? stages.structured as Record<string, unknown>
    : {};
  const response = stage.response && typeof stage.response === "object" && !Array.isArray(stage.response)
    ? stage.response as Record<string, unknown>
    : {};

  const payload = {
    binding: input.binding,
    outputText: analysis.outputText,
    outputSha256: hash(analysis.outputText),
    canonical: analysis.ok ? analysis.canonical : null,
    canonicalHash: hash(stable(analysis.ok ? analysis.canonical : null)),
    evidence: analysis.ok ? analysis.evidence : [],
    error: analysis.ok ? null : analysis.error,
    usage: analysis.usage,
    transport: {
      mode: stage.mode ?? null,
      latencyMs: response.latencyMs ?? null,
      physicalCalls: stage.state === "complete" ? 1 : 0,
      model: TENDER_STRUCTURED_MODEL,
    },
  };
  const latest = await loadTenderStructuredInput(job.rawItemId, repo);
  const stale = stable(latest.binding) !== stable(input.binding);
  const saved = await tenderRpc(repo, "finish_sec_tender_structured", {
    p_id: job.executionId,
    p_status: stale ? "stale" : analysis.ok ? "succeeded" : "failed",
    p_payload: payload,
  });
  return { status: String(saved.status), executionId: job.executionId, physicalCalls };
}

export async function consumeTenderAlertsForRaw(rawItemId: string) {
  const repo = await tenderRepository();
  const response = await repo.select("events", {
    select: "id",
    raw_item_id: `eq.${rawItemId}`,
    source_code: "eq.sec_edgar",
  });
  const events = rows(response);
  const { consumeListingMonitorAlertsForEvent } = await import("../monitor/listingMonitorAlertConsumer.ts");
  const results = [];
  for (const event of events) {
    results.push(await consumeListingMonitorAlertsForEvent({
      eventId: String(event.id),
      conditionFamily: "tender",
    }));
  }
  if (results.some((result) => result.failedCount > 0)) throw new Error("tender_alert_persistence_failed");
  return results;
}
