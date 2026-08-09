export function buildDeliveryDedupeKey(eventId: string) {
  return `event:${eventId}`;
}

export function matchWatchedEventTickers(
  eventTickers: readonly string[],
  watchedTickers: ReadonlySet<string>,
) {
  const seen = new Set<string>();
  const matches: string[] = [];

  for (const value of eventTickers) {
    const ticker = value.trim().toUpperCase();
    if (!ticker || seen.has(ticker) || !watchedTickers.has(ticker)) continue;
    seen.add(ticker);
    matches.push(ticker);
  }

  return matches;
}
