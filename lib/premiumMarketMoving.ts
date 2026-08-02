import {
  getEventTypeDefinition,
} from "./eventTypeRegistry.ts";
import {
  normalizeDirectionalScoreSignal,
  type DirectionalScoreSignal,
} from "./directionalScore.ts";

export const PREMIUM_MARKET_MOVING_LIMIT = 3;
export const PREMIUM_MARKET_MOVING_POLL_INTERVAL_MS = 60_000;
export const PREMIUM_MARKET_MOVING_CACHE_TTL_SECONDS = 60;
export const PREMIUM_MARKET_MOVING_STALE_WHILE_REVALIDATE_SECONDS = 60;

export type PremiumMarketMovingEvent = {
  eventTypeLabel: string;
  href: string;
  id: string;
  score: number;
  signal: DirectionalScoreSignal;
  ticker: string;
  title: string;
};

export type PremiumMarketMovingResponse = {
  events: PremiumMarketMovingEvent[];
  refreshedAt: string;
};

type UnknownRow = Record<string, unknown>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const tickerPattern = /^[A-Z][A-Z0-9.-]{0,14}$/;
const qaMarkerPattern =
  /(?:local[-_ ]filings[-_ ]qa|local[-_ ]qa|qa[-_ ]fixture|development[-_ ]fixture|test[-_ ]fixture|synthetic|\bfixture\b|\[qa\])/i;

export function buildPremiumMarketMovingEventQuery() {
  return {
    limit: "50",
    order: "detected_at.desc",
    score: "gte.90",
    select:
      "id,source_code,source_group,source_name,source_url,published_at,detected_at,ticker,event_type,score,signal,title",
    source_code: "eq.sec_edgar",
    source_group: "eq.filings",
  };
}

export function buildPremiumMarketMovingTickerQuery(eventIds: readonly string[]) {
  const safeIds = eventIds.filter((id) => uuidPattern.test(id));
  return {
    event_id: `in.(${safeIds.join(",")})`,
    limit: String(Math.max(safeIds.length * 10, 1)),
    order: "sort_order.asc",
    select: "event_id,symbol,role,sort_order",
  };
}

export function selectPremiumMarketMovingEvents(
  eventRows: readonly UnknownRow[],
  tickerRows: readonly UnknownRow[] = [],
): PremiumMarketMovingEvent[] {
  const primaryTickerByEventId = collectPrimaryTickers(tickerRows);

  return eventRows
    .filter(isEligibleFilingRow)
    .sort(compareEventRowsByRecency)
    .map((row) => mapEventRow(row, primaryTickerByEventId))
    .filter((event): event is PremiumMarketMovingEvent => Boolean(event))
    .slice(0, PREMIUM_MARKET_MOVING_LIMIT);
}

export function shouldPollPremiumMarketMoving(visibilityState: string) {
  return visibilityState === "visible";
}

function isEligibleFilingRow(row: UnknownRow) {
  const id = readString(row.id);
  const sourceCode = readString(row.source_code);
  const sourceGroup = readString(row.source_group);
  const sourceName = readString(row.source_name);
  const title = readString(row.title);
  const score = readNumber(row.score);
  const eventType = readString(row.event_type);
  const signal = readString(row.signal).toLowerCase();
  const eventDefinition = getEventTypeDefinition(eventType);

  return (
    uuidPattern.test(id) &&
    sourceGroup === "filings" &&
    sourceCode === "sec_edgar" &&
    isOfficialSecUrl(readString(row.source_url)) &&
    score !== null &&
    score >= 90 &&
    score <= 100 &&
    Boolean(title) &&
    !qaMarkerPattern.test(`${sourceCode} ${sourceName} ${title}`) &&
    Boolean(eventDefinition?.sourceGroups.includes("filings")) &&
    (signal === "bullish" ||
      signal === "bearish" ||
      signal === "volatile" ||
      signal === "neutral")
  );
}

function mapEventRow(
  row: UnknownRow,
  primaryTickerByEventId: ReadonlyMap<string, string>,
): PremiumMarketMovingEvent | null {
  const id = readString(row.id);
  const eventType = readString(row.event_type);
  const eventDefinition = getEventTypeDefinition(eventType);
  const score = readNumber(row.score);
  const ticker =
    primaryTickerByEventId.get(id) || normalizeTicker(readString(row.ticker));

  if (!eventDefinition || score === null || !ticker) return null;

  return {
    eventTypeLabel: eventDefinition.label,
    href: `/filings/${id}`,
    id,
    score,
    signal: normalizeDirectionalScoreSignal(row.signal),
    ticker,
    title: readString(row.title),
  };
}

function collectPrimaryTickers(tickerRows: readonly UnknownRow[]) {
  const primary = new Map<string, string>();
  const fallback = new Map<string, string>();

  for (const row of tickerRows) {
    const eventId = readString(row.event_id);
    const symbol = normalizeTicker(readString(row.symbol));
    if (!uuidPattern.test(eventId) || !symbol) continue;
    if (!fallback.has(eventId)) fallback.set(eventId, symbol);
    if (readString(row.role) === "primary" && !primary.has(eventId)) {
      primary.set(eventId, symbol);
    }
  }

  return new Map(
    Array.from(fallback, ([eventId, symbol]) => [
      eventId,
      primary.get(eventId) || symbol,
    ]),
  );
}

function compareEventRowsByRecency(left: UnknownRow, right: UnknownRow) {
  const leftEffectiveTime =
    readTimestamp(left.published_at) || readTimestamp(left.detected_at);
  const rightEffectiveTime =
    readTimestamp(right.published_at) || readTimestamp(right.detected_at);
  const effectiveTimeDifference = rightEffectiveTime - leftEffectiveTime;
  if (effectiveTimeDifference) return effectiveTimeDifference;
  return readTimestamp(right.detected_at) - readTimestamp(left.detected_at);
}

function isOfficialSecUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "sec.gov" || url.hostname.endsWith(".sec.gov"))
    );
  } catch {
    return false;
  }
}

function normalizeTicker(value: string) {
  const ticker = value.trim().toUpperCase();
  return tickerPattern.test(ticker) ? ticker : "";
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTimestamp(value: unknown) {
  const timestamp = Date.parse(readString(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
}
