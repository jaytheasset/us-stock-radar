import { NextRequest, NextResponse } from "next/server";
import {
  chartIntervalForRange,
  readMarketBarCache,
  readMarketGroupSnapshotCache,
  writeMarketGroupSnapshots,
  type MarketGroupSnapshotPayload,
} from "@/lib/marketDataCache";
import type { PricePoint, PriceRange } from "@/lib/marketTypes";
import { supabaseSelect } from "@/lib/supabase";
import { sectorMappings } from "@/lib/taxonomyRegistry";

export const dynamic = "force-dynamic";

const supportedRanges = ["1D", "5D", "1M", "3M"] as const;
const industryCoverageTarget = 0.85;
const groupSnapshotMinMarketCap = 300_000_000;
const minIndustryConstituents = 8;
const maxIndustryConstituents = 75;
const snapshotConcurrency = 6;

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

const sectorFallbacks: Record<string, { change: string; tone: SectorMoverTone; volume: string }> = {
  Technology: { change: "+2.84%", tone: "bullish", volume: "1.34x volume" },
  "Communication Services": { change: "+1.21%", tone: "bullish", volume: "1.12x volume" },
  "Consumer Cyclical": { change: "+0.63%", tone: "warm", volume: "0.98x volume" },
  "Consumer Defensive": { change: "+0.22%", tone: "flat", volume: "0.91x volume" },
  Healthcare: { change: "+1.96%", tone: "bullish", volume: "1.18x volume" },
  "Financial Services": { change: "+0.88%", tone: "warm", volume: "0.96x volume" },
  Industrials: { change: "+1.05%", tone: "bullish", volume: "1.03x volume" },
  Energy: { change: "+1.42%", tone: "bullish", volume: "1.09x volume" },
  Utilities: { change: "+0.18%", tone: "flat", volume: "0.86x volume" },
  "Basic Materials": { change: "-0.72%", tone: "bearish", volume: "0.89x volume" },
  "Real Estate": { change: "-0.31%", tone: "bearish", volume: "0.84x volume" },
  Other: { change: "+0.04%", tone: "flat", volume: "0.61x volume" },
};

const sectorTickerFallbacks: Record<string, string[]> = {
  Technology: ["NVDA", "MSFT", "AAPL"],
  "Communication Services": ["META", "GOOGL", "NFLX"],
  "Consumer Cyclical": ["TSLA", "AMZN", "HD"],
  "Consumer Defensive": ["WMT", "COST", "KO"],
  Healthcare: ["LLY", "UNH", "MRK"],
  "Financial Services": ["JPM", "BAC", "V"],
  Industrials: ["GE", "CAT", "BA"],
  Energy: ["XOM", "CVX", "COP"],
  Utilities: ["NEE", "DUK", "SO"],
  "Basic Materials": ["FCX", "NEM", "DOW"],
  "Real Estate": ["PLD", "AMT", "SPG"],
  Other: ["SPY", "QQQ", "IWM"],
};

const industrySeeds: Record<
  string,
  {
    change: string;
    marketCap: string;
    tickers: string[];
    trend: number[];
  }
> = {
  "Semiconductors & Compute": {
    change: "+4.32%",
    marketCap: "$2.56T",
    tickers: ["NVDA", "AMD", "AVGO", "MU"],
    trend: [26, 31, 29, 36, 42, 40, 48, 52, 50, 58, 63, 67],
  },
  "Software & Cloud": {
    change: "+2.18%",
    marketCap: "$1.89T",
    tickers: ["MSFT", "ORCL", "SNOW", "DDOG"],
    trend: [32, 35, 34, 39, 42, 44, 43, 48, 50, 54, 55, 59],
  },
  Cybersecurity: {
    change: "+0.41%",
    marketCap: "$420B",
    tickers: ["CRWD", "PANW", "ZS"],
    trend: [42, 41, 43, 45, 44, 46, 47, 49, 48, 50, 51, 52],
  },
  "IT Services": {
    change: "+0.74%",
    marketCap: "$820B",
    tickers: ["ACN", "IBM", "INFY"],
    trend: [38, 39, 40, 41, 43, 42, 44, 45, 47, 46, 48, 49],
  },
  "Hardware & Electronics": {
    change: "+1.07%",
    marketCap: "$1.24T",
    tickers: ["AAPL", "DELL", "HPQ"],
    trend: [45, 44, 46, 47, 49, 48, 50, 53, 52, 55, 57, 58],
  },
};

export async function GET(request: NextRequest) {
  const range = normalizeRange(request.nextUrl.searchParams.get("range"));
  const interval = chartIntervalForRange(range);
  const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";

  if (!forceRefresh) {
    const cached = await readMarketGroupSnapshotCache(range, interval);
    const cachedSectors = hydrateCachedSectors(cached.snapshots);
    if (cached.hit && cachedSectors.length && cachedSectors[0]?.industries.length) {
      return NextResponse.json({
        ok: true,
        cache: "hit",
        range,
        interval,
        sectors: cachedSectors,
      });
    }
  }

  const sectors = await buildLiveSectors(range, request.nextUrl.origin);
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

async function buildLiveSectors(range: SectorRange, origin: string): Promise<ApiSector[]> {
  const sectorOrder = Array.from(new Set(sectorMappings.map((item) => item.sector)));
  const selectedSector = sectorOrder[0] || "Technology";

  return Promise.all(
    sectorOrder.map(async (sector, sectorIndex) => {
      const fallback = sectorFallbacks[sector] || { change: "+0.00%", tone: "flat" as const, volume: "0.80x volume" };
      const proxySymbol = sectorEtfSymbols[sector] || sectorTickerFallbacks[sector]?.[0] || "SPY";
      const sectorSnapshot = await loadSymbolSnapshot(proxySymbol, range, origin);
      const sectorChange = sectorSnapshot?.changePercent ?? parsePercent(fallback.change);

      return {
        change: formatSignedPercent(sectorChange),
        industries:
          sector === selectedSector
            ? await buildLiveIndustries(sector, range, origin)
            : buildFallbackIndustries(sector, sectorIndex),
        sector,
        tone: toneFromNumber(sectorChange),
        volume: fallback.volume,
      };
    }),
  );
}

async function buildLiveIndustries(sector: string, range: SectorRange, origin: string): Promise<ApiIndustry[]> {
  const mappings = sectorMappings.filter((item) => item.sector === sector);
  const fallbackSymbols = sectorTickerFallbacks[sector] || ["SPY", "QQQ", "IWM"];

  return Promise.all(
    mappings.map(async (mapping, index) => {
      const seed = industrySeeds[mapping.subCategory];
      const coverage = await loadIndustryCoverage(mapping.slug);
      const symbols = coverage?.constituents.map((item) => item.symbol) || (seed?.tickers || fallbackSymbols).slice(0, 4);
      const marketCapBySymbol = new Map(
        coverage?.constituents.map((item) => [item.symbol, item.marketCap] as const) || [],
      );
      const symbolSnapshots = (await mapWithConcurrency(symbols, snapshotConcurrency, (symbol) => loadSymbolSnapshot(symbol, range, origin)))
        .filter((item): item is SymbolSnapshot => Boolean(item));
      const changePercent = symbolSnapshots.length
        ? weightedAverage(
            symbolSnapshots.map((item) => ({
              value: item.changePercent,
              weight: marketCapBySymbol.get(item.symbol) || 1,
            })),
          )
        : parsePercent(seed?.change || "+0.00%");
      const trend = symbolSnapshots.length
        ? weightedAverageSeries(
            symbolSnapshots.map((item) => ({
              values: item.trend,
              weight: marketCapBySymbol.get(item.symbol) || 1,
            })),
          )
        : seed?.trend || buildMiniTrend(index, changePercent < 0 ? "bearish" : "bullish");
      const topMovers = symbolSnapshots.length
        ? symbolSnapshots
            .slice()
            .sort((a, b) => b.changePercent - a.changePercent)
            .map((item) => ({
              change: formatSignedPercent(item.changePercent),
              symbol: item.symbol,
            }))
        : buildTickerMovers(symbols, seed?.change || "+0.00%", index);

      return {
        change: formatSignedPercent(changePercent),
        coverageLabel: coverage ? formatCoverageLabel(coverage) : undefined,
        coverageMeta: coverage ? toCoverageMeta(coverage) : undefined,
        marketCap: coverage ? formatMarketCap(coverage.totalMarketCap) : seed?.marketCap || estimateMarketCap(index, mappings.length),
        name: mapping.subCategory,
        tickerMovers: topMovers,
        tickers: symbols,
        tone: toneFromNumber(changePercent),
        trend,
      };
    }),
  );
}

function buildFallbackIndustries(sector: string, sectorIndex: number): ApiIndustry[] {
  const mappings = sectorMappings.filter((item) => item.sector === sector);
  const fallbackSymbols = sectorTickerFallbacks[sector] || ["SPY", "QQQ", "IWM"];
  const sectorBase = parsePercent(sectorFallbacks[sector]?.change || "+0.00%");

  return mappings.map((mapping, index) => {
    const generatedChange = sectorBase - index * 0.27 + 0.38;
    const change = formatSignedPercent(generatedChange);

    return {
      change,
        marketCap: estimateMarketCap(index, mappings.length),
        name: mapping.subCategory,
        tickerMovers: buildTickerMovers(fallbackSymbols, change, sectorIndex + index),
        tickers: fallbackSymbols,
        tone: toneFromNumber(generatedChange),
      trend: buildMiniTrend(index, generatedChange < 0 ? "bearish" : "bullish"),
    };
  });
}

async function loadSymbolSnapshot(symbol: string, range: SectorRange, origin: string): Promise<SymbolSnapshot | null> {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!normalizedSymbol) return null;

  const interval = chartIntervalForRange(range);
  const cached = await readMarketBarCache(normalizedSymbol, range, interval);
  if (cached.hit && cached.data) {
    return {
      changePercent: cached.data.changePercent,
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
        typeof data.changePercent === "number" && Number.isFinite(data.changePercent)
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
    .filter((item) => item.scope === "industry_group")
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
    const sectorKey = slugify(sector.sector);
    const sectorSnapshot: MarketGroupSnapshotPayload = {
      changePercent: parsePercent(sector.change),
      constituentSymbols: [sectorEtfSymbols[sector.sector] || "SPY"],
      groupKey: sectorKey,
      groupName: sector.sector,
      interval,
      providerLabel: "Polygon/FMP aggregate",
      range,
      rawPayload: { volume: sector.volume },
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

function buildMiniTrend(index: number, tone: "bullish" | "bearish") {
  const start = tone === "bearish" ? 58 - index * 2 : 28 + index * 3;
  const direction = tone === "bearish" ? -1 : 1;
  return Array.from({ length: 12 }, (_, point) => start + direction * point * 2 + ((point + index) % 3) * 1.4);
}

function buildTickerMovers(symbols: string[], industryChange: string, index: number) {
  const base = parsePercent(industryChange);
  return symbols
    .map((symbol, tickerIndex) => ({
      change: formatSignedPercent(base + 0.72 - tickerIndex * 0.46 - index * 0.08),
      symbol,
    }))
    .sort((a, b) => parsePercent(b.change) - parsePercent(a.change));
}

function estimateMarketCap(index: number, total: number) {
  const base = Math.max(120, 980 - index * Math.max(70, 460 / Math.max(total, 1)));
  return base >= 1000 ? `$${(base / 1000).toFixed(2)}T` : `$${Math.round(base)}B`;
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
