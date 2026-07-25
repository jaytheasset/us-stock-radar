import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import { authorizeMarketCacheCron } from "@/lib/marketCacheCronAuth";
import {
  acquireIngestWorkflowLock,
  releaseIngestWorkflowLock,
  type IngestWorkflowLock,
} from "@/lib/ingestWorkflowLock";
import {
  MARKET_CACHE_WORKFLOW_LOCK_TTL_SECONDS,
  getMarketCacheRefreshPlan,
  splitMarketCacheThemeBatches,
} from "@/lib/marketCacheSchedule";
import { startWithMarketCacheLock } from "@/lib/marketCacheWorkflowStarter";
import {
  sectorMappings,
  themeSubThemes,
} from "@/lib/taxonomyRegistry";
import { marketCacheRefreshWorkflow } from "@/workflows/market-cache-refresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};
const MARKET_CACHE_LOCK_KEY = "market-cache:group-snapshots";

export async function GET(request: NextRequest) {
  const authorization = authorizeMarketCacheCron(request);
  if (!authorization.ok) {
    return NextResponse.json(
      { ok: false, error: authorization.error },
      {
        status: authorization.status,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  const now = new Date();
  const sectors = Array.from(
    new Set(sectorMappings.map((mapping) => mapping.sector)),
  );
  const plan = getMarketCacheRefreshPlan(now, sectors);
  if (
    !plan.oneDaySector &&
    !plan.refreshMarketPulse &&
    !plan.refreshOneDayThemes &&
    !plan.rotatingTarget
  ) {
    return NextResponse.json(
      {
        ok: true,
        status: "not_due",
        triggeredAt: now.toISOString(),
        plan,
      },
      { headers: NO_STORE_HEADERS },
    );
  }

  const lock: IngestWorkflowLock = {
    lockKey: MARKET_CACHE_LOCK_KEY,
    lockOwner: `cron:${randomUUID()}`,
  };
  const triggerId = `market-cache:${plan.slotId}`;
  const startResult = await startWithMarketCacheLock({
    acquire: () =>
      acquireIngestWorkflowLock(
        lock,
        MARKET_CACHE_WORKFLOW_LOCK_TTL_SECONDS,
      ),
    onStartFailure: () => releaseIngestWorkflowLock(lock),
    start: () =>
      start(marketCacheRefreshWorkflow, [
        {
          ...lock,
          origin: request.nextUrl.origin,
          plan,
          themeBatches: splitMarketCacheThemeBatches(
            themeSubThemes.map((subTheme) => subTheme.slug),
          ),
          triggerId,
        },
      ]),
  });

  if (startResult.status === "locked") {
    return NextResponse.json(
      {
        ok: true,
        status: "locked",
        reason: "DUPLICATE_OR_OVERLAPPING_RUN",
        triggeredAt: now.toISOString(),
        plan,
      },
      { headers: NO_STORE_HEADERS },
    );
  }
  if (startResult.status === "failed") {
    return NextResponse.json(
      {
        ok: false,
        status: "failed",
        triggerId,
        error: startResult.error,
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  console.log(
    `[market-cache-cron] STARTED triggerId=${triggerId} runId=${startResult.value.runId}`,
  );
  return NextResponse.json(
    {
      ok: true,
      status: "started",
      triggerId,
      runId: startResult.value.runId,
      triggeredAt: now.toISOString(),
      plan,
    },
    { headers: NO_STORE_HEADERS },
  );
}
