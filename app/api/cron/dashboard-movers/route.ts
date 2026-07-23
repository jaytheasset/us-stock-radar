import { NextRequest, NextResponse } from "next/server";
import { dashboardV2Sessions } from "@/lib/dashboardV2Types";
import {
  getDashboardMoverLifecycle,
  isDashboardMoverFinalizationEligible,
} from "@/lib/dashboardV2MoverLifecycle";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: NextRequest) {
  return runDashboardMoverFinalizer(request);
}

export async function POST(request: NextRequest) {
  return runDashboardMoverFinalizer(request);
}

async function runDashboardMoverFinalizer(request: NextRequest) {
  const auth = authorizeCron(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status, headers: NO_STORE_HEADERS },
    );
  }

  const now = new Date();
  const eligibleSessions = dashboardV2Sessions.filter((session) => {
    const lifecycle = getDashboardMoverLifecycle(session, now);
    return isDashboardMoverFinalizationEligible(session, lifecycle, now);
  });

  if (!eligibleSessions.length) {
    return NextResponse.json(
      {
        ok: true,
        ranAt: now.toISOString(),
        status: "not_due",
        sessions: [],
      },
      { headers: NO_STORE_HEADERS },
    );
  }

  const results = await Promise.all(
    eligibleSessions.map(async (session) => {
      const url = new URL("/api/dashboard-v2/movers", request.nextUrl.origin);
      url.searchParams.set("mode", "gainers");
      url.searchParams.set("session", session);

      try {
        const response = await fetch(url, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const body = await response.json().catch(() => null);
        return {
          capturedAt: textValue(body?.capturedAt),
          finalized: body?.freshness === "final",
          freshness: textValue(body?.freshness) || null,
          ok: response.ok && body?.ok === true,
          session,
          status: response.status,
        };
      } catch {
        return {
          capturedAt: null,
          finalized: false,
          freshness: null,
          ok: false,
          session,
          status: 0,
        };
      }
    }),
  );

  const ok = results.every((result) => result.ok);
  return NextResponse.json(
    {
      ok,
      ranAt: now.toISOString(),
      status: results.every((result) => result.finalized)
        ? "finalized"
        : ok
          ? "waiting_for_provider"
          : "failed",
      sessions: results,
    },
    { status: ok ? 200 : 502, headers: NO_STORE_HEADERS },
  );
}

function authorizeCron(
  request: NextRequest,
): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.DASHBOARD_MOVERS_CRON_SECRET || process.env.CRON_SECRET || "";
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

function textValue(value: unknown) {
  return typeof value === "string" ? value : null;
}
