import { LIVE_ROOM_MESSAGE_MAX_LENGTH } from "../live-room/moderation.ts";
import type {
  DirectMessageRiskFlag,
} from "./types";

type HistoryItem = {
  body: string;
  createdAt: string;
};

type DirectMessageModerationContext = {
  history: readonly HistoryItem[];
  now: string;
  request: boolean;
};

export type DirectMessageModerationDecision =
  | {
      allowed: true;
      normalizedBody: string;
      riskFlags: DirectMessageRiskFlag[];
      riskScore: number;
    }
  | {
      allowed: false;
      message: string;
      reason:
        | "duplicate"
        | "empty"
        | "excessive_links"
        | "max_length"
        | "rate_limit"
        | "request_link";
      retryAfterSeconds?: number;
    };

const burstWindowMs = 20_000;
const burstLimit = 3;
const duplicateWindowMs = 120_000;
const acceptedMaxLinks = 2;
const requestLinkPattern =
  /\b(?:https?:\/\/|www\.|mailto:|[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|me|gg|co|kr)(?:[\/\s]|$))/i;

export function evaluateDirectMessage(
  body: string,
  context: DirectMessageModerationContext,
): DirectMessageModerationDecision {
  const normalizedBody = body.trim();
  if (!normalizedBody) {
    return blocked("empty", "Write a message before sending.");
  }
  if (normalizedBody.length > LIVE_ROOM_MESSAGE_MAX_LENGTH) {
    return blocked(
      "max_length",
      `Messages can be up to ${LIVE_ROOM_MESSAGE_MAX_LENGTH} characters.`,
    );
  }
  if (context.request && requestLinkPattern.test(normalizedBody)) {
    return blocked(
      "request_link",
      "Message requests cannot include links or contact URLs.",
    );
  }
  if (!context.request && countLinks(normalizedBody) > acceptedMaxLinks) {
    return blocked(
      "excessive_links",
      `A message can include up to ${acceptedMaxLinks} links.`,
    );
  }

  const now = readTimestamp(context.now);
  const normalizedComparison = normalizeForComparison(normalizedBody);
  const recent = context.history.filter(
    (item) => now - readTimestamp(item.createdAt) <= duplicateWindowMs,
  );
  if (
    recent.some(
      (item) =>
        normalizeForComparison(item.body) === normalizedComparison,
    )
  ) {
    return blocked(
      "duplicate",
      "The same message was sent recently. Add something new before trying again.",
    );
  }

  const burst = context.history.filter(
    (item) => now - readTimestamp(item.createdAt) <= burstWindowMs,
  );
  if (burst.length >= burstLimit) {
    const oldest = Math.min(
      ...burst.map((item) => readTimestamp(item.createdAt)),
    );
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((burstWindowMs - (now - oldest)) / 1_000),
    );
    return {
      allowed: false,
      message: `Too many messages in a short time. Try again in about ${retryAfterSeconds} seconds.`,
      reason: "rate_limit",
      retryAfterSeconds,
    };
  }

  const riskFlags = detectDirectMessageRisk(
    normalizedBody,
    context.history.map((item) => item.body),
  );
  return {
    allowed: true,
    normalizedBody,
    riskFlags,
    riskScore: Math.min(100, riskFlags.length * 20),
  };
}

export function detectDirectMessageRisk(
  body: string,
  recentBodies: readonly string[] = [],
): DirectMessageRiskFlag[] {
  const flags: DirectMessageRiskFlag[] = [];
  if (
    /(telegram|텔레그램|whats\s*app|왓츠앱|kakao\s*talk|카카오톡|discord|디스코드)/i.test(
      body,
    )
  ) {
    flags.push("off_platform_contact");
  }
  if (
    /(wire transfer|bank transfer|deposit|account number|송금|입금|계좌\s*번호|계좌번호)/i.test(
      body,
    )
  ) {
    flags.push("money_transfer");
  }
  if (
    /(guaranteed?\s+(?:return|profit)|risk[- ]?free profit|수익\s*보장|원금\s*보장|확정\s*수익)/i.test(
      body,
    )
  ) {
    flags.push("guaranteed_return");
  }
  if (
    /(paid\s+(?:room|group)|vip\s*(?:room|group)|premium\s+signals?|유료\s*방|유료방|vip\s*방|리딩\s*방)/i.test(
      body,
    )
  ) {
    flags.push("paid_room");
  }
  if (
    /(wallet\s*address|send\s+(?:btc|eth|usdt|crypto)|crypto\s+transfer|지갑\s*주소|암호화폐\s*전송|코인\s*전송)/i.test(
      body,
    )
  ) {
    flags.push("crypto_wallet");
  }
  const contactCount = countContactTokens(body);
  if (
    contactCount >= 2 ||
    (contactCount >= 1 &&
      recentBodies.some((recentBody) => countContactTokens(recentBody) > 0))
  ) {
    flags.push("repeated_contact");
  }
  return flags;
}

function blocked(
  reason: Extract<
    DirectMessageModerationDecision,
    { allowed: false }
  >["reason"],
  message: string,
): DirectMessageModerationDecision {
  return {
    allowed: false,
    message,
    reason,
  };
}

function normalizeForComparison(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function countLinks(value: string) {
  return value.match(/\b(?:https?:\/\/|www\.)\S+/gi)?.length ?? 0;
}

function countContactTokens(value: string) {
  return (
    (value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)?.length ??
      0) +
    (value.match(/\+?[0-9][0-9 ()-]{7,}[0-9]/g)?.length ?? 0)
  );
}

function readTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}
