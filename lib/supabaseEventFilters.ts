export function buildEventAlertScoreFilters({
  alertOnly,
  deliveryLevel,
  minimumScore,
}: {
  alertOnly?: boolean;
  deliveryLevel?: "archive" | "feed" | "alert";
  minimumScore?: number;
}) {
  const filters: Record<string, string> = {};
  if (deliveryLevel) filters.delivery_level = `eq.${deliveryLevel}`;
  if (alertOnly) filters.delivery_level = "eq.alert";
  if (Number.isFinite(minimumScore)) {
    filters.score = `gte.${Math.max(
      0,
      Math.min(100, Math.round(minimumScore as number)),
    )}`;
  }
  return filters;
}
