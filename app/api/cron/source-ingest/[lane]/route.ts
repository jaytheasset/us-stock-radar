import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { start } from "workflow/api";
import {
  acquireIngestWorkflowLock,
  releaseIngestWorkflowLock,
  type IngestWorkflowLock,
} from "@/lib/ingestWorkflowLock";
import { SEC_PRODUCTION_INGEST_SCHEDULE } from "@/lib/sources/sec/forms/common/forms";
import {
  SEC_WORKFLOW_CONFIG,
  SOURCE_INGEST_WORKFLOW_LANES,
  isSourceIngestCronLane,
} from "@/lib/sourceWorkflowConfig";
import {
  newsSourceIngestWorkflow,
  secSourceIngestWorkflow,
} from "@/workflows/source-ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const preferredRegion = "iad1";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

type RouteContext = {
  params: Promise<{ lane: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return startSourceWorkflows(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return startSourceWorkflows(request, context);
}

async function startSourceWorkflows(request: NextRequest, context: RouteContext) {
  const auth = authorizeCron(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status, headers: NO_STORE_HEADERS },
    );
  }

  const { lane } = await context.params;
  if (!isSourceIngestCronLane(lane)) {
    return NextResponse.json(
      { ok: false, error: "UNKNOWN_INGEST_LANE", lane },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const enabledLanes = readEnabledLanes();
  if (!enabledLanes.has(lane)) {
    return NextResponse.json(
      {
        ok: true,
        lane,
        status: "disabled",
        message:
          "Add this lane to SOURCE_INGEST_WORKFLOW_ENABLED_LANES after the migration and environment checks pass.",
      },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  }

  const now = new Date();
  const triggerMinute = now.toISOString().slice(0, 16);
  const results = lane === "sec"
    ? await startDueSecWorkflows(request, triggerMinute, now)
    : [await startNewsWorkflow(lane, triggerMinute)];
  const failed = results.filter((result) => result.status === "failed");
  const started = results.filter((result) => result.status === "started");

  console.log(
    `[source-ingest-cron] lane=${lane} triggerMinute=${triggerMinute} started=${started.length} failed=${failed.length}`,
  );

  return NextResponse.json(
    {
      ok: failed.length === 0,
      lane,
      triggeredAt: now.toISOString(),
      status:
        failed.length > 0
          ? "failed"
          : started.length > 0
            ? "started"
            : "not_due_or_locked",
      results,
    },
    {
      status: failed.length > 0 ? 503 : 200,
      headers: NO_STORE_HEADERS,
    },
  );
}

async function startDueSecWorkflows(
  request: NextRequest,
  triggerMinute: string,
  now: Date,
) {
  const requestedGroup = request.nextUrl.searchParams.get("group")?.trim() || "";
  const runAll = isTruthy(request.nextUrl.searchParams.get("all"));
  const groups = SEC_PRODUCTION_INGEST_SCHEDULE.filter((group) => {
    if (requestedGroup) return group.id === requestedGroup;
    if (runAll) return true;
    return isSecGroupDue(group, now);
  });

  if (requestedGroup && groups.length === 0) {
    return [
      {
        status: "failed" as const,
        groupId: requestedGroup,
        error: "UNKNOWN_SEC_INGEST_GROUP",
      },
    ];
  }

  const results = [];
  for (const group of groups) {
    const lock = createLock(`source-ingest:sec:${group.id}`);
    const lockResult = await acquireIngestWorkflowLock(
      lock,
      SEC_WORKFLOW_CONFIG.lockTtlSeconds,
    );
    if (!lockResult.ok) {
      results.push({
        status: "failed" as const,
        groupId: group.id,
        error: lockResult.error || "INGEST_LOCK_UNAVAILABLE",
      });
      continue;
    }
    if (!lockResult.acquired) {
      results.push({
        status: "locked" as const,
        groupId: group.id,
        reason: "DUPLICATE_OR_OVERLAPPING_RUN",
      });
      continue;
    }

    const triggerId = `sec:${group.id}:${triggerMinute}Z`;
    try {
      const run = await start(secSourceIngestWorkflow, [
        {
          ...lock,
          triggerId,
          groupId: group.id,
        },
      ]);
      results.push({
        status: "started" as const,
        groupId: group.id,
        triggerId,
        runId: run.runId,
      });
    } catch (error) {
      await releaseIngestWorkflowLock(lock);
      results.push({
        status: "failed" as const,
        groupId: group.id,
        triggerId,
        error: error instanceof Error ? error.message : "WORKFLOW_START_FAILED",
      });
    }
  }
  return results;
}

async function startNewsWorkflow(
  lane: keyof typeof SOURCE_INGEST_WORKFLOW_LANES,
  triggerMinute: string,
) {
  const config = SOURCE_INGEST_WORKFLOW_LANES[lane];
  const lock = createLock(`source-ingest:${lane}`);
  const lockResult = await acquireIngestWorkflowLock(lock, config.lockTtlSeconds);
  if (!lockResult.ok) {
    return {
      status: "failed" as const,
      error: lockResult.error || "INGEST_LOCK_UNAVAILABLE",
    };
  }
  if (!lockResult.acquired) {
    return {
      status: "locked" as const,
      reason: "DUPLICATE_OR_OVERLAPPING_RUN",
    };
  }

  const triggerId = `${lane}:${triggerMinute}Z`;
  try {
    const run = await start(newsSourceIngestWorkflow, [
      {
        ...lock,
        triggerId,
        lane,
      },
    ]);
    return {
      status: "started" as const,
      triggerId,
      runId: run.runId,
      sourceCount: config.sourceIds.length,
    };
  } catch (error) {
    await releaseIngestWorkflowLock(lock);
    return {
      status: "failed" as const,
      triggerId,
      error: error instanceof Error ? error.message : "WORKFLOW_START_FAILED",
    };
  }
}

function isSecGroupDue(
  group: (typeof SEC_PRODUCTION_INGEST_SCHEDULE)[number],
  date: Date,
) {
  const minute = date.getUTCMinutes();
  const normalized =
    ((minute - group.minuteOffset) % group.cadenceMinutes + group.cadenceMinutes) %
    group.cadenceMinutes;
  return normalized === 0;
}

function createLock(lockKey: string): IngestWorkflowLock {
  return {
    lockKey,
    lockOwner: `cron:${randomUUID()}`,
  };
}

function authorizeCron(
  request: NextRequest,
): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) {
    return { ok: false, status: 500, error: "CRON_SECRET_MISSING" };
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const headerSecret = request.headers.get("x-cron-secret") || "";
  if (safeSecretEqual(bearer, secret) || safeSecretEqual(headerSecret, secret)) {
    return { ok: true };
  }

  return { ok: false, status: 401, error: "UNAUTHORIZED" };
}

function safeSecretEqual(candidate: string, expected: string) {
  if (!candidate || candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

function isTruthy(value: string | null) {
  return value === "true" || value === "1" || value === "yes";
}

function readEnabledLanes() {
  return new Set(
    (process.env.SOURCE_INGEST_WORKFLOW_ENABLED_LANES || "")
      .split(",")
      .map((value) => value.trim())
      .filter(isSourceIngestCronLane),
  );
}
