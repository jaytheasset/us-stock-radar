import "server-only";

import { getUserPlan } from "@/lib/alerts/alertValidation";
import { formatLimit, getPlanDisplayName, getPlanLimits } from "@/lib/subscriptionPolicy";
import { supabaseSelect } from "@/lib/supabase";
import type { WatchlistTickerItem, WatchlistViewModel } from "@/lib/watchlist/types";

type WatchlistTickerRow = {
  id?: unknown;
  ticker?: unknown;
  company_name?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

export async function getWatchlistViewModel(userId: string): Promise<WatchlistViewModel> {
  const plan = await getUserPlan(userId);
  const limits = getPlanLimits(plan);
  const result = await supabaseSelect("watchlist_tickers", {
    select: "id,ticker,company_name,created_at,updated_at",
    user_id: `eq.${userId}`,
    order: "ticker.asc",
    limit: "500",
  });

  if (!result.ok) {
    throw new Error(result.error || "Failed to read watchlist tickers.");
  }

  const items = Array.isArray(result.data)
    ? result.data.map(mapWatchlistTickerRow).filter((item): item is WatchlistTickerItem => Boolean(item))
    : [];

  return {
    plan,
    planLabel: getPlanDisplayName(plan),
    limit: limits.watchlistLimit,
    usage: items.length,
    items,
  };
}

export function formatWatchlistUsage(viewModel: Pick<WatchlistViewModel, "usage" | "limit">) {
  return `${viewModel.usage} / ${formatLimit(viewModel.limit)}`;
}

function mapWatchlistTickerRow(row: unknown): WatchlistTickerItem | null {
  if (!row || typeof row !== "object") return null;
  const item = row as WatchlistTickerRow;
  const ticker = typeof item.ticker === "string" ? item.ticker.toUpperCase() : "";
  if (!ticker) return null;

  return {
    id: typeof item.id === "string" ? item.id : ticker,
    ticker,
    companyName: typeof item.company_name === "string" && item.company_name.trim() ? item.company_name : null,
    createdAt: typeof item.created_at === "string" ? item.created_at : null,
    updatedAt: typeof item.updated_at === "string" ? item.updated_at : null,
  };
}
