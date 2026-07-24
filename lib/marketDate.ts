const marketDateKeyFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/New_York",
  year: "numeric",
});

const marketShortDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  timeZone: "America/New_York",
});

export function isSameMarketDate(left: string, right: string) {
  const leftDate = new Date(left);
  const rightDate = new Date(right);
  if (Number.isNaN(leftDate.getTime()) || Number.isNaN(rightDate.getTime())) {
    return false;
  }

  return (
    marketDateKeyFormatter.format(leftDate) ===
    marketDateKeyFormatter.format(rightDate)
  );
}

export function formatMarketDateLabel(value: string, referenceDate: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return isSameMarketDate(value, referenceDate)
    ? "Today"
    : marketShortDateFormatter.format(date);
}
