import type { StockOverviewEvent } from "../watchlist/stockOverview.ts";
import type {
  CompanyEvent,
  CompanyEventReference,
  CompanyRoomKey,
} from "./types.ts";

const tickerPattern = /^[A-Z0-9.-]{1,12}$/;

export function normalizeLiveRoomTicker(value: unknown) {
  if (typeof value !== "string") return null;
  const ticker = value.trim().toUpperCase();
  return tickerPattern.test(ticker) ? ticker : null;
}

export function getLiveRoomHref(value: unknown) {
  const ticker = normalizeLiveRoomTicker(value);
  return ticker ? `/live/${encodeURIComponent(ticker)}` : null;
}

export function createCompanyRoomKey(input: {
  issuerId?: string | null;
  ticker: string;
}): CompanyRoomKey {
  const issuerId = input.issuerId?.trim();
  return issuerId
    ? { kind: "issuer_id", value: issuerId }
    : { kind: "ticker_fallback", value: input.ticker };
}

export function serializeCompanyRoomKey(roomKey: CompanyRoomKey) {
  return `${roomKey.kind}:${roomKey.value}`;
}

export function toCompanyEvent(event: StockOverviewEvent): CompanyEvent {
  return {
    detailHref: event.detailHref,
    eventId: event.id,
    kind: event.sourceGroup === "filings" ? "filing" : "news",
    occurredAt: event.detectedAt,
    score: event.score,
    signal: event.signal,
    source: event.source,
    title: event.title,
  };
}

export function sortCompanyEvents(
  events: readonly CompanyEvent[],
): CompanyEvent[] {
  return [...events].sort((left, right) => {
    const timeDifference =
      readTimestamp(right.occurredAt) - readTimestamp(left.occurredAt);
    return timeDifference || right.eventId.localeCompare(left.eventId);
  });
}

export function selectLatestCompanyEvent(
  events: readonly CompanyEvent[],
): CompanyEvent | null {
  return sortCompanyEvents(events)[0] ?? null;
}

export function createEventReference(
  event: CompanyEvent,
): CompanyEventReference {
  return {
    eventId: event.eventId,
    kind: event.kind,
    title: event.title,
  };
}

function readTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
