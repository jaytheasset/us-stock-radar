import "server-only";

import { WORKFLOW_STEP_LEASE_TTL_SECONDS } from "@/lib/sourceWorkflowConfig";
import { supabaseRpc } from "@/lib/supabase";

export type IngestWorkflowLock = {
  lockKey: string;
  lockOwner: string;
};

type LockRepository = {
  rpc(name: string, payload: Record<string, unknown>): Promise<{ ok: boolean; data: unknown; error?: string }>;
};

export async function acquireIngestWorkflowLock(
  lock: IngestWorkflowLock,
  ttlSeconds: number,
  repository?: LockRepository,
) {
  const result = await (repository?.rpc ?? supabaseRpc)("acquire_ingest_workflow_lock", {
    p_lock_key: lock.lockKey,
    p_lock_owner: lock.lockOwner,
    p_ttl_seconds: normalizeTtl(ttlSeconds),
  });

  return {
    ok: result.ok,
    acquired: result.ok && result.data === true,
    error: result.error,
  };
}

export async function renewIngestWorkflowLock(
  lock: IngestWorkflowLock,
  ttlSeconds: number,
  repository?: LockRepository,
) {
  const result = await (repository?.rpc ?? supabaseRpc)("renew_ingest_workflow_lock", {
    p_lock_key: lock.lockKey,
    p_lock_owner: lock.lockOwner,
    p_ttl_seconds: normalizeTtl(ttlSeconds),
  });

  return {
    ok: result.ok,
    renewed: result.ok && result.data === true,
    error: result.error,
  };
}

export async function releaseIngestWorkflowLock(lock: IngestWorkflowLock, repository?: LockRepository) {
  const result = await (repository?.rpc ?? supabaseRpc)("release_ingest_workflow_lock", {
    p_lock_key: lock.lockKey,
    p_lock_owner: lock.lockOwner,
  });

  return {
    ok: result.ok,
    released: result.ok && result.data === true,
    error: result.error,
  };
}

function normalizeTtl(value: number) {
  return Math.max(
    60,
    Math.min(
      Number.isFinite(value)
        ? Math.trunc(value)
        : WORKFLOW_STEP_LEASE_TTL_SECONDS,
      WORKFLOW_STEP_LEASE_TTL_SECONDS,
    ),
  );
}
