import type { StockOverviewSelectionMode } from "@/lib/watchlist/stockOverview";

type StockDetailLoadState = "idle" | "loading" | "ready" | "unavailable";

export function shouldLoadSecTickerSourceFilings(input: {
  selectionMode: StockOverviewSelectionMode;
  ticker: string | null;
}) {
  return input.selectionMode === "stock" && Boolean(input.ticker);
}

export function isStockDetailUnavailable(input: {
  overviewState: StockDetailLoadState;
  selectionMode: StockOverviewSelectionMode;
  sourceFilingsCount: number;
  sourceFilingsState: StockDetailLoadState;
}) {
  if (input.overviewState !== "unavailable") return false;
  return !(
    input.selectionMode === "stock" &&
    input.sourceFilingsState === "ready" &&
    input.sourceFilingsCount > 0
  );
}

export function resolveStockDetailRenderState(input: {
  overviewState: StockDetailLoadState;
  selectionMode: StockOverviewSelectionMode;
  sourceFilingsCount: number;
  sourceFilingsState: StockDetailLoadState;
}): StockDetailLoadState {
  if (input.overviewState !== "unavailable") return input.overviewState;
  return isStockDetailUnavailable(input) ? "unavailable" : "ready";
}
