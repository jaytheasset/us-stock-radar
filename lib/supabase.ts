import { getServerEnv } from "@/lib/env";

type FetchEventsParams = {
  limit: number;
  page?: number;
  ticker?: string;
  sourceCode?: string;
  impact?: string;
  eventType?: string;
  eventTypes?: string[];
  sourceGroup?: "news" | "filings" | "market";
  deliveryLevel?: "archive" | "feed" | "alert";
  signal?: "bullish" | "bearish" | "volatile" | "neutral";
  alertOnly?: boolean;
  detectedAfter?: string;
  keywordIlike?: string;
};

type FetchEventCountParams = Omit<FetchEventsParams, "limit" | "page">;

type EventFilterParams = Omit<FetchEventsParams, "limit" | "page">;

export type SupabaseCountResult = {
  ok: boolean;
  status: number;
  count: number | null;
  error?: string;
};

function cleanSupabaseUrl(value: string) {
  return value.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
}

function getSupabaseAuth() {
  const env = getServerEnv();
  const key = env.supabaseServiceRoleKey || env.supabaseAnonKey;

  return {
    baseUrl: cleanSupabaseUrl(env.supabaseUrl),
    key,
  };
}

export async function probeEventsTable() {
  const result = await supabaseRest("events", {
    select: "id",
    limit: "1",
  });

  return {
    ok: result.ok,
    status: result.status,
    rows: Array.isArray(result.data) ? result.data.length : 0,
    error: result.error,
  };
}

export async function fetchEvents(params: FetchEventsParams) {
  const limit = Math.max(1, Math.min(params.limit || 50, 100));
  const page = Math.max(1, params.page || 1);
  const search = buildEventSearch(params, {
    limit: String(limit),
    offset: String((page - 1) * limit),
    mode: "canonical",
  });

  const result = await supabaseRest("events", search);
  const finalResult = await retryWithLegacyEventFilters(result, params, {
    limit: String(limit),
    offset: String((page - 1) * limit),
  });

  return {
    ok: finalResult.ok,
    status: finalResult.status,
    data: Array.isArray(finalResult.data) ? finalResult.data : [],
    count: Array.isArray(finalResult.data) ? finalResult.data.length : 0,
    total: finalResult.count,
    error: finalResult.error,
  };
}

export async function fetchEventCount(params: FetchEventCountParams): Promise<SupabaseCountResult> {
  const result = await supabaseRest(
    "events",
    buildEventSearch(params, {
      limit: "1",
      mode: "canonical",
      select: "id",
    }),
  );
  const finalResult = await retryWithLegacyEventFilters(result, params, {
    limit: "1",
    select: "id",
  });

  return {
    ok: finalResult.ok,
    status: finalResult.status,
    count: finalResult.count ?? null,
    error: finalResult.error,
  };
}

export async function fetchEventById(id: string) {
  const result = await supabaseRest("events", {
    select: "*",
    id: `eq.${id}`,
    limit: "1",
  });

  const data = Array.isArray(result.data) ? result.data[0] || null : null;

  return {
    ok: result.ok && Boolean(data),
    status: result.status,
    data,
    error: result.error,
  };
}

type EventFilterMode = "canonical" | "legacy";

function buildEventSearch(
  params: EventFilterParams,
  options: {
    limit: string;
    offset?: string;
    mode: EventFilterMode;
    select?: string;
  },
) {
  const search: Record<string, string> = {
    select: options.select || "*",
    order: "detected_at.desc",
    limit: options.limit,
  };

  if (options.offset) search.offset = options.offset;

  applyEventFilters(search, params, options.mode);

  return search;
}

async function retryWithLegacyEventFilters(
  result: Awaited<ReturnType<typeof supabaseRest>>,
  params: EventFilterParams,
  options: {
    limit: string;
    offset?: string;
    select?: string;
  },
) {
  if (result.ok || !needsLegacyEventFilterRetry(params, result.error)) {
    return result;
  }

  return supabaseRest(
    "events",
    buildEventSearch(params, {
      ...options,
      mode: "legacy",
    }),
  );
}

function needsLegacyEventFilterRetry(params: EventFilterParams, error?: string) {
  const usesCanonicalOnlyFilter =
    Boolean(params.sourceGroup) ||
    Boolean(params.deliveryLevel) ||
    Boolean(params.alertOnly) ||
    Boolean(params.impact) ||
    Boolean(params.signal);

  if (!usesCanonicalOnlyFilter || !error) return false;

  return /column|schema|does not exist|could not find/i.test(error);
}

function applyEventFilters(search: Record<string, string>, params: EventFilterParams, mode: EventFilterMode) {
  if (params.ticker) search.ticker = `eq.${params.ticker.toUpperCase()}`;
  if (params.sourceCode) search.source_code = `eq.${params.sourceCode}`;
  if (params.eventType) search.event_type = `eq.${params.eventType}`;
  if (params.eventTypes?.length) search.event_type = `in.(${params.eventTypes.join(",")})`;
  if (params.sourceGroup) {
    search[mode === "canonical" ? "source_group" : "metadata->>source_group"] = `eq.${params.sourceGroup}`;
  }
  if (params.impact) search[mode === "canonical" ? "impact" : "impact_level"] = `eq.${params.impact}`;
  if (params.signal) {
    search[mode === "canonical" ? "signal" : "market_direction"] =
      mode === "canonical" ? `eq.${params.signal}` : legacySignalFilter(params.signal);
  }
  if (params.deliveryLevel) {
    const deliveryFilter = params.deliveryLevel === "alert" ? "eq.alert" : `eq.${params.deliveryLevel}`;
    search[mode === "canonical" ? "delivery_level" : "metadata->alert_policy->>visibility"] = deliveryFilter;
  }
  if (params.alertOnly) {
    search[mode === "canonical" ? "delivery_level" : "metadata->alert_policy->>visibility"] = "eq.alert";
  }
  if (params.detectedAfter) search.detected_at = `gte.${params.detectedAfter}`;
  if (params.keywordIlike) search.keyword = `ilike.${params.keywordIlike}`;
}

function legacySignalFilter(signal: NonNullable<EventFilterParams["signal"]>) {
  if (signal === "bullish") return "in.(bullish,up,positive)";
  if (signal === "bearish") return "in.(bearish,down,negative)";
  if (signal === "volatile") return "in.(volatile,volatility_watch,mixed)";
  return "eq.neutral";
}

async function supabaseRest(table: string, search: Record<string, string>) {
  const { baseUrl, key } = getSupabaseAuth();

  if (!baseUrl) {
    return { ok: false, status: 0, data: null, count: null, error: "SUPABASE_URL is missing" };
  }

  if (!key) {
    return {
      ok: false,
      status: 0,
      data: null,
      count: null,
      error: "A Supabase API key is missing",
    };
  }

  const url = new URL(`${baseUrl}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(search)) {
    if (value) url.searchParams.set(name, value);
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        Prefer: "count=exact",
      },
    });

    const body = await response.text();
    const data = parseBody(body);
    const contentRange = response.headers.get("content-range") || "";
    const count = readCount(contentRange);

    return {
      ok: response.ok,
      status: response.status,
      data,
      count,
      error: response.ok ? undefined : readError(data, response.statusText),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      count: null,
      error: error instanceof Error ? error.message : "Unknown Supabase error",
    };
  }
}

function parseBody(body: string) {
  if (!body) return null;

  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function readError(data: unknown, fallback: string) {
  if (!data) return fallback;
  if (typeof data === "string") return data;
  if (typeof data === "object" && "message" in data) {
    return String((data as { message?: unknown }).message || fallback);
  }
  return fallback;
}

function readCount(contentRange: string) {
  const value = contentRange.split("/").pop();
  if (!value || value === "*") return null;

  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}
