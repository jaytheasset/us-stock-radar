import { NextRequest, NextResponse } from "next/server";
import {
  chartIntervalForRange,
  readMarketBarCache,
  readMarketGroupSnapshotCache,
  writeMarketGroupSnapshots,
  type MarketGroupSnapshotPayload,
} from "@/lib/marketDataCache";
import { authorizeMarketCacheRefresh } from "@/lib/marketCacheCronAuth";
import type { PricePoint, PriceRange } from "@/lib/marketTypes";
import { fetchFmpQuotes } from "@/lib/integrations";
import { resolveSnapshotCache } from "@/lib/marketGroupCachePolicy";
import { prelaunchInternalRequestHeaders } from "@/lib/prelaunch";
import { themeGroups, themeSubThemes } from "@/lib/taxonomyRegistry";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};
const supportedRanges = ["1D", "5D", "1M", "3M"] as const;
const maxSubThemes = 30;
const symbolConcurrency = 6;
const themeCalculationVersion = 1;

type ThemeRange = (typeof supportedRanges)[number];
type SymbolSnapshot = { symbol: string; changePercent: number };
type ChartApiResponse = { ok?: boolean; changePercent?: number; points?: PricePoint[] };
type FmpQuoteRow = {
  symbol?: unknown;
  changePercentage?: unknown;
  changePercent?: unknown;
};

export async function GET(request: NextRequest) {
  const range = normalizeRange(request.nextUrl.searchParams.get("range"));
  const interval = chartIntervalForRange(range as PriceRange);
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const refreshAuthorization = authorizeMarketCacheRefresh(
    request,
    forceRefresh,
  );
  if (!refreshAuthorization.ok) {
    return NextResponse.json(
      { ok: false, error: refreshAuthorization.error },
      {
        status: refreshAuthorization.status,
        headers: NO_STORE_HEADERS,
      },
    );
  }
  const requested = Array.from(
    new Set(
      String(request.nextUrl.searchParams.get("subthemes") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, maxSubThemes);
  const allowed = new Set(themeSubThemes.map((subTheme) => subTheme.slug));
  const selectedSubThemes = requested.filter((slug) => allowed.has(slug));
  const selectedDefinitions = selectedSubThemes
    .map((slug) => themeSubThemes.find((subTheme) => subTheme.slug === slug))
    .filter((definition): definition is NonNullable<typeof definition> => Boolean(definition));

  if (!selectedDefinitions.length) {
    return NextResponse.json({
      ok: true,
      cache: "miss",
      range,
      groups: [],
      subThemes: [],
    });
  }

  if (!forceRefresh) {
    const cached = await readMarketGroupSnapshotCache(range as PriceRange, interval);
    const resolution = resolveSnapshotCache(
      cached.freshSnapshots,
      cached.snapshots,
      (snapshots) =>
        hydrateCachedThemePerformance(snapshots, selectedDefinitions),
      (hydrated) => Boolean(hydrated),
    );
    if (resolution.state !== "miss" && resolution.value) {
      return NextResponse.json({
        ok: true,
        cache: resolution.state,
        range,
        interval,
        ...resolution.value,
      });
    }
  }

  const quoteSnapshots = range === "1D"
    ? await loadQuoteSnapshots(
      selectedDefinitions.flatMap((definition) => definition.seedSymbols.slice(0, 3)),
    )
    : null;

  const subThemeResults = await mapWithConcurrency(selectedDefinitions, 3, async (definition) => {
    const symbols = definition.seedSymbols.slice(0, 3);
    const snapshots = quoteSnapshots
      ? symbols
        .map((symbol) => quoteSnapshots.get(symbol.trim().toUpperCase()))
        .filter((snapshot): snapshot is SymbolSnapshot => Boolean(snapshot))
      : (await mapWithConcurrency(symbols, symbolConcurrency, (symbol) =>
        loadSymbolSnapshot(symbol, range, request.nextUrl.origin),
      )).filter((snapshot): snapshot is SymbolSnapshot => Boolean(snapshot));
    const changePercent = average(snapshots.map((snapshot) => snapshot.changePercent));

    return {
      change: snapshots.length ? formatSignedPercent(changePercent) : "—",
      groupSlug: definition.themeGroupSlug,
      slug: definition.slug,
      tone: snapshots.length ? toneFromNumber(changePercent) : "flat" as const,
      tickers: snapshots
        .slice()
        .sort((left, right) => right.changePercent - left.changePercent)
        .map((snapshot) => ({ symbol: snapshot.symbol, change: formatSignedPercent(snapshot.changePercent) })),
    };
  });

  const subThemes = subThemeResults.filter((result): result is NonNullable<typeof result> => Boolean(result));
  const groups = themeGroups.flatMap((group) => {
    const rows = subThemes.filter((subTheme) => subTheme.groupSlug === group.slug && subTheme.change !== "—");
    if (!rows.length) return [];
    const changePercent = average(rows.map((row) => parsePercent(row.change)));
    return [{
      slug: group.slug,
      change: formatSignedPercent(changePercent),
      tone: toneFromNumber(changePercent),
    }];
  });

  const cacheWrite = await writeMarketGroupSnapshots(
    selectedDefinitions.map((definition, index) => {
      const result = subThemes.find((subTheme) => subTheme.slug === definition.slug);
      const tickers = result?.tickers || [];

      return {
        changePercent: result?.change === "\u2014" ? 0 : parsePercent(result?.change || "0"),
        constituentSymbols: definition.seedSymbols.slice(0, 3),
        groupKey: definition.slug,
        groupName: definition.name,
        interval,
        parentKey: definition.themeGroupSlug,
        providerLabel: range === "1D" ? "FMP quote snapshot" : "Market bar cache",
        range: range as PriceRange,
        rawPayload: {
          calculation_version: themeCalculationVersion,
          has_data: tickers.length > 0,
        },
        scope: "sub_theme",
        sortOrder: index,
        topMovers: tickers.map((ticker) => ({
          changePercent: parsePercent(ticker.change),
          symbol: ticker.symbol,
        })),
        trendPoints: [],
      } satisfies MarketGroupSnapshotPayload;
    }),
  );

  return NextResponse.json({
    ok: true,
    cache: forceRefresh ? "bypass" : "miss",
    cacheWrite: cacheWrite.ok ? "ok" : "skipped",
    cacheWriteError: cacheWrite.ok ? undefined : cacheWrite.error,
    range,
    interval,
    groups,
    subThemes,
  });
}

function hydrateCachedThemePerformance(
  snapshots: MarketGroupSnapshotPayload[],
  definitions: typeof themeSubThemes,
) {
  const cachedBySlug = new Map(
    snapshots
      .filter((snapshot) => snapshot.scope === "sub_theme" && hasCurrentThemeCalculation(snapshot))
      .map((snapshot) => [snapshot.groupKey, snapshot]),
  );

  if (!definitions.every((definition) => cachedBySlug.has(definition.slug))) {
    return null;
  }

  const subThemes = definitions.map((definition) => {
    const snapshot = cachedBySlug.get(definition.slug)!;
    const hasData = readRawBoolean(snapshot.rawPayload, "has_data");
    return {
      change: hasData ? formatSignedPercent(snapshot.changePercent) : "\u2014",
      groupSlug: definition.themeGroupSlug,
      slug: definition.slug,
      tickers: hasData
        ? snapshot.topMovers.map((mover) => ({
          change: formatSignedPercent(mover.changePercent),
          symbol: mover.symbol,
        }))
        : [],
      tone: hasData ? toneFromNumber(snapshot.changePercent) : "flat" as const,
    };
  });

  const groups = themeGroups.flatMap((group) => {
    const rows = subThemes.filter(
      (subTheme) => subTheme.groupSlug === group.slug && subTheme.change !== "\u2014",
    );
    if (!rows.length) return [];
    const changePercent = average(rows.map((row) => parsePercent(row.change)));
    return [{
      change: formatSignedPercent(changePercent),
      slug: group.slug,
      tone: toneFromNumber(changePercent),
    }];
  });

  return { groups, subThemes };
}

function hasCurrentThemeCalculation(snapshot: MarketGroupSnapshotPayload) {
  return readRawNumber(snapshot.rawPayload, "calculation_version") === themeCalculationVersion;
}

function readRawNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function readRawBoolean(value: unknown, key: string) {
  if (!value || typeof value !== "object") return false;
  return (value as Record<string, unknown>)[key] === true;
}

async function loadQuoteSnapshots(symbols: string[]) {
  const snapshots = new Map<string, SymbolSnapshot>();
  const normalizedSymbols = Array.from(
    new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean)),
  );
  if (!normalizedSymbols.length) return snapshots;

  const result = await fetchFmpQuotes(normalizedSymbols);
  if (!Array.isArray(result.data)) return snapshots;

  for (const raw of result.data as FmpQuoteRow[]) {
    const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
    const changePercent = finiteNumber(raw.changePercentage) ?? finiteNumber(raw.changePercent);
    if (!symbol || changePercent === undefined) continue;
    snapshots.set(symbol, { changePercent, symbol });
  }

  return snapshots;
}

async function loadSymbolSnapshot(symbol: string, range: ThemeRange, origin: string): Promise<SymbolSnapshot | null> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) return null;
  const interval = chartIntervalForRange(range as PriceRange);
  const cached = await readMarketBarCache(normalizedSymbol, range as PriceRange, interval);
  if (cached.hit && cached.data) {
    return {
      symbol: normalizedSymbol,
      changePercent: range === "1D" ? cached.data.changePercent : changeFromPoints(cached.data.points),
    };
  }

  const url = new URL("/api/market/chart", origin);
  url.searchParams.set("symbol", normalizedSymbol);
  url.searchParams.set("range", range);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: prelaunchInternalRequestHeaders(),
    });
    const data = (await response.json().catch(() => null)) as ChartApiResponse | null;
    if (!response.ok || !data?.ok || !Array.isArray(data.points)) return null;
    const changePercent =
      range === "1D" && typeof data.changePercent === "number" && Number.isFinite(data.changePercent)
        ? data.changePercent
        : changeFromPoints(data.points);
    return Number.isFinite(changePercent) ? { symbol: normalizedSymbol, changePercent } : null;
  } catch {
    return null;
  }
}

function changeFromPoints(points: PricePoint[]) {
  const closes = points.map((point) => point.close).filter((value) => Number.isFinite(value) && value > 0);
  if (closes.length < 2) return 0;
  return ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
}

function normalizeRange(value: string | null): ThemeRange {
  return supportedRanges.includes(value as ThemeRange) ? value as ThemeRange : "1D";
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePercent(value: string) {
  const parsed = Number(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function toneFromNumber(value: number) {
  if (value >= 0.75) return "bullish" as const;
  if (value > 0) return "warm" as const;
  if (value <= -0.25) return "bearish" as const;
  return "flat" as const;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await mapper(items[index]);
      }
    }),
  );
  return output;
}
