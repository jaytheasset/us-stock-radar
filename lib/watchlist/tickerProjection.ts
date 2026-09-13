import "server-only";

import { readIssuerBoundPublicStockTickerProjection } from "../sec-ticker-resolution/publicTickerSearch";
import type { SecTickerProductProjectionReadResult } from "../sec-ticker-resolution/productProjectionTypes";
import { getGuestWatchlistViewModel, getWatchlistViewModel } from "./getWatchlistViewModel";
import { markWatchlistProjectionConflicts } from "./tickerProjectionModel";
import type { WatchlistViewModel } from "./types";

class WatchlistProjectionReadError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super("Watchlist security verification is unavailable. Refresh before adding a stock.");
    this.reason = reason;
  }
}

// Per-read memoization only. A later fetch must observe reject/withdraw/reconsideration.
export function createWatchlistProjectionReader(
  readProjection: (input: { ticker: string }) => Promise<SecTickerProductProjectionReadResult> = async ({ ticker }) => {
    const bound = await readIssuerBoundPublicStockTickerProjection(ticker);
    return bound.status === "available" ? bound.projection : bound;
  },
) {
  const reads = new Map<string, ReturnType<typeof readProjection>>();
  return async (ticker: string) => {
    if (!reads.has(ticker)) reads.set(ticker, readProjection({ ticker }));
    const result = await reads.get(ticker)!;
    if (result.status === "unavailable") {
      throw new WatchlistProjectionReadError(result.reason);
    }
    if (result.status === "available") {
      for (const alias of [result.currentTicker, ...result.historicalTickers]) {
        if (!reads.has(alias)) reads.set(alias, Promise.resolve(result));
      }
    }
    return result.status === "available"
      ? { currentTicker: result.currentTicker, historicalTickers: result.historicalTickers }
      : { currentTicker: ticker, historicalTickers: [] };
  };
}

export async function projectWatchlistViewModel(
  base: WatchlistViewModel,
  requestedTicker?: string | null,
  read = createWatchlistProjectionReader(),
): Promise<WatchlistViewModel> {
  const items = [];
  // Keep projection fan-out bounded; the existing reader already batches decisions.
  for (const item of base.items) {
    items.push({ ...item, projection: await read(item.ticker) });
  }
  return {
    ...base,
    items: markWatchlistProjectionConflicts(items),
    selection: requestedTicker
      ? { requestedTicker, ...await read(requestedTicker) }
      : undefined,
  };
}

export async function getProjectedWatchlistViewModel(userId: string | null, ticker?: string | null) {
  const base = userId ? await getWatchlistViewModel(userId) : getGuestWatchlistViewModel();
  return projectWatchlistViewModelForDisplay(base, ticker);
}

export async function projectWatchlistViewModelForDisplay(base: WatchlistViewModel, ticker?: string | null) {
  try {
    return await projectWatchlistViewModel(base, ticker);
  } catch (error) {
    // Show the saved literals explicitly, never keep a stale alias when verification fails.
    // Mutations use the strict reader above and cannot treat this as verified identity.
    return {
      ...base,
      projectionUnavailable: true,
      projectionUnavailableReason: error instanceof WatchlistProjectionReadError ? error.reason : "read_failed",
    };
  }
}
