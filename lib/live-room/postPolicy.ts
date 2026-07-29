import { LiveRoomPolicyError, normalizeLiveRoomTicker } from "./policy.ts";
import {
  isLiveRoomPostDirection,
  isLiveRoomPostSignal,
  type LiveRoomPostDirection,
  type LiveRoomPostSignal,
} from "./postSignals.ts";

export const LIVE_ROOM_POST_TITLE_MAX_LENGTH = 120;
export const LIVE_ROOM_POST_BODY_MAX_LENGTH = 10_000;
export const LIVE_ROOM_POST_BODY_PREVIEW_MAX_LENGTH = 220;
export const LIVE_ROOM_POST_TICKER_LIMIT = 5;
export const LIVE_ROOM_POST_SIGNAL_LIMIT = 3;
export const LIVE_ROOM_POST_PAGE_SIZE = 20;
export const LIVE_ROOM_POST_MAX_PAGE_SIZE = 50;
export const LIVE_ROOM_POST_EVENT_OPTION_MAX_LENGTH = 40;

const LIVE_ROOM_POST_EVENT_DATE_FORMATTER = new Intl.DateTimeFormat(
  "en-US",
  {
    day: "numeric",
    month: "short",
    timeZone: "America/New_York",
  },
);

export function createLiveRoomPostEventOptionLabel(event: {
  kind: "filing" | "news";
  occurredAt?: string | null;
  title?: string | null;
}) {
  const kind = event.kind === "filing" ? "Filing" : "News";
  const date = event.occurredAt ? new Date(event.occurredAt) : null;
  const dateLabel =
    date && !Number.isNaN(date.getTime())
      ? LIVE_ROOM_POST_EVENT_DATE_FORMATTER.format(date)
      : null;
  const normalizedTitle =
    typeof event.title === "string"
      ? event.title.replace(/\s+/g, " ").trim()
      : "";
  const title = normalizedTitle || "Untitled event";
  const prefix = dateLabel ? `${kind} · ${dateLabel}` : kind;
  const availableTitleLength =
    LIVE_ROOM_POST_EVENT_OPTION_MAX_LENGTH - prefix.length - 3;

  return `${prefix} · ${truncateLiveRoomPostEventTitle(
    title,
    availableTitleLength,
  )}`;
}

function truncateLiveRoomPostEventTitle(
  value: string,
  maxLength: number,
) {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return `${characters.slice(0, Math.max(maxLength - 1, 0)).join("")}…`;
}

export function createLiveRoomPostBodyPreview(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= LIVE_ROOM_POST_BODY_PREVIEW_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized
    .slice(0, LIVE_ROOM_POST_BODY_PREVIEW_MAX_LENGTH - 1)
    .trimEnd()}…`;
}

export function normalizeLiveRoomMentionedTicker(value: unknown) {
  const raw = typeof value === "string" ? value.trim() : "";
  return normalizeLiveRoomTicker(raw.startsWith("$") ? raw.slice(1) : raw);
}

export function assertLiveRoomPostMentionTargets(
  relatedTickers: readonly string[],
  primaryTicker?: string | null,
) {
  if (primaryTicker && relatedTickers.includes(primaryTicker)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_INVALID_TICKERS",
      `Do not mention $${primaryTicker}; this post already belongs to that company room.`,
    );
  }
}

export function normalizeLiveRoomPostDraft(value: unknown) {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const eventId =
    typeof input.eventId === "string" && input.eventId.trim()
      ? input.eventId.trim()
      : null;
  const rawTickers = Array.isArray(input.relatedTickers)
    ? input.relatedTickers
    : [];
  const rawSignalLabels = Array.isArray(input.signalLabels)
    ? input.signalLabels
    : [];
  const rawDirection = input.direction;

  if (
    title.length < 4 ||
    title.length > LIVE_ROOM_POST_TITLE_MAX_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(title)
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_INVALID_TITLE",
      `Post titles must be 4 to ${LIVE_ROOM_POST_TITLE_MAX_LENGTH} visible characters.`,
    );
  }
  if (
    body.length < 20 ||
    body.length > LIVE_ROOM_POST_BODY_MAX_LENGTH ||
    body.includes("\u0000")
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_INVALID_BODY",
      `Post bodies must be 20 to ${LIVE_ROOM_POST_BODY_MAX_LENGTH} characters.`,
    );
  }
  if (rawTickers.length > LIVE_ROOM_POST_TICKER_LIMIT) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_INVALID_TICKERS",
      `Choose up to ${LIVE_ROOM_POST_TICKER_LIMIT} related tickers.`,
    );
  }
  if (rawSignalLabels.length > LIVE_ROOM_POST_SIGNAL_LIMIT) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_INVALID_SIGNALS",
      `Choose up to ${LIVE_ROOM_POST_SIGNAL_LIMIT} post signals.`,
    );
  }
  if (
    rawDirection !== undefined &&
    rawDirection !== null &&
    rawDirection !== "" &&
    !isLiveRoomPostDirection(rawDirection)
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_INVALID_DIRECTION",
      "Choose a post direction from the available list.",
    );
  }

  const relatedTickers = [
    ...new Set(
      rawTickers.map((ticker) => normalizeLiveRoomMentionedTicker(ticker)),
    ),
  ];
  if (relatedTickers.length !== rawTickers.length) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_INVALID_TICKERS",
      "Related tickers must be unique.",
    );
  }

  if (!rawSignalLabels.every(isLiveRoomPostSignal)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_INVALID_SIGNALS",
      "Choose post signals from the available list.",
    );
  }
  const signalLabels = [
    ...new Set(rawSignalLabels as LiveRoomPostSignal[]),
  ];
  const direction =
    rawDirection === undefined || rawDirection === null || rawDirection === ""
      ? null
      : (rawDirection as LiveRoomPostDirection);
  if (signalLabels.length !== rawSignalLabels.length) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_INVALID_SIGNALS",
      "Post signals must be unique.",
    );
  }

  return {
    body,
    direction,
    eventId,
    relatedTickers,
    signalLabels,
    title,
  };
}

export function normalizeLiveRoomPostPageLimit(value: unknown) {
  const parsed = Number(value);
  return Math.max(
    1,
    Math.min(
      Number.isFinite(parsed) ? parsed : LIVE_ROOM_POST_PAGE_SIZE,
      LIVE_ROOM_POST_MAX_PAGE_SIZE,
    ),
  );
}
