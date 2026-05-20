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
  marketScope?: "company" | "sector" | "theme" | "macro";
  marketScopes?: Array<"company" | "sector" | "theme" | "macro">;
  deliveryLevel?: "archive" | "feed" | "alert";
  excludeDeliveryLevel?: "archive" | "feed" | "alert";
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

type SupabaseMutationOptions = {
  onConflict?: string;
  prefer?: string;
};

function cleanSupabaseUrl(value: string) {
  return value.replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
}

function getSupabaseAuth() {
  const env = getServerEnv();
  const serviceKey =
    env.supabaseServiceRoleKey && !env.supabaseServiceRoleKey.startsWith("sb_secret_")
      ? env.supabaseServiceRoleKey
      : "";
  const key = serviceKey || env.supabaseAnonKey;

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
  });

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
  const result = await supabaseRest(
    "events",
    buildEventSearch(params, {
      limit: "1",
      select: "id",
    }),
  );

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

export async function fetchEventAnalysis(eventId: string) {
  const result = await supabaseRest("event_analysis", {
    select: "*",
    event_id: `eq.${eventId}`,
    limit: "1",
  });

  const data = Array.isArray(result.data) ? result.data[0] || null : null;

  return {
    ok: result.ok,
    status: result.status,
    data,
    error: result.error,
  };
}

export async function fetchEventTickers(eventId: string) {
  const result = await supabaseRest("event_tickers", {
    select: "*",
    event_id: `eq.${eventId}`,
    order: "sort_order.asc",
    limit: "50",
  });

  return {
    ok: result.ok,
    status: result.status,
    data: Array.isArray(result.data) ? result.data : [],
    error: result.error,
  };
}

export async function fetchEventsByTicker({
  ticker,
  sourceGroup,
  excludeId,
  limit = 4,
}: {
  ticker: string;
  sourceGroup?: "news" | "filings" | "market";
  excludeId?: string;
  limit?: number;
}) {
  const search: Record<string, string> = {
    select: "*",
    ticker: `eq.${ticker.toUpperCase()}`,
    order: "detected_at.desc",
    limit: String(Math.max(1, Math.min(limit, 20))),
  };

  if (sourceGroup) search.source_group = `eq.${sourceGroup}`;
  if (excludeId) search.id = `neq.${excludeId}`;

  const result = await supabaseRest("events", search);

  return {
    ok: result.ok,
    status: result.status,
    data: Array.isArray(result.data) ? result.data : [],
    error: result.error,
  };
}

function buildEventSearch(
  params: EventFilterParams,
  options: {
    limit: string;
    offset?: string;
    select?: string;
  },
) {
  const search: Record<string, string> = {
    select: options.select || "*",
    order: "detected_at.desc",
    limit: options.limit,
  };

  if (options.offset) search.offset = options.offset;

  applyEventFilters(search, params);

  return search;
}

function applyEventFilters(search: Record<string, string>, params: EventFilterParams) {
  if (params.ticker) search.ticker = `eq.${params.ticker.toUpperCase()}`;
  if (params.sourceCode) search.source_code = `eq.${params.sourceCode}`;
  if (params.eventType) search.event_type = `eq.${params.eventType}`;
  if (params.eventTypes?.length) search.event_type = `in.(${params.eventTypes.join(",")})`;
  if (params.sourceGroup) search.source_group = `eq.${params.sourceGroup}`;
  if (params.marketScope) search.market_scope = `eq.${params.marketScope}`;
  if (params.marketScopes?.length) search.market_scope = `in.(${params.marketScopes.join(",")})`;
  if (params.impact) search.impact = `eq.${params.impact}`;
  if (params.signal) search.signal = `eq.${params.signal}`;
  if (params.deliveryLevel) {
    const deliveryFilter = params.deliveryLevel === "alert" ? "eq.alert" : `eq.${params.deliveryLevel}`;
    search.delivery_level = deliveryFilter;
  }
  if (!params.deliveryLevel && params.excludeDeliveryLevel) {
    search.delivery_level = `neq.${params.excludeDeliveryLevel}`;
  }
  if (params.alertOnly) search.delivery_level = "eq.alert";
  if (params.detectedAfter) search.detected_at = `gte.${params.detectedAfter}`;
  if (params.keywordIlike) search.keyword = `ilike.${params.keywordIlike}`;
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

export async function supabaseSelect(table: string, search: Record<string, string>) {
  return supabaseRest(table, search);
}

export async function supabaseUpsert(
  table: string,
  payload: Record<string, unknown> | Array<Record<string, unknown>>,
  options: SupabaseMutationOptions = {},
) {
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
  if (options.onConflict) {
    url.searchParams.set("on_conflict", options.onConflict);
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: options.prefer || "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(payload),
    });

    const body = await response.text();
    const data = parseBody(body);

    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : readError(data, response.statusText),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : "Unknown Supabase error",
    };
  }
}

export async function supabaseUpdate(
  table: string,
  search: Record<string, string>,
  payload: Record<string, unknown>,
  options: Pick<SupabaseMutationOptions, "prefer"> = {},
) {
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
      method: "PATCH",
      cache: "no-store",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Prefer: options.prefer || "return=representation",
      },
      body: JSON.stringify(payload),
    });

    const body = await response.text();
    const data = parseBody(body);

    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : readError(data, response.statusText),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: error instanceof Error ? error.message : "Unknown Supabase error",
    };
  }
}

export async function supabaseDelete(table: string, search: Record<string, string>) {
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
      method: "DELETE",
      cache: "no-store",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        Prefer: "return=representation",
      },
    });

    const body = await response.text();
    const data = parseBody(body);

    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? undefined : readError(data, response.statusText),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null,
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
