import { NextRequest, NextResponse } from "next/server";
import {
  chartIntervalForRange,
  readMarketBarCache,
  readMarketGroupSnapshotCache,
  writeMarketGroupSnapshots,
  type MarketGroupSnapshotPayload,
} from "@/lib/marketDataCache";
import type { PricePoint, PriceRange } from "@/lib/marketTypes";
import { fetchFmpQuotes } from "@/lib/integrations";
import { supabaseSelect } from "@/lib/supabase";
import { sectorMappings } from "@/lib/taxonomyRegistry";

export const dynamic = "force-dynamic";

const supportedRanges = ["1D", "5D", "1M", "3M"] as const;
const industryCoverageTarget = 0.85;
const groupSnapshotMinMarketCap = 300_000_000;
const minIndustryConstituents = 8;
const maxIndustryConstituents = 75;
const snapshotConcurrency = 6;
const rangeCalculationVersion = 3;

type SectorRange = (typeof supportedRanges)[number];
type SectorMoverTone = "bullish" | "warm" | "flat" | "bearish";

type ApiSector = {
  sector: string;
  change: string;
  tone: SectorMoverTone;
  volume: string;
  industries: ApiIndustry[];
};

type ApiIndustry = {
  name: string;
  change: string;
  tickers: string[];
  tickerMovers: Array<{
    symbol: string;
    change: string;
  }>;
  coverageLabel?: string;
  coverageMeta?: {
    targetPercent: number;
    actualPercent: number;
    minMarketCap: number;
    selectedCount: number;
    totalCount: number;
    selectedMarketCap: number;
    totalMarketCap: number;
  };
  tone: SectorMoverTone;
  marketCap: string;
  trend: number[];
};

type SymbolSnapshot = {
  symbol: string;
  changePercent: number;
  latestPrice?: number;
  trend: number[];
};

type IndustryConstituent = {
  symbol: string;
  marketCap: number;
};

type IndustryCoverage = {
  constituents: IndustryConstituent[];
  coveragePercent: number;
  selectedMarketCap: number;
  totalMarketCap: number;
  totalSymbols: number;
};

type ChartApiResponse = {
  ok?: boolean;
  latestPrice?: number;
  changePercent?: number;
  points?: PricePoint[];
};

type FmpQuoteRow = {
  symbol?: unknown;
  changePercentage?: unknown;
  changePercent?: unknown;
  price?: unknown;
};

const sectorEtfSymbols: Record<string, string> = {
  Technology: "XLK",
  "Communication Services": "XLC",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  Healthcare: "XLV",
  "Financial Services": "XLF",
  Industrials: "XLI",
  Energy: "XLE",
  Utilities: "XLU",
  "Basic Materials": "XLB",
  "Real Estate": "XLRE",
  Other: "SPY",
};

export async function GET(request: NextRequest) {
  const range = normalizeRange(request.nextUrl.searchParams.get("range"));
  const interval = chartIntervalForRange(range);
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
  const sectorOrder = Array.from(new Set(sectorMappings.map((item) => item.sector)));
  const requestedSector = sectorOrder.includes(String(request.nextUrl.searchParams.get("sector") || ""))
    ? String(request.nextUrl.searchParams.get("sector"))
    : sectorOrder[0] || "Technology";

  if (!forceRefresh) {
    const cached = await readMarketGroupSnapshotCache(range, interval);
    const cachedSectors = hydrateCachedSectors(cached.snapshots);
    if (
      cached.hit &&
      hasCurrentRangeCalculation(cached.snapshots) &&
      cachedSectors.length &&
      cachedSectors.find((sector) => sector.sector === requestedSector)?.industries.length
    ) {
      return NextResponse.json({
        ok: true,
        cache: "hit",
        range,
        interval,
        sectors: cachedSectors,
      });
    }
  }

  const sectors = await buildLiveSectors(range, request.nextUrl.origin, requestedSector);
  const snapshots = flattenSnapshots(sectors, range, interval);
  const cacheWrite = await writeMarketGroupSnapshots(snapshots);

  return NextResponse.json({
    ok: true,
    cache: forceRefresh ? "bypass" : "miss",
    cacheWrite: cacheWrite.ok ? "ok" : "skipped",
    cacheWriteError: cacheWrite.ok ? undefined : cacheWrite.error,
    range,
    interval,
    sectors,
  });
}

async function buildLiveSectors(range: SectorRange, origin: string, requestedSector: string): Promise<ApiSector[]> {
  const sectorOrder = Array.from(new Set(sectorMappings.map((item) => item.sector)));

  if (range === "1D") {
    const sectorSymbols = sectorOrder.map((sector) => sectorEtfSymbols[sector] || "SPY");
    const [sectorSnapshots, industries] = await Promise.all([
      loadQuoteSnapshots(sectorSymbols),
      buildLiveIndustriesFromQuotes(requestedSector),
    ]);

    return sectorOrder.map((sector) => {
      const proxySymbol = sectorEtfSymbols[sector] || "SPY";
      const sectorChange = sectorSnapshots.get(proxySymbol)?.changePercent;

      return {
        change: sectorChange === undefined ? "\u2014" : formatSignedPercent(sectorChange),
        industries: sector === requestedSector ? industries : [],
        sector,
        tone: sectorChange === undefined ? "flat" as const : toneFromNumber(sectorChange),
        volume: "Live market data",
      };
    });
  }

  return Promise.all(
    sectorOrder.map(async (sector) => {
      const proxySymbol = sectorEtfSymbols[sector] || "SPY";
      const sectorSnapshot = await loadSymbolSnapshot(proxySymbol, range, origin);
      const sectorChange = sectorSnapshot?.changePercent;

      return {
        change: sectorChange === undefined ? "—" : formatSignedPercent(sectorChange),
        industries: sector === requestedSector ? await buildLiveIndustries(sector, range, origin) : [],
        sector,
        tone: sectorChange === undefined ? "flat" as const : toneFromNumber(sectorChange),
        volume: "Live market data",
      };
    }),
  );
}

async function buildLiveIndustries(sector: string, range: SectorRange, origin: string): Promise<ApiIndustry[]> {
  const mappings = sectorMappings.filter((item) => item.sector === sector);

  const industries: Array<ApiIndustry | null> = await Promise.all(
    mappings.map(async (mapping) => {
      const coverage = await loadIndustryCoverage(mapping.slug);
      if (!coverage?.constituents.length) return null;
      const symbols = coverage.constituents.map((item) => item.symbol);
      const marketCapBySymbol = new Map(
        coverage.constituents.map((item) => [item.symbol, item.marketCap] as const),
      );
      const symbolSnapshots = (await mapWithConcurrency(symbols, snapshotConcurrency, (symbol) => loadSymbolSnapshot(symbol, range, origin)))
        .filter((item): item is SymbolSnapshot => Boolean(item));
      if (!symbolSnapshots.length) return null;
      const changePercent = weightedAverage(
        symbolSnapshots.map((item) => ({
          value: item.changePercent,
          weight: marketCapBySymbol.get(item.symbol) || 1,
        })),
      );
      const trend = weightedAverageSeries(
        symbolSnapshots.map((item) => ({
          values: item.trend,
          weight: marketCapBySymbol.get(item.symbol) || 1,
        })),
      );
      const topMovers = symbolSnapshots
        .slice()
        .sort((a, b) => b.changePercent - a.changePercent)
        .map((item) => ({
          change: formatSignedPercent(item.changePercent),
          symbol: item.symbol,
        }));

      return {
        change: formatSignedPercent(changePercent),
        coverageLabel: formatCoverageLabel(coverage),
        coverageMeta: toCoverageMeta(coverage),
        marketCap: formatMarketCap(coverage.totalMarketCap),
        name: mapping.subCategory,
        tickerMovers: topMovers,
        tickers: symbols,
        tone: toneFromNumber(changePercent),
        trend,
      };
    }),
  );
  return industries.filter((industry): industry is ApiIndustry => industry !== null);
}

async function loadSymbolSnapshot(symbol: string, range: SectorRange, origin: string): Promise<SymbolSnapshot | null> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) return null;

  const interval = chartIntervalForRange(range);
  const cached = await readMarketBarCache(normalizedSymbol, range, interval);
  if (cached.hit && cached.data) {
    return {
      changePercent:
        range === "1D" ? cached.data.changePercent : changeFromPoints(cached.data.points),
      latestPrice: cached.data.latestPrice,
      symbol: normalizedSymbol,
      trend: normalizeCloseSeries(cached.data.points, 18),
    };
  }

  const url = new URL("/api/market/chart", origin);
  url.searchParams.set("symbol", normalizedSymbol);
  url.searchParams.set("range", range);

  try {
    const response = await fetch(url, { cache: "no-store" });
    const data = (await response.json().catch(() => null)) as ChartApiResponse | null;
    if (!response.ok || !data?.ok || !Array.isArray(data.points)) return null;

    return {
      changePercent:
        range === "1D" && typeof data.changePercent === "number" && Number.isFinite(data.changePercent)
          ? data.changePercent
          : changeFromPoints(data.points),
      latestPrice: typeof data.latestPrice === "number" ? data.latestPrice : undefined,
      symbol: normalizedSymbol,
      trend: normalizeCloseSeries(data.points, 18),
    };
  } catch {
    return null;
  }
}

function hydrateCachedSectors(snapshots: MarketGroupSnapshotPayload[]): ApiSector[] {
  const sectorRows = snapshots
    .filter((item) => item.scope === "sector")
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const industryRows = snapshots
    .filter((item) => item.scope === "industry_group" && hasSnapshotCalculationVersion(item))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return sectorRows.map((sector) => ({
    change: formatSignedPercent(sector.changePercent),
    industries: industryRows
      .filter((industry) => industry.parentKey === sector.groupKey)
      .map((industry) => ({
        change: formatSignedPercent(industry.changePercent),
        marketCap: industry.marketCapLabel || "-",
        name: industry.groupName,
        tickerMovers: industry.topMovers.map((ticker) => ({
          change: formatSignedPercent(ticker.changePercent),
          symbol: ticker.symbol,
        })),
        coverageLabel: readCoverageLabel(industry.rawPayload),
        coverageMeta: readCoverageMeta(industry.rawPayload),
        tickers: industry.constituentSymbols,
        tone: toneFromNumber(industry.changePercent),
        trend: industry.trendPoints,
      })),
    sector: sector.groupName,
    tone: toneFromNumber(sector.changePercent),
    volume: String((sector.rawPayload as { volume?: string } | undefined)?.volume || "Live market data"),
  }));
}

function flattenSnapshots(
  sectors: ApiSector[],
  range: SectorRange,
  interval: string,
): MarketGroupSnapshotPayload[] {
  return sectors.flatMap((sector, sectorIndex) => {
    if (sector.change === "—") return [];
    const sectorKey = slugify(sector.sector);
    const sectorSnapshot: MarketGroupSnapshotPayload = {
      changePercent: parsePercent(sector.change),
      constituentSymbols: [sectorEtfSymbols[sector.sector] || "SPY"],
      groupKey: sectorKey,
      groupName: sector.sector,
      interval,
      providerLabel: "Polygon/FMP aggregate",
      range,
      rawPayload: { calculationVersion: rangeCalculationVersion, volume: sector.volume },
      scope: "sector",
      sortOrder: sectorIndex * 100,
      topMovers: [],
      trendPoints: [],
    };

    const industrySnapshots = sector.industries.map((industry, industryIndex) => ({
      changePercent: parsePercent(industry.change),
      constituentSymbols: industry.tickers,
      groupKey: `${sectorKey}:${slugify(industry.name)}`,
      groupName: industry.name,
      interval,
      marketCapLabel: industry.marketCap,
      parentKey: sectorKey,
      providerLabel: "Polygon/FMP aggregate",
      range,
      rawPayload: {
        calculationVersion: rangeCalculationVersion,
        coverage: industry.coverageMeta,
        coverageLabel: industry.coverageLabel,
        minMarketCap: groupSnapshotMinMarketCap,
        coverageTarget: industryCoverageTarget,
      },
      scope: "industry_group" as const,
      sortOrder: sectorIndex * 100 + industryIndex + 1,
      topMovers: industry.tickerMovers.map((ticker) => ({
        changePercent: parsePercent(ticker.change),
        symbol: ticker.symbol,
      })),
      trendPoints: industry.trend,
    }));

    return [sectorSnapshot, ...industrySnapshots];
  });
}

function hasCurrentRangeCalculation(snapshots: MarketGroupSnapshotPayload[]) {
  const sectorSnapshots = snapshots.filter((snapshot) => snapshot.scope === "sector");
  return (
    sectorSnapshots.length > 0 &&
    sectorSnapshots.every((snapshot) => {
      return hasSnapshotCalculationVersion(snapshot);
    })
  );
}

async function buildLiveIndustriesFromQuotes(sector: string): Promise<ApiIndustry[]> {
  const mappings = sectorMappings.filter((item) => item.sector === sector);
  const coverageRows = await Promise.all(
    mappings.map(async (mapping) => ({
      coverage: await loadIndustryCoverage(mapping.slug),
      mapping,
    })),
  );
  const symbols = Array.from(
    new Set(
      coverageRows.flatMap((row) =>
        row.coverage?.constituents.map((item) => item.symbol) || [],
      ),
    ),
  );
  const snapshots = await loadQuoteSnapshots(symbols);

  return coverageRows.flatMap(({ coverage, mapping }) => {
    if (!coverage?.constituents.length) return [];
    const marketCapBySymbol = new Map(
      coverage.constituents.map((item) => [item.symbol, item.marketCap] as const),
    );
    const symbolSnapshots = coverage.constituents
      .map((item) => snapshots.get(item.symbol))
      .filter((item): item is SymbolSnapshot => Boolean(item));
    if (!symbolSnapshots.length) return [];
    const changePercent = weightedAverage(
      symbolSnapshots.map((item) => ({
        value: item.changePercent,
        weight: marketCapBySymbol.get(item.symbol) || 1,
      })),
    );
    const topMovers = symbolSnapshots
      .slice()
      .sort((left, right) => right.changePercent - left.changePercent)
      .map((item) => ({
        change: formatSignedPercent(item.changePercent),
        symbol: item.symbol,
      }));

    return [{
      change: formatSignedPercent(changePercent),
      coverageLabel: formatCoverageLabel(coverage),
      coverageMeta: toCoverageMeta(coverage),
      marketCap: formatMarketCap(coverage.totalMarketCap),
      name: mapping.subCategory,
      tickerMovers: topMovers,
      tickers: coverage.constituents.map((item) => item.symbol),
      tone: toneFromNumber(changePercent),
      trend: [],
    }];
  });
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
    const symbol = stringOrEmpty(raw.symbol).toUpperCase();
    const changePercent = numberOrUndefined(raw.changePercentage) ??
      numberOrUndefined(raw.changePercent);
    if (!symbol || changePercent === undefined) continue;
    snapshots.set(symbol, {
      changePercent,
      latestPrice: numberOrUndefined(raw.price),
      symbol,
      trend: [],
    });
  }

  return snapshots;
}

function hasSnapshotCalculationVersion(snapshot: MarketGroupSnapshotPayload) {
  if (!snapshot.rawPayload || typeof snapshot.rawPayload !== "object") return false;
  return (snapshot.rawPayload as { calculationVersion?: unknown }).calculationVersion === rangeCalculationVersion;
}

async function loadIndustryCoverage(subCategorySlug: string): Promise<IndustryCoverage | null> {
  const classifications = await supabaseSelect("ticker_classifications", {
    select: "symbol,sub_category_slug",
    sub_category_slug: `eq.${subCategorySlug}`,
    limit: "1000",
  });

  if (!classifications.ok || !Array.isArray(classifications.data) || !classifications.data.length) {
    return null;
  }

  const symbols = Array.from(
    new Set(
      classifications.data
        .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>).symbol : null))
        .filter((symbol): symbol is string => typeof symbol === "string" && Boolean(symbol))
        .map((symbol) => symbol.toUpperCase()),
    ),
  );

  if (!symbols.length) return null;

  const profiles = await loadTickerProfiles(symbols);
  return selectCoverageConstituents(profiles);
}

async function loadTickerProfiles(symbols: string[]): Promise<IndustryConstituent[]> {
  const chunks = chunk(symbols, 100);
  const rows = await Promise.all(
    chunks.map(async (items) => {
      const result = await supabaseSelect("tickers", {
        select: "symbol,market_cap,is_active",
        symbol: `in.(${items.join(",")})`,
        is_active: "eq.true",
        limit: String(items.length),
      });

      if (!result.ok || !Array.isArray(result.data)) return [];

      return result.data
        .map((row) => {
          if (!row || typeof row !== "object") return null;
          const item = row as Record<string, unknown>;
          const symbol = stringOrEmpty(item.symbol).toUpperCase();
          const marketCap = numberOrZero(item.market_cap);
          if (!symbol || marketCap < groupSnapshotMinMarketCap) return null;
          return { marketCap, symbol };
        })
        .filter((item): item is IndustryConstituent => Boolean(item));
    }),
  );

  return rows.flat();
}

function selectCoverageConstituents(items: IndustryConstituent[]): IndustryCoverage | null {
  const sorted = items
    .filter((item) => item.marketCap > 0)
    .sort((a, b) => b.marketCap - a.marketCap);

  if (!sorted.length) return null;

  const totalMarketCap = sorted.reduce((sum, item) => sum + item.marketCap, 0);
  const selected: IndustryConstituent[] = [];
  let selectedMarketCap = 0;

  for (const item of sorted) {
    if (selected.length >= maxIndustryConstituents) break;

    selected.push(item);
    selectedMarketCap += item.marketCap;

    const hasMinimumSize = selected.length >= Math.min(minIndustryConstituents, sorted.length);
    const reachedCoverage = selectedMarketCap / totalMarketCap >= industryCoverageTarget;
    if (hasMinimumSize && reachedCoverage) break;
  }

  return {
    constituents: selected,
    coveragePercent: totalMarketCap ? (selectedMarketCap / totalMarketCap) * 100 : 0,
    selectedMarketCap,
    totalMarketCap,
    totalSymbols: sorted.length,
  };
}

function normalizeCloseSeries(points: PricePoint[], targetLength: number) {
  const closes = points
    .map((point) => point.close)
    .filter((close) => typeof close === "number" && Number.isFinite(close));
  if (closes.length < 2) return [];

  const length = Math.min(targetLength, closes.length);
  const sampled = Array.from({ length }, (_, index) => {
    const sourceIndex = Math.round((index / Math.max(length - 1, 1)) * (closes.length - 1));
    return closes[sourceIndex];
  });
  const base = sampled[0] || 1;
  return sampled.map((close) => Number(((close / base) * 100).toFixed(3)));
}

function averageSeries(series: number[][]) {
  const usable = series.filter((item) => item.length > 1);
  if (!usable.length) return [];

  const length = Math.min(...usable.map((item) => item.length));
  return Array.from({ length }, (_, index) => Number(average(usable.map((item) => item[index])).toFixed(3)));
}

function weightedAverageSeries(series: Array<{ values: number[]; weight: number }>) {
  const usable = series.filter((item) => item.values.length > 1 && item.weight > 0);
  if (!usable.length) return [];

  const length = Math.min(...usable.map((item) => item.values.length));
  return Array.from({ length }, (_, index) =>
    Number(
      weightedAverage(
        usable.map((item) => ({
          value: item.values[index],
          weight: item.weight,
        })),
      ).toFixed(3),
    ),
  );
}

function changeFromPoints(points: PricePoint[]) {
  if (points.length < 2) return 0;
  const first = points[0].close;
  const last = points[points.length - 1].close;
  return first ? ((last - first) / first) * 100 : 0;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function weightedAverage(values: Array<{ value: number; weight: number }>) {
  const usable = values.filter((item) => Number.isFinite(item.value) && item.weight > 0);
  const weightSum = usable.reduce((sum, item) => sum + item.weight, 0);
  if (!usable.length || weightSum <= 0) return 0;
  return usable.reduce((sum, item) => sum + item.value * item.weight, 0) / weightSum;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function numberOrZero(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrUndefined(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringOrEmpty(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeRange(value: string | null): SectorRange {
  return supportedRanges.includes(value as SectorRange) ? (value as SectorRange) : "1D";
}

function parsePercent(value: string) {
  return Number(value.replace("%", "")) || 0;
}

function formatSignedPercent(value: number) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function toneFromNumber(value: number): SectorMoverTone {
  if (value < 0) return "bearish";
  if (value < 0.5) return "flat";
  if (value < 1.2) return "warm";
  return "bullish";
}

function formatMarketCap(value: number) {
  if (value >= 1_000_000_000_000) return `$${(value / 1_000_000_000_000).toFixed(2)}T`;
  if (value >= 1_000_000_000) return `$${Math.round(value / 1_000_000_000)}B`;
  if (value >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`;
  return "$0";
}

function formatCoverageLabel(coverage: IndustryCoverage) {
  return `Coverage ${Math.round(coverage.coveragePercent)}% / ${coverage.constituents.length} stocks`;
}

function toCoverageMeta(coverage: IndustryCoverage) {
  return {
    actualPercent: Number(coverage.coveragePercent.toFixed(2)),
    minMarketCap: groupSnapshotMinMarketCap,
    selectedCount: coverage.constituents.length,
    selectedMarketCap: Math.round(coverage.selectedMarketCap),
    targetPercent: industryCoverageTarget * 100,
    totalCount: coverage.totalSymbols,
    totalMarketCap: Math.round(coverage.totalMarketCap),
  };
}

function readCoverageLabel(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== "object") return undefined;
  const value = (rawPayload as Record<string, unknown>).coverageLabel;
  return typeof value === "string" && value ? value : undefined;
}

function readCoverageMeta(rawPayload: unknown): ApiIndustry["coverageMeta"] | undefined {
  if (!rawPayload || typeof rawPayload !== "object") return undefined;
  const value = (rawPayload as Record<string, unknown>).coverage;
  if (!value || typeof value !== "object") return undefined;

  const item = value as Record<string, unknown>;
  return {
    actualPercent: numberOrZero(item.actualPercent),
    minMarketCap: numberOrZero(item.minMarketCap),
    selectedCount: numberOrZero(item.selectedCount),
    selectedMarketCap: numberOrZero(item.selectedMarketCap),
    targetPercent: numberOrZero(item.targetPercent),
    totalCount: numberOrZero(item.totalCount),
    totalMarketCap: numberOrZero(item.totalMarketCap),
  };
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
