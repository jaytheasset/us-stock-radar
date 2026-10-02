import { runS8StructuredAnalyzerPreview } from "../ai/s8StructuredAnalyzerPreview.ts";
import { hash, record, stable } from "./directFacts.ts";
import { loadS8StructuredInput, reserveS8Structured, s8Repository, s8Rpc, S8_STRUCTURED_MODEL,
  type S8StructuredInput } from "./structuredPersistence.ts";
import type { S8Repository } from "./persistence.ts";

type Job = { executionId: string; rawItemId: string };
/** Dedicated raw-bound job on the existing durable workflow platform. Generic Primary-child lineage is not reused. */
export async function enqueueS8Structured(rawItemId: string, options: {
  repository?: S8Repository; start?: (job: Job) => Promise<{ runId: string }>;
} = {}) {
  const repo = options.repository ?? await s8Repository();
  const input = await reserveS8Structured(rawItemId, repo);
  if (!input.reserved) return { status: "duplicate" as const, executionId: input.executionId };
  try {
    const start = options.start ?? (async (job: Job) => {
      const { start } = await import("workflow/api");
      const { s8StructuredWorkflow } = await import("../../workflows/s8-structured.ts");
      return start(s8StructuredWorkflow, [job]);
    });
    const run = await start({ executionId: input.executionId, rawItemId });
    await s8Rpc(repo, "link_sec_s8_structured_workflow", { p_id: input.executionId, p_workflow_id: run.runId });
    return { status: "enqueued" as const, executionId: input.executionId, workflowRunId: run.runId };
  } catch (error) {
    // An ambiguous start failure must not cause another model call on ingest replay.
    return { status: "enqueue_uncertain" as const, executionId: input.executionId,
      error: error instanceof Error ? error.message : "workflow_start_failed" };
  }
}

export async function processS8Structured(job: Job, options: {
  repository?: S8Repository; analyze?: typeof runS8StructuredAnalyzerPreview;
} = {}) {
  const repo = options.repository ?? await s8Repository();
  const claimed = await s8Rpc(repo, "claim_sec_s8_structured", { p_id: job.executionId, p_raw_item_id: job.rawItemId });
  if (claimed.claimed !== true) return { status: "duplicate" as const };
  const binding = record(claimed.binding);
  let input: S8StructuredInput;
  try {
    input = await loadS8StructuredInput(job.rawItemId, repo);
    if (input.executionId !== job.executionId || stable(binding) !== stable(input.binding)) throw new Error("s8_source_changed");
  } catch (error) {
    await finish("stale", { error: String(error), outputText: "", provider: null });
    return { status: "stale" as const };
  }
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
    await finish("failed", { error: String(error), outputText: "", provider: null });
    return { status: "failed" as const };
  }
  const status = analysis.stage === "complete" ? "succeeded" : "failed";
  const saved = await finish(status, { outputText: analysis.run?.outputText ?? "", provider: analysis.run,
    error: "error" in analysis ? analysis.error : null, validationStage: analysis.stage });
  return { status: String(saved.status), executionId: job.executionId };

  async function finish(status: string, result: Record<string, unknown>) {
    return s8Rpc(repo, "finish_sec_s8_structured", { p_id: job.executionId, p_status: status,
      p_payload: { ...result, binding, executionMode: options.analyze ? "injected_analyzer_replay" : "provider",
        outputSha256: hash(String(result.outputText)) } });
  }
}
