import { NextResponse } from "next/server";
import { envStatus, getServerEnv, redactUrl } from "@/lib/env";
import { probeEventsTable } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getServerEnv();
  const [renderHealth, supabase] = await Promise.all([
    fetchRenderHealth(env.appBaseUrl),
    probeEventsTable(),
  ]);

  return NextResponse.json({
    ok: renderHealth.ok && supabase.ok,
    env: envStatus(),
    targets: {
      appBaseUrl: redactUrl(env.appBaseUrl),
      supabaseUrl: redactUrl(env.supabaseUrl),
    },
    render: renderHealth,
    supabase,
  });
}

async function fetchRenderHealth(appBaseUrl: string) {
  if (!appBaseUrl) {
    return { ok: false, status: 0, error: "APP_BASE_URL is missing" };
  }

  try {
    const response = await fetch(`${appBaseUrl.replace(/\/$/, "")}/health`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      service: data?.service ?? null,
      timestamp: data?.timestamp ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
