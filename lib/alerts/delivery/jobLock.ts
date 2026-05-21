import "server-only";

import { supabaseRpc } from "@/lib/supabase";

export type JobLockAcquireResult =
  | {
      ok: true;
      acquired: boolean;
      jobName: string;
      lockedBy: string;
    }
  | {
      ok: false;
      acquired: false;
      jobName: string;
      lockedBy: string;
      error: string;
    };

export async function acquireJobLock(
  jobName: string,
  ttlSeconds: number,
  lockedBy = createLockOwner(),
): Promise<JobLockAcquireResult> {
  const result = await supabaseRpc("acquire_alert_delivery_job_lock", {
    p_job_name: jobName,
    p_ttl_seconds: normalizeTtl(ttlSeconds),
    p_locked_by: lockedBy,
  });

  if (!result.ok) {
    return {
      ok: false,
      acquired: false,
      jobName,
      lockedBy,
      error: result.error || "Failed to acquire job lock.",
    };
  }

  return {
    ok: true,
    acquired: result.data === true,
    jobName,
    lockedBy,
  };
}

export async function releaseJobLock(jobName: string, lockedBy: string) {
  const result = await supabaseRpc("release_alert_delivery_job_lock", {
    p_job_name: jobName,
    p_locked_by: lockedBy,
  });

  return {
    ok: result.ok,
    released: result.data === true,
    error: result.error,
  };
}

export async function withJobLock<T>(
  jobName: string,
  options: {
    ttlSeconds: number;
    lockedBy?: string;
    useLock?: boolean;
  },
  fn: (lock: { lockedBy: string; locked: boolean }) => Promise<T>,
): Promise<T | { ok: false; locked: false; skipped: true; error: "LOCK_HELD"; lockedBy: string }> {
  const lockedBy = options.lockedBy || createLockOwner();
  if (options.useLock === false) {
    return fn({ lockedBy, locked: false });
  }

  const lock = await acquireJobLock(jobName, options.ttlSeconds, lockedBy);
  if (!lock.ok || !lock.acquired) {
    return {
      ok: false,
      locked: false,
      skipped: true,
      error: "LOCK_HELD",
      lockedBy,
    };
  }

  try {
    return await fn({ lockedBy, locked: true });
  } finally {
    await releaseJobLock(jobName, lockedBy);
  }
}

export function createLockOwner() {
  return `pid:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTtl(value: number) {
  return Math.max(1, Math.min(Number.isFinite(value) ? Math.trunc(value) : 300, 3600));
}
