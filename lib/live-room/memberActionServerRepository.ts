import "server-only";

import { ensureUserBootstrap } from "@/lib/auth/supabaseAuth";
import {
  supabaseRpc,
  supabaseSelect,
} from "@/lib/supabase";
import {
  LiveRoomPolicyError,
  normalizeLiveRoomUuid,
  type LiveRoomActor,
} from "./policy";
import type {
  LiveRoomPublicMemberActions,
  LiveRoomPublicMemberFollowResult,
} from "./types";

type PublicMemberActionTarget = {
  publicProfileId: string;
  roomId: string | null;
  sourceMessageId: string | null;
  userId: string;
};

export async function getLiveRoomPublicMemberActions({
  actor,
  publicProfileId,
}: {
  actor: LiveRoomActor;
  publicProfileId: unknown;
}): Promise<LiveRoomPublicMemberActions> {
  const target = await resolvePublicMemberActionTarget(publicProfileId);

  if (actor.kind === "guest") {
    return {
      canFollow: false,
      canMessage: false,
      isFollowing: false,
      isGuest: true,
      isSelf: false,
      sourceMessageId: null,
    };
  }

  const isSelf = actor.userId === target.userId;
  if (isSelf) {
    return {
      canFollow: false,
      canMessage: false,
      isFollowing: false,
      isGuest: false,
      isSelf: true,
      sourceMessageId: null,
    };
  }

  const [followResult, blockResult] = await Promise.all([
    supabaseSelect("live_room_member_follows", {
      select: "followed_user_id",
      follower_user_id: `eq.${actor.userId}`,
      followed_user_id: `eq.${target.userId}`,
      limit: "1",
    }),
    selectBilateralMemberBlocks(actor.userId, target.userId),
  ]);
  if (!followResult.ok || !blockResult.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_ACTION_STATE_UNAVAILABLE",
      "Member actions could not be loaded safely.",
      followResult.status || blockResult.status || 502,
    );
  }

  const isBlocked = Boolean(readSingleRow(blockResult.data));
  const sourceMessageId =
    isBlocked ? null : target.sourceMessageId;
  const canAct = Boolean(sourceMessageId);

  return {
    canFollow: canAct,
    canMessage: canAct,
    isFollowing:
      !isBlocked && Boolean(readSingleRow(followResult.data)),
    isGuest: false,
    isSelf: false,
    sourceMessageId,
  };
}

export async function updateLiveRoomPublicMemberFollow({
  actor,
  followed,
  publicProfileId,
}: {
  actor: LiveRoomActor;
  followed: unknown;
  publicProfileId: unknown;
}): Promise<LiveRoomPublicMemberFollowResult> {
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_REQUIRED",
      "Sign in to follow members.",
      401,
    );
  }
  if (typeof followed !== "boolean") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_MEMBER_FOLLOW",
      "Member follow status must be true or false.",
    );
  }

  const target = await resolvePublicMemberActionTarget(publicProfileId);
  if (actor.userId === target.userId) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_CANNOT_FOLLOW_SELF",
      "You cannot follow yourself.",
    );
  }
  if (!target.sourceMessageId || !target.roomId) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_NOT_FOLLOWABLE",
      "That member has no visible Live Room activity.",
      409,
    );
  }

  const blockResult = await selectBilateralMemberBlocks(
    actor.userId,
    target.userId,
  );
  if (!blockResult.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_ACTION_STATE_UNAVAILABLE",
      "Member actions could not be checked safely.",
      blockResult.status || 502,
    );
  }
  if (readSingleRow(blockResult.data)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_ACTION_UNAVAILABLE",
      "That member action is unavailable.",
      409,
    );
  }

  await ensureUserBootstrap({ id: actor.userId, email: actor.email });
  const result = await supabaseRpc("set_live_room_member_follow", {
    p_follower_user_id: actor.userId,
    p_room_id: target.roomId,
    p_message_id: target.sourceMessageId,
    p_followed: followed,
  });
  if (!result.ok) {
    throw mapMemberFollowError(result.error, result.status);
  }

  return {
    followed: result.data === true,
    publicProfileId: target.publicProfileId,
  };
}

async function resolvePublicMemberActionTarget(
  rawPublicProfileId: unknown,
): Promise<PublicMemberActionTarget> {
  const publicProfileId = normalizeLiveRoomUuid(
    rawPublicProfileId,
    "LIVE_ROOM_INVALID_PUBLIC_PROFILE_ID",
    "The public member profile ID is invalid.",
  );
  const profileResult = await supabaseSelect(
    "live_room_member_profiles",
    {
      select: "user_id,public_profile_id",
      public_profile_id: `eq.${publicProfileId}`,
      limit: "1",
    },
  );
  const profile = readSingleRow(profileResult.data);
  const userId = readString(profile?.user_id);
  if (!profileResult.ok || !profile || !userId) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PUBLIC_PROFILE_NOT_FOUND",
      "That member profile is unavailable.",
      404,
    );
  }

  const messageResult = await supabaseSelect("live_room_messages", {
    select: "id,room_id",
    author_kind: "eq.member",
    member_user_id: `eq.${userId}`,
    visibility_status: "eq.visible",
    order: "created_at.desc,id.desc",
    limit: "1",
  });
  if (!messageResult.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_ACTION_STATE_UNAVAILABLE",
      "Member actions could not be loaded safely.",
      messageResult.status || 502,
    );
  }
  const message = readSingleRow(messageResult.data);

  return {
    publicProfileId,
    roomId: readString(message?.room_id) || null,
    sourceMessageId: readString(message?.id) || null,
    userId,
  };
}

function selectBilateralMemberBlocks(
  requesterUserId: string,
  targetUserId: string,
) {
  return supabaseSelect("live_room_actor_blocks", {
    select: "id",
    blocker_kind: "eq.member",
    blocked_kind: "eq.member",
    or: `(and(blocker_member_user_id.eq.${requesterUserId},blocked_member_user_id.eq.${targetUserId}),and(blocker_member_user_id.eq.${targetUserId},blocked_member_user_id.eq.${requesterUserId}))`,
    limit: "1",
  });
}

function mapMemberFollowError(error: string | undefined, status: number) {
  const value = error || "";
  if (value.includes("LIVE_ROOM_CANNOT_FOLLOW_SELF")) {
    return new LiveRoomPolicyError(
      "LIVE_ROOM_CANNOT_FOLLOW_SELF",
      "You cannot follow yourself.",
    );
  }
  if (
    value.includes("LIVE_ROOM_MEMBER_NOT_FOLLOWABLE") ||
    value.includes("LIVE_ROOM_MESSAGE_NOT_FOUND")
  ) {
    return new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_NOT_FOLLOWABLE",
      "That member has no visible Live Room activity.",
      409,
    );
  }
  return new LiveRoomPolicyError(
    "LIVE_ROOM_MEMBER_FOLLOW_UPDATE_FAILED",
    "Member follow status could not be saved.",
    status || 502,
  );
}

function readSingleRow(value: unknown) {
  return Array.isArray(value) &&
    value[0] &&
    typeof value[0] === "object"
    ? (value[0] as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}
