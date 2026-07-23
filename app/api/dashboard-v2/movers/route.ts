import { unstable_cache } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import type { BadgeTone } from "@/components/ui/Badge";
import {
  dashboardV2Sessions,
  type DashboardV2Event,
  type DashboardV2Impact,
  type DashboardV2MarketMover,
  type DashboardV2Signal,
  type DashboardV2Session,
} from "@/lib/dashboardV2Types";
import {
  dashboardV2MoverModes,
  getNewYorkMarketSession,
  rankExtendedMovers,
  type DashboardV2MoverMode,
} from "@/lib/dashboardV2ExtendedMovers";
import {
  readDashboardMoverSnapshot,
  type DashboardMoverSnapshot,
  writeDashboardMoverSnapshot,
} from "@/lib/dashboardMoverSnapshotCache";
import { getServerEnv } from "@/lib/env";
import { getEventTypeBadge, type EventTypeBadgeTone } from "@/lib/eventTypeRegistry";
import { fetchRecentEventsByTickers } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const rowLimit = 25;
const regularMoverCacheSeconds = 3 * 60;
const extendedMoverCacheSeconds = 60;
const regularMoverRetryDelayMs = 250;
const regularMoverStaleAfterMs = regularMoverCacheSeconds * 2 * 1000;
const extendedFetchConcurrency = 6;
const fmpRequestTimeoutMs = 8_000;

type MoverMode = DashboardV2MoverMode;
type Session = DashboardV2Session;
type ExtendedSession = Exclude<Session, "Regular">;
type EventRow = Record<string, unknown>;
type DataStatus = "ready" | "partial" | "empty" | "unavailable";
type BaseMover = Omit<DashboardV2MarketMover, "rank" | "events" | "maxImpact">;
type RegularMoverResult = Awaited<ReturnType<typeof loadRegularMarketMovers>>;

const regularMoverRequests = new Map<MoverMode, Promise<RegularMoverResult>>();
const lastGoodRegularMovers = new Map<MoverMode, RegularMoverResult>();

const loadCachedRegularMovers = unstable_cache(
  async (mode: MoverMode) => loadRegularMarketMovers(mode),
  ["dashboard-v2-regular-movers-v4"],
  { revalidate: regularMoverCacheSeconds },
);

const loadCachedExtendedCandidateUniverse = unstable_cache(
  async () => loadExtendedCandidateUniverse(),
  ["dashboard-v2-extended-candidate-universe-v1"],
  { revalidate: extendedMoverCacheSeconds },
);

const loadCachedAftermarketSymbol = unstable_cache(
  async (symbol: string) => loadAftermarketSymbol(symbol),
  ["dashboard-v2-aftermarket-symbol-v1"],
  { revalidate: extendedMoverCacheSeconds },
);

const loadCachedExtendedMovers = unstable_cache(
  async (session: ExtendedSession, mode: MoverMode) => loadExtendedMarketMovers(session, mode),
  ["dashboard-v2-extended-movers-v1"],
  { revalidate: extendedMoverCacheSeconds },
);

export async function GET(request: NextRequest) {
  const session = normalizeSession(request.nextUrl.searchParams.get("session"));
  const mode = normalizeMode(request.nextUrl.searchParams.get("mode"));

  const { fmpApiKey } = getServerEnv();
  if (!fmpApiKey) {
    return json(
      {
        asOf: null,
        available: false,
        dataAvailability: unavailableData(),
        error: "FMP_API_KEY is not configured",
        mode,
        ok: false,
        reason: "missing_key",
        receivedAt: new Date().toISOString(),
        rows: [],
        session,
        sourceCount: 0,
      },
      503,
    );
  }

  try {
    if (session === "Regular") {
      const marketSessionOpen = getNewYorkMarketSession(Date.now())?.session === "Regular";
      const { fallback, result } = await loadRegularMoversWithFallback(
        mode,
        marketSessionOpen,
      );
      const capturedAtMilliseconds = new Date(result.fetchedAt).getTime();
      const stale =
        fallback ||
        !Number.isFinite(capturedAtMilliseconds) ||
        Date.now() - capturedAtMilliseconds > regularMoverStaleAfterMs;
      return json({
        ...result,
        available: true,
        capturedAt: result.fetchedAt,
        freshness: marketSessionOpen ? (stale ? "stale" : "fresh") : "closed",
        marketSessionOpen,
        message: fallback
          ? "Showing the last successful regular-session snapshot while FMP is unavailable."
          : undefined,
        mode,
        ok: true,
        reason: result.rows.length ? "ready" : "empty",
        receivedAt: result.fetchedAt,
        session,
        source: "fmp_stable_movers",
        stale,
      });
    }

    const { matchingCount, ...result } = await loadCachedExtendedMovers(session, mode);
    const available = matchingCount > 0;
    return json({
      ...result,
      available,
      message: available
        ? undefined
        : `No ${session.toLowerCase()}-market trades match the latest FMP data.`,
      mode,
      ok: true,
      reason: available ? (result.rows.length ? "ready" : "empty") : "session_unavailable",
      receivedAt: result.fetchedAt,
      session,
    });
  } catch {
    return json(
      {
        asOf: null,
        available: false,
        dataAvailability: unavailableData(),
        error: "FMP market movers are unavailable",
        mode,
        ok: false,
        reason: "upstream_error",
        receivedAt: new Date().toISOString(),
        rows: [],
        session,
        sourceCount: 0,
      },
      502,
    );
  }
}

async function loadRegularMoversWithFallback(mode: MoverMode, allowRefresh: boolean) {
  if (!allowRefresh) {
    const snapshot = await loadLastGoodRegularMovers(mode);
    if (snapshot) return { fallback: false, result: snapshot };
    throw new Error("No completed regular-session snapshot is available");
  }

  const existing = regularMoverRequests.get(mode);
  if (existing) {
    try {
      return { fallback: false, result: await existing };
    } catch (error) {
      const fallback = await loadLastGoodRegularMovers(mode);
      if (fallback) return { fallback: true, result: fallback };
      throw error;
    }
  }

  const request = loadCachedRegularMovers(mode);
  regularMoverRequests.set(mode, request);

  try {
    const result = await request;
    lastGoodRegularMovers.set(mode, result);
    await writeDashboardMoverSnapshot(mode, result).catch(() => undefined);
    return { fallback: false, result };
  } catch (error) {
    const fallback = await loadLastGoodRegularMovers(mode);
    if (fallback) return { fallback: true, result: fallback };
    throw error;
  } finally {
    regularMoverRequests.delete(mode);
  }
}

async function loadLastGoodRegularMovers(mode: MoverMode) {
  const inMemory = lastGoodRegularMovers.get(mode);
  if (inMemory) return inMemory;

  const persisted = await readDashboardMoverSnapshot(mode).catch(() => null);
  if (persisted) lastGoodRegularMovers.set(mode, persisted);
  return persisted;
}

async function loadRegularMarketMovers(mode: MoverMode): Promise<DashboardMoverSnapshot> {
  const { fmpApiKey } = getServerEnv();
  if (!fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  const payload = await loadRegularMoverPayload(mode, fmpApiKey);
  const baseRows = payload
    .map(normalizeMover)
    .filter((row): row is BaseMover => row !== null)
    .slice(0, rowLimit);
  const enriched = await enrichMoverRows(baseRows, fmpApiKey, false);

  return {
    asOf: readProviderAsOf(payload),
    ...enriched,
    fetchedAt: new Date().toISOString(),
    sourceCount: payload.length,
  };
}

async function loadExtendedCandidateUniverse() {
  const { fmpApiKey } = getServerEnv();
  if (!fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  const payloads = await Promise.all(
    dashboardV2MoverModes.map((mode) =>
      loadRegularMoverPayload(mode, fmpApiKey, { retryTransient: false }),
    ),
  );
  const candidates = new Map<string, BaseMover>();
  for (const payload of payloads) {
    const rows = payload
      .map(normalizeMover)
      .filter((value): value is BaseMover => value !== null)
      .slice(0, rowLimit);
    for (const row of rows) {
      if (!candidates.has(row.ticker)) candidates.set(row.ticker, row);
    }
  }
  return [...candidates.values()];
}

async function loadExtendedMarketMovers(session: ExtendedSession, mode: MoverMode) {
  const { fmpApiKey } = getServerEnv();
  if (!fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  const candidates = await loadCachedExtendedCandidateUniverse();
  const fetched = await mapWithConcurrency(
    candidates,
    extendedFetchConcurrency,
    async (candidate) => {
      try {
        return {
          candidate,
          data: await loadCachedAftermarketSymbol(candidate.ticker),
          ok: true as const,
        };
      } catch {
        return { candidate, ok: false as const };
      }
    },
  );
  const successful = fetched.filter((result) => result.ok);
  if (candidates.length && !successful.length) {
    throw new Error("FMP aftermarket requests failed");
  }

  const sessionRows = successful.flatMap(({ candidate, data }) => {
    if (candidate.priceValue <= 0) return [];
    const trade = newestSessionRecord(data.trades, session);
    if (!trade) return [];

    const extendedPrice = numberValue(trade.record.price);
    if (!Number.isFinite(extendedPrice) || extendedPrice < 0) return [];
    const changePercentage =
      ((extendedPrice - candidate.priceValue) / candidate.priceValue) * 100;
    const quote = newestSessionRecord(data.quotes, session, trade.session.date);
    const volumeValue = quote ? optionalNumber(quote.record.volume) : undefined;

    return [{
      asOfMilliseconds: Math.max(
        trade.session.epochMilliseconds,
        quote?.session.epochMilliseconds || 0,
      ),
      changePercentage,
      row: {
        ...candidate,
        changePercent: formatSignedPercent(changePercentage),
        price: formatCurrency(extendedPrice),
        priceValue: extendedPrice,
        volume: volumeValue === undefined ? "—" : formatVolume(volumeValue),
        volumeValue,
      } satisfies BaseMover,
      sessionDate: trade.session.date,
      ticker: candidate.ticker,
      volumeValue,
    }];
  });
  const latestSessionDate = sessionRows.reduce(
    (latest, row) => row.sessionDate > latest ? row.sessionDate : latest,
    "",
  );
  const latestSessionRows = sessionRows.filter((row) => row.sessionDate === latestSessionDate);
  const rankedRows = rankExtendedMovers(latestSessionRows, mode)
    .slice(0, rowLimit)
    .map((item) => item.row);
  const enriched = await enrichMoverRows(rankedRows, fmpApiKey);
  const asOfMilliseconds = latestSessionRows.reduce(
    (latest, row) => Math.max(latest, row.asOfMilliseconds),
    0,
  );

  return {
    asOf: asOfMilliseconds ? new Date(asOfMilliseconds).toISOString() : null,
    ...enriched,
    fetchedAt: new Date().toISOString(),
    matchingCount: latestSessionRows.length,
    sourceCount: candidates.length,
  };
}

async function enrichMoverRows(
  baseRows: BaseMover[],
  fmpApiKey: string,
  includeMarketCaps = true,
) {
  const tickers = baseRows.map((row) => row.ticker);
  const [marketCaps, recentEvents] = await Promise.all([
    includeMarketCaps
      ? loadBatchMarketCaps(tickers, fmpApiKey)
      : Promise.resolve({
          status: "unavailable" as const,
          values: new Map<string, number>(),
        }),
    loadRecentEventsByTicker(tickers),
  ]);
  const rows = baseRows.map((row, index) => {
    const marketCapValue = marketCaps.values.get(row.ticker) ?? row.marketCapValue;
    const events = recentEvents.values.get(row.ticker) || [];
    return {
      ...row,
      events,
      marketCap: marketCapValue === undefined ? "—" : formatMarketCap(marketCapValue),
      marketCapValue,
      maxImpact: maxImpact(events),
      rank: index + 1,
    } satisfies DashboardV2MarketMover;
  });
  const marketCapCount = rows.filter((row) => row.marketCapValue !== undefined).length;
  const volumeCount = rows.filter((row) => row.volumeValue !== undefined).length;

  return {
    dataAvailability: {
      events: recentEvents.status,
      marketCap:
        marketCapCount === rows.length && rows.length
          ? "ready"
          : marketCapCount
            ? "partial"
            : "unavailable",
      volume: volumeCount ? (volumeCount === rows.length ? "ready" : "partial") : "unavailable",
    } satisfies Record<"events" | "marketCap" | "volume", DataStatus>,
    rows,
  };
}

async function loadRegularMoverPayload(
  mode: MoverMode,
  fmpApiKey: string,
  options: { retryTransient?: boolean } = { retryTransient: true },
) {
  return loadFmpArray(
    `https://financialmodelingprep.com/stable/${endpointFor(mode)}`,
    fmpApiKey,
    options,
  );
}

async function loadAftermarketSymbol(symbol: string) {
  const { fmpApiKey } = getServerEnv();
  if (!fmpApiKey) throw new Error("FMP_API_KEY is not configured");

  const tradeUrl = new URL("https://financialmodelingprep.com/stable/aftermarket-trade");
  tradeUrl.searchParams.set("symbol", symbol);
  const quoteUrl = new URL("https://financialmodelingprep.com/stable/aftermarket-quote");
  quoteUrl.searchParams.set("symbol", symbol);
  const [trades, quotes] = await Promise.allSettled([
    loadFmpArray(tradeUrl, fmpApiKey),
    loadFmpArray(quoteUrl, fmpApiKey),
  ]);
  if (trades.status === "rejected") throw trades.reason;

  return {
    quotes: quotes.status === "fulfilled" ? quotes.value : [],
    trades: trades.value,
  };
}

async function loadFmpArray(
  url: string | URL,
  fmpApiKey: string,
  options: { retryTransient?: boolean } = {},
) {
  const attempts = options.retryTransient ? 2 : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json", apikey: fmpApiKey },
        signal: AbortSignal.timeout(fmpRequestTimeoutMs),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && Array.isArray(payload)) return payload;

      const retryable =
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      if (!retryable || attempt + 1 >= attempts) {
        throw new FmpRequestError(response.status, retryable);
      }
    } catch (error) {
      if (error instanceof FmpRequestError && !error.retryable) throw error;
      if (attempt + 1 >= attempts) throw error;
    }

    await delay(regularMoverRetryDelayMs);
  }

  throw new Error("FMP request failed");
}

class FmpRequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(`FMP request failed with status ${status}`);
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function newestSessionRecord(
  values: unknown[],
  session: ExtendedSession,
  sessionDate?: string,
) {
  let latest:
    | {
        record: Record<string, unknown>;
        session: NonNullable<ReturnType<typeof getNewYorkMarketSession>>;
      }
    | undefined;

  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const classified = getNewYorkMarketSession(record.timestamp);
    if (
      !classified ||
      classified.session !== session ||
      (sessionDate && classified.date !== sessionDate)
    ) {
      continue;
    }
    if (!latest || classified.epochMilliseconds > latest.session.epochMilliseconds) {
      latest = { record, session: classified };
    }
  }
  return latest;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  callback: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await callback(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function loadBatchMarketCaps(tickers: string[], apiKey: string) {
  const values = new Map<string, number>();
  if (!tickers.length) return { status: "empty" as const, values };

  const url = new URL("https://financialmodelingprep.com/stable/market-capitalization-batch");
  url.searchParams.set("symbols", tickers.join(","));

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", apikey: apiKey },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(payload)) return { status: "unavailable" as const, values };

    for (const item of payload) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const ticker = textValue(row.symbol).toUpperCase();
      const marketCap = numberValue(row.marketCap);
      if (ticker && Number.isFinite(marketCap) && marketCap >= 0) values.set(ticker, marketCap);
    }

    return { status: values.size ? "ready" as const : "empty" as const, values };
  } catch {
    return { status: "unavailable" as const, values };
  }
}

async function loadRecentEventsByTicker(tickers: string[]) {
  const detectedAfter = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await fetchRecentEventsByTickers({ detectedAfter, tickers });
  const values = new Map<string, DashboardV2Event[]>();
  if (!result.ok) return { status: "unavailable" as const, values };

  for (const raw of result.data) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as EventRow;
    const ticker = textValue(row.ticker).toUpperCase();
    if (!ticker || !tickers.includes(ticker)) continue;
    const event = normalizeEvent(row);
    if (!event) continue;
    values.set(ticker, [...(values.get(ticker) || []), event]);
  }

  return { status: values.size ? "ready" as const : "empty" as const, values };
}

function normalizeEvent(row: EventRow): DashboardV2Event | null {
  const id = textValue(row.id);
  const code = textValue(row.event_type).toLowerCase();
  const title = textValue(row.title);
  const timestamp = textValue(row.detected_at) || textValue(row.published_at);
  if (!id || !code || !title || !timestamp) return null;
  const badge = getEventTypeBadge(code);

  return {
    code,
    id,
    impact: normalizeImpact(row.impact),
    label: badge.label,
    signal: normalizeSignal(row.signal),
    timestamp,
    title,
    tone: badgeTone(badge.tone),
  };
}

function badgeTone(tone: EventTypeBadgeTone): BadgeTone {
  if (tone === "earnings") return "earnings";
  if (tone === "risk" || tone === "dilution") return "legal";
  if (tone === "deal" || tone === "market") return "transaction";
  if (tone === "regulatory") return "insider";
  if (tone === "clinical") return "product";
  return "neutral";
}

function maxImpact(events: DashboardV2Event[]): DashboardV2Impact | undefined {
  if (events.some((event) => event.impact === "high")) return "high";
  if (events.some((event) => event.impact === "medium")) return "medium";
  if (events.some((event) => event.impact === "low")) return "low";
  return undefined;
}

function normalizeImpact(value: unknown): DashboardV2Impact | undefined {
  const impact = textValue(value).toLowerCase();
  return impact === "high" || impact === "medium" || impact === "low" ? impact : undefined;
}

function normalizeSignal(value: unknown): DashboardV2Signal | undefined {
  const signal = textValue(value).toLowerCase();
  return signal === "bullish" || signal === "bearish" || signal === "volatile" || signal === "neutral"
    ? signal
    : undefined;
}

function endpointFor(mode: MoverMode) {
  if (mode === "gainers") return "biggest-gainers";
  if (mode === "losers") return "biggest-losers";
  return "most-actives";
}

function normalizeMover(value: unknown): BaseMover | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const ticker = textValue(row.symbol).toUpperCase();
  const priceValue = numberValue(row.price);
  if (!ticker || !Number.isFinite(priceValue)) return null;
  const marketCapValue = optionalNumber(row.marketCap);
  const volumeValue = optionalNumber(row.volume);

  return {
    changePercent: formatSignedPercent(numberValue(row.changesPercentage)),
    company: textValue(row.name) || ticker,
    logoUrl: `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`,
    marketCap: marketCapValue === undefined ? "—" : formatMarketCap(marketCapValue),
    marketCapValue,
    price: formatCurrency(priceValue),
    priceValue,
    ticker,
    volume: volumeValue === undefined ? "—" : formatVolume(volumeValue),
    volumeValue,
  };
}

function readProviderAsOf(payload: unknown[]) {
  const timestamps = payload
    .map((item) => (item && typeof item === "object" ? textValue((item as EventRow).timestamp) : ""))
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => Number.isFinite(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());
  return timestamps[0]?.toISOString() || null;
}

function normalizeMode(value: string | null): MoverMode {
  return dashboardV2MoverModes.includes(value as MoverMode) ? (value as MoverMode) : "gainers";
}

function normalizeSession(value: string | null): Session {
  return dashboardV2Sessions.includes(value as Session) ? (value as Session) : "Regular";
}

function textValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return Number.NaN;
  const normalized = value.replace(/[$,%]/g, "").replace(/[()]/g, "").trim();
  if (!normalized || !Number.isFinite(Number(normalized))) return Number.NaN;
  return value.trim().startsWith("(") ? -Math.abs(Number(normalized)) : Number(normalized);
}

function optionalNumber(value: unknown) {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function formatCurrency(value: number) {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function formatMarketCap(value: number) {
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function formatVolume(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return Math.round(value).toLocaleString("en-US");
}

function unavailableData() {
  return { events: "unavailable", marketCap: "unavailable", volume: "unavailable" } as const;
}

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" }, status });
}
