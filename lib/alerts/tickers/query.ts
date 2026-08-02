export function normalizeAlertTickerSearchParam(
  value: string | string[] | undefined,
) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return "";

  const ticker = candidate.trim().toUpperCase();
  return /^[A-Z0-9.-]{1,12}$/.test(ticker) ? ticker : "";
}

export function getAlertsRouteHref(
  value: string | string[] | undefined,
) {
  const ticker = normalizeAlertTickerSearchParam(value);
  return ticker ? `/alerts?ticker=${encodeURIComponent(ticker)}` : "/alerts";
}

export function getAlertsLoginHref(
  value: string | string[] | undefined,
) {
  return `/login?next=${encodeURIComponent(getAlertsRouteHref(value))}`;
}
