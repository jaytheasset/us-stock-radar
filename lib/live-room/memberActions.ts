export function createLiveRoomMemberLoginHref(nextPath: string, preferredNextPath?: string) {
  const candidate =
    typeof preferredNextPath === "string" && preferredNextPath.startsWith(`${nextPath}?`)
      ? preferredNextPath
      : nextPath;
  const safeNextPath =
    candidate.startsWith("/") && !candidate.startsWith("//")
      ? candidate
      : "/";
  return `/login?next=${encodeURIComponent(safeNextPath)}`;
}

export function createCompanyLiveRoomEntryPath(input: {
  ticker: string;
  eventId?: unknown;
  source?: unknown;
}) {
  const ticker = input.ticker.trim().toUpperCase();
  const basePath = /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(ticker)
    ? `/live/${encodeURIComponent(ticker)}`
    : "/live";
  const eventId = safeQueryValue(input.eventId, 128);
  const source = input.source === "telegram" ? "telegram" : "";
  const search = new URLSearchParams();
  if (eventId) search.set("event", eventId);
  if (source) search.set("src", source);
  return search.size ? `${basePath}?${search.toString()}` : basePath;
}

function safeQueryValue(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]+$/.test(normalized) && normalized.length <= maxLength
    ? normalized
    : "";
}
