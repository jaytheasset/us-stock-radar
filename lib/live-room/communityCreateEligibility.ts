export const COMMUNITY_ROOM_CREATE_COOLDOWN_MS = 5 * 60 * 1_000;
export const COMMUNITY_ROOM_CREATE_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const COMMUNITY_ROOM_CREATE_WINDOW_LIMIT = 5;
export const COMMUNITY_ROOM_CREATE_RETURN_PATH = "/live?create=room";
export const COMMUNITY_ROOM_CREATE_LOGIN_HREF =
  `/login?next=${encodeURIComponent(COMMUNITY_ROOM_CREATE_RETURN_PATH)}`;

export type CommunityRoomCreateEligibilityReason =
  | "COMMUNITY_ROOM_MEMBER_REQUIRED"
  | "COMMUNITY_ROOM_CREATE_COOLDOWN"
  | "COMMUNITY_ROOM_CREATE_DAILY_LIMIT";

export type CommunityRoomCreateEligibility = {
  canCreate: boolean;
  message: string;
  nextActionHref: string | null;
  nextActionLabel: string | null;
  reason: CommunityRoomCreateEligibilityReason | null;
  retryAt: string | null;
};

export type CommunityRoomCreateHistoryItem = {
  createdAt: string;
  slug: string;
};

export function resolveCommunityRoomCreateEligibility({
  history,
  isMember,
  now = new Date(),
}: {
  history: readonly CommunityRoomCreateHistoryItem[];
  isMember: boolean;
  now?: Date;
}): CommunityRoomCreateEligibility {
  if (!isMember) {
    return {
      canCreate: false,
      message:
        "A signed-in member account is required to create a Community Room.",
      nextActionHref: COMMUNITY_ROOM_CREATE_LOGIN_HREF,
      nextActionLabel: "Sign in or create an account",
      reason: "COMMUNITY_ROOM_MEMBER_REQUIRED",
      retryAt: null,
    };
  }

  const nowMs = now.getTime();
  const recent = history
    .map((item) => ({
      ...item,
      createdAtMs: Date.parse(item.createdAt),
    }))
    .filter(
      (item) =>
        Number.isFinite(item.createdAtMs) &&
        item.createdAtMs <= nowMs &&
        item.createdAtMs >= nowMs - COMMUNITY_ROOM_CREATE_WINDOW_MS,
    )
    .sort((left, right) => right.createdAtMs - left.createdAtMs);
  const latest = recent[0] ?? null;
  const latestRoomHref = latest?.slug
    ? `/live/community/${encodeURIComponent(latest.slug)}`
    : "/live";

  if (recent.length >= COMMUNITY_ROOM_CREATE_WINDOW_LIMIT) {
    const oldestCounted =
      recent[COMMUNITY_ROOM_CREATE_WINDOW_LIMIT - 1]!;
    return {
      canCreate: false,
      message:
        "A member can create at most 5 Community Rooms in a rolling 24-hour period. Your account has reached that limit.",
      nextActionHref: latestRoomHref,
      nextActionLabel: latest?.slug
        ? "Open your latest room"
        : "Browse Community Rooms",
      reason: "COMMUNITY_ROOM_CREATE_DAILY_LIMIT",
      retryAt: new Date(
        oldestCounted.createdAtMs + COMMUNITY_ROOM_CREATE_WINDOW_MS,
      ).toISOString(),
    };
  }

  if (
    latest &&
    latest.createdAtMs + COMMUNITY_ROOM_CREATE_COOLDOWN_MS > nowMs
  ) {
    return {
      canCreate: false,
      message:
        "Community Rooms can be created once every 5 minutes. Your most recent room is still inside that cooldown.",
      nextActionHref: latestRoomHref,
      nextActionLabel: latest.slug
        ? "Open your latest room"
        : "Browse Community Rooms",
      reason: "COMMUNITY_ROOM_CREATE_COOLDOWN",
      retryAt: new Date(
        latest.createdAtMs + COMMUNITY_ROOM_CREATE_COOLDOWN_MS,
      ).toISOString(),
    };
  }

  return {
    canCreate: true,
    message:
      "Your signed-in member account meets the current room-creation limits.",
    nextActionHref: null,
    nextActionLabel: null,
    reason: null,
    retryAt: null,
  };
}
