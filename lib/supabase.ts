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
  const search: Record<string, string> = {
    select: "*",
    order: "detected_at.desc",
    limit: String(limit),
    offset: String((page - 1) * limit),
  };

  applyEventFilters(search, params);

  const result = await supabaseRest("events", search);

  return {
    ok: result.ok,
    status: result.status,
    data: Array.isArray(result.data) ? result.data : [],
    count: Array.isArray(result.data) ? result.data.length : 0,
    total: result.count,
    error: result.error,
  };
}

export async function fetchEventCount(params: FetchEventCountParams): Promise<SupabaseCountResult> {
  const search: Record<string, string> = {
    select: "id",
    limit: "1",
  };

  applyEventFilters(search, params);

  const result = await supabaseRest("events", search);

  return {
    ok: result.ok,
    status: result.status,
    count: result.count ?? null,
    error: result.error,
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

function applyEventFilters(search: Record<string, string>, params: EventFilterParams) {
  if (params.ticker) search.ticker = `eq.${params.ticker.toUpperCase()}`;
  if (params.sourceCode) search.source_code = `eq.${params.sourceCode}`;
  if (params.impact) search.impact = `eq.${params.impact}`;
  if (params.eventType) search.event_type = `eq.${params.eventType}`;
  if (params.eventTypes?.length) search.event_type = `in.(${params.eventTypes.join(",")})`;
  if (params.sourceGroup) search["metadata->>source_group"] = `eq.${params.sourceGroup}`;
  if (params.deliveryLevel) {
    search.delivery_level = params.deliveryLevel === "alert" ? "in.(alert,telegram)" : `eq.${params.deliveryLevel}`;
  }
  if (params.alertOnly) search["metadata->alert_policy->>visibility"] = "eq.alert";
  if (params.detectedAfter) search.detected_at = `gte.${params.detectedAfter}`;
  if (params.keywordIlike) search.keyword = `ilike.${params.keywordIlike}`;
}

async function supabaseRest(table: string, search: Record<string, string>) {
  const { baseUrl, key } = getSupabaseAuth();

  if (!baseUrl) {
    return { ok: false, status: 0, data: null, error: "SUPABASE_URL is missing" };
  }

  if (!key) {
    return {
      ok: false,
      status: 0,
      data: null,
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
