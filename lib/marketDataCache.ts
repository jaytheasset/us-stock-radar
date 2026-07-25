import { supabaseSelect, supabaseUpsert } from "@/lib/supabase";
import type { PricePoint, PriceRange } from "@/lib/marketTypes";

export type MarketQuoteCachePayload = {
  symbol: string;
  provider: string;
  price?: number;
  changeAmount?: number;
  changePercent?: number;
  previousClose?: number;
  volume?: number;
  rawPayload?: unknown;
};

export type MarketBarCachePayload = {
  symbol: string;
  range: PriceRange;
  interval: string;
  provider: "polygon" | "fmp";
  providerLabel: string;
  previousClose: number;
  latestPrice: number;
  changeAmount: number;
  changePercent: number;
  points: PricePoint[];
  rawPayload?: unknown;
};

export type MarketGroupSnapshotPayload = {
  scope: "sector" | "industry_group" | "theme" | "sub_theme";
  groupKey: string;
  groupName: string;
  parentKey?: string | null;
  range: PriceRange;
  interval: string;
  providerLabel: string;
  changePercent: number;
  marketCapLabel?: string | null;
  trendPoints: number[];
  topMovers: Array<{
    symbol: string;
    changePercent: number;
    latestPrice?: number;
  }>;
  constituentSymbols: string[];
  sortOrder: number;
  rawPayload?: unknown;
};

export type MarketQuoteCacheHit = {
  hit: boolean;
  quote?: Omit<MarketQuoteCachePayload, "symbol" | "rawPayload">;
  error?: string;
};

export type MarketBarCacheHit = {
  hit: boolean;
  data?: MarketBarCachePayload;
  error?: string;
};

export type MarketGroupSnapshotCacheHit = {
  hit: boolean;
  snapshots: MarketGroupSnapshotPayload[];
  freshSnapshots: MarketGroupSnapshotPayload[];
  stale: boolean;
  error?: string;
};

export function quoteTtlSeconds() {
  return 60;
}

export function barTtlSeconds(range: PriceRange) {
  switch (range) {
    case "1D":
      return 60;
    case "5D":
      return 300;
    case "1M":
      return 1800;
    case "3M":
    case "1Y":
      return 3600;
  }
}

export function groupSnapshotTtlSeconds(range: PriceRange) {
  switch (range) {
    case "1D":
      return 300;
    case "5D":
      return 900;
    case "1M":
    case "3M":
    case "1Y":
      return 3600;
  }
}

export function chartIntervalForRange(range: PriceRange) {
  switch (range) {
    case "1D":
      return "5min-ext";
    case "5D":
      return "30min-ext";
    case "1M":
      return "2hour-ext";
    case "3M":
    case "1Y":
      return "1day";
  }
}

export async function readMarketQuoteCache(symbol: string): Promise<MarketQuoteCacheHit> {
  const result = await supabaseSelect("market_quotes", {
    select: "symbol,provider,price,change_amount,change_percent,previous_close,volume,expires_at",
    symbol: `eq.${symbol}`,
    expires_at: `gt.${new Date().toISOString()}`,
    limit: "1",
  });

  if (!result.ok) {
    return { hit: false, error: result.error };
  }

  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row || typeof row !== "object") return { hit: false };

  const item = row as Record<string, unknown>;
  return {
    hit: true,
    quote: {
      changeAmount: numberOrUndefined(item.change_amount),
      changePercent: numberOrUndefined(item.change_percent),
      previousClose: numberOrUndefined(item.previous_close),
      price: numberOrUndefined(item.price),
      provider: stringOrFallback(item.provider, "fmp"),
      volume: numberOrUndefined(item.volume),
    },
  };
}

export async function readMarketQuoteCacheMap(symbols: string[]) {
  const uniqueSymbols = normalizeSymbols(symbols);
  if (!uniqueSymbols.length) return new Map<string, Omit<MarketQuoteCachePayload, "symbol" | "rawPayload">>();

  const result = await supabaseSelect("market_quotes", {
    select: "symbol,provider,price,change_amount,change_percent,previous_close,volume,expires_at",
    symbol: postgrestIn(uniqueSymbols),
    expires_at: `gt.${new Date().toISOString()}`,
    limit: String(uniqueSymbols.length),
  });

  if (!result.ok) {
    return new Map<string, Omit<MarketQuoteCachePayload, "symbol" | "rawPayload">>();
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  return new Map(
    rows
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const item = row as Record<string, unknown>;
        const symbol = stringOrFallback(item.symbol, "").toUpperCase();
        if (!symbol) return null;

        return [
          symbol,
          {
            changeAmount: numberOrUndefined(item.change_amount),
            changePercent: numberOrUndefined(item.change_percent),
            previousClose: numberOrUndefined(item.previous_close),
            price: numberOrUndefined(item.price),
            provider: stringOrFallback(item.provider, "fmp"),
            volume: numberOrUndefined(item.volume),
          },
        ] as [string, Omit<MarketQuoteCachePayload, "symbol" | "rawPayload">];
      })
      .filter((entry): entry is [string, Omit<MarketQuoteCachePayload, "symbol" | "rawPayload">] =>
        Boolean(entry),
      ),
  );
}

export async function writeMarketQuoteCache(
  payload: MarketQuoteCachePayload,
  ttlSeconds = quoteTtlSeconds(),
) {
  return supabaseUpsert(
    "market_quotes",
    {
      change_amount: payload.changeAmount ?? null,
      change_percent: payload.changePercent ?? null,
      expires_at: expiresAt(ttlSeconds),
      fetched_at: new Date().toISOString(),
      previous_close: payload.previousClose ?? null,
      price: payload.price ?? null,
      provider: payload.provider,
      raw_payload: payload.rawPayload ?? {},
      symbol: payload.symbol,
      volume: payload.volume ?? null,
    },
    { onConflict: "symbol" },
  );
}

export async function readMarketBarCache(
  symbol: string,
  range: PriceRange,
  interval = chartIntervalForRange(range),
): Promise<MarketBarCacheHit> {
  const result = await supabaseSelect("market_bars", {
    select:
      "symbol,range,interval,provider,provider_label,previous_close,latest_price,change_amount,change_percent,bars,expires_at",
    symbol: `eq.${symbol}`,
    range: `eq.${range}`,
    interval: `eq.${interval}`,
    expires_at: `gt.${new Date().toISOString()}`,
    limit: "1",
  });

  if (!result.ok) {
    return { hit: false, error: result.error };
  }

  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (!row || typeof row !== "object") return { hit: false };

  const item = row as Record<string, unknown>;
  const points = Array.isArray(item.bars) ? item.bars.map(normalizePoint).filter((point): point is PricePoint => Boolean(point)) : [];

  if (!points.length) return { hit: false };

  return {
    hit: true,
    data: {
      changeAmount: numberOrFallback(item.change_amount, 0),
      changePercent: numberOrFallback(item.change_percent, 0),
      interval: stringOrFallback(item.interval, interval),
      latestPrice: numberOrFallback(item.latest_price, points[points.length - 1].close),
      points,
      previousClose: numberOrFallback(item.previous_close, points[0].open),
      provider: stringOrFallback(item.provider, "polygon") === "fmp" ? "fmp" : "polygon",
      providerLabel: stringOrFallback(item.provider_label, "Market cache"),
      range,
      symbol,
    },
  };
}

export async function readMarketBarCacheMap(
  symbols: string[],
  range: PriceRange,
  interval = chartIntervalForRange(range),
) {
  const uniqueSymbols = normalizeSymbols(symbols);
  if (!uniqueSymbols.length) return new Map<string, MarketBarCachePayload>();

  const result = await supabaseSelect("market_bars", {
    select:
      "symbol,range,interval,provider,provider_label,previous_close,latest_price,change_amount,change_percent,bars,expires_at",
    symbol: postgrestIn(uniqueSymbols),
    range: `eq.${range}`,
    interval: `eq.${interval}`,
    expires_at: `gt.${new Date().toISOString()}`,
    limit: String(uniqueSymbols.length),
  });

  if (!result.ok) {
    return new Map<string, MarketBarCachePayload>();
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  return new Map(
    rows
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const item = row as Record<string, unknown>;
        const symbol = stringOrFallback(item.symbol, "").toUpperCase();
        const points = Array.isArray(item.bars)
          ? item.bars.map(normalizePoint).filter((point): point is PricePoint => Boolean(point))
          : [];
        if (!symbol || !points.length) return null;

        return [
          symbol,
          {
            changeAmount: numberOrFallback(item.change_amount, 0),
            changePercent: numberOrFallback(item.change_percent, 0),
            interval: stringOrFallback(item.interval, interval),
            latestPrice: numberOrFallback(item.latest_price, points[points.length - 1].close),
            points,
            previousClose: numberOrFallback(item.previous_close, points[0].open),
            provider: stringOrFallback(item.provider, "polygon") === "fmp" ? "fmp" : "polygon",
            providerLabel: stringOrFallback(item.provider_label, "Market cache"),
            range,
            symbol,
          },
        ] as [string, MarketBarCachePayload];
      })
      .filter((entry): entry is [string, MarketBarCachePayload] => Boolean(entry)),
  );
}

export async function writeMarketBarCache(
  payload: MarketBarCachePayload,
  ttlSeconds = barTtlSeconds(payload.range),
) {
  return supabaseUpsert(
    "market_bars",
    {
      bars: payload.points,
      change_amount: payload.changeAmount,
      change_percent: payload.changePercent,
      expires_at: expiresAt(ttlSeconds),
      fetched_at: new Date().toISOString(),
      interval: payload.interval,
      latest_price: payload.latestPrice,
      previous_close: payload.previousClose,
      provider: payload.provider,
      provider_label: payload.providerLabel,
      range: payload.range,
      raw_payload: payload.rawPayload ?? {},
      symbol: payload.symbol,
    },
    { onConflict: "symbol,range,interval" },
  );
}

export async function readMarketGroupSnapshotCache(
  range: PriceRange,
  interval = chartIntervalForRange(range),
): Promise<MarketGroupSnapshotCacheHit> {
  const now = Date.now();
  const result = await supabaseSelect("market_group_snapshots", {
    select:
      "scope,group_key,group_name,parent_key,range,interval,provider_label,change_percent,market_cap_label,trend_points,top_movers,constituent_symbols,sort_order,raw_payload,expires_at",
    range: `eq.${range}`,
    interval: `eq.${interval}`,
    order: "sort_order.asc",
  });

  if (!result.ok) {
    return {
      hit: false,
      snapshots: [],
      freshSnapshots: [],
      stale: false,
      error: result.error,
    };
  }

  const rows = Array.isArray(result.data) ? result.data : [];
  const normalizedRows = rows
    .map((row) => {
      const snapshot = normalizeGroupSnapshot(row);
      if (!snapshot || !row || typeof row !== "object") return null;
      const expiresAt = Date.parse(
        stringOrFallback(
          (row as Record<string, unknown>).expires_at,
          "",
        ),
      );
      return {
        fresh: Number.isFinite(expiresAt) && expiresAt > now,
        snapshot,
      };
    })
    .filter(
      (
        row,
      ): row is {
        fresh: boolean;
        snapshot: MarketGroupSnapshotPayload;
      } => Boolean(row),
    );
  const snapshots = normalizedRows.map((row) => row.snapshot);
  const freshSnapshots = normalizedRows
    .filter((row) => row.fresh)
    .map((row) => row.snapshot);

  return {
    hit: freshSnapshots.length > 0,
    snapshots,
    freshSnapshots,
    stale: snapshots.length > freshSnapshots.length,
  };
}

export async function writeMarketGroupSnapshots(payloads: MarketGroupSnapshotPayload[]) {
  if (!payloads.length) {
    return { ok: true, status: 204, data: [], error: undefined };
  }

  return supabaseUpsert(
    "market_group_snapshots",
    payloads.map((payload) => ({
      change_percent: payload.changePercent,
      constituent_symbols: payload.constituentSymbols,
      expires_at: expiresAt(groupSnapshotTtlSeconds(payload.range)),
      fetched_at: new Date().toISOString(),
      group_key: payload.groupKey,
      group_name: payload.groupName,
      interval: payload.interval,
      market_cap_label: payload.marketCapLabel ?? null,
      parent_key: payload.parentKey ?? null,
      provider_label: payload.providerLabel,
      range: payload.range,
      raw_payload: payload.rawPayload ?? {},
      scope: payload.scope,
      sort_order: payload.sortOrder,
      top_movers: payload.topMovers,
      trend_points: payload.trendPoints,
    })),
    { onConflict: "scope,group_key,range,interval" },
  );
}

function expiresAt(ttlSeconds: number) {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

function normalizeSymbols(symbols: string[]) {
  return Array.from(
    new Set(
      symbols
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => symbol && symbol !== "N/A"),
    ),
  );
}

function postgrestIn(values: string[]) {
  return `in.(${values.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",")})`;
}

function normalizeGroupSnapshot(value: unknown): MarketGroupSnapshotPayload | null {
  if (!value || typeof value !== "object") return null;

  const item = value as Record<string, unknown>;
  const scope = stringOrFallback(item.scope, "");
  const range = stringOrFallback(item.range, "") as PriceRange;
  const groupKey = stringOrFallback(item.group_key, "");
  const groupName = stringOrFallback(item.group_name, "");
  const interval = stringOrFallback(item.interval, "");

  if (!isGroupScope(scope) || !isPriceRange(range) || !groupKey || !groupName || !interval) {
    return null;
  }

  return {
    changePercent: numberOrFallback(item.change_percent, 0),
    constituentSymbols: normalizeStringArray(item.constituent_symbols),
    groupKey,
    groupName,
    interval,
    marketCapLabel: stringOrFallback(item.market_cap_label, ""),
    parentKey: stringOrFallback(item.parent_key, ""),
    providerLabel: stringOrFallback(item.provider_label, "Market aggregate"),
    range,
    rawPayload: item.raw_payload,
    scope,
    sortOrder: numberOrFallback(item.sort_order, 0),
    topMovers: normalizeTopMovers(item.top_movers),
    trendPoints: normalizeNumberArray(item.trend_points),
  };
}

function normalizePoint(value: unknown): PricePoint | null {
  if (!value || typeof value !== "object") return null;

  const item = value as Record<string, unknown>;
  const open = numberOrUndefined(item.open);
  const high = numberOrUndefined(item.high);
  const low = numberOrUndefined(item.low);
  const close = numberOrUndefined(item.close);
  const volume = numberOrUndefined(item.volume);
  const vwap = numberOrUndefined(item.vwap);
  const time = stringOrFallback(item.time, "");

  if (
    !time ||
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined ||
    volume === undefined ||
    vwap === undefined
  ) {
    return null;
  }

  return { close, high, low, open, time, volume, vwap };
}

function numberOrUndefined(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function numberOrFallback(value: unknown, fallback: number) {
  return numberOrUndefined(value) ?? fallback;
}

function stringOrFallback(value: unknown, fallback: string) {
  return typeof value === "string" && value ? value : fallback;
}

function isPriceRange(value: string): value is PriceRange {
  return value === "1D" || value === "5D" || value === "1M" || value === "3M" || value === "1Y";
}

function isGroupScope(value: string): value is MarketGroupSnapshotPayload["scope"] {
  return value === "sector" || value === "industry_group" || value === "theme" || value === "sub_theme";
}

function normalizeNumberArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(numberOrUndefined).filter((item): item is number => item !== undefined)
    : [];
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === "string" ? item : "")).filter(Boolean)
    : [];
}

function normalizeTopMovers(value: unknown): MarketGroupSnapshotPayload["topMovers"] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const symbol = stringOrFallback(record.symbol, "");
      const changePercent = numberOrUndefined(record.changePercent ?? record.change_percent);
      const latestPrice = numberOrUndefined(record.latestPrice ?? record.latest_price);
      if (!symbol || changePercent === undefined) return null;

      const mover: MarketGroupSnapshotPayload["topMovers"][number] = {
        changePercent,
        symbol,
      };
      if (latestPrice !== undefined) mover.latestPrice = latestPrice;
      return mover;
    })
    .filter((item): item is MarketGroupSnapshotPayload["topMovers"][number] => Boolean(item));
}
