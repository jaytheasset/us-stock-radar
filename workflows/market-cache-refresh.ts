import {
  FatalError,
  RetryableError,
  getStepMetadata,
} from "workflow";
import {
  renewIngestWorkflowLock,
  type IngestWorkflowLock,
} from "@/lib/ingestWorkflowLock";
import {
  MARKET_CACHE_COMPLETION_HOLD_SECONDS,
  MARKET_CACHE_WORKFLOW_LOCK_TTL_SECONDS,
  type MarketCacheRefreshPlan,
} from "@/lib/marketCacheSchedule";
import { refreshMarketPulseCache } from "@/lib/marketPulseRefresh";

export type MarketCacheRefreshWorkflowInput = IngestWorkflowLock & {
  origin: string;
  plan: MarketCacheRefreshPlan;
  themeBatches: string[][];
  triggerId: string;
};

type RefreshStepResult = {
  cache: string;
  count: number;
  kind: "pulse" | "sector" | "themes";
  range: string;
  target: string;
};

export async function marketCacheRefreshWorkflow(
  input: MarketCacheRefreshWorkflowInput,
) {
  "use workflow";

  console.log(
    `[marketCacheRefreshWorkflow] START triggerId=${input.triggerId} phase=${input.plan.marketPhase}`,
  );

  const results: RefreshStepResult[] = [];
  try {
    await ensureMarketCacheLockStep(input);

    if (input.plan.refreshMarketPulse) {
      results.push(await refreshMarketPulseStep());
    }

    if (input.plan.oneDaySector) {
      results.push(
        await refreshSectorPerformanceStep(
          input.origin,
          "1D",
          input.plan.oneDaySector,
        ),
      );
    }

    if (input.plan.refreshOneDayThemes) {
      for (const slugs of input.themeBatches) {
        await ensureMarketCacheLockStep(input);
        results.push(
          await refreshThemePerformanceStep(input.origin, "1D", slugs),
        );
      }
    }

    if (input.plan.rotatingTarget) {
      await ensureMarketCacheLockStep(input);
      results.push(
        await refreshSectorPerformanceStep(
          input.origin,
          input.plan.rotatingTarget.range,
          input.plan.rotatingTarget.sector,
        ),
      );
    }

    console.log(
      `[marketCacheRefreshWorkflow] DONE triggerId=${input.triggerId} refreshed=${results.length}`,
    );
    return {
      ok: true,
      triggerId: input.triggerId,
      plan: input.plan,
      results,
    };
  } finally {
    await holdMarketCacheLockStep(input);
  }
}
async function refreshMarketPulseStep(): Promise<RefreshStepResult> {
  "use step";

  const metadata = getStepMetadata();
  console.log(
    `[refreshMarketPulseStep] START stepId=${metadata.stepId} attempt=${metadata.attempt}`,
  );
  try {
    const result = await refreshMarketPulseCache();
    if (!result.ok) {
      throw new Error(
        `Market pulse refresh returned no cache writes: ${result.unavailable.map((item) => `${item.symbol}:${item.error}`).join(", ")}`,
      );
    }
    console.log(
      `[refreshMarketPulseStep] DONE stepId=${metadata.stepId} refreshed=${result.refreshed.length} unavailable=${result.unavailable.length}`,
    );
    return {
      cache: "write",
      count: result.refreshed.length,
      kind: "pulse",
      range: "1D",
      target: result.refreshed.join(","),
    };
  } catch (error) {
    console.error(
      `[refreshMarketPulseStep] FAIL stepId=${metadata.stepId} error=${error instanceof Error ? error.message : String(error)}`,
    );
    throw retryableError(
      error instanceof Error ? error.message : "Market pulse refresh failed",
      metadata.attempt,
    );
  }
}
refreshMarketPulseStep.maxRetries = 3;

async function ensureMarketCacheLockStep(lock: IngestWorkflowLock) {
  "use step";

  const metadata = getStepMetadata();
  console.log(
    `[ensureMarketCacheLockStep] START stepId=${metadata.stepId} attempt=${metadata.attempt} lockKey=${lock.lockKey}`,
  );
  const result = await renewIngestWorkflowLock(
    lock,
    MARKET_CACHE_WORKFLOW_LOCK_TTL_SECONDS,
  );
  if (!result.ok) {
    throw retryableError(
      `Could not renew market cache lock ${lock.lockKey}: ${result.error || "unknown Supabase error"}`,
      metadata.attempt,
    );
  }
  if (!result.renewed) {
    throw new FatalError(
      `Market cache lock ${lock.lockKey} expired or changed owner`,
    );
  }
  console.log(
    `[ensureMarketCacheLockStep] DONE stepId=${metadata.stepId} lockKey=${lock.lockKey}`,
  );
}
ensureMarketCacheLockStep.maxRetries = 3;

async function holdMarketCacheLockStep(lock: IngestWorkflowLock) {
  "use step";

  const metadata = getStepMetadata();
  console.log(
    `[holdMarketCacheLockStep] START stepId=${metadata.stepId} attempt=${metadata.attempt} lockKey=${lock.lockKey}`,
  );
  const result = await renewIngestWorkflowLock(
    lock,
    MARKET_CACHE_COMPLETION_HOLD_SECONDS,
  );
  if (!result.ok) {
    throw retryableError(
      `Could not settle market cache lock ${lock.lockKey}: ${result.error || "unknown Supabase error"}`,
      metadata.attempt,
    );
  }
  console.log(
    `[holdMarketCacheLockStep] DONE stepId=${metadata.stepId} lockKey=${lock.lockKey} held=${result.renewed}`,
  );
  return result.renewed;
}
holdMarketCacheLockStep.maxRetries = 3;

async function refreshSectorPerformanceStep(
  origin: string,
  range: string,
  sector: string,
): Promise<RefreshStepResult> {
  "use step";

  const metadata = getStepMetadata();
  const url = new URL("/api/market/sector-performance", origin);
  url.searchParams.set("range", range);
  url.searchParams.set("refresh", "1");
  url.searchParams.set("sector", sector);
  console.log(
    `[refreshSectorPerformanceStep] START stepId=${metadata.stepId} attempt=${metadata.attempt} range=${range} sector=${sector}`,
  );

  try {
    const cronSecret = process.env.CRON_SECRET || "";
    if (!cronSecret) {
      throw new FatalError("CRON_SECRET is missing in the Workflow step environment");
    }
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
    });
    const body = await readJsonRecord(response);
    const sectors = Array.isArray(body?.sectors) ? body.sectors : [];
    const requestedSector = sectors.find(
      (item) =>
        Boolean(item) &&
        typeof item === "object" &&
        (item as Record<string, unknown>).sector === sector,
    ) as Record<string, unknown> | undefined;
    const industries = Array.isArray(requestedSector?.industries)
      ? requestedSector.industries
      : [];

    if (
      !response.ok ||
      body?.ok !== true ||
      body.cacheWrite !== "ok" ||
      sectors.length === 0 ||
      industries.length === 0
    ) {
      throw new Error(
        `Sector refresh returned status=${response.status} cacheWrite=${String(body?.cacheWrite || "missing")} sectors=${sectors.length} industries=${industries.length}`,
      );
    }

    console.log(
      `[refreshSectorPerformanceStep] DONE stepId=${metadata.stepId} range=${range} sector=${sector} industries=${industries.length}`,
    );
    return {
      cache: String(body.cache || "bypass"),
      count: industries.length,
      kind: "sector",
      range,
      target: sector,
    };
  } catch (error) {
    console.error(
      `[refreshSectorPerformanceStep] FAIL stepId=${metadata.stepId} range=${range} sector=${sector} error=${error instanceof Error ? error.message : String(error)}`,
    );
    if (error instanceof RetryableError || error instanceof FatalError) {
      throw error;
    }
    throw retryableError(
      error instanceof Error ? error.message : "Sector refresh failed",
      metadata.attempt,
    );
  }
}
refreshSectorPerformanceStep.maxRetries = 3;

async function refreshThemePerformanceStep(
  origin: string,
  range: string,
  slugs: string[],
): Promise<RefreshStepResult> {
  "use step";

  const metadata = getStepMetadata();
  const url = new URL("/api/market/theme-performance", origin);
  url.searchParams.set("range", range);
  url.searchParams.set("refresh", "1");
  url.searchParams.set("subthemes", slugs.join(","));
  console.log(
    `[refreshThemePerformanceStep] START stepId=${metadata.stepId} attempt=${metadata.attempt} range=${range} count=${slugs.length}`,
  );

  try {
    const cronSecret = process.env.CRON_SECRET || "";
    if (!cronSecret) {
      throw new FatalError("CRON_SECRET is missing in the Workflow step environment");
    }
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
    });
    const body = await readJsonRecord(response);
    const subThemes = Array.isArray(body?.subThemes) ? body.subThemes : [];
    if (
      !response.ok ||
      body?.ok !== true ||
      body.cacheWrite !== "ok" ||
      subThemes.length !== slugs.length
    ) {
      throw new Error(
        `Theme refresh returned status=${response.status} cacheWrite=${String(body?.cacheWrite || "missing")} expected=${slugs.length} received=${subThemes.length}`,
      );
    }

    console.log(
      `[refreshThemePerformanceStep] DONE stepId=${metadata.stepId} range=${range} count=${subThemes.length}`,
    );
    return {
      cache: String(body.cache || "bypass"),
      count: subThemes.length,
      kind: "themes",
      range,
      target: slugs.join(","),
    };
  } catch (error) {
    console.error(
      `[refreshThemePerformanceStep] FAIL stepId=${metadata.stepId} range=${range} error=${error instanceof Error ? error.message : String(error)}`,
    );
    if (error instanceof RetryableError || error instanceof FatalError) {
      throw error;
    }
    throw retryableError(
      error instanceof Error ? error.message : "Theme refresh failed",
      metadata.attempt,
    );
  }
}
refreshThemePerformanceStep.maxRetries = 3;

async function readJsonRecord(response: Response) {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object"
    ? (body as Record<string, unknown>)
    : null;
}

function retryableError(message: string, attempt: number) {
  return new RetryableError(message, {
    retryAfter:
      Math.min(60, 5 * 2 ** Math.max(0, attempt - 1)) * 1_000,
  });
}
