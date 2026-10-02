import { runS8StructuredAnalyzerPreview } from "../ai/s8StructuredAnalyzerPreview.ts";
import { parseS8Structured } from "./structuredContract.ts";
import { hash, record, stable } from "./directFacts.ts";
import { loadS8StructuredInput, reserveS8Structured, s8Repository, s8Rpc, S8_STRUCTURED_MODEL,
  type S8StructuredInput } from "./structuredPersistence.ts";
import type { S8Repository } from "./persistence.ts";

export type S8StructuredJob = { executionId: string; rawItemId: string; verificationKey?: string };
type Job = S8StructuredJob;
/** Dedicated raw-bound job on the existing durable workflow platform. Generic Primary-child lineage is not reused. */
export async function enqueueS8Structured(rawItemId: string, options: {
  verificationKey?: string; repository?: S8Repository; start?: (job: Job) => Promise<{ runId: string }>;
} = {}) {
  const repo = options.repository ?? await s8Repository();
  const input = await reserveS8Structured(rawItemId, repo, options.verificationKey);
  const scheduled = await s8Rpc(repo, "sec_s8_worker_transition", {
    p_id: input.executionId, p_raw_item_id: rawItemId, p_action: "schedule",
  });
  if (scheduled.claimed !== true) return { status: scheduled.status === "schedule_exhausted" ? "schedule_exhausted" as const : "duplicate" as const, executionId: input.executionId };
  try {
    const start = options.start ?? (async (job: Job) => {
      const { start } = await import("workflow/api");
      const { s8StructuredWorkflow } = await import("../../workflows/s8-structured.ts");
      return start(s8StructuredWorkflow, [job]);
    });
    const run = await start({ executionId: input.executionId, rawItemId, ...(options.verificationKey ? {verificationKey: options.verificationKey} : {}) });
    await s8Rpc(repo, "sec_s8_worker_transition", { p_id: input.executionId, p_raw_item_id: rawItemId,
      p_action: "link", p_token: scheduled.token, p_value: {workflowRunId:run.runId} });
    return { status: "enqueued" as const, executionId: input.executionId, workflowRunId: run.runId };
  } catch (error) {
    // Ambiguous starts retain the bounded scheduler lease; replay after expiry can start a replacement workflow.
    // Atomic worker claims/checkpoints fence late deliveries from either workflow.
    return { status: "enqueue_uncertain" as const, executionId: input.executionId,
      error: error instanceof Error ? error.message : "workflow_start_failed" };
  }
}

export async function analyzeS8StructuredJob(job: Job, options: {
  repository?: S8Repository; analyze?: typeof runS8StructuredAnalyzerPreview;
} = {}) {
  const repo = options.repository ?? await s8Repository();
  const claimed = await s8Rpc(repo, "claim_sec_s8_structured", { p_id: job.executionId, p_raw_item_id: job.rawItemId });
  if (claimed.claimed !== true) return { status: claimed.status === "busy" ? "busy" as const
    : claimed.status === "recovery_exhausted" ? "recovery_exhausted" as const : "duplicate" as const };
  const leaseToken = String(claimed.token);
  const checkpoint = claimed.checkpoint ? record(claimed.checkpoint) : null;
  const binding = record(claimed.binding);
  let input: S8StructuredInput;
  try {
    input = await loadS8StructuredInput(job.rawItemId, repo, job.verificationKey);
    if (input.executionId !== job.executionId || stable(binding) !== stable(input.binding)) throw new Error("s8_source_changed");
  } catch (error) {
    if (checkpoint) return fromCheckpoint(checkpoint, true);
    return prepared("stale", { error: String(error), outputText: "", provider: null, validationStage: "stale_source" });
  }
  if (checkpoint) {
    const payload = record(checkpoint.payload);
    if (stable(payload.binding) !== stable(binding) || typeof payload.outputText !== "string"
      || hash(payload.outputText) !== payload.outputSha256) throw new Error("s8_checkpoint_binding_invalid");
    if (checkpoint.status === "succeeded" && !parseS8Structured(payload.outputText, input.source).ok)
      throw new Error("s8_checkpoint_validation_failed");
    return fromCheckpoint(checkpoint, false);
  }
  await transition("provider_started");
  let analysis;
  try {
    analysis = await (options.analyze ?? runS8StructuredAnalyzerPreview)(input.raw, {
      model: S8_STRUCTURED_MODEL,
      // Preserve the exact tested v6 generation settings without changing the shared provider.
      fetchImpl: (url, init) => {
        const body = JSON.parse(String(init?.body));
        body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
        return fetch(url, { ...init, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      },
    });
  } catch (error) {
    return prepared("failed", { error: String(error), outputText: "", provider: null, validationStage: "provider_error" });
  }
  const status = analysis.stage === "complete" ? "succeeded" : "failed";
  return prepared(status, { outputText: analysis.run?.outputText ?? "", provider: analysis.run,
    error: "error" in analysis ? analysis.error : null, validationStage: analysis.stage });

  async function prepared(status: string, result: Record<string, unknown>) {
    const cp = {status, payload: { ...result, binding, executionMode: options.analyze ? "injected_analyzer_replay" : "provider",
      outputSha256: hash(String(result.outputText)) }};
    // Durable across Workflow runs, not only across steps of the original run.
    await transition("checkpoint", cp);
    return fromCheckpoint(cp, false);
  }
  function fromCheckpoint(cp: Record<string, unknown>, sourceStale: boolean) {
    return {status:"prepared" as const, job, leaseToken, terminalStatus:String(cp.status),
      payload:record(cp.payload), sourceStale};
  }
  function transition(action: string, value?: Record<string, unknown>) {
    return s8Rpc(repo,"sec_s8_worker_transition",{p_id:job.executionId,p_raw_item_id:job.rawItemId,
      p_action:action,p_token:leaseToken,p_value:value ?? null});
  }
}

export type S8PreparedResult = Awaited<ReturnType<typeof analyzeS8StructuredJob>>;
/** Separate durable step: DB retries reuse the checkpointed provider response, never call Gemini. */
export async function persistS8StructuredJob(result: S8PreparedResult, supplied?: S8Repository) {
  if (result.status !== "prepared") return result;
  const saved = await s8Rpc(supplied ?? await s8Repository(), "sec_s8_worker_transition", {
    p_id: result.job.executionId, p_raw_item_id: result.job.rawItemId, p_action:"finish",
    p_token:result.leaseToken,p_value:{stale:result.sourceStale},
  });
  return {status: String(saved.executionStatus ?? saved.status), executionId: result.job.executionId};
}
/** Direct harness compatibility. Product workflows use the two checkpointed steps. */
export async function processS8Structured(job: Job, options: {
  repository?: S8Repository; analyze?: typeof runS8StructuredAnalyzerPreview;
} = {}) {
  return persistS8StructuredJob(await analyzeS8StructuredJob(job, options), options.repository);
}
