import { NextRequest, NextResponse } from "next/server";
import { getServerEnv, redactUrl } from "@/lib/env";
import { runAccesswireNewsIngest } from "@/lib/newsIngest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const bodyRecord = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  const limit = readNumber(request.nextUrl.searchParams.get("limit"), bodyRecord.limit, 1, 20, 1);
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "true" || bodyRecord.dryRun === true;
  const force = request.nextUrl.searchParams.get("force") === "true" || bodyRecord.force === true;
  const sourceUniqueId = readString(request.nextUrl.searchParams.get("sourceUniqueId"), bodyRecord.sourceUniqueId);
  const result = await runAccesswireNewsIngestWithFallback({ limit, dryRun, force, sourceUniqueId });

  return NextResponse.json(result, {
    status: responseStatus(result),
  });
}

export async function GET(request: NextRequest) {
  const limit = readNumber(request.nextUrl.searchParams.get("limit"), null, 1, 20, 1);
  const dryRun = request.nextUrl.searchParams.get("dryRun") !== "false";
  const force = request.nextUrl.searchParams.get("force") === "true";
  const sourceUniqueId = readString(request.nextUrl.searchParams.get("sourceUniqueId"), null);
  const result = await runAccesswireNewsIngestWithFallback({ limit, dryRun, force, sourceUniqueId });

  return NextResponse.json(result, {
    status: responseStatus(result),
  });
}

type AccesswireIngestOptions = {
  limit: number;
  dryRun: boolean;
  force: boolean;
  sourceUniqueId?: string;
};

async function runAccesswireNewsIngestWithFallback(options: AccesswireIngestOptions) {
  const directResult = await runAccesswireNewsIngest(options);
  if (!shouldUseNasFallback(directResult)) return directResult;

  const fallbackResult = await runAccesswireNasBridge(options, directResult);
  if (fallbackResult.ok && fallbackResult.data) {
    return {
      ...fallbackResult.data,
      nas_fallback: {
        attempted: true,
        used: true,
        source: "ACCESSWIRE_INGEST_URL",
        url: fallbackResult.redactedUrl,
        direct_stage: readRecord(directResult)?.stage || null,
        direct_status: readRecord(directResult)?.status || null,
        bridge_status: fallbackResult.status,
      },
    };
  }

  return {
    ...readRecord(directResult),
    nas_fallback: {
      attempted: true,
      used: false,
      source: "ACCESSWIRE_INGEST_URL",
      url: fallbackResult.redactedUrl,
      bridge_status: fallbackResult.status,
      bridge_error: fallbackResult.error,
    },
  };
}

function shouldUseNasFallback(result: unknown) {
  const record = readRecord(result);
  return record?.ok === false && record.stage === "raw_fetch";
}

async function runAccesswireNasBridge(options: AccesswireIngestOptions, directResult: unknown) {
  const env = getServerEnv();
  const redactedUrl = redactUrl(env.accesswireIngestUrl);
  if (!env.accesswireIngestUrl) {
    return {
      ok: false,
      status: 0,
      redactedUrl,
      error: "ACCESSWIRE_INGEST_URL is not configured",
    };
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (env.nasIngestToken) {
    headers.Authorization = `Bearer ${env.nasIngestToken}`;
    headers["X-Ingest-Token"] = env.nasIngestToken;
  }

  try {
    const response = await timedFetch(env.accesswireIngestUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...options,
        source: "accesswire",
        fallbackFrom: "next_accesswire_direct_raw_fetch",
        directStatus: readRecord(directResult)?.status || null,
        directError: readRecord(directResult)?.error || null,
      }),
    });
    const data = await response.json().catch(() => null);
    const record = readRecord(data);
    const ok = response.ok && record?.ok !== false;

    return {
      ok,
      status: response.status,
      redactedUrl,
      data: record,
      error: ok ? undefined : readBridgeError(record, response.statusText || "Accesswire NAS bridge failed"),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      redactedUrl,
      error: error instanceof Error ? error.message : "Accesswire NAS bridge request failed",
    };
  }
}

async function timedFetch(input: string, init: RequestInit, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function responseStatus(result: unknown) {
  const record = readRecord(result);
  const stats = readRecord(record?.stats);
  if (record?.ok === true) return 200;
  if (
    (record?.stage === "complete" || record?.stage === "dry_run") &&
    readNumberValue(stats?.event_upserted_count) > 0
  ) {
    return 200;
  }
  return 502;
}

function readNumber(
  queryValue: string | null,
  bodyValue: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  const value = queryValue ?? bodyValue;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function readString(queryValue: string | null, bodyValue: unknown) {
  const value = queryValue ?? bodyValue;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readBridgeError(data: Record<string, unknown> | null, fallback: string) {
  if (!data) return fallback;
  if (typeof data.message === "string" && data.message.trim()) return data.message;
  if (typeof data.error === "string" && data.error.trim()) return data.error;
  return fallback;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
