import "server-only";
import { randomUUID } from "node:crypto";
import { acquireIngestWorkflowLock, renewIngestWorkflowLock, releaseIngestWorkflowLock } from "../ingestWorkflowLock.ts";

import { discoverSecTickerAutomaticCandidates } from "./automaticPlanner.ts";
export { SEC_TICKER_AUTOMATIC_ISSUER_LIMIT } from "./automaticPlanner.ts";
import { resolveAndPersistSecTickerChange, type SecTickerResolutionRepository } from "./persistence.ts";
export const SEC_TICKER_AUTOMATIC_TRIGGER_VERSION = "sec-ticker-resolution-ingest-v1";
const LEASE_SECONDS = 300;

export type SecTickerAutomaticTriggerResult = {
  version: string;
  status: "completed" | "waiting" | "review_required" | "failed";
  reasons: string[];
  decisions: Array<{ decisionId: string; resolutionState: string; writeStatus: string }>;
};

/** Discovery supplies source-bound inputs only; the existing engine owns every relationship rule. */
export async function runSecTickerResolutionAutomaticTrigger(input: {
  issuerCik: string;
  accessionNumber: string;
  sourceSha256: string | null;
  resultId: string;
  repository?: SecTickerResolutionRepository;
}): Promise<SecTickerAutomaticTriggerResult> {
  const result: SecTickerAutomaticTriggerResult = {
    version: SEC_TICKER_AUTOMATIC_TRIGGER_VERSION, status: "completed", reasons: [], decisions: [],
  };
  const stop = (status: SecTickerAutomaticTriggerResult["status"], reason: string) => {
    result.status = status;
    result.reasons.push(reason);
    return result;
  };
  let held: { repository: SecTickerResolutionRepository; lock: { lockKey: string; lockOwner: string } } | null = null;
  try {
    const repository = input.repository ?? await defaultRepository();
    const issuerCik = input.issuerCik;
    if (!/^\d{10}$/.test(issuerCik)) return stop("failed", "invalid_issuer_cik");
    const lock = { lockKey: `sec-ticker-resolution:${issuerCik}`, lockOwner: randomUUID() };
    const acquired = await acquireIngestWorkflowLock(lock, LEASE_SECONDS, repository);
    if (!acquired.ok) return stop("failed", "issuer_lease_acquire_failed");
    if (!acquired.acquired) return stop("waiting", "issuer_resolution_busy_retry_on_replay");
    held = { repository, lock };
    for await (const step of discoverSecTickerAutomaticCandidates({ ...input, repository })) {
      if (step.kind === "stop") {
        if (step.status !== "review_required") return stop(step.status, step.reason);
        result.status = "review_required"; result.reasons.push(step.reason);
      } else if (step.kind === "checkpoint" || step.kind === "selected") {
        const renewed = await renewIngestWorkflowLock(lock, LEASE_SECONDS, repository);
        if (!renewed.ok || !renewed.renewed) return stop("failed", "issuer_lease_lost");
        if (step.kind === "selected") {
          const persisted = await resolveAndPersistSecTickerChange({ ...step.candidate.request, repository });
          if (persisted.status !== "available") return stop("failed", persisted.reason);
          result.decisions.push({ decisionId: persisted.decisionId, resolutionState: persisted.resolutionState, writeStatus: persisted.writeStatus });
        }
      }
    }
    if (!result.decisions.length && !result.reasons.length) return stop("waiting", "no_observed_symbol_boundary");
    return result;
  } catch {
    return stop("failed", "automatic_resolution_exception");
  } finally {
    if (held) {
      try {
        const released = await releaseIngestWorkflowLock(held.lock, held.repository);
        if (!released.ok || !released.released) stop("failed", "issuer_lease_release_failed");
      } catch { stop("failed", "issuer_lease_release_failed"); }
    }
  }
}

async function defaultRepository(): Promise<SecTickerResolutionRepository> {
  const supabase = await import("../supabase.ts");
  return { select: supabase.supabaseSelect, rpc: supabase.supabaseRpc };
}
