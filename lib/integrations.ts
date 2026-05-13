import { XMLParser } from "fast-xml-parser";
import { getServerEnv } from "@/lib/env";
import { probeEventsTable } from "@/lib/supabase";

type IntegrationResult = {
  key: string;
  label: string;
  ok: boolean;
  status?: number;
  detail?: string;
  error?: string;
};

type SecFiling = {
  title: string;
  link: string;
  updated: string;
  summary: string;
};

export type MarketBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const defaultTimeoutMs = 15000;

export async function probeAllIntegrations() {
  const [
    render,
    supabase,
    sec,
    fmp,
    polygon,
    openai,
    telegram,
    webPush,
  ] = await Promise.all([
    probeRender(),
    probeSupabase(),
    probeSec(),
    probeFmp(),
    probePolygon(),
    probeOpenAI(),
    probeTelegram(),
    probeWebPush(),
  ]);

  return [render, supabase, sec, fmp, polygon, openai, telegram, webPush];
}

export async function probeRender(): Promise<IntegrationResult> {
  const env = getServerEnv();
  if (!env.appBaseUrl) return missing("render", "Render API", "APP_BASE_URL");

  try {
    const response = await timedFetch(`${env.appBaseUrl.replace(/\/$/, "")}/health`);
    const data = await response.json().catch(() => null);
    return {
      key: "render",
      label: "Render API",
      ok: response.ok,
      status: response.status,
      detail: data?.service || "Health endpoint",
      error: response.ok ? undefined : response.statusText,
    };
  } catch (error) {
    return failed("render", "Render API", error);
  }
}

export async function probeSupabase(): Promise<IntegrationResult> {
  const result = await probeEventsTable();
  return {
    key: "supabase",
    label: "Supabase",
    ok: result.ok,
    status: result.status,
    detail: result.ok ? `${result.rows} event probe row` : undefined,
    error: result.error,
  };
}

export async function probeSec(): Promise<IntegrationResult> {
  const result = await fetchSecCompanyTickers("");
  return {
    key: "sec",
    label: "SEC EDGAR",
    ok: result.ok,
    status: result.status,
    detail: result.ok ? `${result.count} tickers indexed` : undefined,
    error: result.error,
  };
}

export async function probeFmp(): Promise<IntegrationResult> {
  const result = await fetchFmpQuote("AAPL");
  return {
    key: "fmp",
    label: "FMP",
    ok: result.ok,
    status: result.status,
    detail: result.ok ? "AAPL quote reachable" : undefined,
    error: result.error,
  };
}

export async function probePolygon(): Promise<IntegrationResult> {
  const result = await fetchPolygonTicker("AAPL");
  return {
    key: "polygon",
    label: "Polygon",
    ok: result.ok,
    status: result.status,
    detail: result.ok ? result.data?.name || "AAPL ticker reachable" : undefined,
    error: result.error,
  };
}

export async function probeOpenAI(): Promise<IntegrationResult> {
  const env = getServerEnv();
  if (!env.openAiApiKey) return missing("openai", "OpenAI", "OPENAI_API_KEY");

  try {
    const response = await timedFetch("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${env.openAiApiKey}`,
        Accept: "application/json",
      },
    });
    const data = await response.json().catch(() => null);
    return {
      key: "openai",
      label: "OpenAI",
      ok: response.ok,
      status: response.status,
      detail: response.ok ? `${data?.data?.length ?? 0} models visible` : undefined,
      error: response.ok ? undefined : readError(data, response.statusText),
    };
  } catch (error) {
    return failed("openai", "OpenAI", error);
  }
}

export async function probeTelegram(): Promise<IntegrationResult> {
  const env = getServerEnv();
  if (!env.telegramBotToken) {
    return missing("telegram", "Telegram", "TELEGRAM_BOT_TOKEN");
  }

  try {
    const response = await timedFetch(
      `https://api.telegram.org/bot${env.telegramBotToken}/getMe`,
    );
    const data = await response.json().catch(() => null);
    return {
      key: "telegram",
      label: "Telegram",
      ok: Boolean(response.ok && data?.ok),
      status: response.status,
      detail: data?.result?.username ? `@${data.result.username}` : undefined,
      error: response.ok && data?.ok ? undefined : readError(data, response.statusText),
    };
  } catch (error) {
    return failed("telegram", "Telegram", error);
  }
}

export async function probeWebPush(): Promise<IntegrationResult> {
  const env = getServerEnv();
  const missingKeys = [
    ["WEB_PUSH_VAPID_PUBLIC_KEY", env.webPushVapidPublicKey],
    ["WEB_PUSH_VAPID_PRIVATE_KEY", env.webPushVapidPrivateKey],
    ["WEB_PUSH_VAPID_SUBJECT", env.webPushVapidSubject],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return {
    key: "web-push",
    label: "Web Push",
    ok: missingKeys.length === 0,
    detail: missingKeys.length === 0 ? "VAPID config present" : undefined,
    error: missingKeys.length ? `Missing ${missingKeys.join(", ")}` : undefined,
  };
}

export async function fetchFmpQuote(symbol: string) {
  const env = getServerEnv();
  if (!env.fmpApiKey) {
    return { ok: false, status: 0, data: null, error: "FMP_API_KEY is missing" };
  }

  const cleanSymbol = normalizeSymbol(symbol);
  const url = new URL("https://financialmodelingprep.com/stable/quote");
  url.searchParams.set("symbol", cleanSymbol);
  url.searchParams.set("apikey", env.fmpApiKey);

  return fetchJson(url);
}

export async function fetchFmpQuotes(symbols: string[]) {
  const env = getServerEnv();
  if (!env.fmpApiKey) {
    return { ok: false, status: 0, data: null, error: "FMP_API_KEY is missing" };
  }

  const cleanSymbols = normalizeSymbols(symbols);
  if (cleanSymbols.length <= 1) {
    return fetchFmpQuote(cleanSymbols[0] || "AAPL");
  }

  if (env.fmpBatchQuoteEnabled) {
    const batchUrl = new URL("https://financialmodelingprep.com/stable/batch-quote");
    batchUrl.searchParams.set("symbols", cleanSymbols.join(","));
    batchUrl.searchParams.set("apikey", env.fmpApiKey);
    const batchResult = await fetchJson(batchUrl);

    if (batchResult.ok) {
      return {
        ...batchResult,
        mode: "batch",
      };
    }

    const fallback = await fetchFmpSingleQuoteList(cleanSymbols);
    return {
      ...fallback,
      mode: "single-fallback",
      warning: `Batch quote failed: ${batchResult.status} ${batchResult.error || ""}`.trim(),
    };
  }

  return {
    ...(await fetchFmpSingleQuoteList(cleanSymbols)),
    mode: "single",
  };
}

export async function fetchFmpProfile(symbol: string) {
  const env = getServerEnv();
  if (!env.fmpApiKey) {
    return { ok: false, status: 0, data: null, error: "FMP_API_KEY is missing" };
  }

  const cleanSymbol = normalizeSymbol(symbol);
  const url = new URL("https://financialmodelingprep.com/stable/profile");
  url.searchParams.set("symbol", cleanSymbol);
  url.searchParams.set("apikey", env.fmpApiKey);

  return fetchJson(url);
}

export async function fetchFmpSharesFloat(symbol: string) {
  const env = getServerEnv();
  if (!env.fmpApiKey) {
    return { ok: false, status: 0, data: null, error: "FMP_API_KEY is missing" };
  }

  const cleanSymbol = normalizeSymbol(symbol);
  const url = new URL("https://financialmodelingprep.com/stable/shares-float");
  url.searchParams.set("symbol", cleanSymbol);
  url.searchParams.set("apikey", env.fmpApiKey);

  return fetchJson(url);
}

export async function fetchPolygonTicker(symbol: string) {
  const env = getServerEnv();
  if (!env.polygonApiKey) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "POLYGON_API_KEY is missing",
    };
  }

  const cleanSymbol = normalizeSymbol(symbol);
  const url = new URL(
    `https://api.polygon.io/v3/reference/tickers/${encodeURIComponent(cleanSymbol)}`,
  );
  url.searchParams.set("apiKey", env.polygonApiKey);

  const result = await fetchJson(url);
  return {
    ...result,
    data:
      result.data && typeof result.data === "object" && "results" in result.data
        ? (result.data as { results?: unknown }).results
        : result.data,
  };
}

export async function fetchDailyBars(symbol: string, days = 20) {
  const polygonResult = await fetchPolygonDailyBars(symbol, days);
  if (polygonResult.ok && Array.isArray(polygonResult.data) && polygonResult.data.length) {
    return {
      ...polygonResult,
      provider: "polygon",
    };
  }

  const fmpResult = await fetchFmpDailyBars(symbol, days);
  return {
    ...fmpResult,
    provider: fmpResult.ok ? "fmp" : "none",
    warning: polygonResult.ok ? undefined : `Polygon failed: ${polygonResult.error || polygonResult.status}`,
  };
}

export async function fetchPolygonDailyBars(symbol: string, days = 20) {
  const env = getServerEnv();
  if (!env.polygonApiKey) {
    return {
      ok: false,
      status: 0,
      data: [] as MarketBar[],
      error: "POLYGON_API_KEY is missing",
    };
  }

  const cleanSymbol = normalizeSymbol(symbol);
  const { from, to } = dateWindow(days);
  const url = new URL(
    `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(cleanSymbol)}/range/1/day/${from}/${to}`,
  );
  url.searchParams.set("adjusted", "true");
  url.searchParams.set("sort", "asc");
  url.searchParams.set("limit", String(Math.max(days, 20) + 20));
  url.searchParams.set("apiKey", env.polygonApiKey);

  const result = await fetchJson(url);
  const rows =
    result.data && typeof result.data === "object" && "results" in result.data
      ? ((result.data as { results?: unknown }).results as unknown)
      : [];

  return {
    ...result,
    data: normalizePolygonBars(rows).slice(-days),
  };
}

export async function fetchFmpDailyBars(symbol: string, days = 20) {
  const env = getServerEnv();
  if (!env.fmpApiKey) {
    return {
      ok: false,
      status: 0,
      data: [] as MarketBar[],
      error: "FMP_API_KEY is missing",
    };
  }

  const cleanSymbol = normalizeSymbol(symbol);
  const { from, to } = dateWindow(days);
  const url = new URL("https://financialmodelingprep.com/stable/historical-price-eod/full");
  url.searchParams.set("symbol", cleanSymbol);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("apikey", env.fmpApiKey);

  const result = await fetchJson(url);
  return {
    ...result,
    data: normalizeFmpBars(result.data).slice(-days),
  };
}

export async function fetchSecCompanyTickers(query: string) {
  const env = getServerEnv();
  if (!env.secUserAgent) {
    return {
      ok: false,
      status: 0,
      data: [],
      count: 0,
      error: "SEC_USER_AGENT is missing",
    };
  }

  try {
    const response = await timedFetch("https://www.sec.gov/files/company_tickers.json", {
      headers: {
        "User-Agent": env.secUserAgent,
        Accept: "application/json",
      },
    });
    const data = await response.json();
    const rows = Object.values(data || {}) as Array<{
      cik_str: number;
      ticker: string;
      title: string;
    }>;
    const normalizedQuery = query.trim().toUpperCase();
    const filtered = normalizedQuery
      ? rows.filter(
          (row) =>
            row.ticker?.toUpperCase().includes(normalizedQuery) ||
            row.title?.toUpperCase().includes(normalizedQuery),
        )
      : rows;

    return {
      ok: response.ok,
      status: response.status,
      data: filtered.slice(0, 50),
      count: rows.length,
      error: response.ok ? undefined : response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: [],
      count: 0,
      error: error instanceof Error ? error.message : "SEC request failed",
    };
  }
}

export async function fetchSecCurrentFilings(form: string, count: number) {
  const env = getServerEnv();
  if (!env.secUserAgent) {
    return {
      ok: false,
      status: 0,
      data: [] as SecFiling[],
      error: "SEC_USER_AGENT is missing",
    };
  }

  const cleanForm = (form || "8-K").replace(/[^A-Za-z0-9/-]/g, "");
  const safeCount = Math.max(1, Math.min(count || 10, 100));
  const url = new URL("https://www.sec.gov/cgi-bin/browse-edgar");
  url.searchParams.set("action", "getcurrent");
  url.searchParams.set("type", cleanForm);
  url.searchParams.set("owner", "include");
  url.searchParams.set("count", String(safeCount));
  url.searchParams.set("output", "atom");

  try {
    const response = await timedFetch(url, {
      headers: {
        "User-Agent": env.secUserAgent,
        Accept: "application/atom+xml, application/xml, text/xml",
      },
    });
    const text = await response.text();
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "",
    });
    const parsed = parser.parse(text);
    const entries = asArray(parsed?.feed?.entry);
    const filings: SecFiling[] = entries.map((entry) => ({
      title: textValue(entry?.title),
      link: textValue(entry?.link?.href || entry?.link),
      updated: textValue(entry?.updated),
      summary: textValue(entry?.summary),
    }));

    return {
      ok: response.ok,
      status: response.status,
      data: filings,
      count: filings.length,
      error: response.ok ? undefined : response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: [] as SecFiling[],
      error: error instanceof Error ? error.message : "SEC filings request failed",
    };
  }
}

function normalizeSymbol(symbol: string) {
  return (symbol || "AAPL").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function normalizeSymbols(symbols: string[]) {
  return Array.from(
    new Set(
      symbols
        .flatMap((symbol) => symbol.split(","))
        .map((symbol) => normalizeSymbol(symbol))
        .filter(Boolean),
    ),
  ).slice(0, 50);
}

function dateWindow(days: number) {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - Math.max(days * 3, 45));

  return {
    from: toDateString(start),
    to: toDateString(end),
  };
}

function toDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizePolygonBars(value: unknown): MarketBar[] {
  return asArray(value)
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      const timestamp = numberValue(item.t);
      const date = timestamp ? new Date(timestamp).toISOString().slice(0, 10) : "";
      return normalizeBar({
        date,
        open: item.o,
        high: item.h,
        low: item.l,
        close: item.c,
        volume: item.v,
      });
    })
    .filter((row): row is MarketBar => Boolean(row));
}

function normalizeFmpBars(value: unknown): MarketBar[] {
  const rows =
    value && typeof value === "object" && "historical" in value
      ? (value as { historical?: unknown }).historical
      : value;

  return asArray(rows)
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const item = row as Record<string, unknown>;
      return normalizeBar({
        date: textValue(item.date),
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      });
    })
    .filter((row): row is MarketBar => Boolean(row))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeBar(value: {
  date: string;
  open: unknown;
  high: unknown;
  low: unknown;
  close: unknown;
  volume: unknown;
}) {
  const open = numberValue(value.open);
  const high = numberValue(value.high);
  const low = numberValue(value.low);
  const close = numberValue(value.close);
  const volume = numberValue(value.volume);

  if (!value.date || !Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
    return null;
  }

  return {
    date: value.date,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
  };
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return Number.NaN;
}

async function fetchFmpSingleQuoteList(symbols: string[]) {
  const results = await Promise.all(symbols.map((symbol) => fetchFmpQuote(symbol)));
  const failed = results.find((result) => !result.ok);

  return {
    ok: !failed,
    status: failed?.status || 200,
    data: results.flatMap((result) => {
      if (!result.ok) return [];
      return Array.isArray(result.data) ? result.data : [result.data];
    }),
    error: failed?.error,
  };
}

async function fetchJson(url: URL) {
  try {
    const response = await timedFetch(url, {
      headers: { Accept: "application/json" },
    });
    const data = await response.json().catch(() => null);
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
      error: error instanceof Error ? error.message : "Request failed",
    };
  }
}

async function timedFetch(input: string | URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), defaultTimeoutMs);

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

function missing(key: string, label: string, envKey: string): IntegrationResult {
  return {
    key,
    label,
    ok: false,
    error: `${envKey} is missing`,
  };
}

function failed(key: string, label: string, error: unknown): IntegrationResult {
  return {
    key,
    label,
    ok: false,
    status: 0,
    error: error instanceof Error ? error.message : "Request failed",
  };
}

function readError(data: unknown, fallback: string) {
  if (!data) return fallback;
  if (typeof data === "string") return data;
  if (typeof data === "object" && "message" in data) {
    return String((data as { message?: unknown }).message || fallback);
  }
  if (typeof data === "object" && "error" in data) {
    return String((data as { error?: unknown }).error || fallback);
  }
  return fallback;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "#text" in value) {
    return String((value as { "#text"?: unknown })["#text"] || "");
  }
  return String(value);
}
