import "server-only";

import { supabaseRpc } from "@/lib/supabase";

export type IngestWorkflowLock = {
  lockKey: string;
  lockOwner: string;
};

export async function acquireIngestWorkflowLock(
  lock: IngestWorkflowLock,
  ttlSeconds: number,
) {
  const result = await supabaseRpc("acquire_ingest_workflow_lock", {
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
) {
  const result = await supabaseRpc("renew_ingest_workflow_lock", {
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

export async function releaseIngestWorkflowLock(lock: IngestWorkflowLock) {
  const result = await supabaseRpc("release_ingest_workflow_lock", {
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
  const fallback = 60 * 60;
  return Math.max(60, Math.min(Number.isFinite(value) ? Math.trunc(value) : fallback, 6 * 60 * 60));
}
