import "server-only";

import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import { formatLimit, getPlanDisplayName, getPlanLimits } from "@/lib/subscriptionPolicy";
import { supabaseSelect } from "@/lib/supabase";
import { fetchSecCompanyTickers } from "@/lib/integrations";
import {
  normalizeTickerSearchQuery,
  completeTickerSearch,
  requireCompleteTickerSearch,
  TickerSearchUnavailableError,
  type TickerSearchRead,
  type TickerSearchResult,
} from "@/lib/tickerSearchContract";
import type {
  AlertTickerItem,
  AlertTickersViewModel,
} from "@/lib/alerts/tickers/types";

type AlertTickerRow = {
  id?: unknown;
  ticker?: unknown;
  company_name?: unknown;
  enabled?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

type TickerCatalogRow = {
  symbol?: unknown;
  name?: unknown;
  exchange?: unknown;
  asset_type?: unknown;
  market_cap?: unknown;
};

type EventTickerCatalogRow = {
  symbol?: unknown;
  exchange?: unknown;
  metadata?: unknown;
};

type SecTickerRow = {
  ticker?: unknown;
  title?: unknown;
};

export async function getAlertTickersViewModel(userId: string): Promise<AlertTickersViewModel> {
  const planState = await getEffectiveUserPlan(userId);
  const plan = planState.effectivePlan;
  const limit = getPlanLimits(plan).alertTickerLimit;
  const result = await supabaseSelect("user_alert_tickers", {
    select: "id,ticker,company_name,enabled,created_at,updated_at",
    user_id: `eq.${userId}`,
    order: "created_at.asc",
    limit: "500",
  });

  if (!result.ok) {
    throw new Error(result.error || "Failed to read alert-enabled tickers.");
  }

  const items = Array.isArray(result.data)
    ? result.data
        .map(mapAlertTickerRow)
        .filter((item): item is AlertTickerItem => Boolean(item))
    : [];

  return {
    plan,
    planLabel: getPlanDisplayName(plan),
    limit,
    usage: items.length,
    enabledCount: items.filter((item) => item.enabled).length,
    items,
  };
}

export function getGuestAlertTickersViewModel(): AlertTickersViewModel {
  const plan = "free";
  return {
    guestMode: true,
    plan,
    planLabel: getPlanDisplayName(plan),
    limit: getPlanLimits(plan).alertTickerLimit,
    usage: 0,
    enabledCount: 0,
    items: [],
  };
}

export function formatAlertTickerUsage(viewModel: Pick<AlertTickersViewModel, "usage" | "limit">) {
  return `${viewModel.usage} / ${formatLimit(viewModel.limit)}`;
}

export async function findTickerBySymbol(ticker: string): Promise<TickerSearchResult | null> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const result = await readTickerCatalogSearch(normalizedTicker, 12);
  const exact = result.data.find((row) => row.ticker === normalizedTicker);
  if (exact) return exact;
  if (result.partial) throw new TickerSearchUnavailableError();
  return null;
}

export async function searchTickerCatalog(query: string, limit = 8): Promise<TickerSearchResult[]> {
  return requireCompleteTickerSearch(await readTickerCatalogSearch(query, limit));
}

export async function readTickerCatalogSearch(query: string, limit = 8): Promise<TickerSearchRead> {
  const normalized = normalizeTickerSearchQuery(query);
  if (!normalized) return { data: [] };

  const cappedLimit = Math.max(1, Math.min(limit, 12));
  const [catalogResult, eventTickerResult] = await Promise.all([
    supabaseSelect("tickers", {
      select: "symbol,name,exchange,asset_type,market_cap",
      is_active: "eq.true",
      or: `(symbol.ilike.${normalized}*,name.ilike.*${normalized}*)`,
      order: "symbol.asc",
      limit: String(cappedLimit),
    }),
    supabaseSelect("event_tickers", {
      select: "symbol,exchange,metadata",
      or: `(symbol.ilike.${normalized}*,metadata->>company_name.ilike.*${normalized}*)`,
      order: "symbol.asc",
      limit: String(cappedLimit * 4),
    }),
  ]);

  if (!catalogResult.ok || !Array.isArray(catalogResult.data)) {
    throw new TickerSearchUnavailableError();
  }

  const catalogRows = catalogResult.data.map(mapTickerCatalogRow);
  const eventFailed = !eventTickerResult.ok || !Array.isArray(eventTickerResult.data);
  const eventRows = eventFailed ? [] : eventTickerResult.data.map(mapEventTickerCatalogRow);
  const localRows = mergeTickerResults([...catalogRows, ...eventRows]);
  const sec = localRows.length < cappedLimit
    ? await searchSecTickerCatalog(normalized)
    : { data: [], failed: false };
  const rows = mergeTickerResults([...localRows, ...sec.data]);
  const uppercaseQuery = normalized.toUpperCase();

  const data = rows.sort((a, b) => {
    const rankDifference = getSearchRank(a, uppercaseQuery) - getSearchRank(b, uppercaseQuery);
    return rankDifference || a.ticker.localeCompare(b.ticker);
  }).slice(0, cappedLimit);
  return completeTickerSearch(data, eventFailed || sec.failed);
}

function getSearchRank(item: TickerSearchResult, query: string) {
  if (item.ticker === query) return 0;
  if (item.ticker.startsWith(query)) return 1;
  if (item.companyName.toUpperCase().startsWith(query)) return 2;
  return 3;
}

function mapAlertTickerRow(row: unknown): AlertTickerItem | null {
  if (!row || typeof row !== "object") return null;
  const item = row as AlertTickerRow;
  const ticker = stringValue(item.ticker).toUpperCase();
  const companyName = stringValue(item.company_name);
  if (!ticker || !companyName) return null;

  return {
    id: stringValue(item.id) || ticker,
    ticker,
    companyName,
    enabled: item.enabled !== false,
    createdAt: nullableString(item.created_at),
    updatedAt: nullableString(item.updated_at),
  };
}

function mapTickerCatalogRow(row: unknown): TickerSearchResult | null {
  if (!row || typeof row !== "object") return null;
  const item = row as TickerCatalogRow;
  const ticker = stringValue(item.symbol).toUpperCase();
  const companyName = stringValue(item.name);
  if (!ticker || !companyName) return null;

  const marketCap = optionalNumber(item.market_cap);
  return {
    ticker,
    companyName,
    exchange: nullableString(item.exchange),
    assetType: nullableString(item.asset_type),
    marketCap: Number.isFinite(marketCap) ? marketCap : null,
  };
}

function mapEventTickerCatalogRow(row: unknown): TickerSearchResult | null {
  if (!row || typeof row !== "object") return null;
  const item = row as EventTickerCatalogRow;
  const metadata =
    item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : {};
  const ticker = stringValue(item.symbol).toUpperCase();
  const companyName = stringValue(metadata.company_name);
  if (!ticker || !companyName) return null;
  const marketCap = optionalNumber(metadata.market_cap);
  return {
    ticker,
    companyName,
    exchange: nullableString(item.exchange),
    assetType: nullableString(metadata.asset_type) || "stock",
    marketCap: Number.isFinite(marketCap) ? marketCap : null,
  };
}

async function searchSecTickerCatalog(query: string): Promise<{ data: TickerSearchResult[]; failed: boolean }> {
  const result = await fetchSecCompanyTickers(query, { fresh: false });
  if (!result.ok || !Array.isArray(result.data)) return { data: [], failed: true };
  const data = result.data.flatMap((value) => {
    const row = value as SecTickerRow;
    const ticker = stringValue(row.ticker).toUpperCase();
    const companyName = stringValue(row.title);
    if (!ticker || !companyName) return [];
    return [{
      ticker,
      companyName,
      exchange: null,
      assetType: "stock",
      marketCap: null,
    }];
  });
  return { data, failed: false };
}

function mergeTickerResults(results: Array<TickerSearchResult | null>) {
  const merged = new Map<string, TickerSearchResult>();
  for (const result of results) {
    if (!result) continue;
    const current = merged.get(result.ticker);
    if (!current) {
      merged.set(result.ticker, result);
      continue;
    }
    merged.set(result.ticker, {
      ticker: result.ticker,
      companyName: current.companyName || result.companyName,
      exchange: current.exchange || result.exchange,
      assetType: current.assetType || result.assetType,
      ...(current.isHistoricalTicker || result.isHistoricalTicker
        ? {
            historicalTicker: current.historicalTicker || result.historicalTicker,
            isHistoricalTicker: true,
          }
        : {}),
      marketCap: current.marketCap ?? result.marketCap,
    });
  }
  return [...merged.values()];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return Number.NaN;
  return Number(value);
}
