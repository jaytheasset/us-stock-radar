import "server-only";

import { randomUUID } from "node:crypto";
import {
  acquireIngestWorkflowLock,
  releaseIngestWorkflowLock,
} from "@/lib/ingestWorkflowLock";
import { runGlobeNewsIngest } from "@/lib/newsIngest";
import { WORKFLOW_STEP_LEASE_TTL_SECONDS } from "@/lib/sourceWorkflowConfig";
import { supabaseRpc } from "@/lib/supabase";
import { AdminApiError } from "./api";

const GLOBE_ADMIN_LOCK_KEY = "admin:source-ingest:globe";
const ALLOWED_LIMITS = new Set([1, 5, 12, 20]);

export async function runAdminGlobeIngest(input: {
  actorUserId: string;
  force: unknown;
  forceConfirmation: unknown;
  limit: unknown;
  reason: unknown;
  requestId: string;
}) {
  const reason = readText(input.reason).slice(0, 2000);
  const limit = Number(input.limit);
  const force = input.force === true;
  if (reason.length < 4) {
    throw new AdminApiError(
      "ADMIN_REASON_REQUIRED",
      "Enter a reason of at least four characters.",
    );
  }
  if (!ALLOWED_LIMITS.has(limit)) {
    throw new AdminApiError(
      "ADMIN_SOURCE_RUN_LIMIT_INVALID",
      "Choose one of the supported ingest limits.",
    );
  }
  if (
    force &&
    readText(input.forceConfirmation).toUpperCase() !== "FORCE REANALYZE"
  ) {
    throw new AdminApiError(
      "ADMIN_SOURCE_RUN_CONFIRMATION_REQUIRED",
      "Type FORCE REANALYZE to confirm forced analysis.",
    );
  }

  await recordAudit({
    actorUserId: input.actorUserId,
    force,
    limit,
    phase: "started",
    reason,
    requestId: input.requestId,
    result: null,
  });

  const lock = {
    lockKey: GLOBE_ADMIN_LOCK_KEY,
    lockOwner: randomUUID(),
  };
  const acquired = await acquireIngestWorkflowLock(
    lock,
    WORKFLOW_STEP_LEASE_TTL_SECONDS,
  );
  if (!acquired.ok) {
    await recordAudit({
      actorUserId: input.actorUserId,
      force,
      limit,
      phase: "failed",
      reason,
      requestId: input.requestId,
      result: { error: "lock_unavailable" },
    });
    throw new AdminApiError(
      "ADMIN_SOURCE_RUN_LOCK_UNAVAILABLE",
      "The ingest lock is temporarily unavailable.",
      503,
    );
  }
  if (!acquired.acquired) {
    await recordAudit({
      actorUserId: input.actorUserId,
      force,
      limit,
      phase: "blocked",
      reason,
      requestId: input.requestId,
      result: { error: "already_running" },
    });
    throw new AdminApiError(
      "ADMIN_SOURCE_RUN_ALREADY_RUNNING",
      "A GlobeNewswire ingest is already running.",
      409,
    );
  }

  try {
    const result = await runGlobeNewsIngest({
      dryRun: false,
      force,
      limit,
    });
    const serialized = toJsonRecord(result);
    const succeeded =
      result.ok ||
      ((result.stage === "complete" || result.stage === "dry_run") &&
        (result.stats?.event_upserted_count || 0) > 0);
    await recordAudit({
      actorUserId: input.actorUserId,
      force,
      limit,
      phase: succeeded ? "succeeded" : "failed",
      reason,
      requestId: input.requestId,
      result: serialized,
    });
    if (!succeeded) {
      throw new AdminApiError(
        "ADMIN_SOURCE_RUN_FAILED",
        "GlobeNewswire ingest completed with a source or analysis failure.",
        502,
      );
    }
    return serialized;
  } catch (error) {
    if (error instanceof AdminApiError) throw error;
    await recordAudit({
      actorUserId: input.actorUserId,
      force,
      limit,
      phase: "failed",
      reason,
      requestId: input.requestId,
      result: {
        error: error instanceof Error ? error.message.slice(0, 500) : "unknown",
      },
    });
    throw error;
  } finally {
    await releaseIngestWorkflowLock(lock).catch(() => undefined);
  }
}

async function recordAudit(input: {
  actorUserId: string;
  force: boolean;
  limit: number;
  phase: "blocked" | "failed" | "started" | "succeeded";
  reason: string;
  requestId: string;
  result: Record<string, unknown> | null;
}) {
  const result = await supabaseRpc("admin_record_source_run_audit", {
    p_actor_user_id: input.actorUserId,
    p_force: input.force,
    p_limit: input.limit,
    p_phase: input.phase,
    p_reason: input.reason,
    p_request_id: input.requestId,
    p_result: input.result,
  });
  if (!result.ok) {
    throw new Error(result.error || "ADMIN_SOURCE_RUN_AUDIT_FAILED");
  }
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
