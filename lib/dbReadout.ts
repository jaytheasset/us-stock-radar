import {
  currentReferenceTables,
  canonicalTables,
  eventScoringPolicy,
  taxonomyTickerFlow,
} from "@/lib/dbRegistry";
import { getServerEnv } from "@/lib/env";

export async function getDbReadout() {
  const counts = await Promise.all(currentReferenceTables.map((table) => countTable(table)));

  return {
    ok: counts.every((item) => item.ok),
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    eventScoringPolicy,
    taxonomyTickerFlow,
    canonicalTables,
    currentReference: counts,
  };
}

async function countTable(table: string) {
  const env = getServerEnv();

  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return {
      table,
      ok: false,
      status: 0,
      count: null,
      error: "Supabase env is missing",
    };
  }

  const url = new URL(`${env.supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}`);
  url.searchParams.set("select", "*");
  url.searchParams.set("limit", "0");

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        apikey: env.supabaseServiceRoleKey,
        Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
        Accept: "application/json",
        Prefer: "count=exact",
      },
    });
    const body = await response.text();
    const contentRange = response.headers.get("content-range") || "";
    const count = contentRange.includes("/")
      ? Number(contentRange.split("/").pop())
      : null;

    return {
      table,
      ok: response.ok,
      status: response.status,
      count: Number.isFinite(count) ? count : null,
      error: response.ok ? undefined : readError(body),
    };
  } catch (error) {
    return {
      table,
      ok: false,
      status: 0,
      count: null,
      error: error instanceof Error ? error.message : "Count request failed",
    };
  }
}

function readError(body: string) {
  try {
    const parsed = JSON.parse(body);
    return parsed.message || parsed.error || body.slice(0, 160);
  } catch {
    return body.slice(0, 160);
  }
}
