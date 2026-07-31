import { NextRequest, NextResponse } from "next/server";
import { runAlertDeliveryScheduler } from "@/lib/alerts/delivery/runAlertDeliveryScheduler";
import { runCalendarAlertDelivery } from "@/lib/alerts/calendarDelivery";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function POST(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status, headers: NO_STORE_HEADERS });
  }

  const params = request.nextUrl.searchParams;
  const writeRequested = isTruthy(params.get("write")) || params.get("dryRun") === "false";
  const cronWriteEnabled = process.env.ALERT_DELIVERY_CRON_WRITE_ENABLED === "true";

  if (writeRequested && !cronWriteEnabled) {
    return NextResponse.json(
      {
        ok: false,
        error: "CRON_WRITE_DISABLED",
        message: "Set ALERT_DELIVERY_CRON_WRITE_ENABLED=true before running the alert delivery cron in write mode.",
      },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const write = writeRequested && cronWriteEnabled;
  const runId = `cron:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;

  const [result, calendar] = await Promise.all([
    runAlertDeliveryScheduler({
      runId,
      recordRunLog: true,
      dryRun: !write,
      write,
      limit: readPositiveInt(params.get("limit"), 50, 250),
      queuedLimit: readPositiveInt(params.get("queuedLimit") || params.get("queued-limit"), 50, 250),
      lookbackHours: readPositiveInt(params.get("lookbackHours") || params.get("lookback-hours"), 6, 24 * 30),
      lockTtlSeconds: readPositiveInt(params.get("lockTtlSeconds") || params.get("lock-ttl-seconds"), 300, 3600),
      force: isTruthy(params.get("force")),
      skipBatch: isTruthy(params.get("skipBatch") || params.get("skip-batch")),
      skipQueued: isTruthy(params.get("skipQueued") || params.get("skip-queued")),
    }),
    runCalendarAlertDelivery({
      write,
      limit: readPositiveInt(params.get("calendarLimit") || params.get("calendar-limit"), 100, 250),
    }),
  ]);

  const ok = result.ok && calendar.ok;
  const status = result.lockSkipped ? "skipped" : ok ? "success" : "failed";
  return NextResponse.json(
    {
      ok,
      status,
      reason: result.lockSkipped ? "LOCK_HELD" : undefined,
      runId: result.runId || runId,
      dryRun: result.dryRun,
      writeEnabled: result.write,
      summary: {
        batch: result.batch,
        queued: result.queued,
        calendar,
      },
      error: result.error || calendar.error,
    },
    { status: ok ? 200 : 500, headers: NO_STORE_HEADERS },
  );
}

function authorizeCron(request: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.ALERT_DELIVERY_CRON_SECRET || process.env.CRON_SECRET || "";
  if (!secret) {
    return { ok: false, status: 500, error: "CRON_SECRET_MISSING" };
  }

  const authorization = request.headers.get("authorization") || "";
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const headerSecret = request.headers.get("x-cron-secret") || "";
  if (bearer === secret || headerSecret === secret) {
    return { ok: true };
  }

  return { ok: false, status: 401, error: "UNAUTHORIZED" };
}

function isTruthy(value: string | null) {
  return value === "true" || value === "1" || value === "yes";
}

function readPositiveInt(value: string | null, fallback: number, max: number) {
  const parsed = Number(value || fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.trunc(parsed), max));
}
