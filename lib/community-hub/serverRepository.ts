import "server-only";

import { supabaseRpc } from "@/lib/supabase";
import type { Plan } from "@/lib/subscriptionPolicy";
import {
  LiveRoomPolicyError,
  normalizeLiveRoomUuid,
  type LiveRoomActor,
} from "@/lib/live-room/policy";
import {
  COMMUNITY_HUB_PEOPLE_FILTERS,
  type CommunityHubPeopleFilter,
  type CommunityHubPeoplePage,
  type CommunityHubPerson,
  type CommunityHubRoom,
  type CommunityHubRoomsPage,
} from "./types";

type PeopleCursor = {
  at: string;
  userId: string;
};

type RoomsCursor = {
  at: string;
  roomId: string;
};

export async function listCommunityHubPeople({
  actor,
  cursor,
  filter,
  limit = 30,
}: {
  actor: LiveRoomActor;
  cursor?: string | null;
  filter: unknown;
  limit?: number;
}): Promise<CommunityHubPeoplePage> {
  const member = requireMember(actor);
  const normalizedFilter = normalizePeopleFilter(filter);
  const decoded = decodeCursor<PeopleCursor>(cursor, "userId");
  const pageSize = normalizeLimit(limit);
  const result = await supabaseRpc(
    "get_live_room_member_relationships",
    {
      p_requester_user_id: member.userId,
      p_filter: normalizedFilter,
      p_after_at: decoded?.at || null,
      p_after_user_id: decoded?.userId || null,
      p_limit: pageSize,
    },
  );
  if (!result.ok) {
    throw communityHubError(result.error, result.status);
  }

  const data = readRecord(result.data);
  const rows = readRows(data?.items);
  const items = rows
    .map(mapPerson)
    .filter((item): item is CommunityHubPerson => item !== null);
  const last = rows.at(-1);
  const nextCursor =
    data?.hasMore === true && last
      ? encodeCursor({
          at: readDate(last.relationshipAt),
          userId: normalizeLiveRoomUuid(last.targetUserId),
        })
      : null;

  return {
    counts: {
      followers: readCount(data?.followerCount),
      following: readCount(data?.followingCount),
      mutual: readCount(data?.mutualCount),
    },
    items,
    nextCursor,
  };
}

export async function setCommunityHubMemberFollow({
  actor,
  followed,
  publicProfileId,
}: {
  actor: LiveRoomActor;
  followed: unknown;
  publicProfileId: unknown;
}) {
  const member = requireMember(actor);
  if (typeof followed !== "boolean") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_MEMBER_FOLLOW",
      "Follow status must be true or false.",
      400,
    );
  }
  const result = await supabaseRpc(
    "set_live_room_member_follow_by_profile",
    {
      p_requester_user_id: member.userId,
      p_public_profile_id: normalizeLiveRoomUuid(publicProfileId),
      p_followed: followed,
    },
  );
  if (!result.ok) {
    throw communityHubError(result.error, result.status);
  }
  return {
    followed: result.data === true,
    publicProfileId: normalizeLiveRoomUuid(publicProfileId),
  };
}

export async function listCommunityHubRooms({
  actor,
  cursor,
  limit = 30,
}: {
  actor: LiveRoomActor;
  cursor?: string | null;
  limit?: number;
}): Promise<CommunityHubRoomsPage> {
  const member = requireMember(actor);
  const decoded = decodeCursor<RoomsCursor>(cursor, "roomId");
  const result = await supabaseRpc("get_live_room_followed_rooms", {
    p_requester_user_id: member.userId,
    p_after_at: decoded?.at || null,
    p_after_room_id: decoded?.roomId || null,
    p_limit: normalizeLimit(limit),
  });
  if (!result.ok) {
    throw communityHubError(result.error, result.status);
  }

  const data = readRecord(result.data);
  const rows = readRows(data?.items);
  const items = rows
    .map(mapRoom)
    .filter((item): item is CommunityHubRoom => item !== null);
  const last = rows.at(-1);
  const nextCursor =
    data?.hasMore === true && last
      ? encodeCursor({
          at: readDate(last.updatedAt),
          roomId: normalizeLiveRoomUuid(last.roomId),
        })
      : null;

  return {
    items,
    nextCursor,
    totalUnreadCount: readCount(data?.totalUnreadCount),
  };
}

function mapPerson(
  row: Record<string, unknown>,
): CommunityHubPerson | null {
  const publicProfileId = readString(row.publicProfileId);
  const isFollowing = row.isFollowing === true;
  const followsYou = row.followsYou === true;
  if (!isUuid(publicProfileId) || (!isFollowing && !followsYou)) {
    return null;
  }
  return {
    displayName: readString(row.displayName).slice(0, 24) || "Member",
    emoji: readString(row.emoji).slice(0, 16) || "👋",
    followsYou,
    isFollowing,
    isVerified: row.isVerified === true,
    messageId: isUuid(readString(row.messageId))
      ? readString(row.messageId)
      : null,
    plan: normalizePlan(row.plan),
    publicProfileId,
    relationship:
      isFollowing && followsYou
        ? "mutual"
        : isFollowing
          ? "following"
          : "follower",
  };
}

function mapRoom(
  row: Record<string, unknown>,
): CommunityHubRoom | null {
  const kind = row.kind === "community" ? "community" : "company";
  const ticker =
    kind === "company" ? readString(row.ticker).toUpperCase() : null;
  const slug = kind === "community" ? readString(row.slug) : null;
  if (
    (kind === "company" && !/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker || "")) ||
    (kind === "community" &&
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug || ""))
  ) {
    return null;
  }
  return {
    href:
      kind === "company"
        ? `/live/${encodeURIComponent(ticker!)}`
        : `/live/community/${encodeURIComponent(slug!)}`,
    kind,
    label:
      readString(row.label).slice(0, 80) ||
      (kind === "company" ? `${ticker} Live Room` : "Community Room"),
    notificationScope: "new_chat_messages",
    slug,
    ticker,
    unreadCount: readCount(row.unreadCount),
  };
}

function normalizePeopleFilter(value: unknown): CommunityHubPeopleFilter {
  if (
    typeof value !== "string" ||
    !COMMUNITY_HUB_PEOPLE_FILTERS.includes(
      value as CommunityHubPeopleFilter,
    )
  ) {
    throw new LiveRoomPolicyError(
      "COMMUNITY_HUB_INVALID_PEOPLE_FILTER",
      "Choose Following, Followers, or Mutual.",
      400,
    );
  }
  return value as CommunityHubPeopleFilter;
}

function requireMember(actor: LiveRoomActor) {
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "COMMUNITY_HUB_MEMBER_REQUIRED",
      "Sign in to manage Community.",
      401,
    );
  }
  return actor;
}

function normalizeLimit(value: number) {
  return Math.min(Math.max(Number(value) || 30, 1), 50);
}

function communityHubError(
  error: string | undefined,
  status: number,
) {
  const value = error || "";
  const mappings: Array<[string, string, number]> = [
    [
      "COMMUNITY_HUB_MEMBER_REQUIRED",
      "Sign in to manage Community.",
      401,
    ],
    [
      "COMMUNITY_HUB_INVALID_PEOPLE_FILTER",
      "Choose Following, Followers, or Mutual.",
      400,
    ],
    [
      "COMMUNITY_HUB_INVALID_CURSOR",
      "That Community page cursor is invalid.",
      400,
    ],
    [
      "COMMUNITY_HUB_FOLLOW_BACK_REQUIRED",
      "Follow back is available only for members who follow you.",
      403,
    ],
    [
      "LIVE_ROOM_MEMBER_TARGET_NOT_FOUND",
      "That member is unavailable.",
      404,
    ],
  ];
  const mapping = mappings.find(([code]) => value.includes(code));
  return new LiveRoomPolicyError(
    mapping?.[0] || "COMMUNITY_HUB_UNAVAILABLE",
    mapping?.[1] || "Community is temporarily unavailable.",
    mapping?.[2] || status || 502,
  );
}

function encodeCursor(value: PeopleCursor | RoomsCursor) {
  return Buffer.from(JSON.stringify(value), "utf8").toString(
    "base64url",
  );
}

function decodeCursor<T extends PeopleCursor | RoomsCursor>(
  value: string | null | undefined,
  idKey: "roomId" | "userId",
): T | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const at = readDate(parsed.at);
    const id = normalizeLiveRoomUuid(parsed[idKey]);
    return { at, [idKey]: id } as T;
  } catch {
    throw new LiveRoomPolicyError(
      "COMMUNITY_HUB_INVALID_CURSOR",
      "That Community page cursor is invalid.",
      400,
    );
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return readRecord(value[0]);
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readCount(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

function readDate(value: unknown) {
  const date = readString(value);
  if (!date || !Number.isFinite(Date.parse(date))) {
    throw new Error("invalid date");
  }
  return date;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizePlan(value: unknown): Plan {
  return value === "ad_free" ||
    value === "pro" ||
    value === "advanced" ||
    value === "ultimate"
    ? value
    : "free";
}
