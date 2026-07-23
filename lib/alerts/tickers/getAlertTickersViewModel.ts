import "server-only";

import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import { formatLimit, getPlanDisplayName, getPlanLimits } from "@/lib/subscriptionPolicy";
import { supabaseSelect } from "@/lib/supabase";
import type {
  AlertTickerItem,
  AlertTickersViewModel,
  TickerSearchResult,
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
  const result = await supabaseSelect("tickers", {
    select: "symbol,name,exchange,asset_type,market_cap",
    symbol: `eq.${ticker}`,
    is_active: "eq.true",
    limit: "1",
  });

  if (!result.ok) {
    throw new Error(result.error || "Failed to validate ticker.");
  }

  const row = Array.isArray(result.data) ? result.data[0] : null;
  return mapTickerCatalogRow(row);
}

export async function searchTickerCatalog(query: string, limit = 8): Promise<TickerSearchResult[]> {
  const normalized = normalizeCatalogQuery(query);
  if (!normalized) return [];

  const result = await supabaseSelect("tickers", {
    select: "symbol,name,exchange,asset_type,market_cap",
    is_active: "eq.true",
    or: `(symbol.ilike.${normalized}*,name.ilike.*${normalized}*)`,
    order: "symbol.asc",
    limit: String(Math.max(1, Math.min(limit, 12))),
  });

  if (!result.ok) {
    throw new Error(result.error || "Failed to search tickers.");
  }

  const rows = Array.isArray(result.data)
    ? result.data
        .map(mapTickerCatalogRow)
        .filter((item): item is TickerSearchResult => Boolean(item))
    : [];
  const uppercaseQuery = normalized.toUpperCase();

  return rows.sort((a, b) => {
    const rankDifference = getSearchRank(a, uppercaseQuery) - getSearchRank(b, uppercaseQuery);
    return rankDifference || a.ticker.localeCompare(b.ticker);
  });
}

function normalizeCatalogQuery(value: string) {
  return value
    .trim()
    .replace(/[^A-Za-z0-9 .&'-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 48);
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

  const marketCap = Number(item.market_cap);
  return {
    ticker,
    companyName,
    exchange: nullableString(item.exchange),
    assetType: nullableString(item.asset_type),
    marketCap: Number.isFinite(marketCap) ? marketCap : null,
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}
