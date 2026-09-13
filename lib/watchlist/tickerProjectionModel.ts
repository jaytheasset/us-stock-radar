import type { WatchlistTickerItem } from "./types.ts";

export type WatchlistTickerProjection = {
  currentTicker: string;
  historicalTickers: readonly string[];
};

// ticker always identifies the saved row. Only an explicit consumer uses projection.
export function displayedWatchlistTicker(item: WatchlistTickerItem) {
  return item.projection?.currentTicker ?? item.ticker;
}

export function watchlistItemMatchesTicker(item: WatchlistTickerItem, ticker: string) {
  return item.ticker === ticker || displayedWatchlistTicker(item) === ticker ||
    item.projection?.historicalTickers.includes(ticker) === true;
}

export function selectWatchlistItem(items: readonly WatchlistTickerItem[], ticker: string | null) {
  return items.find((item) => item.ticker === ticker) ??
    items.find((item) => ticker && watchlistItemMatchesTicker(item, ticker)) ?? null;
}

export function markWatchlistProjectionConflicts(items: WatchlistTickerItem[]) {
  return items.map((item) => ({
    ...item,
    projectionConflict: items
      .filter((other) => other.id !== item.id &&
        displayedWatchlistTicker(other) === displayedWatchlistTicker(item))
      .map((other) => other.ticker),
  }));
}
