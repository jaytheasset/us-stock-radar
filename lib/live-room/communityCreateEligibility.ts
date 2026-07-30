import type { Plan } from "@/lib/subscriptionPolicy";

export const COMMUNITY_ROOM_CREATE_COOLDOWN_MS = 5 * 60 * 1_000;
export const COMMUNITY_ROOM_CREATE_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const COMMUNITY_ROOM_CREATE_WINDOW_LIMIT = 5;
export const COMMUNITY_ROOM_CREATE_FOLLOWER_REQUIREMENT = 100;
export const COMMUNITY_ROOM_CREATE_RETURN_PATH = "/live?create=room";
export const COMMUNITY_ROOM_CREATE_LOGIN_HREF =
  `/login?next=${encodeURIComponent(COMMUNITY_ROOM_CREATE_RETURN_PATH)}`;
export const COMMUNITY_ROOM_CREATE_UPGRADE_HREF = "/premium";

export type CommunityRoomCreateEligibilityReason =
  | "COMMUNITY_ROOM_MEMBER_REQUIRED"
  | "COMMUNITY_ROOM_ADVANCED_REQUIRED"
  | "COMMUNITY_ROOM_FOLLOWERS_REQUIRED"
  | "COMMUNITY_ROOM_CREATE_COOLDOWN"
  | "COMMUNITY_ROOM_CREATE_DAILY_LIMIT";

export type CommunityRoomCreateEligibility = {
  canCreate: boolean;
  effectivePlan: Plan | null;
  followerCount: number;
  followerRequirement: number;
  message: string;
  nextActionHref: string | null;
  nextActionLabel: string | null;
  planEligible: boolean;
  reason: CommunityRoomCreateEligibilityReason | null;
  retryAt: string | null;
};

export type CommunityRoomCreateHistoryItem = {
  createdAt: string;
  slug: string;
};

export function resolveCommunityRoomCreateEligibility({
  effectivePlan,
  followerCount = 0,
  history,
  isMember,
  now = new Date(),
}: {
  effectivePlan: Plan | null;
  followerCount?: number;
  history: readonly CommunityRoomCreateHistoryItem[];
  isMember: boolean;
  now?: Date;
}): CommunityRoomCreateEligibility {
  const normalizedFollowerCount = Math.max(
    0,
    Math.floor(Number.isFinite(followerCount) ? followerCount : 0),
  );
  const planEligible =
    effectivePlan === "advanced" || effectivePlan === "ultimate";
  const base = {
    effectivePlan: isMember ? effectivePlan : null,
    followerCount: normalizedFollowerCount,
    followerRequirement: COMMUNITY_ROOM_CREATE_FOLLOWER_REQUIREMENT,
    planEligible,
  };

  if (!isMember) {
    return {
      ...base,
      canCreate: false,
      message:
        "A signed-in member account is required to create a Community Room.",
      nextActionHref: COMMUNITY_ROOM_CREATE_LOGIN_HREF,
      nextActionLabel: "Sign in or create an account",
      reason: "COMMUNITY_ROOM_MEMBER_REQUIRED",
      retryAt: null,
    };
  }

  if (!planEligible) {
    return {
      ...base,
      canCreate: false,
      message:
        "Creating a Community Room requires an Advanced or Ultimate plan.",
      nextActionHref: COMMUNITY_ROOM_CREATE_UPGRADE_HREF,
      nextActionLabel: "Compare Premium plans",
      reason: "COMMUNITY_ROOM_ADVANCED_REQUIRED",
      retryAt: null,
    };
  }

  if (
    normalizedFollowerCount <
    COMMUNITY_ROOM_CREATE_FOLLOWER_REQUIREMENT
  ) {
    return {
      ...base,
      canCreate: false,
      message: `You have ${normalizedFollowerCount} of ${COMMUNITY_ROOM_CREATE_FOLLOWER_REQUIREMENT} followers required to create a Community Room.`,
      nextActionHref: null,
      nextActionLabel: null,
      reason: "COMMUNITY_ROOM_FOLLOWERS_REQUIRED",
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
      ...base,
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
      ...base,
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
    ...base,
    canCreate: true,
    message:
      "Your plan, follower count, and current creation limits are eligible.",
    nextActionHref: null,
    nextActionLabel: null,
    reason: null,
    retryAt: null,
  };
}
