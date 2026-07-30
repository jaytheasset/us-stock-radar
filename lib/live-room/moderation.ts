export const LIVE_ROOM_MESSAGE_MAX_LENGTH = 600;

export type ModerationReason =
  | "blocked_word"
  | "duplicate"
  | "empty"
  | "excessive_links"
  | "max_length"
  | "rate_limit";

export type ModerationDecision =
  | { allowed: true; normalizedBody: string }
  | {
      allowed: false;
      message: string;
      reason: ModerationReason;
      retryAfterSeconds?: number;
    };

export type ModerationHistoryItem = {
  body: string;
  createdAt: string;
};

export type ModerationContext = {
  allowEmpty?: boolean;
  history: readonly ModerationHistoryItem[];
  now: string;
};

const blockedPhrases = [
  "guaranteed return",
  "pump and dump",
  "risk-free profit",
];
const burstWindowMs = 20_000;
const burstLimit = 3;
const duplicateWindowMs = 120_000;
const maxLinks = 2;

export function evaluateLiveRoomMessage(
  body: string,
  context: ModerationContext,
): ModerationDecision {
  const normalizedBody = body.trim();

  if (!normalizedBody) {
    if (context.allowEmpty) {
      return { allowed: true, normalizedBody };
    }
    return block("empty", "Write a message before sending.");
  }

  if (normalizedBody.length > LIVE_ROOM_MESSAGE_MAX_LENGTH) {
    return block(
      "max_length",
      `Messages can be up to ${LIVE_ROOM_MESSAGE_MAX_LENGTH} characters.`,
    );
  }

  const normalizedForComparison = normalizeForComparison(normalizedBody);
  if (
    blockedPhrases.some((phrase) =>
      normalizedForComparison.includes(phrase),
    )
  ) {
    return block(
      "blocked_word",
      "This wording is blocked. Rephrase the message.",
    );
  }

  if (countLinks(normalizedBody) > maxLinks) {
    return block(
      "excessive_links",
      `A message can include up to ${maxLinks} links.`,
    );
  }

  const now = readTimestamp(context.now);
  const recentHistory = context.history.filter(
    (item) => now - readTimestamp(item.createdAt) <= duplicateWindowMs,
  );

  if (
    recentHistory.some(
      (item) => normalizeForComparison(item.body) === normalizedForComparison,
    )
  ) {
    return block(
      "duplicate",
      "The same message was sent recently. Add something new before trying again.",
    );
  }

  const burstMessages = context.history.filter(
    (item) => now - readTimestamp(item.createdAt) <= burstWindowMs,
  );
  if (burstMessages.length >= burstLimit) {
    const oldestBurstTimestamp = Math.min(
      ...burstMessages.map((item) => readTimestamp(item.createdAt)),
    );
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil(
        (burstWindowMs - (now - oldestBurstTimestamp)) / 1_000,
      ),
    );
    return {
      allowed: false,
      message: `Too many messages in a short time. Try again in about ${retryAfterSeconds} seconds.`,
      reason: "rate_limit",
      retryAfterSeconds,
    };
  }

  return { allowed: true, normalizedBody };
}

function block(
  reason: Exclude<ModerationReason, "rate_limit">,
  message: string,
): ModerationDecision {
  return { allowed: false, message, reason };
}

function normalizeForComparison(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function countLinks(value: string) {
  return value.match(/\b(?:https?:\/\/|www\.)\S+/gi)?.length ?? 0;
}

function readTimestamp(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
