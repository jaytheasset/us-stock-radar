import {
  LIVE_ROOM_REPORT_REASONS,
  type CompanyEventReference,
  type LiveRoomProfile,
  type LiveRoomReportReason,
} from "./types.ts";

export const LIVE_ROOM_ALLOWED_EMOJIS = [
  "👋",
  "🦊",
  "🐻",
  "🦉",
  "🚀",
  "🧭",
  "📊",
  "🌱",
] as const;

export const LIVE_ROOM_GUEST_LAST_SEEN_INTERVAL_MS = 5 * 60 * 1_000;

export type LiveRoomActor =
  | {
      kind: "member";
      userId: string;
      email: string | null;
    }
  | {
      kind: "guest";
      guestSessionId: string;
    };

export type LiveRoomEventValidationInput = {
  deliveryLevel: string | null;
  eventId: string;
  eventTicker: string | null;
  kind: CompanyEventReference["kind"];
  roomTicker: string;
  title: string;
};

export class LiveRoomPolicyError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(
    code: string,
    message: string,
    status = 400,
    retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "LiveRoomPolicyError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function normalizeLiveRoomTicker(value: unknown) {
  const ticker =
    typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_TICKER",
      "This company room is unavailable.",
      400,
    );
  }
  return ticker;
}

export function normalizeLiveRoomPresenceTicker(value: unknown) {
  const ticker = normalizeLiveRoomTicker(value);
  if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(ticker)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PRESENCE_INVALID_TICKER",
      "Presence is unavailable for this company room.",
      400,
    );
  }
  return ticker;
}

export function normalizeLiveRoomUuid(
  value: unknown,
  code = "LIVE_ROOM_INVALID_MESSAGE_ID",
  message = "The Live Room message ID is invalid.",
) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      normalized,
    )
  ) {
    throw new LiveRoomPolicyError(code, message);
  }
  return normalized;
}

export function normalizeOptionalLiveRoomReplyMessageId(value: unknown) {
  if (value === null || value === undefined) return null;
  return normalizeLiveRoomUuid(
    value,
    "LIVE_ROOM_INVALID_REPLY_TARGET",
    "That message is not available to reply to.",
  );
}

export function normalizeLiveRoomReportReason(
  value: unknown,
): LiveRoomReportReason {
  if (
    typeof value !== "string" ||
    !LIVE_ROOM_REPORT_REASONS.includes(value as LiveRoomReportReason)
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_REPORT_REASON",
      "Choose spam, harassment, misinformation, or other.",
    );
  }
  return value as LiveRoomReportReason;
}

export function normalizeLiveRoomProfileInput(value: unknown) {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const displayName =
    typeof input.displayName === "string" ? input.displayName.trim() : "";
  const emoji = typeof input.emoji === "string" ? input.emoji : "";

  if (
    !displayName ||
    displayName.length > 24 ||
    /[\u0000-\u001f\u007f]/.test(displayName)
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_DISPLAY_NAME",
      "Display names must be between 1 and 24 visible characters.",
      400,
    );
  }

  if (
    !LIVE_ROOM_ALLOWED_EMOJIS.includes(
      emoji as (typeof LIVE_ROOM_ALLOWED_EMOJIS)[number],
    )
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_EMOJI",
      "Choose one of the available profile emojis.",
      400,
    );
  }

  return { displayName, emoji };
}

export function validateLiveRoomEventReference(
  input: LiveRoomEventValidationInput,
): CompanyEventReference {
  if (
    !input.eventId ||
    input.deliveryLevel === "archive" ||
    input.eventTicker?.trim().toUpperCase() !==
      input.roomTicker.trim().toUpperCase()
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_EVENT_REFERENCE",
      "That event cannot be mentioned in this company room.",
      400,
    );
  }

  return {
    eventId: input.eventId,
    kind: input.kind,
    title: input.title,
  };
}

export function getLiveRoomActorFilter(
  actor: LiveRoomActor,
  kindColumn: "actor_kind" | "author_kind" = "actor_kind",
): Record<string, string> {
  return actor.kind === "member"
    ? {
        [kindColumn]: "eq.member",
        member_user_id: `eq.${actor.userId}`,
      }
    : {
        [kindColumn]: "eq.guest",
        guest_session_id: `eq.${actor.guestSessionId}`,
      };
}

export function isLiveRoomMessageMine(
  row: {
    author_kind?: unknown;
    member_user_id?: unknown;
    guest_session_id?: unknown;
  },
  actor: LiveRoomActor,
) {
  return actor.kind === "member"
    ? row.author_kind === "member" &&
        row.member_user_id === actor.userId
    : row.author_kind === "guest" &&
        row.guest_session_id === actor.guestSessionId;
}

export function createServerOwnedAuthorSnapshot({
  actor,
  profile,
}: {
  actor: LiveRoomActor;
  profile: LiveRoomProfile;
}) {
  return {
    actorKind: actor.kind,
    memberUserId: actor.kind === "member" ? actor.userId : null,
    guestSessionId:
      actor.kind === "guest" ? actor.guestSessionId : null,
    displayName: profile.displayName,
    emoji: profile.emoji,
    plan: profile.plan,
  };
}

export function shouldRefreshLiveRoomGuestLastSeen(
  lastSeenAt: unknown,
  now: Date = new Date(),
) {
  if (typeof lastSeenAt !== "string") return true;
  const lastSeenTime = Date.parse(lastSeenAt);
  if (!Number.isFinite(lastSeenTime)) return true;
  return (
    now.getTime() - lastSeenTime >=
    LIVE_ROOM_GUEST_LAST_SEEN_INTERVAL_MS
  );
}

export function getDefaultLiveRoomDisplayName(actor: LiveRoomActor) {
  return actor.kind === "guest" ? "Guest" : "Member";
}
