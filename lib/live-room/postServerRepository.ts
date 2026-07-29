import "server-only";

import { ensureUserBootstrap } from "@/lib/auth/supabaseAuth";
import { getBrokerageConfig } from "@/lib/brokerage/config";
import {
  getBrokerageProofMapForPosts,
  hasActiveBrokerageConnection,
} from "@/lib/brokerage/serverRepository";
import {
  supabaseRpc,
  supabaseSelect,
  supabaseUpsert,
} from "@/lib/supabase";
import { getCommunityRoomIdentity } from "./communityServerRepository";
import {
  getDefaultLiveRoomDisplayName,
  LiveRoomPolicyError,
  normalizeLiveRoomReportReason,
  normalizeLiveRoomTicker,
  normalizeLiveRoomUuid,
  type LiveRoomActor,
} from "./policy";
import {
  assertLiveRoomPostMentionTargets,
  createLiveRoomPostBodyPreview,
  normalizeLiveRoomPostDraft,
  normalizeLiveRoomPostPageLimit,
} from "./postPolicy";
import {
  encodeLiveRoomPostMetadataTags,
  isLiveRoomPostSignal,
  readLiveRoomPostDirection,
} from "./postSignals";
import {
  normalizeLiveRoomPostCommentDraft,
  normalizeLiveRoomPostCommentPageLimit,
} from "./commentPolicy";
import { applyLiveRoomPostScopeAndCursorFilters } from "./postQuery";
import type {
  CompanyEventReference,
  LiveRoomBlockResult,
  LiveRoomBlockedActor,
  LiveRoomPost,
  LiveRoomPostComment,
  LiveRoomPostCommentPage,
  LiveRoomPostDraft,
  LiveRoomPostLikeResult,
  LiveRoomPostPage,
  LiveRoomPostPreview,
  LiveRoomPublicMemberPostPage,
} from "./types";

type RoomIdentity = {
  id: string;
  kind: "company" | "community";
  label: string;
  slug: string | null;
  ticker: string | null;
};

export type PostRow = {
  author_user_id?: unknown;
  body?: unknown;
  created_at?: unknown;
  id?: unknown;
  like_count?: unknown;
  referenced_event_id?: unknown;
  related_tickers?: unknown;
  room_id?: unknown;
  signal_labels?: unknown;
  title?: unknown;
  updated_at?: unknown;
  visible_comment_count?: unknown;
  visibility_status?: unknown;
};

type CursorValue = {
  createdAt: string;
  id: string;
};

type CommentRow = {
  author_user_id?: unknown;
  body?: unknown;
  created_at?: unknown;
  id?: unknown;
  parent_comment_id?: unknown;
  post_id?: unknown;
  updated_at?: unknown;
  visibility_status?: unknown;
};

export async function listLiveRoomPosts({
  actor,
  after,
  before,
  limit,
  publicProfileId,
  slug,
  ticker,
  includeMentionedCompanyPosts = true,
  visibility = "visible",
}: {
  actor: LiveRoomActor;
  after?: string | null;
  before?: string | null;
  limit?: number;
  publicProfileId?: string;
  slug?: string;
  ticker?: string;
  includeMentionedCompanyPosts?: boolean;
  visibility?: "hidden" | "visible";
}): Promise<LiveRoomPostPage> {
  if (after && before) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_CURSOR",
      "Use either an older-page cursor or an update cursor.",
    );
  }
  if (visibility === "hidden") await assertLiveRoomModerator(actor);

  const pageSize = normalizeLiveRoomPostPageLimit(limit);
  const cursor = decodePostCursor(after || before || null);
  const ascending = Boolean(after);
  let authorUserId: string | null = null;
  let profile:
    | { displayName: string; emoji: string; publicProfileId: string }
    | null = null;

  if (publicProfileId) {
    const profileResult = await getPublicMember(publicProfileId);
    authorUserId = profileResult.userId;
    profile = profileResult.member;
  }

  const room =
    slug || ticker
      ? await resolveRoom({ slug, ticker })
      : null;
  const blockedMemberIds =
    visibility === "visible" ? await getBlockedMemberIds(actor) : [];
  if (authorUserId && blockedMemberIds.includes(authorUserId)) {
    return { items: [], nextCursor: null };
  }
  const search: Record<string, string> = {
    select:
      "id,room_id,author_user_id,title,body,related_tickers,signal_labels,referenced_event_id,visibility_status,created_at,updated_at,like_count,visible_comment_count",
    visibility_status: `eq.${visibility}`,
    order: ascending
      ? "created_at.asc,id.asc"
      : "created_at.desc,id.desc",
    limit: String(pageSize + 1),
  };
  if (authorUserId) search.author_user_id = `eq.${authorUserId}`;
  if (blockedMemberIds.length) {
    search.author_user_id = authorUserId
      ? search.author_user_id
      : `not.in.(${blockedMemberIds.join(",")})`;
  }
  applyLiveRoomPostScopeAndCursorFilters({
    ascending,
    cursor,
    includeMentionedCompanyPosts,
    room,
    search,
  });

  const result = await supabaseSelect("live_room_posts", search);
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POSTS_UNAVAILABLE",
      result.error || "Posts could not be loaded.",
      result.status || 502,
    );
  }
  const fetchedRows = readRows(result.data) as PostRow[];
  const hasMore = fetchedRows.length > pageSize;
  const rows = fetchedRows.slice(0, pageSize);
  const items = await mapLiveRoomPostRows(rows, actor);
  const oldest = rows[rows.length - 1];

  return {
    items,
    nextCursor:
      !ascending && hasMore && oldest
        ? encodePostCursor(readCursor(oldest))
        : null,
    ...(profile ? { member: profile } : {}),
  } as LiveRoomPostPage;
}

export async function listPublicMemberPosts({
  actor,
  before,
  limit,
  publicProfileId,
}: {
  actor: LiveRoomActor;
  before?: string | null;
  limit?: number;
  publicProfileId: string;
}): Promise<LiveRoomPublicMemberPostPage> {
  const profile = await getPublicMember(publicProfileId);
  const page = await listLiveRoomPosts({
    actor,
    before,
    limit,
    publicProfileId: profile.member.publicProfileId,
  });
  return { ...page, member: profile.member };
}

export async function getLiveRoomPost(
  actor: LiveRoomActor,
  rawPostId: unknown,
): Promise<LiveRoomPost> {
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  const [result, blockedMemberIds] = await Promise.all([
    supabaseSelect("live_room_posts", {
      select:
        "id,room_id,author_user_id,title,body,related_tickers,signal_labels,referenced_event_id,visibility_status,created_at,updated_at,like_count,visible_comment_count",
      id: `eq.${postId}`,
      visibility_status: "eq.visible",
      limit: "1",
    }),
    getBlockedMemberIds(actor),
  ]);
  const row = readSingleRow(result.data) as PostRow | null;
  if (
    !result.ok ||
    !row ||
    blockedMemberIds.includes(readString(row.author_user_id))
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_NOT_FOUND",
      "That post is no longer available.",
      404,
    );
  }
  const [post] = await mapLiveRoomPostRows([row], actor);
  if (!post) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_NOT_FOUND",
      "That post is no longer available.",
      404,
    );
  }
  return post;
}

export async function createLiveRoomPost({
  actor,
  draft,
  slug,
  ticker,
}: {
  actor: LiveRoomActor;
  draft: unknown;
  slug?: string;
  ticker?: string;
}) {
  assertMember(actor);
  const normalized = normalizeLiveRoomPostDraft(draft);
  const room = await resolveRoom({ slug, ticker });
  await validatePostRelatedTickers(normalized.relatedTickers, room);
  await ensureLiveRoomMember(actor);
  const result = await supabaseRpc("create_live_room_post_with_proof", {
    p_room_id: room.id,
    p_author_user_id: actor.userId,
    p_title: normalized.title,
    p_body: normalized.body,
    p_related_tickers: normalized.relatedTickers,
    p_referenced_event_id: normalized.eventId,
    p_signal_labels: encodeLiveRoomPostMetadataTags(
      normalized.signalLabels,
      normalized.direction,
    ),
    p_proof_id: normalized.proofId,
    p_public_sharing_enabled: getBrokerageConfig().publicProofsEnabled,
  });
  return mapMutationResult(result, actor, "LIVE_ROOM_POST_CREATE_FAILED");
}

export async function updateLiveRoomPost({
  actor,
  draft,
  postId: rawPostId,
}: {
  actor: LiveRoomActor;
  draft: unknown;
  postId: unknown;
}) {
  assertMember(actor);
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  const normalized = normalizeLiveRoomPostDraft(draft);
  const room = await resolvePostRoom(postId);
  await validatePostRelatedTickers(normalized.relatedTickers, room);
  const result = await supabaseRpc("update_live_room_post", {
    p_post_id: postId,
    p_author_user_id: actor.userId,
    p_title: normalized.title,
    p_body: normalized.body,
    p_related_tickers: normalized.relatedTickers,
    p_referenced_event_id: normalized.eventId,
    p_signal_labels: encodeLiveRoomPostMetadataTags(
      normalized.signalLabels,
      normalized.direction,
    ),
  });
  return mapMutationResult(result, actor, "LIVE_ROOM_POST_UPDATE_FAILED");
}

export async function deleteLiveRoomPost({
  actor,
  postId: rawPostId,
}: {
  actor: LiveRoomActor;
  postId: unknown;
}) {
  assertMember(actor);
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  const result = await supabaseRpc("delete_live_room_post", {
    p_post_id: postId,
    p_author_user_id: actor.userId,
  });
  if (!result.ok || result.data !== true) {
    throw mapPostDatabaseError(
      result.error,
      result.status,
      "LIVE_ROOM_POST_DELETE_FAILED",
    );
  }
  return { deleted: true as const, postId };
}

export async function toggleLiveRoomPostLike({
  actor,
  postId: rawPostId,
}: {
  actor: LiveRoomActor;
  postId: unknown;
}): Promise<LiveRoomPostLikeResult> {
  assertMember(actor);
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  await ensureLiveRoomMember(actor);
  const result = await supabaseRpc("toggle_live_room_post_like", {
    p_post_id: postId,
    p_actor_user_id: actor.userId,
  });
  const row = readSingleRow(result.data);
  if (!result.ok || !row || typeof row.liked !== "boolean") {
    throw mapPostDatabaseError(
      result.error,
      result.status,
      "LIVE_ROOM_POST_LIKE_FAILED",
    );
  }
  return {
    liked: row.liked,
    likeCount: readNonnegativeCount(row.like_count),
    postId,
  };
}

export async function reportLiveRoomPost({
  actor,
  postId: rawPostId,
  reason: rawReason,
}: {
  actor: LiveRoomActor;
  postId: unknown;
  reason: unknown;
}) {
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  const reason = normalizeLiveRoomReportReason(rawReason);
  if (actor.kind === "member") await ensureLiveRoomMember(actor);
  const result = await supabaseRpc("report_live_room_post", {
    p_post_id: postId,
    p_reporter_kind: actor.kind,
    p_reporter_member_user_id:
      actor.kind === "member" ? actor.userId : null,
    p_reporter_guest_session_id:
      actor.kind === "guest" ? actor.guestSessionId : null,
    p_reason: reason,
  });
  if (!result.ok) {
    throw mapPostDatabaseError(
      result.error,
      result.status,
      "LIVE_ROOM_POST_REPORT_FAILED",
    );
  }
  return { reported: true as const };
}

export async function moderateLiveRoomPost({
  action,
  actor,
  postId: rawPostId,
  reason,
}: {
  action: unknown;
  actor: LiveRoomActor;
  postId: unknown;
  reason: unknown;
}) {
  assertMember(actor);
  await assertLiveRoomModerator(actor);
  if (action !== "hide" && action !== "restore") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_MODERATION_ACTION",
      "Choose hide or restore.",
    );
  }
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  const result = await supabaseRpc("moderate_live_room_post", {
    p_post_id: postId,
    p_moderator_user_id: actor.userId,
    p_action: action,
    p_reason:
      typeof reason === "string" ? reason.trim().slice(0, 240) : "",
  });
  const post = await mapMutationResult(
    result,
    actor,
    "LIVE_ROOM_POST_MODERATION_FAILED",
  );
  return { action, post, postId };
}

export async function blockLiveRoomPostAuthor({
  actor,
  postId: rawPostId,
}: {
  actor: LiveRoomActor;
  postId: unknown;
}): Promise<LiveRoomBlockResult> {
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  if (actor.kind === "member") await ensureLiveRoomMember(actor);
  const result = await supabaseRpc("block_live_room_post_author", {
    p_post_id: postId,
    p_blocker_kind: actor.kind,
    p_blocker_member_user_id:
      actor.kind === "member" ? actor.userId : null,
    p_blocker_guest_session_id:
      actor.kind === "guest" ? actor.guestSessionId : null,
  });
  const row = readSingleRow(result.data);
  if (!result.ok || !row) {
    throw mapPostDatabaseError(
      result.error,
      result.status,
      "LIVE_ROOM_POST_BLOCK_FAILED",
    );
  }
  return {
    block: mapBlockRow(row),
    removedMessageIds: [postId],
  };
}

export async function listLiveRoomPostComments({
  actor,
  after,
  limit,
  postId: rawPostId,
}: {
  actor: LiveRoomActor;
  after?: string | null;
  limit?: number;
  postId: unknown;
}): Promise<LiveRoomPostCommentPage> {
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  await getLiveRoomPost(actor, postId);
  const pageSize = normalizeLiveRoomPostCommentPageLimit(limit);
  const cursor = decodeCommentCursor(after || null);
  const blockedMemberIds = await getBlockedMemberIds(actor);
  const search: Record<string, string> = {
    select:
      "id,post_id,author_user_id,parent_comment_id,body,visibility_status,created_at,updated_at",
    post_id: `eq.${postId}`,
    visibility_status: "eq.visible",
    order: "created_at.asc,id.asc",
    limit: String(pageSize + 1),
  };
  if (blockedMemberIds.length) {
    search.author_user_id = `not.in.(${blockedMemberIds.join(",")})`;
  }
  if (cursor) {
    search.or =
      `(created_at.gt.${cursor.createdAt},` +
      `and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id}))`;
  }
  const result = await supabaseSelect("live_room_post_comments", search);
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_COMMENTS_UNAVAILABLE",
      result.error || "Comments could not be loaded.",
      result.status || 502,
    );
  }
  const fetchedRows = readRows(result.data) as CommentRow[];
  const hasMore = fetchedRows.length > pageSize;
  const rows = fetchedRows.slice(0, pageSize);
  const items = await mapLiveRoomPostCommentRows(rows, actor);
  const last = rows[rows.length - 1];
  return {
    canComment: actor.kind === "member",
    items,
    nextCursor:
      hasMore && last ? encodePostCursor(readCommentCursor(last)) : null,
  };
}

export async function createLiveRoomPostComment({
  actor,
  draft,
  postId: rawPostId,
}: {
  actor: LiveRoomActor;
  draft: unknown;
  postId: unknown;
}) {
  assertMember(actor);
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  const normalized = normalizeLiveRoomPostCommentDraft(draft);
  const parentCommentId = normalized.parentCommentId
    ? normalizeLiveRoomUuid(
        normalized.parentCommentId,
        "LIVE_ROOM_COMMENT_INVALID_PARENT",
        "Reply to a valid top-level comment.",
      )
    : null;
  await ensureLiveRoomMember(actor);
  const result = await supabaseRpc("create_live_room_post_comment", {
    p_post_id: postId,
    p_author_user_id: actor.userId,
    p_body: normalized.body,
    p_parent_comment_id: parentCommentId,
  });
  return mapCommentMutationResult(
    result,
    actor,
    "LIVE_ROOM_COMMENT_CREATE_FAILED",
  );
}

export async function updateLiveRoomPostComment({
  actor,
  commentId: rawCommentId,
  draft,
  postId: rawPostId,
}: {
  actor: LiveRoomActor;
  commentId: unknown;
  draft: unknown;
  postId: unknown;
}) {
  assertMember(actor);
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  const commentId = normalizeLiveRoomUuid(
    rawCommentId,
    "LIVE_ROOM_INVALID_COMMENT_ID",
    "The comment ID is invalid.",
  );
  await assertCommentBelongsToPost(commentId, postId);
  const normalized = normalizeLiveRoomPostCommentDraft(draft);
  const result = await supabaseRpc("update_live_room_post_comment", {
    p_comment_id: commentId,
    p_author_user_id: actor.userId,
    p_body: normalized.body,
  });
  return mapCommentMutationResult(
    result,
    actor,
    "LIVE_ROOM_COMMENT_UPDATE_FAILED",
  );
}

export async function deleteLiveRoomPostComment({
  actor,
  commentId: rawCommentId,
  postId: rawPostId,
}: {
  actor: LiveRoomActor;
  commentId: unknown;
  postId: unknown;
}) {
  assertMember(actor);
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  const commentId = normalizeLiveRoomUuid(
    rawCommentId,
    "LIVE_ROOM_INVALID_COMMENT_ID",
    "The comment ID is invalid.",
  );
  await assertCommentBelongsToPost(commentId, postId);
  const result = await supabaseRpc("delete_live_room_post_comment", {
    p_comment_id: commentId,
    p_author_user_id: actor.userId,
  });
  if (!result.ok || result.data !== true) {
    throw mapCommentDatabaseError(
      result.error,
      result.status,
      "LIVE_ROOM_COMMENT_DELETE_FAILED",
    );
  }
  return { commentId, deleted: true as const };
}

export async function reportLiveRoomPostComment({
  actor,
  commentId: rawCommentId,
  postId: rawPostId,
  reason: rawReason,
}: {
  actor: LiveRoomActor;
  commentId: unknown;
  postId: unknown;
  reason: unknown;
}) {
  const postId = normalizeLiveRoomUuid(
    rawPostId,
    "LIVE_ROOM_INVALID_POST_ID",
    "The post ID is invalid.",
  );
  const commentId = normalizeLiveRoomUuid(
    rawCommentId,
    "LIVE_ROOM_INVALID_COMMENT_ID",
    "The comment ID is invalid.",
  );
  await assertCommentBelongsToPost(commentId, postId);
  const reason = normalizeLiveRoomReportReason(rawReason);
  if (actor.kind === "member") await ensureLiveRoomMember(actor);
  const result = await supabaseRpc("report_live_room_post_comment", {
    p_comment_id: commentId,
    p_reporter_kind: actor.kind,
    p_reporter_member_user_id:
      actor.kind === "member" ? actor.userId : null,
    p_reporter_guest_session_id:
      actor.kind === "guest" ? actor.guestSessionId : null,
    p_reason: reason,
  });
  if (!result.ok) {
    throw mapCommentDatabaseError(
      result.error,
      result.status,
      "LIVE_ROOM_COMMENT_REPORT_FAILED",
    );
  }
  return { reported: true as const };
}

export function toLiveRoomPostPreview(post: LiveRoomPost): LiveRoomPostPreview {
  return {
    author: post.author,
    bodyPreview: createLiveRoomPostBodyPreview(post.body),
    brokerageProof: post.brokerageProof,
    canLike: post.canLike,
    commentCount: post.commentCount,
    createdAt: post.createdAt,
    direction: post.direction,
    id: post.id,
    isLiked: post.isLiked,
    kind: "post_preview",
    likeCount: post.likeCount,
    room: post.room,
    signalLabels: post.signalLabels,
    title: post.title,
  };
}

async function resolveRoom({
  slug,
  ticker: rawTicker,
}: {
  slug?: string;
  ticker?: string;
}): Promise<RoomIdentity> {
  if (rawTicker && !slug) {
    const ticker = normalizeLiveRoomTicker(rawTicker);
    const selected = await supabaseSelect("live_room_rooms", {
      select: "id,ticker,room_kind",
      ticker: `eq.${ticker}`,
      room_kind: "eq.company",
      limit: "1",
    });
    let row = readSingleRow(selected.data);
    if (!selected.ok || !row) {
      const created = await supabaseUpsert(
        "live_room_rooms",
        { room_kind: "company", ticker },
        {
          onConflict: "ticker",
          prefer: "resolution=merge-duplicates,return=representation",
        },
      );
      row = readSingleRow(created.data);
      if (!created.ok || !row) {
        throw new LiveRoomPolicyError(
          "LIVE_ROOM_UNAVAILABLE",
          created.error || "The company room is unavailable.",
          created.status || 502,
        );
      }
    }
    return {
      id: readString(row.id),
      kind: "company",
      label: `${ticker} Company Room`,
      slug: null,
      ticker,
    };
  }
  if (slug && !rawTicker) {
    const identity = await getCommunityRoomIdentity(slug);
    const result = await supabaseSelect("live_room_community_rooms", {
      select: "name",
      room_id: `eq.${identity.id}`,
      limit: "1",
    });
    const row = readSingleRow(result.data);
    return {
      id: identity.id,
      kind: "community",
      label: readString(row?.name) || "Community Room",
      slug: identity.slug,
      ticker: null,
    };
  }
  throw new LiveRoomPolicyError(
    "LIVE_ROOM_INVALID_ROOM",
    "Choose one valid Live Room.",
  );
}

export async function mapLiveRoomPostRows(
  rows: PostRow[],
  actor: LiveRoomActor,
): Promise<LiveRoomPost[]> {
  if (!rows.length) return [];
  const authorIds = unique(rows.map((row) => readString(row.author_user_id)));
  const roomIds = unique(rows.map((row) => readString(row.room_id)));
  const eventIds = unique(
    rows.map((row) => readString(row.referenced_event_id)),
  );
  const postIds = unique(rows.map((row) => readString(row.id)));
  const [
    profilesResult,
    roomsResult,
    communitiesResult,
    eventsResult,
    likedPostsResult,
    moderator,
    brokerageProofs,
  ] = await Promise.all([
      supabaseSelect("live_room_member_profiles", {
        select: "user_id,public_profile_id,display_name,emoji",
        user_id: `in.(${authorIds.join(",")})`,
        limit: String(authorIds.length),
      }),
      supabaseSelect("live_room_rooms", {
        select: "id,room_kind,ticker",
        id: `in.(${roomIds.join(",")})`,
        limit: String(roomIds.length),
      }),
      supabaseSelect("live_room_community_rooms", {
        select: "room_id,slug,name",
        room_id: `in.(${roomIds.join(",")})`,
        limit: String(roomIds.length),
      }),
      eventIds.length
        ? supabaseSelect("events", {
            select: "id,title,source_group",
            id: `in.(${eventIds.join(",")})`,
            limit: String(eventIds.length),
          })
        : Promise.resolve({ ok: true, status: 200, data: [] }),
      actor.kind === "member"
        ? supabaseSelect("live_room_post_likes", {
            select: "post_id",
            post_id: `in.(${postIds.join(",")})`,
            actor_user_id: `eq.${actor.userId}`,
            limit: String(postIds.length),
          })
        : Promise.resolve({ ok: true, status: 200, data: [] }),
      isLiveRoomModerator(actor),
      getBrokerageProofMapForPosts(postIds),
    ]);
  if (
    !profilesResult.ok ||
    !roomsResult.ok ||
    !communitiesResult.ok ||
    !eventsResult.ok ||
    !likedPostsResult.ok
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POSTS_UNAVAILABLE",
      "Post metadata could not be loaded safely.",
      502,
    );
  }

  const profiles = new Map(
    readRows(profilesResult.data).map((row) => [
      readString(row.user_id),
      row,
    ]),
  );
  const rooms = new Map(
    readRows(roomsResult.data).map((row) => [readString(row.id), row]),
  );
  const communities = new Map(
    readRows(communitiesResult.data).map((row) => [
      readString(row.room_id),
      row,
    ]),
  );
  const events = new Map(
    readRows(eventsResult.data).map((row) => [readString(row.id), row]),
  );
  const likedPostIds = new Set(
    readRows(likedPostsResult.data)
      .map((row) => readString(row.post_id))
      .filter(Boolean),
  );

  return rows.map((row) => {
    const authorUserId = readString(row.author_user_id);
    const profile = profiles.get(authorUserId);
    const roomId = readString(row.room_id);
    const room = rooms.get(roomId);
    const community = communities.get(roomId);
    const isCommunity = room?.room_kind === "community";
    const ticker = readString(room?.ticker);
    const slug = readString(community?.slug);
    const eventId = readString(row.referenced_event_id);
    const event = events.get(eventId);
    const eventKind = readString(event?.source_group);
    const eventTitle = readString(event?.title);
    const eventReference: CompanyEventReference | null =
      eventId &&
      eventTitle &&
      (eventKind === "filings" || eventKind === "news")
        ? {
            eventId,
            kind: eventKind === "filings" ? "filing" : "news",
            title: eventTitle,
          }
        : null;
    return {
      author: {
        displayName: readString(profile?.display_name) || "Member",
        emoji: readString(profile?.emoji) || "👋",
        publicProfileId: readString(profile?.public_profile_id),
      },
      body: readString(row.body),
      brokerageProof: brokerageProofs.get(readString(row.id)) || null,
      canLike: actor.kind === "member",
      canModerate: moderator,
      commentCount: readNonnegativeCount(row.visible_comment_count),
      createdAt: readString(row.created_at),
      direction: Array.isArray(row.signal_labels)
        ? readLiveRoomPostDirection(row.signal_labels)
        : null,
      eventReference,
      id: readString(row.id),
      isLiked: likedPostIds.has(readString(row.id)),
      isMine: actor.kind === "member" && actor.userId === authorUserId,
      likeCount: readNonnegativeCount(row.like_count),
      relatedTickers: Array.isArray(row.related_tickers)
        ? row.related_tickers.map(readString).filter(Boolean)
        : [],
      room: isCommunity
        ? {
            href: `/live/community/${encodeURIComponent(slug)}`,
            kind: "community" as const,
            label: readString(community?.name) || "Community Room",
          }
        : {
            href: `/live/${encodeURIComponent(ticker)}`,
            kind: "company" as const,
            label: `${ticker} Company Room`,
            ticker,
          },
      signalLabels: Array.isArray(row.signal_labels)
        ? row.signal_labels.filter(isLiveRoomPostSignal)
        : [],
      title: readString(row.title),
      updatedAt: readString(row.updated_at),
    };
  });
}

async function mapLiveRoomPostCommentRows(
  rows: CommentRow[],
  actor: LiveRoomActor,
): Promise<LiveRoomPostComment[]> {
  if (!rows.length) return [];
  const authorIds = unique(rows.map((row) => readString(row.author_user_id)));
  const profilesResult = await supabaseSelect("live_room_member_profiles", {
    select: "user_id,public_profile_id,display_name,emoji",
    user_id: `in.(${authorIds.join(",")})`,
    limit: String(authorIds.length),
  });
  if (!profilesResult.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_COMMENTS_UNAVAILABLE",
      "Comment authors could not be loaded safely.",
      502,
    );
  }
  const profiles = new Map(
    readRows(profilesResult.data).map((row) => [
      readString(row.user_id),
      row,
    ]),
  );
  return rows.map((row) => {
    const authorUserId = readString(row.author_user_id);
    const profile = profiles.get(authorUserId);
    return {
      author: {
        displayName: readString(profile?.display_name) || "Member",
        emoji: readString(profile?.emoji) || "?",
        publicProfileId: readString(profile?.public_profile_id),
      },
      body: readString(row.body),
      createdAt: readString(row.created_at),
      id: readString(row.id),
      isMine: actor.kind === "member" && actor.userId === authorUserId,
      parentCommentId: readString(row.parent_comment_id) || null,
      updatedAt: readString(row.updated_at),
    };
  });
}

async function mapMutationResult(
  result: Awaited<ReturnType<typeof supabaseRpc>>,
  actor: LiveRoomActor,
  fallbackCode: string,
) {
  const row = readSingleRow(result.data) as PostRow | null;
  if (!result.ok || !row) {
    throw mapPostDatabaseError(result.error, result.status, fallbackCode);
  }
  const [post] = await mapLiveRoomPostRows([row], actor);
  if (!post) {
    throw new LiveRoomPolicyError(
      fallbackCode,
      "The post response was invalid.",
      502,
    );
  }
  return post;
}

async function ensureLiveRoomMember(
  actor: Extract<LiveRoomActor, { kind: "member" }>,
) {
  await ensureUserBootstrap({ id: actor.userId, email: actor.email });
  const selected = await supabaseSelect("live_room_member_profiles", {
    select: "user_id",
    user_id: `eq.${actor.userId}`,
    limit: "1",
  });
  if (selected.ok && readSingleRow(selected.data)) return;
  const created = await supabaseUpsert(
    "live_room_member_profiles",
    {
      user_id: actor.userId,
      display_name: getDefaultLiveRoomDisplayName(actor),
      emoji: "👋",
    },
    {
      onConflict: "user_id",
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );
  if (!created.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PROFILE_UNAVAILABLE",
      "The member profile could not be created.",
      created.status || 502,
    );
  }
}

async function getPublicMember(rawPublicProfileId: unknown) {
  const publicProfileId = normalizeLiveRoomUuid(
    rawPublicProfileId,
    "LIVE_ROOM_INVALID_PUBLIC_PROFILE_ID",
    "The public member profile ID is invalid.",
  );
  const result = await supabaseSelect("live_room_member_profiles", {
    select: "user_id,public_profile_id,display_name,emoji",
    public_profile_id: `eq.${publicProfileId}`,
    limit: "1",
  });
  const row = readSingleRow(result.data);
  if (!result.ok || !row) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PUBLIC_PROFILE_NOT_FOUND",
      "That member profile is unavailable.",
      404,
    );
  }
  const userId = readString(row.user_id);
  const [receivedLikesResult, brokerageConnected] = await Promise.all([
    supabaseRpc("get_live_room_member_received_like_count", {
      p_member_user_id: userId,
    }),
    hasActiveBrokerageConnection(userId),
  ]);
  if (!receivedLikesResult.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PUBLIC_PROFILE_UNAVAILABLE",
      "The member profile activity could not be loaded.",
      receivedLikesResult.status || 502,
    );
  }
  return {
    member: {
      brokerageConnected,
      displayName: readString(row.display_name) || "Member",
      emoji: readString(row.emoji) || "👋",
      publicProfileId: readString(row.public_profile_id),
      receivedLikeCount: readNonnegativeCount(receivedLikesResult.data),
    },
    userId,
  };
}

async function getBlockedMemberIds(actor: LiveRoomActor) {
  const result = await supabaseSelect("live_room_actor_blocks", {
    select: "blocked_member_user_id",
    blocker_kind: `eq.${actor.kind}`,
    ...(actor.kind === "member"
      ? { blocker_member_user_id: `eq.${actor.userId}` }
      : { blocker_guest_session_id: `eq.${actor.guestSessionId}` }),
    blocked_kind: "eq.member",
    limit: "200",
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_BLOCKS_UNAVAILABLE",
      "Blocked authors could not be applied safely.",
      result.status || 502,
    );
  }
  return readRows(result.data)
    .map((row) => readString(row.blocked_member_user_id))
    .filter(Boolean);
}

async function mapCommentMutationResult(
  result: Awaited<ReturnType<typeof supabaseRpc>>,
  actor: LiveRoomActor,
  fallbackCode: string,
) {
  const row = readSingleRow(result.data) as CommentRow | null;
  if (!result.ok || !row) {
    throw mapCommentDatabaseError(result.error, result.status, fallbackCode);
  }
  const [comment] = await mapLiveRoomPostCommentRows([row], actor);
  if (!comment) {
    throw new LiveRoomPolicyError(
      fallbackCode,
      "The comment response was invalid.",
      502,
    );
  }
  return comment;
}

async function resolvePostRoom(postId: string): Promise<RoomIdentity> {
  const postResult = await supabaseSelect("live_room_posts", {
    select: "room_id",
    id: `eq.${postId}`,
    limit: "1",
  });
  const post = readSingleRow(postResult.data);
  const roomId = readString(post?.room_id);
  if (!postResult.ok || !roomId) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_NOT_FOUND",
      "That post is no longer available.",
      404,
    );
  }
  const roomResult = await supabaseSelect("live_room_rooms", {
    select: "id,room_kind,ticker",
    id: `eq.${roomId}`,
    limit: "1",
  });
  const room = readSingleRow(roomResult.data);
  const kind = readString(room?.room_kind);
  if (
    !roomResult.ok ||
    !room ||
    (kind !== "company" && kind !== "community")
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_UNAVAILABLE",
      "The post room is unavailable.",
      502,
    );
  }
  const ticker = readString(room.ticker) || null;
  return {
    id: roomId,
    kind,
    label: ticker ? `${ticker} Company Room` : "Community Room",
    slug: null,
    ticker,
  };
}

async function assertCommentBelongsToPost(
  commentId: string,
  postId: string,
) {
  const result = await supabaseSelect("live_room_post_comments", {
    select: "id",
    id: `eq.${commentId}`,
    post_id: `eq.${postId}`,
    visibility_status: "eq.visible",
    limit: "1",
  });
  if (!result.ok || !readSingleRow(result.data)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_COMMENT_NOT_FOUND",
      "That comment is no longer available.",
      404,
    );
  }
}

async function validatePostRelatedTickers(
  relatedTickers: string[],
  room: RoomIdentity,
) {
  if (!relatedTickers.length) return;
  assertLiveRoomPostMentionTargets(
    relatedTickers,
    room.kind === "company" ? room.ticker : null,
  );

  const result = await supabaseSelect("tickers", {
    select: "symbol",
    symbol: `in.(${relatedTickers.join(",")})`,
    is_active: "eq.true",
    limit: String(Math.max(20, relatedTickers.length * 8)),
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_TICKERS_UNAVAILABLE",
      "Mentioned tickers could not be verified.",
      result.status || 502,
    );
  }
  const activeSymbols = new Set(
    readRows(result.data)
      .map((row) => readString(row.symbol).trim().toUpperCase())
      .filter(Boolean),
  );
  const invalid = relatedTickers.filter(
    (ticker) => !activeSymbols.has(ticker),
  );
  if (invalid.length) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_INVALID_TICKERS",
      `Use active listed tickers only: ${invalid
        .map((ticker) => `$${ticker}`)
        .join(", ")}.`,
    );
  }
}

async function isLiveRoomModerator(actor: LiveRoomActor) {
  if (actor.kind !== "member") return false;
  const result = await supabaseSelect("live_room_moderators", {
    select: "user_id",
    user_id: `eq.${actor.userId}`,
    active: "eq.true",
    limit: "1",
  });
  return result.ok && Boolean(readSingleRow(result.data));
}

async function assertLiveRoomModerator(actor: LiveRoomActor) {
  if (!(await isLiveRoomModerator(actor))) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MODERATOR_REQUIRED",
      "Moderator access is required.",
      403,
    );
  }
}

function assertMember(
  actor: LiveRoomActor,
): asserts actor is Extract<LiveRoomActor, { kind: "member" }> {
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_REQUIRED",
      "Sign in to write Live Room posts.",
      401,
    );
  }
}

function mapPostDatabaseError(
  error: string | undefined,
  status: number,
  fallbackCode: string,
) {
  const knownCode =
    error?.match(
      /(?:LIVE_ROOM_(?:POST_[A-Z_]+|INVALID_EVENT_REFERENCE|MEMBER_REQUIRED|MODERATOR_REQUIRED|CANNOT_BLOCK_SELF)|BROKERAGE_(?:PUBLIC_SHARING_DISABLED|PLAN_REQUIRED|PROOF_NOT_ATTACHABLE))/,
    )?.[0] || fallbackCode;
  const messages: Record<string, string> = {
    LIVE_ROOM_POST_DUPLICATE:
      "A post with this title was created recently.",
    LIVE_ROOM_POST_RATE_LIMIT:
      "Too many posts were created recently. Try again later.",
    LIVE_ROOM_POST_NOT_FOUND: "That post is no longer available.",
    LIVE_ROOM_POST_NOT_EDITABLE:
      "Only a visible post written by you can be changed.",
    LIVE_ROOM_POST_INVALID_TICKERS:
      "Use active listed tickers and do not repeat the current room ticker.",
    LIVE_ROOM_POST_PRIMARY_TICKER_DUPLICATE:
      "Do not repeat the current room ticker in mentioned tickers.",
    LIVE_ROOM_POST_FORBIDDEN: "You cannot edit this post.",
    LIVE_ROOM_POST_INVALID_SIGNALS:
      "Choose up to three post signals from the available list.",
    LIVE_ROOM_INVALID_EVENT_REFERENCE:
      "That event cannot be attached to this room.",
    LIVE_ROOM_MEMBER_REQUIRED: "Sign in to write Live Room posts.",
    LIVE_ROOM_MODERATOR_REQUIRED: "Moderator access is required.",
    LIVE_ROOM_CANNOT_BLOCK_SELF: "You cannot block yourself.",
    BROKERAGE_PUBLIC_SHARING_DISABLED:
      "Public sharing is pending provider approval.",
    BROKERAGE_PLAN_REQUIRED:
      "A Pro, Advanced, or Ultimate plan is required.",
    BROKERAGE_PROOF_NOT_ATTACHABLE:
      "That brokerage proof cannot be attached.",
  };
  const forbidden =
    knownCode === "LIVE_ROOM_POST_FORBIDDEN" ||
    knownCode === "LIVE_ROOM_MODERATOR_REQUIRED";
  const notFound = knownCode === "LIVE_ROOM_POST_NOT_FOUND";
  const unauthorized = knownCode === "LIVE_ROOM_MEMBER_REQUIRED";
  const brokerageForbidden =
    knownCode === "BROKERAGE_PUBLIC_SHARING_DISABLED" ||
    knownCode === "BROKERAGE_PLAN_REQUIRED";
  return new LiveRoomPolicyError(
    knownCode,
    messages[knownCode] || "The post action could not be completed.",
    unauthorized
      ? 401
      : forbidden || brokerageForbidden
        ? 403
        : notFound
          ? 404
          : status || 400,
  );
}

function mapCommentDatabaseError(
  error: string | undefined,
  status: number,
  fallbackCode: string,
) {
  const knownCode =
    error?.match(
      /LIVE_ROOM_(?:COMMENT_[A-Z_]+|POST_NOT_FOUND|MEMBER_REQUIRED|INVALID_REPORT_REASON)/,
    )?.[0] || fallbackCode;
  const messages: Record<string, string> = {
    LIVE_ROOM_COMMENT_DUPLICATE:
      "That comment was already posted.",
    LIVE_ROOM_COMMENT_RATE_LIMIT:
      "Too many comments were posted recently. Try again later.",
    LIVE_ROOM_COMMENT_INVALID_PARENT:
      "Reply to a valid top-level comment on this post.",
    LIVE_ROOM_COMMENT_NOT_FOUND:
      "That comment is no longer available.",
    LIVE_ROOM_COMMENT_NOT_EDITABLE:
      "Only a visible comment written by you can be changed.",
    LIVE_ROOM_POST_NOT_FOUND:
      "That post is no longer available.",
    LIVE_ROOM_MEMBER_REQUIRED:
      "Sign in to comment on Live Room posts.",
    LIVE_ROOM_INVALID_REPORT_REASON:
      "Choose a valid report reason.",
  };
  const unauthorized = knownCode === "LIVE_ROOM_MEMBER_REQUIRED";
  const notFound =
    knownCode === "LIVE_ROOM_COMMENT_NOT_FOUND" ||
    knownCode === "LIVE_ROOM_POST_NOT_FOUND";
  return new LiveRoomPolicyError(
    knownCode,
    messages[knownCode] || "The comment action could not be completed.",
    unauthorized ? 401 : notFound ? 404 : status || 400,
  );
}

function mapBlockRow(row: Record<string, unknown>): LiveRoomBlockedActor {
  return {
    blockedAt: readString(row.created_at),
    displayName: readString(row.blocked_display_name) || "Blocked author",
    emoji: readString(row.blocked_emoji) || "👋",
    id: readString(row.id),
  };
}

function encodePostCursor(value: CursorValue) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodePostCursor(value: string | null): CursorValue | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<CursorValue>;
    if (
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(parsed.id)
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_CURSOR",
      "The post cursor is invalid.",
    );
  }
}

function readCursor(row: PostRow): CursorValue {
  return {
    createdAt: readString(row.created_at),
    id: readString(row.id),
  };
}

function decodeCommentCursor(value: string | null) {
  return decodePostCursor(value);
}

function readCommentCursor(row: CommentRow): CursorValue {
  return {
    createdAt: readString(row.created_at),
    id: readString(row.id),
  };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function readRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === "object",
      )
    : [];
}

function readSingleRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    return readRows(value)[0] || null;
  }
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNonnegativeCount(value: unknown) {
  const count =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}
