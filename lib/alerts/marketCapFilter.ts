import {
  classifyMarketCapFilterId,
  marketCapBands,
  type MarketCapFilterId,
} from "../marketCapBands.ts";

export const allAlertMarketCapFilterIds = marketCapBands.map(
  (band) => band.toLowerCase() as MarketCapFilterId,
);

export function matchesAlertMarketCapFilters(
  marketCap: unknown,
  filters: readonly string[],
) {
  const selected = new Set(filters.filter(isMarketCapFilterId));
  if (selected.size === allAlertMarketCapFilterIds.length) return true;
  const band = classifyMarketCapFilterId(marketCap);
  return band !== null && selected.has(band);
}

function isMarketCapFilterId(value: string): value is MarketCapFilterId {
  return allAlertMarketCapFilterIds.includes(value as MarketCapFilterId);
}
