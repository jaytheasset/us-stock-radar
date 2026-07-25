export type MarketCacheLockAttempt = {
  ok: boolean;
  acquired: boolean;
  error?: string;
};

export type MarketCacheWorkflowStartResult<T> =
  | { status: "started"; value: T }
  | { status: "locked" }
  | { status: "failed"; error: string };

export async function startWithMarketCacheLock<T>(options: {
  acquire: () => Promise<MarketCacheLockAttempt>;
  onStartFailure: () => Promise<unknown>;
  start: () => Promise<T>;
}): Promise<MarketCacheWorkflowStartResult<T>> {
  const lock = await options.acquire();
  if (!lock.ok) {
    return {
      status: "failed",
      error: lock.error || "MARKET_CACHE_LOCK_UNAVAILABLE",
    };
  }
  if (!lock.acquired) {
    return { status: "locked" };
  }

  try {
    return {
      status: "started",
      value: await options.start(),
    };
  } catch (error) {
    await options.onStartFailure();
    return {
      status: "failed",
      error:
        error instanceof Error ? error.message : "WORKFLOW_START_FAILED",
    };
  }
}
