export const liveFeedMarketScopes = ["sector", "theme", "macro"] as const;

type LiveFeedEventVisibilityInput = {
  deliveryLevel: string | null | undefined;
  marketScope: string | null | undefined;
  sourceGroup: string | null | undefined;
  ticker: string | null | undefined;
};

export const liveFeedEventVisibilityOrFilter = [
  "source_group.is.null",
  "source_group.neq.news",
  "market_scope.is.null",
  "market_scope.not.in.(sector,theme,macro)",
  "delivery_level.eq.alert",
  'and(ticker.not.is.null,ticker.imatch."^[A-Z][A-Z0-9.-]{0,9}$",ticker.not.ilike.NA,ticker.not.ilike.UNKNOWN)',
].join(",");

export function hasValidLiveFeedPrimaryTicker(value: string | null | undefined) {
  const ticker = value?.trim().toUpperCase() || "";
  if (!ticker || ticker === "N/A" || ticker === "NA" || ticker === "UNKNOWN" || ticker === "-") {
    return false;
  }

  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker);
}

export function shouldIncludeLiveFeedEvent({
  deliveryLevel,
  marketScope,
  sourceGroup,
  ticker,
}: LiveFeedEventVisibilityInput) {
  const isMarketNews =
    sourceGroup === "news" &&
    liveFeedMarketScopes.includes(
      marketScope as (typeof liveFeedMarketScopes)[number],
    );

  return (
    !isMarketNews ||
    deliveryLevel === "alert" ||
    hasValidLiveFeedPrimaryTicker(ticker)
  );
}
