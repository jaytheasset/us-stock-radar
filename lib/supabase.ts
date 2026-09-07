import { getServerEnv } from "@/lib/env";
import { supabaseApiKeyHeaders } from "@/lib/supabaseKeys";
import {
  applyEventTickerRelationshipFilter,
  normalizeEventRows,
  normalizeEventTickers,
} from "@/lib/eventTickerLinkage";
import { liveFeedEventVisibilityOrFilter } from "@/lib/liveFeedEventPolicy";
import { buildEventAlertScoreFilters } from "@/lib/supabaseEventFilters";
import {
  readSecIssuerTickerCatalogRow,
  resolveIssuerLinkedTickersFromCatalog,
} from "@/lib/serviceTickerCatalogPolicy";

export type FetchEventsParams = {
  limit: number;
  page?: number;
  order?:
    | "detected_at.desc"
    | "published_at.desc.nullslast,detected_at.desc,id.desc"
    | "score.desc,detected_at.desc";
  ticker?: string;
  sourceCode?: string;
  impact?: string;
  eventType?: string;
  eventTypes?: readonly string[];
  sourceGroup?: "news" | "filings" | "market";
  marketScope?: "company" | "sector" | "theme" | "macro";
  marketScopes?: ReadonlyArray<"company" | "sector" | "theme" | "macro">;
  deliveryLevel?: "archive" | "feed" | "alert";
  excludeDeliveryLevel?: "archive" | "feed" | "alert";
  signal?: "bullish" | "bearish" | "volatile" | "neutral";
  alertOnly?: boolean;
  detectedAfter?: string;
  keywordIlike?: string;
  excludeTickerlessNonAlertMarketNews?: boolean;
  minimumScore?: number;
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

  return {
    baseUrl: cleanSupabaseUrl(env.supabaseUrl),
    key: env.supabaseSecretKey,
    keyError: env.supabaseSecretKeyError,
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
  const linkedTickers = params.ticker
    ? await resolveIssuerLinkedTickers([params.ticker])
    : [];
  const search = buildEventSearch(params, {
    limit: String(limit),
    offset: String((page - 1) * limit),
  }, linkedTickers);

  const result = await supabaseRest("events", search);
  const data = normalizeEventRows(result.data);

  return {
    ok: result.ok,
    status: result.status,
    data,
    count: data.length,
    total: result.count,
    error: result.error,
  };
}

export async function fetchEventCount(params: FetchEventCountParams): Promise<SupabaseCountResult> {
  const linkedTickers = params.ticker
    ? await resolveIssuerLinkedTickers([params.ticker])
    : [];
  const result = await supabaseRest(
    "events",
    buildEventSearch(params, {
      limit: "1",
      select: "id",
    }, linkedTickers),
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

export async function fetchLatestEventByAccession(accessionNumber: string) {
  const accession = accessionNumber.trim();
  if (!accession) {
    return { ok: false, status: 0, data: null, error: "Accession number is missing" };
  }

  const result = await supabaseRest("events", {
    select: "*",
    "metadata->>accession_number": `eq.${accession}`,
    order: "detected_at.desc",
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
  const linkedTickers = await resolveIssuerLinkedTickers([ticker]);
  const search: Record<string, string> = {
    select: "*",
    order: "detected_at.desc",
    limit: String(Math.max(1, Math.min(limit, 20))),
  };
  applyEventTickerRelationshipFilter(search, linkedTickers);

  if (sourceGroup) search.source_group = `eq.${sourceGroup}`;
  if (excludeId) search.id = `neq.${excludeId}`;

  const result = await supabaseRest("events", search);

  return {
    ok: result.ok,
    status: result.status,
    data: normalizeEventRows(result.data),
    error: result.error,
  };
}

export async function fetchRecentEventsByTickers({
  tickers,
  detectedAfter,
}: {
  tickers: string[];
  detectedAfter: string;
}) {
  const normalizedTickers = normalizeEventTickers(tickers).slice(0, 50);

  if (!normalizedTickers.length) {
    return { ok: true, status: 200, data: [], error: undefined };
  }

  const linkedTickers = await resolveIssuerLinkedTickers(normalizedTickers);
  const search = {
    select: "id,ticker,event_type,score,signal,impact,title,detected_at,published_at,delivery_level,source_group",
    detected_at: `gte.${detectedAfter}`,
    delivery_level: "neq.archive",
    order: "detected_at.desc",
    limit: "1000",
  };
  applyEventTickerRelationshipFilter(search, linkedTickers);
  const result = await supabaseRest("events", search);

  return {
    ok: result.ok,
    status: result.status,
    data: normalizeEventRows(result.data),
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
  linkedTickers: readonly string[] = [],
) {
  const search: Record<string, string> = {
    select: options.select || "*",
    order: params.order || "detected_at.desc",
    limit: options.limit,
  };

  if (options.offset) search.offset = options.offset;

  applyEventFilters(search, params);
  if (params.ticker) {
    applyEventTickerRelationshipFilter(search, linkedTickers);
  }

  return search;
}

function applyEventFilters(search: Record<string, string>, params: EventFilterParams) {
  if (params.sourceCode) search.source_code = `eq.${params.sourceCode}`;
  if (params.eventType) search.event_type = `eq.${params.eventType}`;
  if (params.eventTypes?.length) search.event_type = `in.(${params.eventTypes.join(",")})`;
  if (params.sourceGroup) search.source_group = `eq.${params.sourceGroup}`;
  if (params.marketScope) search.market_scope = `eq.${params.marketScope}`;
  if (params.marketScopes?.length) search.market_scope = `in.(${params.marketScopes.join(",")})`;
  if (params.impact) search.impact = `eq.${params.impact}`;
  if (params.signal) search.signal = `eq.${params.signal}`;
  Object.assign(search, buildEventAlertScoreFilters(params));
  if (!params.deliveryLevel && !params.alertOnly && params.excludeDeliveryLevel) {
    search.delivery_level = `neq.${params.excludeDeliveryLevel}`;
  }
  if (params.detectedAfter) search.detected_at = `gte.${params.detectedAfter}`;
  if (params.keywordIlike) search.keyword = `ilike.${params.keywordIlike}`;
  if (params.excludeTickerlessNonAlertMarketNews) {
    search.or = `(${liveFeedEventVisibilityOrFilter})`;
  }
}

async function resolveIssuerLinkedTickers(tickers: readonly string[]) {
  const normalizedTickers = normalizeEventTickers(tickers);
  if (!normalizedTickers.length) return [];

  const requestedRows = await supabaseRest("tickers", {
    select: "symbol,metadata",
    symbol:
      normalizedTickers.length === 1
        ? `eq.${normalizedTickers[0]}`
        : `in.(${normalizedTickers.join(",")})`,
    is_active: "eq.true",
    limit: String(normalizedTickers.length),
  });
  if (!requestedRows.ok || !Array.isArray(requestedRows.data)) {
    return normalizedTickers;
  }

  const issuerCiks = Array.from(
    new Set(
      requestedRows.data
        .map((row) => readSecIssuerTickerCatalogRow(row)?.issuerCik || "")
        .filter(Boolean),
    ),
  );
  if (!issuerCiks.length) return normalizedTickers;

  const siblingRows = await supabaseRest("tickers", {
    select: "symbol,name,exchange,asset_type,is_active,metadata",
    "metadata->>sec_cik":
      issuerCiks.length === 1
        ? `eq.${issuerCiks[0]}`
        : `in.(${issuerCiks.join(",")})`,
    is_active: "eq.true",
    asset_type: "in.(stock,adr_or_class)",
    "metadata->>provider": "eq.fmp",
    limit: "250",
  });
  if (!siblingRows.ok || !Array.isArray(siblingRows.data)) {
    return normalizedTickers;
  }

  return resolveIssuerLinkedTickersFromCatalog({
    requestedTickers: normalizedTickers,
    requestedSecIssuerRows: requestedRows.data,
    secIssuerCandidateRows: siblingRows.data,
    fmpTickerRows: siblingRows.data,
  });
}

async function supabaseRest(table: string, search: Record<string, string>) {
  const { baseUrl, key, keyError } = getSupabaseAuth();

  if (!baseUrl) {
    return { ok: false, status: 0, data: null, count: null, error: "SUPABASE_URL is missing" };
  }

  if (!key) {
    return {
      ok: false,
      status: 0,
      data: null,
      count: null,
      error: supabaseSecretConfigurationError(keyError),
    };
  }

  const url = new URL(`${baseUrl}/rest/v1/${table}`);
  for (const [name, value] of Object.entries(search)) {
    if (value) url.searchParams.set(name, value);
  }

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: supabaseApiKeyHeaders({
        apiKey: key,
        headers: {
          Accept: "application/json",
          Prefer: "count=exact",
        },
      }),
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
      error: readSupabaseFetchError(error),
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
  const { baseUrl, key, keyError } = getSupabaseAuth();

  if (!baseUrl) {
    return { ok: false, status: 0, data: null, error: "SUPABASE_URL is missing" };
  }

  if (!key) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: supabaseSecretConfigurationError(keyError),
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
      headers: supabaseApiKeyHeaders({
        apiKey: key,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Prefer:
            options.prefer ||
            "resolution=merge-duplicates,return=representation",
        },
      }),
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
      error: readSupabaseFetchError(error),
    };
  }
}

export async function supabaseUpdate(
  table: string,
  search: Record<string, string>,
  payload: Record<string, unknown>,
  options: Pick<SupabaseMutationOptions, "prefer"> = {},
) {
  const { baseUrl, key, keyError } = getSupabaseAuth();

  if (!baseUrl) {
    return { ok: false, status: 0, data: null, error: "SUPABASE_URL is missing" };
  }

  if (!key) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: supabaseSecretConfigurationError(keyError),
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
      headers: supabaseApiKeyHeaders({
        apiKey: key,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Prefer: options.prefer || "return=representation",
        },
      }),
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
      error: readSupabaseFetchError(error),
    };
  }
}

export async function supabaseDelete(table: string, search: Record<string, string>) {
  const { baseUrl, key, keyError } = getSupabaseAuth();

  if (!baseUrl) {
    return { ok: false, status: 0, data: null, error: "SUPABASE_URL is missing" };
  }

  if (!key) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: supabaseSecretConfigurationError(keyError),
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
      headers: supabaseApiKeyHeaders({
        apiKey: key,
        headers: {
          Accept: "application/json",
          Prefer: "return=representation",
        },
      }),
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
      error: readSupabaseFetchError(error),
    };
  }
}

export async function supabaseRpc(functionName: string, payload: Record<string, unknown>) {
  const { baseUrl, key, keyError } = getSupabaseAuth();

  if (!baseUrl) {
    return { ok: false, status: 0, data: null, error: "SUPABASE_URL is missing" };
  }

  if (!key) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: supabaseSecretConfigurationError(keyError),
    };
  }

  try {
    const response = await fetch(`${baseUrl}/rest/v1/rpc/${functionName}`, {
      method: "POST",
      cache: "no-store",
      headers: supabaseApiKeyHeaders({
        apiKey: key,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      }),
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
      error: readSupabaseFetchError(error),
    };
  }
}

function supabaseSecretConfigurationError(error: "wrong-role" | null) {
  return error === "wrong-role"
    ? "Supabase privileged API key has the wrong role"
    : "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY is missing";
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

function readSupabaseFetchError(error: unknown) {
  if (!(error instanceof Error)) return "Supabase request failed";
  if (/invalid header value/i.test(error.message)) {
    return "Supabase request failed because an environment variable contains an invalid header value.";
  }
  return "Supabase request failed";
}

function readCount(contentRange: string) {
  const value = contentRange.split("/").pop();
  if (!value || value === "*") return null;

  const count = Number(value);
  return Number.isFinite(count) ? count : null;
}
