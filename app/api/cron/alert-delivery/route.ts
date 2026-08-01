import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { runAlertDeliveryScheduler } from "@/lib/alerts/delivery/runAlertDeliveryScheduler";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: NextRequest) {
  const auth = authorizeVercelCron(request);
  if (!auth.ok) return auth.response;
  return runCron(request, { scheduled: true });
}

// Kept for existing operator tooling. POST remains dry-run by default and
// supports the legacy alert-specific secret/header, while scheduled Vercel
// invocations use GET + CRON_SECRET only.
export async function POST(request: NextRequest) {
  const auth = authorizeManualRun(request);
  if (!auth.ok) return auth.response;
  return runCron(request, { scheduled: false });
}

async function runCron(
  request: NextRequest,
  { scheduled }: { scheduled: boolean },
) {
  const params = request.nextUrl.searchParams;
  const dryRunRequested =
    isTruthy(params.get("dryRun") || params.get("dry-run")) ||
    params.get("write") === "false";
  const writeRequested = scheduled
    ? !dryRunRequested
    : isTruthy(params.get("write")) || params.get("dryRun") === "false";
  const cronWriteEnabled =
    process.env.ALERT_DELIVERY_CRON_WRITE_ENABLED === "true";

  if (writeRequested && !cronWriteEnabled) {
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_WRITE_DISABLED",
        message:
          "Set ALERT_DELIVERY_CRON_WRITE_ENABLED=true before running the alert delivery cron in write mode.",
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const write = writeRequested && cronWriteEnabled;
  const runId = `cron:${Date.now()}:${randomUUID()}`;
  const result = await runAlertDeliveryScheduler({
    runId,
    recordRunLog: true,
    dryRun: !write,
    write,
    limit: readPositiveInt(params.get("limit"), 50, 250),
    queuedLimit: readPositiveInt(
      params.get("queuedLimit") || params.get("queued-limit"),
      50,
      250,
    ),
    publicTelegramLimit: readPositiveInt(
      params.get("publicTelegramLimit") ||
        params.get("public-telegram-limit"),
      50,
      250,
    ),
    calendarLimit: readPositiveInt(
      params.get("calendarLimit") || params.get("calendar-limit"),
      100,
      250,
    ),
    lookbackHours: readPositiveInt(
      params.get("lookbackHours") || params.get("lookback-hours"),
      6,
      24 * 30,
    ),
    lockTtlSeconds: readPositiveInt(
      params.get("lockTtlSeconds") || params.get("lock-ttl-seconds"),
      300,
      3600,
    ),
    force: !scheduled && isTruthy(params.get("force")),
    skipBatch: isTruthy(params.get("skipBatch") || params.get("skip-batch")),
    skipQueued: isTruthy(
      params.get("skipQueued") || params.get("skip-queued"),
    ),
    skipPublicTelegram: isTruthy(
      params.get("skipPublicTelegram") ||
        params.get("skip-public-telegram"),
    ),
    skipCalendar: isTruthy(
      params.get("skipCalendar") || params.get("skip-calendar"),
    ),
  });

  const status = result.lockSkipped
    ? "skipped"
    : result.ok
      ? "success"
      : "failed";
  return NextResponse.json(
    {
      ok: result.ok,
      status,
      reason: result.lockSkipped ? "LOCK_HELD" : undefined,
      runId: result.runId || runId,
      dryRun: result.dryRun,
      writeEnabled: result.write,
      retryBoundary:
        "Vercel does not retry failed cron invocations. Failed or uncertain external channel attempts require explicit reconciliation before requeueing.",
      summary: {
        batch: result.batch,
        queued: result.queued,
        publicTelegram: result.publicTelegram,
        calendar: result.calendar,
      },
      error: result.error || result.calendar?.error,
    },
    { status: result.ok ? 200 : 500, headers: NO_STORE_HEADERS },
  );
}

function authorizeVercelCron(request: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const authorization = request.headers.get("authorization") || "";
  if (!secret || authorization !== `Bearer ${secret}`) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "UNAUTHORIZED" },
        { status: 401, headers: NO_STORE_HEADERS },
      ),
    };
  }
  return { ok: true as const };
}

function authorizeManualRun(request: NextRequest) {
  const secret =
    process.env.ALERT_DELIVERY_CRON_SECRET || process.env.CRON_SECRET || "";
  const authorization = request.headers.get("authorization") || "";
  const headerSecret = request.headers.get("x-cron-secret") || "";
  if (
    !secret ||
    (authorization !== `Bearer ${secret}` && headerSecret !== secret)
  ) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { ok: false, error: "UNAUTHORIZED" },
        { status: 401, headers: NO_STORE_HEADERS },
      ),
    };
  }
  return { ok: true as const };
}

function isTruthy(value: string | null) {
  return value === "true" || value === "1" || value === "yes";
}

function readPositiveInt(
  value: string | null,
  fallback: number,
  max: number,
) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), max));
}
