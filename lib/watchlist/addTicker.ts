import "server-only";

import { supabaseRpc } from "../supabase";
import { getEffectiveUserPlan } from "../subscription/effectivePlan";
import { getPlanLimits, type Plan } from "../subscriptionPolicy";
import { createWatchlistProjectionReader } from "./tickerProjection";
import { normalizeTicker, WatchlistValidationError } from "./watchlistValidation";

export async function addWatchlistTicker(input: {
  userId: string;
  ticker: string;
  expectedCurrentTicker?: unknown;
  readCatalog: (ticker: string) => Promise<{ company_name: string } | null>;
  assertLimit: (plan: Plan, usage: number) => void;
}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = await supabaseRpc("watchlist_projection_snapshot", {});
    if (!snapshot.ok || typeof snapshot.data !== "string") {
      throw new Error("Watchlist security verification is unavailable. No stock was added.");
    }
    const projection = await createWatchlistProjectionReader()(input.ticker);
    if (input.expectedCurrentTicker !== undefined && normalizeTicker(input.expectedCurrentTicker) !== projection.currentTicker) {
      throw new WatchlistValidationError("TICKER_PROJECTION_CHANGED", "Ticker verification changed. Search again before adding this stock.", { ticker: input.ticker });
    }
    const planState = await getEffectiveUserPlan(input.userId);
    const catalog = await input.readCatalog(projection.currentTicker);
    if (!catalog) {
      throw new WatchlistValidationError("TICKER_NOT_FOUND", `${input.ticker} is not an active listed ticker.`, { ticker: input.ticker });
    }
    const result = await supabaseRpc("add_watchlist_ticker_verified", {
      p_user_id: input.userId,
      p_saved_ticker: input.ticker,
      p_company_name: catalog.company_name,
      p_aliases: [...new Set([input.ticker, projection.currentTicker, ...projection.historicalTickers])],
      p_projection_snapshot: snapshot.data,
      p_limit: getPlanLimits(planState.effectivePlan).watchlistLimit,
    });
    if (!result.ok) throw new Error(result.error || "Failed to add ticker.");
    const outcome = result.data as { status?: string; savedTickers?: string[]; usage?: number } | null;
    if (outcome?.status === "inserted") return;
    if (outcome?.status === "stale") continue;
    if (outcome?.status === "duplicate") {
      throw new WatchlistValidationError("DUPLICATE_TICKER", `${input.ticker} is already in your watchlist.`, {
        ticker: input.ticker, savedTickers: outcome.savedTickers,
      });
    }
    if (outcome?.status === "limit" && typeof outcome.usage === "number") {
      input.assertLimit(planState.effectivePlan, outcome.usage);
    }
    throw new Error("Watchlist addition could not be confirmed. Refresh before trying again.");
  }
  throw new WatchlistValidationError("TICKER_PROJECTION_CHANGED", "Ticker verification changed. Search again before adding this stock.");
}
