import "server-only";

import { envStatus, getServerEnv, redactUrl } from "@/lib/env";
import { probeEventsTable } from "@/lib/supabase";

export async function getDetailedSystemHealth() {
  const env = getServerEnv();
  const [renderHealth, supabase] = await Promise.all([
    fetchRenderHealth(env.appBaseUrl),
    probeEventsTable(),
  ]);

  return {
    ok: renderHealth.ok && supabase.ok,
    env: envStatus(),
    targets: {
      appBaseUrl: redactUrl(env.appBaseUrl),
      supabaseUrl: redactUrl(env.supabaseUrl),
    },
    render: renderHealth,
    supabase,
  };
}

async function fetchRenderHealth(appBaseUrl: string) {
  if (!appBaseUrl) {
    return { ok: false, status: 0, error: "Render health is not configured." };
  }

  try {
    const response = await fetch(`${appBaseUrl.replace(/\/$/, "")}/health`, {
      cache: "no-store",
    });
    const data = await response.json().catch(() => null);
    return {
      ok: response.ok,
      status: response.status,
      service: typeof data?.service === "string" ? data.service : null,
      timestamp: typeof data?.timestamp === "string" ? data.timestamp : null,
    };
  } catch {
    return {
      ok: false,
      status: 0,
      error: "Render health is temporarily unavailable.",
    };
  }
}
