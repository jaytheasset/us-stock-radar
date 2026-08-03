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
  rankExtendedMovers,
  type DashboardV2MoverMode,
} from "@/lib/dashboardV2ExtendedMovers";
import {
  includesDashboardV2EventDeliveryLevel,
  normalizeDashboardV2EventScore,
  sortDashboardV2Events,
} from "@/lib/dashboardV2Events";
import {
  readDashboardExtendedMoverSnapshot,
  type DashboardExtendedMoverSnapshot,
  writeDashboardExtendedMoverSnapshot,
} from "@/lib/dashboardExtendedMoverSnapshotCache";
import {
  readDashboardMoverSnapshot,
  type DashboardMoverSnapshot,
  writeDashboardMoverSnapshot,
} from "@/lib/dashboardMoverSnapshotCache";
import {
  buildMassiveExtendedCandidates,
  type DashboardV2ExtendedSession,
} from "@/lib/dashboardV2MassiveMovers";
import { companyLogoPath } from "@/lib/companyLogoCache";
import {
  getDashboardMoverLifecycle,
  isDashboardMoverFinalizationEligible,
  shouldFinalizeDashboardMoverSnapshot,
  type DashboardMoverLifecycle,
} from "@/lib/dashboardV2MoverLifecycle";
import { getServerEnv } from "@/lib/env";
import { getEventTypeBadge, type EventTypeBadgeTone } from "@/lib/eventTypeRegistry";
import { fetchRecentEventsByTickers, supabaseSelect } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const rowLimit = 25;
const regularMoverCacheSeconds = 3 * 60;
const extendedMoverCacheSeconds = 3 * 60;
const regularMoverRetryDelayMs = 250;
const regularMoverStaleAfterMs = regularMoverCacheSeconds * 2 * 1000;
const extendedMoverStaleAfterMs = extendedMoverCacheSeconds * 2 * 1000;
const fmpRequestTimeoutMs = 8_000;
const massiveRequestTimeoutMs = 20_000;

type MoverMode = DashboardV2MoverMode;
type Session = DashboardV2Session;
type ExtendedSession = DashboardV2ExtendedSession;
type EventRow = Record<string, unknown>;
type DataStatus = "ready" | "partial" | "empty" | "unavailable";
type BaseMover = Omit<DashboardV2MarketMover, "rank" | "events" | "maxImpact">;
type RegularMoverResult = Awaited<ReturnType<typeof loadRegularMarketMovers>>;
type ExtendedUniverse = Awaited<ReturnType<typeof loadMassiveExtendedUniverse>>;

const regularMoverRequests = new Map<string, Promise<RegularMoverResult>>();
const regularFinalizationRequests = new Map<
  string,
  Promise<Map<MoverMode, DashboardMoverSnapshot>>
>();
const lastGoodRegularMovers = new Map<MoverMode, RegularMoverResult>();
const extendedMoverRequests = new Map<string, Promise<DashboardExtendedMoverSnapshot>>();
const extendedFinalizationRequests = new Map<
  string,
  Promise<Map<MoverMode, DashboardExtendedMoverSnapshot>>
>();
const extendedUniverseRequests = new Map<
  string,
  Promise<Awaited<ReturnType<typeof loadMassiveExtendedUniverse>>>
>();
const lastGoodExtendedMovers = new Map<string, DashboardExtendedMoverSnapshot>();

const loadCachedRegularMovers = unstable_cache(
  async (mode: MoverMode, marketDate: string) =>
    loadRegularMarketMovers(mode, marketDate),
  ["dashboard-v2-regular-movers-v5"],
  { revalidate: regularMoverCacheSeconds },
);

const loadCachedExtendedMovers = unstable_cache(
  async (session: ExtendedSession, mode: MoverMode, marketDate: string) =>
    loadExtendedMarketMovers(session, mode, marketDate),
  ["dashboard-v2-massive-extended-movers-v2"],
  { revalidate: extendedMoverCacheSeconds },
);

const loadCachedMassiveExtendedUniverse = unstable_cache(
  async (session: ExtendedSession, marketDate: string) =>
    loadMassiveExtendedUniverse(session, marketDate),
  ["dashboard-v2-massive-extended-universe-v2"],
  { revalidate: extendedMoverCacheSeconds },
);

export async function GET(request: NextRequest) {
  const session = normalizeSession(request.nextUrl.searchParams.get("session"));
  const mode = normalizeMode(request.nextUrl.searchParams.get("mode"));
  const lifecycle = getDashboardMoverLifecycle(session);

  try {
    if (session === "Regular") {
      const { fmpApiKey } = getServerEnv();
      if (!fmpApiKey) {
        return missingKeyResponse("FMP_API_KEY", session, mode);
      }
      const { fallback, result } = await loadRegularMoversWithFallback(
        mode,
        lifecycle,
      );
      const capturedAtMilliseconds = new Date(result.fetchedAt).getTime();
      const stale =
        fallback ||
        !Number.isFinite(capturedAtMilliseconds) ||
        (lifecycle.phase === "active" &&
          Date.now() - capturedAtMilliseconds > regularMoverStaleAfterMs);
      return json({
        ...result,
        available: true,
        capturedAt: result.fetchedAt,
        freshness: moverFreshness(result.isFinal, lifecycle, stale),
        lifecyclePhase: lifecycle.phase,
        marketSessionOpen: lifecycle.phase === "active",
        message: fallback
          ? "Showing the last successful regular-session snapshot while FMP is unavailable."
          : undefined,
        mode,
        ok: true,
        reason: result.rows.length ? "ready" : "empty",
        receivedAt: result.fetchedAt,
        refreshAfterSeconds: result.isFinal
          ? null
          : lifecycle.refreshAfterSeconds,
        session,
        source: "fmp_stable_movers",
        stale,
      });
    }

    const { polygonApiKey } = getServerEnv();
    if (!polygonApiKey) {
      return missingKeyResponse("POLYGON_API_KEY", session, mode);
    }

    const loaded = await loadExtendedMoversWithFallback(
      session,
      mode,
      lifecycle,
    );
    if (!loaded) {
      return json({
        asOf: null,
        available: false,
        capturedAt: null,
        dataAvailability: unavailableData(),
        freshness:
          lifecycle.phase === "finalizing" ? "finalizing" : "closed",
        lifecyclePhase: lifecycle.phase,
        marketSessionOpen: lifecycle.phase === "active",
        message: `No saved ${session.toLowerCase()}-market snapshot is available yet.`,
        mode,
        ok: true,
        providerDelayMinutes: 15,
        reason: "session_unavailable",
        receivedAt: new Date().toISOString(),
        refreshAfterSeconds: lifecycle.refreshAfterSeconds,
        rows: [],
        session,
        source: "massive_full_market_snapshot",
        sourceCount: 0,
        stale: false,
      });
    }

    const { fallback, result } = loaded;
    const capturedAtMilliseconds = new Date(result.fetchedAt).getTime();
    const stale =
      fallback ||
      !Number.isFinite(capturedAtMilliseconds) ||
      (lifecycle.phase === "active" &&
        Date.now() - capturedAtMilliseconds > extendedMoverStaleAfterMs);
    const available = result.matchingCount > 0;
    return json({
      ...result,
      available,
      capturedAt: result.fetchedAt,
      freshness: moverFreshness(result.isFinal, lifecycle, stale),
      lifecyclePhase: lifecycle.phase,
      marketSessionOpen: lifecycle.phase === "active",
      message: fallback
        ? `Showing the last successful ${session.toLowerCase()}-market snapshot while Massive is unavailable.`
        : available
          ? undefined
          : `No ${session.toLowerCase()}-market aggregate trades are available in the latest Massive snapshot.`,
      mode,
      ok: true,
      providerDelayMinutes: 15,
      reason: available ? (result.rows.length ? "ready" : "empty") : "session_unavailable",
      receivedAt: result.fetchedAt,
      refreshAfterSeconds: result.isFinal
        ? null
        : lifecycle.refreshAfterSeconds,
      session,
      source: "massive_full_market_snapshot",
      stale,
    });
  } catch {
    return json(
      {
        asOf: null,
        available: false,
        dataAvailability: unavailableData(),
        error: "Market movers are unavailable",
        freshness:
          lifecycle.phase === "finalizing" ? "finalizing" : "stale",
        lifecyclePhase: lifecycle.phase,
        marketSessionOpen: lifecycle.phase === "active",
        mode,
        ok: false,
        reason: "upstream_error",
        receivedAt: new Date().toISOString(),
        refreshAfterSeconds: lifecycle.refreshAfterSeconds ?? 60,
        rows: [],
        session,
        sourceCount: 0,
      },
      502,
    );
  }
}

async function loadRegularMoversWithFallback(
  mode: MoverMode,
  lifecycle: DashboardMoverLifecycle,
) {
  try {
    if (
      lifecycle.phase === "finalizing" &&
      isDashboardMoverFinalizationEligible("Regular", lifecycle)
    ) {
      const finalized = await finalizeRegularMovers(lifecycle);
      return { fallback: false, result: finalized.get(mode)! };
    }

    const saved = await loadLastGoodRegularMovers(mode);
    if (
      saved &&
      (lifecycle.phase === "closed" ||
        saved.marketDate === lifecycle.marketDate)
    ) {
      if (lifecycle.phase !== "active") {
        return { fallback: false, result: saved };
      }
    }

    if (lifecycle.phase === "closed") {
      throw new Error("No completed regular-session snapshot is available");
    }

    return {
      fallback: false,
      result: await loadActiveRegularMovers(mode, lifecycle.marketDate),
    };
  } catch (error) {
    const fallback = await loadLastGoodRegularMovers(mode);
    if (fallback) return { fallback: true, result: fallback };
    throw error;
  }
}

async function loadActiveRegularMovers(mode: MoverMode, marketDate: string) {
  const key = `${marketDate}:${mode}`;
  const existing = regularMoverRequests.get(key);
  if (existing) return existing;

  const request = loadCachedRegularMovers(mode, marketDate);
  regularMoverRequests.set(key, request);
  try {
    const result = await request;
    lastGoodRegularMovers.set(mode, result);
    await writeDashboardMoverSnapshot(mode, result).catch(() => undefined);
    return result;
  } finally {
    regularMoverRequests.delete(key);
  }
}

async function finalizeRegularMovers(lifecycle: DashboardMoverLifecycle) {
  const existing = regularFinalizationRequests.get(lifecycle.marketDate);
  if (existing) return existing;

  const request = (async () => {
    const saved = await Promise.all(
      dashboardV2MoverModes.map(async (mode) => [
        mode,
        await readDashboardMoverSnapshot(mode).catch(() => null),
      ] as const),
    );
    if (
      saved.every(
        ([, snapshot]) =>
          snapshot?.marketDate === lifecycle.marketDate && snapshot.isFinal,
      )
    ) {
      return new Map(
        saved.map(([mode, snapshot]) => [mode, snapshot!] as const),
      );
    }

    const snapshots = await Promise.all(
      dashboardV2MoverModes.map(async (mode) => [
        mode,
        await loadRegularMarketMovers(mode, lifecycle.marketDate),
      ] as const),
    );
    const finalizedAt = new Date().toISOString();
    const isFinal = snapshots.every(([, snapshot]) =>
      shouldFinalizeDashboardMoverSnapshot({
        asOf: snapshot.asOf,
        fetchedAt: snapshot.fetchedAt,
        lifecycle,
        session: "Regular",
      }),
    );
    const results = new Map<MoverMode, DashboardMoverSnapshot>();

    await Promise.all(
      snapshots.map(async ([mode, snapshot]) => {
        const result = {
          ...snapshot,
          finalizedAt: isFinal ? finalizedAt : null,
          isFinal,
        };
        results.set(mode, result);
        lastGoodRegularMovers.set(mode, result);
        await writeDashboardMoverSnapshot(mode, result);
      }),
    );
    return results;
  })();

  regularFinalizationRequests.set(lifecycle.marketDate, request);
  try {
    return await request;
  } finally {
    regularFinalizationRequests.delete(lifecycle.marketDate);
  }
}

async function loadLastGoodRegularMovers(mode: MoverMode) {
  const inMemory = lastGoodRegularMovers.get(mode);
  if (inMemory) return inMemory;

  const persisted = await readDashboardMoverSnapshot(mode).catch(() => null);
  if (persisted) lastGoodRegularMovers.set(mode, persisted);
  return persisted;
}

async function loadRegularMarketMovers(
  mode: MoverMode,
  marketDate: string,
): Promise<DashboardMoverSnapshot> {
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
    finalizedAt: null,
    isFinal: false,
    marketDate,
    sourceCount: payload.length,
  };
}

async function loadExtendedMoversWithFallback(
  session: ExtendedSession,
  mode: MoverMode,
  lifecycle: DashboardMoverLifecycle,
) {
  const key = extendedMoverKey(session, mode);
  try {
    if (
      lifecycle.phase === "finalizing" &&
      isDashboardMoverFinalizationEligible(session, lifecycle)
    ) {
      const finalized = await finalizeExtendedMovers(session, lifecycle);
      return { fallback: false, result: finalized.get(mode)! };
    }

    const saved = await loadLastGoodExtendedMovers(session, mode);
    if (
      saved &&
      (lifecycle.phase === "closed" ||
        saved.marketDate === lifecycle.marketDate)
    ) {
      if (lifecycle.phase !== "active") {
        return { fallback: false, result: saved };
      }
    }

    if (lifecycle.phase === "closed") {
      return saved ? { fallback: false, result: saved } : null;
    }

    return {
      fallback: false,
      result: await loadActiveExtendedMovers(
        session,
        mode,
        lifecycle.marketDate,
      ),
    };
  } catch (error) {
    const fallback = await loadLastGoodExtendedMovers(session, mode);
    if (fallback) return { fallback: true, result: fallback };
    throw error;
  }
}

async function loadActiveExtendedMovers(
  session: ExtendedSession,
  mode: MoverMode,
  marketDate: string,
) {
  const key = `${extendedMoverKey(session, mode)}:${marketDate}`;
  const existing = extendedMoverRequests.get(key);
  if (existing) return existing;

  const request = loadCachedExtendedMovers(session, mode, marketDate);
  extendedMoverRequests.set(key, request);
  try {
    const result = await request;
    lastGoodExtendedMovers.set(extendedMoverKey(session, mode), result);
    await writeDashboardExtendedMoverSnapshot(session, mode, result).catch(
      () => undefined,
    );
    return result;
  } finally {
    extendedMoverRequests.delete(key);
  }
}

async function finalizeExtendedMovers(
  session: ExtendedSession,
  lifecycle: DashboardMoverLifecycle,
) {
  const key = `${session}:${lifecycle.marketDate}`;
  const existing = extendedFinalizationRequests.get(key);
  if (existing) return existing;

  const request = (async () => {
    const saved = await Promise.all(
      dashboardV2MoverModes.map(async (mode) => [
        mode,
        await readDashboardExtendedMoverSnapshot(session, mode).catch(
          () => null,
        ),
      ] as const),
    );
    if (
      saved.every(
        ([, snapshot]) =>
          snapshot?.marketDate === lifecycle.marketDate && snapshot.isFinal,
      )
    ) {
      return new Map(
        saved.map(([mode, snapshot]) => [mode, snapshot!] as const),
      );
    }

    const universe = await loadMassiveExtendedUniverse(
      session,
      lifecycle.marketDate,
    );
    const snapshots = await Promise.all(
      dashboardV2MoverModes.map(async (mode) => [
        mode,
        await buildExtendedMarketMovers(universe, mode),
      ] as const),
    );
    const finalizedAt = new Date().toISOString();
    const isFinal = snapshots.every(([, snapshot]) =>
      shouldFinalizeDashboardMoverSnapshot({
        asOf: snapshot.asOf,
        fetchedAt: snapshot.fetchedAt,
        lifecycle,
        session,
      }),
    );
    const results = new Map<MoverMode, DashboardExtendedMoverSnapshot>();

    await Promise.all(
      snapshots.map(async ([mode, snapshot]) => {
        const result = {
          ...snapshot,
          finalizedAt: isFinal ? finalizedAt : null,
          isFinal,
        };
        results.set(mode, result);
        lastGoodExtendedMovers.set(extendedMoverKey(session, mode), result);
        await writeDashboardExtendedMoverSnapshot(session, mode, result);
      }),
    );
    return results;
  })();

  extendedFinalizationRequests.set(key, request);
  try {
    return await request;
  } finally {
    extendedFinalizationRequests.delete(key);
  }
}

async function loadLastGoodExtendedMovers(
  session: ExtendedSession,
  mode: MoverMode,
) {
  const key = extendedMoverKey(session, mode);
  const inMemory = lastGoodExtendedMovers.get(key);
  if (inMemory) return inMemory;

  const persisted = await readDashboardExtendedMoverSnapshot(session, mode).catch(() => null);
  if (persisted) lastGoodExtendedMovers.set(key, persisted);
  return persisted;
}

async function loadExtendedMarketMovers(
  session: ExtendedSession,
  mode: MoverMode,
  marketDate: string,
): Promise<DashboardExtendedMoverSnapshot> {
  const universe = await loadMassiveExtendedUniverseWithDedup(
    session,
    marketDate,
  );
  return buildExtendedMarketMovers(universe, mode);
}

async function buildExtendedMarketMovers(
  universe: ExtendedUniverse,
  mode: MoverMode,
): Promise<DashboardExtendedMoverSnapshot> {
  const ranked = rankExtendedMovers(universe.candidates, mode).slice(0, rowLimit);
  const tickerMetadata = await loadTickerMetadata(ranked.map((row) => row.ticker));
  const baseRows = ranked.map((candidate) => {
    const metadata = tickerMetadata.get(candidate.ticker);
    return {
      changePercent: formatSignedPercent(candidate.changePercentage),
      company: metadata?.name || candidate.ticker,
      logoUrl: companyLogoPath(candidate.ticker),
      marketCap:
        metadata?.marketCap === undefined ? "—" : formatMarketCap(metadata.marketCap),
      marketCapValue: metadata?.marketCap,
      price: formatCurrency(candidate.priceValue),
      priceValue: candidate.priceValue,
      ticker: candidate.ticker,
      volume:
        candidate.volumeValue === undefined ? "—" : formatVolume(candidate.volumeValue),
      volumeValue: candidate.volumeValue,
    } satisfies BaseMover;
  });
  const enriched = await enrichMoverRows(baseRows, "", false);
  const marketCapCount = enriched.rows.filter(
    (row) => row.marketCapValue !== undefined,
  ).length;

  return {
    asOf: universe.asOfMilliseconds
      ? new Date(universe.asOfMilliseconds).toISOString()
      : null,
    dataAvailability: {
      ...enriched.dataAvailability,
      marketCap:
        marketCapCount === enriched.rows.length && enriched.rows.length
          ? "ready"
          : marketCapCount
            ? "partial"
            : "unavailable",
    },
    fetchedAt: new Date().toISOString(),
    finalizedAt: null,
    isFinal: false,
    marketDate: universe.marketDate,
    matchingCount: universe.candidates.length,
    rows: enriched.rows,
    sourceCount: universe.sourceCount,
  };
}

async function loadMassiveExtendedUniverseWithDedup(
  session: ExtendedSession,
  marketDate: string,
) {
  const key = `${session}:${marketDate}`;
  const existing = extendedUniverseRequests.get(key);
  if (existing) return existing;

  const request = loadCachedMassiveExtendedUniverse(session, marketDate);
  extendedUniverseRequests.set(key, request);
  try {
    return await request;
  } finally {
    extendedUniverseRequests.delete(key);
  }
}

async function loadMassiveExtendedUniverse(
  session: ExtendedSession,
  marketDate: string,
) {
  const { polygonApiKey } = getServerEnv();
  if (!polygonApiKey) throw new Error("POLYGON_API_KEY is not configured");

  const snapshotUrl = new URL(
    "https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers",
  );
  const [snapshotPayload, dailyPayload] = await Promise.all([
    loadMassiveObject(snapshotUrl, polygonApiKey),
    session === "After"
      ? loadMassiveObject(
          new URL(
            `https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/${marketDate}`,
          ),
          polygonApiKey,
        )
      : Promise.resolve(undefined),
  ]);
  const universe = buildMassiveExtendedCandidates({
    dailyPayload,
    session,
    snapshotPayload,
  });
  if (
    universe.marketDate !== marketDate ||
    !universe.candidates.length
  ) {
    throw new Error(`Massive returned no ${session} aggregate candidates`);
  }
  return universe;
}

async function loadTickerMetadata(tickers: string[]) {
  const values = new Map<string, { marketCap?: number; name?: string }>();
  if (!tickers.length) return values;

  const result = await supabaseSelect("tickers", {
    limit: String(tickers.length),
    select: "symbol,name,market_cap",
    symbol: `in.(${tickers.join(",")})`,
  });
  if (!result.ok || !Array.isArray(result.data)) return values;

  for (const value of result.data) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const ticker = textValue(row.symbol).toUpperCase();
    const marketCap = optionalNumber(row.market_cap);
    if (!ticker) continue;
    values.set(ticker, {
      marketCap,
      name: textValue(row.name) || undefined,
    });
  }
  return values;
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

async function loadMassiveObject(url: URL, apiKey: string) {
  const attempts = 2;
  url.searchParams.set("apiKey", apiKey);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(massiveRequestTimeoutMs),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload && typeof payload === "object") return payload;

      const retryable =
        response.status === 408 ||
        response.status === 425 ||
        response.status === 429 ||
        response.status >= 500;
      if (!retryable || attempt + 1 >= attempts) {
        throw new MassiveRequestError(response.status, retryable);
      }
    } catch (error) {
      if (error instanceof MassiveRequestError && !error.retryable) throw error;
      if (attempt + 1 >= attempts) throw error;
    }

    await delay(regularMoverRetryDelayMs);
  }

  throw new Error("Massive request failed");
}

class MassiveRequestError extends Error {
  constructor(
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(`Massive request failed with status ${status}`);
  }
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
  for (const [ticker, events] of values) {
    values.set(ticker, sortDashboardV2Events(events));
  }

  return { status: values.size ? "ready" as const : "empty" as const, values };
}

function normalizeEvent(row: EventRow): DashboardV2Event | null {
  const id = textValue(row.id);
  const code = textValue(row.event_type).toLowerCase();
  const title = textValue(row.title);
  const timestamp = textValue(row.detected_at) || textValue(row.published_at);
  if (
    !id ||
    !code ||
    !title ||
    !timestamp ||
    !includesDashboardV2EventDeliveryLevel(row.delivery_level)
  ) {
    return null;
  }
  const badge = getEventTypeBadge(code);

  return {
    code,
    id,
    impact: normalizeImpact(row.impact),
    label: badge.label,
    score: normalizeDashboardV2EventScore(row.score),
    signal: normalizeSignal(row.signal),
    sourceGroup: normalizeSourceGroup(row.source_group),
    timestamp,
    title,
    tone: badgeTone(badge.tone),
  };
}

function normalizeSourceGroup(value: unknown): DashboardV2Event["sourceGroup"] {
  const sourceGroup = textValue(value).toLowerCase();
  return sourceGroup === "filings" || sourceGroup === "market" || sourceGroup === "news"
    ? sourceGroup
    : undefined;
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
    logoUrl: companyLogoPath(ticker),
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

function extendedMoverKey(session: ExtendedSession, mode: MoverMode) {
  return `${session}:${mode}`;
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

function moverFreshness(
  isFinal: boolean,
  lifecycle: DashboardMoverLifecycle,
  stale: boolean,
) {
  if (isFinal) return "final";
  if (lifecycle.phase === "finalizing") return "finalizing";
  if (lifecycle.phase === "closed") return "closed";
  return stale ? "stale" : "fresh";
}

function json(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" }, status });
}

function missingKeyResponse(key: string, session: Session, mode: MoverMode) {
  return json(
    {
      asOf: null,
      available: false,
      dataAvailability: unavailableData(),
      error: `${key} is not configured`,
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
