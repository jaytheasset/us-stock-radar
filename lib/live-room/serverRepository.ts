import "server-only";

import { ensureUserBootstrap } from "@/lib/auth/supabaseAuth";
import { getBrokerageConfig } from "@/lib/brokerage/config";
import { getBrokerageProofMapForMessages } from "@/lib/brokerage/serverRepository";
import type { BrokerageProofSummary } from "@/lib/brokerage/types";
import { resolveKlipyMedia } from "@/lib/klipy/serverProvider";
import {
  getKlipyMediaMapForMessages,
  toKlipyReplyMediaPreview,
} from "@/lib/klipy/serverRepository";
import type { KlipyMediaAttachment } from "@/lib/klipy/types";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import {
  supabaseDelete,
  supabaseRpc,
  supabaseSelect,
  supabaseUpsert,
} from "@/lib/supabase";
import type { Plan } from "@/lib/subscriptionPolicy";
import { getLiveRoomSocialBadgeMap } from "@/lib/social-verification/serverRepository";
import { listCommunityHubRooms } from "@/lib/community-hub/serverRepository";
import { getCommunityRoomIdentity } from "./communityServerRepository";
import { isLiveRoomChatNameSet } from "./chatIdentity";
import { evaluateLiveRoomMessage } from "./moderation";
import { assertLiveRoomMutationRateLimit } from "./mutationRateLimit";
import {
  listLiveRoomPosts,
  mapLiveRoomPostRows,
  toLiveRoomPostPreview,
  type PostRow,
} from "./postServerRepository";
import {
  createServerOwnedAuthorSnapshot,
  getDefaultLiveRoomDisplayName,
  getLiveRoomActorFilter,
  isLiveRoomMessageMine,
  LiveRoomPolicyError,
  normalizeLiveRoomProfileInput,
  normalizeLiveRoomPresenceTicker,
  normalizeLiveRoomReportReason,
  normalizeLiveRoomTicker,
  normalizeLiveRoomUuid,
  normalizeOptionalLiveRoomReplyMessageId,
  validateLiveRoomEventReference,
  type LiveRoomActor,
} from "./policy";
import { createLiveRoomReplyBodyPreview } from "./replyPolicy";
import {
  buildLiveRoomAvatarPath,
  buildLiveRoomAvatarUrl,
  removeLiveRoomAvatarObject,
  uploadLiveRoomAvatarObject,
} from "./profileAvatar";
import { processLiveRoomAvatarUpload } from "./profileAvatarImage";
import type {
  CompanyEventReference,
  LiveRoomBlockedActor,
  LiveRoomBlockResult,
  LiveRoomChatMessage,
  LiveRoomFollowPreference,
  LiveRoomMemberFollowResult,
  LiveRoomMemberSummary,
  LiveRoomMemberSummaryList,
  LiveRoomMembershipList,
  LiveRoomMembershipListItem,
  LiveRoomMembershipState,
  LiveRoomMessageLikeResult,
  LiveRoomModerationItem,
  LiveRoomProfile,
  LiveRoomPresenceSetting,
  LiveRoomPresenceSummary,
  LiveRoomPostActivity,
  LiveRoomPostActivityKind,
  LiveRoomReplyPreview,
  LiveRoomTimelineItem,
  LiveRoomUnreadSummary,
} from "./types";

const defaultPageSize = 50;
const maxPageSize = 100;

type CursorValue = {
  createdAt: string;
  id: string;
};

type RoomRow = {
  id: string;
  kind: "company" | "community";
  slug: string | null;
  ticker: string | null;
};

type LiveRoomPublicProfilePresentation = {
  avatarUrl: string | null;
  publicProfileId: string;
};

type MessageRow = {
  id?: unknown;
  room_id?: unknown;
  actor_id?: unknown;
  author_kind?: unknown;
  member_user_id?: unknown;
  guest_session_id?: unknown;
  author_display_name?: unknown;
  author_emoji?: unknown;
  author_plan?: unknown;
  body?: unknown;
  referenced_event_id?: unknown;
  referenced_event_kind?: unknown;
  referenced_event_title?: unknown;
  reply_to_message_id?: unknown;
  like_count?: unknown;
  visibility_status?: unknown;
  moderation_reason?: unknown;
  hidden_at?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
};

type BlockRow = {
  id?: unknown;
  blocked_kind?: unknown;
  blocked_member_user_id?: unknown;
  blocked_guest_session_id?: unknown;
  blocked_actor_id?: unknown;
  blocked_display_name?: unknown;
  blocked_emoji?: unknown;
  created_at?: unknown;
};

export type LiveRoomMessagePage = {
  firstUnreadMessageId: string | null;
  initialMode: "latest" | "resume";
  isLatest: boolean;
  items: LiveRoomTimelineItem[];
  latestChangeCursor: string | null;
  latestCursor: string | null;
  nextCursor: string | null;
  unreadCount: number;
};

export type LiveRoomMessageChanges = {
  hasMore: boolean;
  latestChangeCursor: string | null;
  removedIds: string[];
  upserts: LiveRoomTimelineItem[];
};

export async function getLiveRoomMessagePage({
  actor,
  after,
  before,
  limit,
  resume = false,
  slug,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  after?: string | null;
  before?: string | null;
  limit?: number;
  resume?: boolean;
  slug?: string;
  ticker?: string;
}): Promise<LiveRoomMessagePage> {
  if (after && before) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_CURSOR",
      "Use either an older-page cursor or an update cursor.",
    );
  }

  const room = await resolveLiveRoom({ slug, ticker: rawTicker });
  const latestChangeCursor = await getLatestRoomChangeCursor(room.id);
  const blockedActorIds = await getBlockedActorIds(actor);
  const pageSize = Math.max(
    1,
    Math.min(Number(limit) || defaultPageSize, maxPageSize),
  );
  const resumeState =
    resume && !after && !before && actor.kind === "member"
      ? await getLiveRoomResumeState(room.id, actor.userId)
      : null;
  const activeResumeState =
    resumeState?.unreadCount &&
    resumeState.firstUnreadMessageId &&
    resumeState.startMessageId &&
    resumeState.startCreatedAt
      ? resumeState
      : null;
  const resumed = activeResumeState !== null;
  const resumeCursor = activeResumeState
    ? encodeMessageCursor({
        createdAt: activeResumeState.startCreatedAt,
        id: activeResumeState.startMessageId,
      })
    : null;
  const effectiveAfter = after || resumeCursor;
  const cursor = decodeMessageCursor(effectiveAfter || before || null);
  const ascending = Boolean(effectiveAfter);
  const search: Record<string, string> = {
    select:
      "id,room_id,actor_id,author_kind,member_user_id,guest_session_id,author_display_name,author_emoji,author_plan,body,referenced_event_id,referenced_event_kind,referenced_event_title,reply_to_message_id,like_count,created_at",
    room_id: `eq.${room.id}`,
    visibility_status: "eq.visible",
    order: ascending
      ? "created_at.asc,id.asc"
      : "created_at.desc,id.desc",
    limit: String(pageSize + 1),
  };

  applyMessageCursorAndBlockFilters(
    search,
    cursor,
    ascending,
    blockedActorIds,
  );

  const [result, postPage, resumeAnchorResult] = await Promise.all([
    supabaseSelect("live_room_messages", search),
    listLiveRoomPosts({
      actor,
      after: effectiveAfter,
      before,
      includeMentionedCompanyPosts: false,
      limit: pageSize,
      slug,
      ticker: rawTicker,
    }),
    activeResumeState
      ? supabaseSelect("live_room_messages", {
          select:
            "id,room_id,actor_id,author_kind,member_user_id,guest_session_id,author_display_name,author_emoji,author_plan,body,referenced_event_id,referenced_event_kind,referenced_event_title,reply_to_message_id,like_count,created_at",
          id: `in.(${[
            activeResumeState.startMessageId,
            activeResumeState.firstUnreadMessageId,
          ]
            .filter((id, index, ids) => ids.indexOf(id) === index)
            .join(",")})`,
          room_id: `eq.${room.id}`,
          visibility_status: "eq.visible",
          limit: "2",
        })
      : Promise.resolve({
          data: [],
          error: undefined,
          ok: true,
          status: 200,
        }),
  ]);
  if (!result.ok || !resumeAnchorResult.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MESSAGES_UNAVAILABLE",
      result.error ||
        resumeAnchorResult.error ||
        "Messages could not be loaded.",
      result.status || resumeAnchorResult.status || 502,
    );
  }

  const fetchedRows = readRows(result.data) as MessageRow[];
  const hasMore = fetchedRows.length > pageSize;
  const pageRows = fetchedRows.slice(0, pageSize);
  const resumeAnchorRows = readRows(
    resumeAnchorResult.data,
  ) as MessageRow[];
  const chronologicalRowsWithDuplicates = ascending
    ? [...resumeAnchorRows, ...pageRows]
    : [...pageRows].reverse();
  const chronologicalRows = [
    ...new Map(
      chronologicalRowsWithDuplicates.map((row) => [
        readString(row.id),
        row,
      ]),
    ).values(),
  ].filter((row) => readString(row.id));
  const messageItems = await mapMessageRows(
    chronologicalRows,
    actor,
    blockedActorIds,
  );
  const postItems = postPage.items.map(toLiveRoomPostPreview);
  const combinedItems = [...messageItems, ...postItems].sort(compareTimeline);
  let items = ascending
    ? combinedItems.slice(0, pageSize)
    : combinedItems.slice(-pageSize);
  if (activeResumeState) {
    const requiredIds = new Set([
      activeResumeState.startMessageId,
      activeResumeState.firstUnreadMessageId,
    ]);
    for (const requiredId of requiredIds) {
      if (items.some((item) => item.id === requiredId)) continue;
      const requiredItem = combinedItems.find(
        (item) => item.id === requiredId,
      );
      if (requiredItem) items.push(requiredItem);
    }
    while (items.length > pageSize) {
      const removableIndex = items.findLastIndex(
        (item) => !requiredIds.has(item.id),
      );
      if (removableIndex < 0) break;
      items.splice(removableIndex, 1);
    }
    items.sort(compareTimeline);
  }
  const oldest = items[0];
  const latest = items[items.length - 1];
  const combinedHasMore =
    hasMore ||
    Boolean(postPage.nextCursor) ||
    combinedItems.length > pageSize;

  return {
    firstUnreadMessageId: activeResumeState
      ? activeResumeState.firstUnreadMessageId
      : null,
    initialMode: resumed ? "resume" : "latest",
    isLatest: resumed ? !combinedHasMore : !after && !before,
    items,
    latestChangeCursor,
    latestCursor: latest
      ? encodeMessageCursor({ createdAt: latest.createdAt, id: latest.id })
      : null,
    nextCursor:
      ((resumed && oldest) ||
        (!ascending && combinedHasMore && oldest))
        ? encodeMessageCursor({
            createdAt: oldest!.createdAt,
            id: oldest!.id,
          })
        : null,
    unreadCount: activeResumeState
      ? activeResumeState.unreadCount
      : 0,
  };
}

type LiveRoomResumeState = {
  firstUnreadMessageId: string;
  startCreatedAt: string;
  startMessageId: string;
  unreadCount: number;
};

async function getLiveRoomResumeState(
  roomId: string,
  memberUserId: string,
): Promise<LiveRoomResumeState | null> {
  const result = await supabaseRpc("get_live_room_resume_state", {
    p_member_user_id: memberUserId,
    p_room_id: roomId,
  });
  const row = readSingleRow(result.data);
  if (!result.ok || !row) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_RESUME_UNAVAILABLE",
      result.error || "The saved reading position could not be loaded.",
      result.status || 502,
    );
  }
  const firstUnreadMessageId = readString(
    row.firstUnreadMessageId ?? row.first_unread_message_id,
  );
  const startMessageId = readString(
    row.startMessageId ?? row.start_message_id,
  );
  const startCreatedAt = readString(
    row.startCreatedAt ?? row.start_created_at,
  );
  const unreadCount = readNonnegativeCount(
    row.unreadCount ?? row.unread_count,
  );
  if (
    row.joined !== true ||
    unreadCount < 1 ||
    !isUuid(firstUnreadMessageId) ||
    !isUuid(startMessageId) ||
    !Number.isFinite(Date.parse(startCreatedAt))
  ) {
    return null;
  }
  return {
    firstUnreadMessageId,
    startCreatedAt,
    startMessageId,
    unreadCount,
  };
}

export async function getLiveRoomMessageAnchor({
  actor,
  messageId: rawMessageId,
  slug,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  messageId: unknown;
  slug?: string;
  ticker?: string;
}): Promise<LiveRoomChatMessage> {
  const room = await resolveLiveRoom({ slug, ticker: rawTicker });
  const messageId = normalizeLiveRoomUuid(rawMessageId);
  const [result, blockedActorIds] = await Promise.all([
    supabaseSelect("live_room_messages", {
      select:
        "id,room_id,actor_id,author_kind,member_user_id,guest_session_id,author_display_name,author_emoji,author_plan,body,referenced_event_id,referenced_event_kind,referenced_event_title,reply_to_message_id,like_count,created_at",
      id: `eq.${messageId}`,
      room_id: `eq.${room.id}`,
      visibility_status: "eq.visible",
      limit: "1",
    }),
    getBlockedActorIds(actor),
  ]);
  const row = readSingleRow(result.data) as MessageRow | null;
  const rowActorId = readString(row?.actor_id);
  if (
    !result.ok ||
    !row ||
    (rowActorId && blockedActorIds.includes(rowActorId))
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MESSAGE_NOT_FOUND",
      "That message is no longer available in this Live Room.",
      404,
    );
  }
  const [message] = await mapMessageRows(
    [row],
    actor,
    blockedActorIds,
  );
  if (!message) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MESSAGE_NOT_FOUND",
      "That message is no longer available in this Live Room.",
      404,
    );
  }
  return message;
}

export async function getLiveRoomMessageChanges({
  actor,
  afterChange,
  limit,
  slug,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  afterChange?: string | null;
  limit?: number;
  slug?: string;
  ticker?: string;
}): Promise<LiveRoomMessageChanges> {
  const room = await resolveLiveRoom({ slug, ticker: rawTicker });
  const pageSize = Math.max(
    1,
    Math.min(Number(limit) || maxPageSize, maxPageSize),
  );
  const cursor = decodeMessageCursor(afterChange || null);
  const search: Record<string, string> = {
    select:
      "id,room_id,actor_id,author_kind,member_user_id,guest_session_id,author_display_name,author_emoji,author_plan,body,referenced_event_id,referenced_event_kind,referenced_event_title,reply_to_message_id,like_count,visibility_status,created_at,updated_at",
    room_id: `eq.${room.id}`,
    order: "updated_at.asc,id.asc",
    limit: String(pageSize + 1),
  };
  if (cursor) {
    search.or =
      `(updated_at.gt.${cursor.createdAt},and(updated_at.eq.${cursor.createdAt},id.gt.${cursor.id}))`;
  }

  const postSearch: Record<string, string> = {
    select:
      "id,room_id,author_user_id,title,body,related_tickers,signal_labels,referenced_event_id,visibility_status,created_at,updated_at,like_count,visible_comment_count",
    room_id: `eq.${room.id}`,
    order: "updated_at.asc,id.asc",
    limit: String(pageSize + 1),
  };
  if (cursor) {
    postSearch.or =
      `(updated_at.gt.${cursor.createdAt},and(updated_at.eq.${cursor.createdAt},id.gt.${cursor.id}))`;
  }

  const [result, postResult, blockedActorIds] = await Promise.all([
    supabaseSelect("live_room_messages", search),
    supabaseSelect("live_room_posts", postSearch),
    getBlockedActorIds(actor),
  ]);
  if (!result.ok || !postResult.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_CHANGES_UNAVAILABLE",
      result.error ||
        postResult.error ||
        "Live Room updates could not be loaded.",
      result.status || postResult.status || 502,
    );
  }

  const fetchedChanges = [
    ...(readRows(result.data) as MessageRow[]).map((row) => ({
      kind: "message" as const,
      row,
    })),
    ...(readRows(postResult.data) as PostRow[]).map((row) => ({
      kind: "post" as const,
      row,
    })),
  ].sort((left, right) => {
    const time =
      Date.parse(readString(left.row.updated_at)) -
      Date.parse(readString(right.row.updated_at));
    return time || readString(left.row.id).localeCompare(readString(right.row.id));
  });
  const hasMore = fetchedChanges.length > pageSize;
  const pageChanges = fetchedChanges.slice(0, pageSize);
  const blocked = new Set(blockedActorIds);
  const upsertRows: MessageRow[] = [];
  const upsertPostRows: PostRow[] = [];
  const removedIds: string[] = [];

  pageChanges.forEach(({ kind, row }) => {
    const id = readString(row.id);
    const actorId =
      kind === "message"
        ? readString((row as MessageRow).actor_id)
        : readString((row as PostRow).author_user_id);
    if (row.visibility_status === "visible" && !blocked.has(actorId)) {
      if (kind === "message") upsertRows.push(row as MessageRow);
      else upsertPostRows.push(row as PostRow);
    } else if (id) {
      removedIds.push(id);
    }
  });

  const latest = pageChanges[pageChanges.length - 1]?.row;
  const [messageUpserts, postUpserts] = await Promise.all([
    mapMessageRows(upsertRows, actor, blockedActorIds),
    mapLiveRoomPostRows(upsertPostRows, actor),
  ]);
  const upserts = [
    ...messageUpserts,
    ...postUpserts.map(toLiveRoomPostPreview),
  ].sort(compareTimeline);
  return {
    hasMore,
    latestChangeCursor: latest
      ? encodeMessageCursor({
          createdAt: readString(latest.updated_at),
          id: readString(latest.id),
        })
      : afterChange || null,
    removedIds,
    upserts,
  };
}

export async function sendLiveRoomMessage({
  actor,
  body,
  eventId,
  mediaId: rawMediaId,
  proofId: rawProofId,
  replyToMessageId: rawReplyToMessageId,
  slug,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  body: string;
  eventId?: string | null;
  mediaId?: unknown;
  proofId?: unknown;
  replyToMessageId?: unknown;
  slug?: string;
  ticker?: string;
}) {
  const room = await resolveLiveRoom({ slug, ticker: rawTicker });
  const replyToMessageId =
    normalizeOptionalLiveRoomReplyMessageId(rawReplyToMessageId);
  const proofId =
    rawProofId === undefined || rawProofId === null || rawProofId === ""
      ? null
      : normalizeLiveRoomUuid(
          rawProofId,
          "BROKERAGE_PROOF_NOT_ATTACHABLE",
          "That brokerage proof cannot be attached.",
        );
  const hasMediaId =
    rawMediaId !== undefined && rawMediaId !== null && rawMediaId !== "";
  if (hasMediaId && actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_REQUIRED",
      "Sign in to send KLIPY GIFs.",
      401,
    );
  }
  const media =
    !hasMediaId
      ? null
      : await resolveKlipyMedia(rawMediaId);
  if (media && proofId) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_ATTACHMENT_CONFLICT",
      "Attach either Evidence or a KLIPY GIF.",
      400,
    );
  }
  const profile = await getLiveRoomProfile(actor);
  if (actor.kind === "member" && !profile.isChatNameSet) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_CHAT_NAME_REQUIRED",
      "Choose a chat name before posting publicly.",
      409,
    );
  }
  const history = await getRecentActorMessages(actor);
  const decision = evaluateLiveRoomMessage(
    typeof body === "string" ? body : "",
    {
      allowEmpty: Boolean(media),
      history,
      now: new Date().toISOString(),
    },
  );

  if (!decision.allowed) {
    throw new LiveRoomPolicyError(
      `LIVE_ROOM_${decision.reason.toUpperCase()}`,
      decision.message,
      decision.reason === "duplicate" ||
        decision.reason === "rate_limit"
        ? 429
        : 400,
      decision.retryAfterSeconds,
    );
  }

  if (eventId && (room.kind !== "company" || !room.ticker)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_EVENT_REFERENCE",
      "Community Room messages cannot attach company event cards.",
    );
  }
  const reference =
    eventId && room.ticker
      ? await getValidatedEventReference(room.ticker, eventId)
      : null;
  const author = createServerOwnedAuthorSnapshot({ actor, profile });
  const result = await supabaseRpc("insert_live_room_message_with_attachments", {
    p_room_id: room.id,
    p_actor_kind: author.actorKind,
    p_member_user_id: author.memberUserId,
    p_guest_session_id: author.guestSessionId,
    p_author_display_name: author.displayName,
    p_author_emoji: author.emoji,
    p_author_plan: author.plan,
    p_body: decision.normalizedBody,
    p_referenced_event_id: reference?.eventId || null,
    p_reply_to_message_id: replyToMessageId,
    p_proof_id: proofId,
    p_public_sharing_enabled: getBrokerageConfig().publicProofsEnabled,
    p_media_provider: media?.provider || null,
    p_provider_media_id: media?.providerMediaId || null,
    p_media_kind: media?.kind || null,
    p_media_title: media?.title || null,
    p_media_alt_text: media?.alt || null,
    p_media_display_url: media?.displayUrl || null,
    p_media_preview_url: media?.previewUrl || null,
    p_media_width: media?.width || null,
    p_media_height: media?.height || null,
    p_media_item_url: media?.itemUrl || null,
    p_media_content_fingerprint: media?.contentFingerprint || null,
  });

  if (!result.ok) {
    throw mapDatabaseModerationError(result.error, result.status);
  }

  const row = readSingleRow(result.data) as MessageRow | null;
  if (!row) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_SEND_FAILED",
      "The message was not saved.",
      502,
    );
  }

  const [message] = await mapMessageRows([row], actor);
  return message;
}

export async function setLiveRoomMessageLike({
  actor,
  liked,
  messageId: rawMessageId,
  slug,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  liked: unknown;
  messageId: unknown;
  slug?: string;
  ticker?: string;
}): Promise<LiveRoomMessageLikeResult> {
  assertLiveRoomEngagementMember(actor);
  if (typeof liked !== "boolean") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_MESSAGE_LIKE",
      "Choose whether this message is liked.",
    );
  }
  const room = await resolveLiveRoom({ slug, ticker: rawTicker });
  const messageId = normalizeLiveRoomUuid(rawMessageId);
  await ensureMemberBootstrap(actor);
  await assertLiveRoomMutationRateLimit(actor, "like");
  const result = await supabaseRpc("set_live_room_message_like", {
    p_room_id: room.id,
    p_message_id: messageId,
    p_actor_user_id: actor.userId,
    p_liked: liked,
  });
  const row = readSingleRow(result.data);
  if (
    !result.ok ||
    !row ||
    typeof row.liked !== "boolean"
  ) {
    throw mapLiveRoomActionError(
      result.error,
      result.status,
      "LIVE_ROOM_MESSAGE_LIKE_FAILED",
      "The message like could not be saved.",
    );
  }
  return {
    liked: row.liked,
    likeCount: readNonnegativeCount(row.like_count),
    messageId: readString(row.message_id) || messageId,
  };
}

export async function reportLiveRoomMessage({
  actor,
  messageId: rawMessageId,
  reason: rawReason,
  slug,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  messageId: unknown;
  reason: unknown;
  slug?: string;
  ticker?: string;
}) {
  const messageId = normalizeLiveRoomUuid(rawMessageId);
  const reason = normalizeLiveRoomReportReason(rawReason);
  const room = await resolveLiveRoom({ slug, ticker: rawTicker });
  await ensureMemberBootstrap(actor);
  await assertLiveRoomMutationRateLimit(actor, "report");
  const result = await supabaseRpc("report_live_room_message", {
    p_room_id: room.id,
    p_message_id: messageId,
    p_reporter_kind: actor.kind,
    p_reporter_member_user_id:
      actor.kind === "member" ? actor.userId : null,
    p_reporter_guest_session_id:
      actor.kind === "guest" ? actor.guestSessionId : null,
    p_reason: reason,
  });
  if (!result.ok) {
    throw mapLiveRoomActionError(
      result.error,
      result.status,
      "LIVE_ROOM_REPORT_FAILED",
      "The report could not be saved.",
    );
  }
  return { reported: true as const };
}

export async function blockLiveRoomMessageAuthor({
  actor,
  messageId: rawMessageId,
  slug,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  messageId: unknown;
  slug?: string;
  ticker?: string;
}): Promise<LiveRoomBlockResult> {
  const messageId = normalizeLiveRoomUuid(rawMessageId);
  const room = await resolveLiveRoom({ slug, ticker: rawTicker });
  await ensureMemberBootstrap(actor);
  const result = await supabaseRpc("block_live_room_message_author", {
    p_room_id: room.id,
    p_message_id: messageId,
    p_blocker_kind: actor.kind,
    p_blocker_member_user_id:
      actor.kind === "member" ? actor.userId : null,
    p_blocker_guest_session_id:
      actor.kind === "guest" ? actor.guestSessionId : null,
  });
  if (!result.ok) {
    throw mapLiveRoomActionError(
      result.error,
      result.status,
      "LIVE_ROOM_BLOCK_FAILED",
      "The author could not be blocked.",
    );
  }
  const row = readSingleRow(result.data) as BlockRow | null;
  if (!row) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_BLOCK_FAILED",
      "The author could not be blocked.",
      502,
    );
  }

  const removed = await supabaseSelect("live_room_messages", {
    select: "id",
    room_id: `eq.${room.id}`,
    visibility_status: "eq.visible",
    author_kind: `eq.${readString(row.blocked_kind)}`,
    actor_id: `eq.${readString(row.blocked_actor_id)}`,
    limit: "1000",
  });
  if (!removed.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_BLOCK_FAILED",
      "The author was blocked, but the room could not refresh safely.",
      502,
    );
  }

  return {
    block: mapBlockRow(row),
    removedMessageIds: readRows(removed.data)
      .map((message) => readString(message.id))
      .filter(Boolean),
  };
}

export async function listLiveRoomBlocks(
  actor: LiveRoomActor,
): Promise<LiveRoomBlockedActor[]> {
  const result = await supabaseSelect("live_room_actor_blocks", {
    select: "id,blocked_display_name,blocked_emoji,created_at",
    ...getBlockerFilter(actor),
    order: "created_at.desc",
    limit: "200",
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_BLOCKS_UNAVAILABLE",
      result.error || "Blocked authors could not be loaded.",
      result.status || 502,
    );
  }
  return (readRows(result.data) as BlockRow[]).map(mapBlockRow);
}

export async function unblockLiveRoomActor(
  actor: LiveRoomActor,
  rawBlockId: unknown,
) {
  const blockId = normalizeLiveRoomUuid(
    rawBlockId,
    "LIVE_ROOM_INVALID_BLOCK_ID",
    "The blocked-author ID is invalid.",
  );
  const result = await supabaseDelete("live_room_actor_blocks", {
    id: `eq.${blockId}`,
    ...getBlockerFilter(actor),
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_UNBLOCK_FAILED",
      result.error || "The author could not be unblocked.",
      result.status || 502,
    );
  }
  if (!readRows(result.data).length) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_BLOCK_NOT_FOUND",
      "That blocked author was not found.",
      404,
    );
  }
  return { removed: true as const };
}

export async function listHiddenLiveRoomMessages(
  actor: LiveRoomActor,
  roomInput: string | { slug?: string; ticker?: string },
): Promise<LiveRoomModerationItem[]> {
  await assertLiveRoomModerator(actor);
  const room =
    typeof roomInput === "string"
      ? await resolveLiveRoom({ ticker: roomInput })
      : await resolveLiveRoom(roomInput);
  const result = await supabaseSelect("live_room_messages", {
    select:
      "id,room_id,author_kind,member_user_id,guest_session_id,author_display_name,author_emoji,author_plan,body,referenced_event_id,referenced_event_kind,referenced_event_title,reply_to_message_id,like_count,moderation_reason,hidden_at,created_at",
    room_id: `eq.${room.id}`,
    visibility_status: "eq.hidden",
    order: "hidden_at.desc",
    limit: "100",
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MODERATION_UNAVAILABLE",
      result.error || "Hidden messages could not be loaded.",
      result.status || 502,
    );
  }
  return (readRows(result.data) as MessageRow[]).map((row) => ({
    ...mapMessageRow(row, actor),
    hiddenAt: readString(row.hidden_at),
    moderationReason:
      readString(row.moderation_reason) || "Hidden by moderator",
  }));
}

export async function moderateLiveRoomMessage({
  action,
  actor,
  messageId: rawMessageId,
  reason,
  slug,
  ticker: rawTicker,
}: {
  action: unknown;
  actor: LiveRoomActor;
  messageId: unknown;
  reason: unknown;
  slug?: string;
  ticker?: string;
}) {
  await assertLiveRoomModerator(actor);
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MODERATOR_REQUIRED",
      "Moderator access is required.",
      403,
    );
  }
  if (action !== "hide" && action !== "restore") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_MODERATION_ACTION",
      "Choose hide or restore.",
    );
  }
  const room = await resolveLiveRoom({ slug, ticker: rawTicker });
  const messageId = normalizeLiveRoomUuid(rawMessageId);
  const moderationReason =
    typeof reason === "string" ? reason.trim().slice(0, 240) : "";
  const result = await supabaseRpc("moderate_live_room_message", {
    p_room_id: room.id,
    p_message_id: messageId,
    p_moderator_user_id: actor.userId,
    p_action: action,
    p_reason: moderationReason,
  });
  if (!result.ok) {
    throw mapLiveRoomActionError(
      result.error,
      result.status,
      "LIVE_ROOM_MODERATION_FAILED",
      "The moderation action could not be completed.",
    );
  }
  const row = readSingleRow(result.data) as MessageRow | null;
  const restored =
    action === "restore" && row
      ? (await mapMessageRows([row], actor))[0] || null
      : null;
  return {
    action,
    message: restored,
    messageId,
  };
}

export async function getLiveRoomProfile(
  actor: LiveRoomActor,
): Promise<LiveRoomProfile> {
  const table =
    actor.kind === "member"
      ? "live_room_member_profiles"
      : "live_room_guest_profiles";
  const key =
    actor.kind === "member" ? "user_id" : "guest_session_id";
  const id =
    actor.kind === "member" ? actor.userId : actor.guestSessionId;
  const selected = await supabaseSelect(table, {
    select:
      actor.kind === "member"
        ? "display_name,emoji,bio,avatar_path,public_profile_id"
        : "display_name,emoji",
    [key]: `eq.${id}`,
    limit: "1",
  });
  let row = readSingleRow(selected.data);

  if (!selected.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PROFILE_UNAVAILABLE",
      selected.error || "The Live Room profile could not be loaded.",
      selected.status || 502,
    );
  }

  if (!row) {
    if (actor.kind === "member") {
      await ensureUserBootstrap({
        id: actor.userId,
        email: actor.email,
      });
    }
    const defaults =
      actor.kind === "member"
        ? {
            display_name: null,
            emoji: null,
            [key]: id,
          }
        : {
            display_name: getDefaultLiveRoomDisplayName(actor),
            emoji: "👋",
            [key]: id,
          };
    const created = await supabaseUpsert(table, defaults, {
      onConflict: key,
      prefer: "resolution=merge-duplicates,return=representation",
    });
    row = readSingleRow(created.data);
    if (!created.ok || !row) {
      throw new LiveRoomPolicyError(
        "LIVE_ROOM_PROFILE_UNAVAILABLE",
        created.error || "The Live Room profile could not be created.",
        created.status || 502,
      );
    }
  }

  const [plan, canModerate] = await Promise.all([
    actor.kind === "member"
      ? getEffectiveUserPlan(actor.userId).then(
          (subscription) => subscription.effectivePlan,
        )
      : Promise.resolve("free" as const),
    isLiveRoomModerator(actor),
  ]);

  const displayName = readString(row.display_name);
  return {
    avatarUrl:
      actor.kind === "member"
        ? buildLiveRoomAvatarUrl(row.avatar_path)
        : null,
    bio: actor.kind === "member" ? readString(row.bio) || null : null,
    canModerate,
    displayName:
      displayName || getDefaultLiveRoomDisplayName(actor),
    emoji: readString(row.emoji) || "👋",
    isChatNameSet:
      actor.kind === "guest" || isLiveRoomChatNameSet(displayName),
    isGuest: actor.kind === "guest",
    plan,
    publicProfileId:
      actor.kind === "member"
        ? readString(row.public_profile_id) || undefined
        : undefined,
  };
}

export async function updateLiveRoomProfile(
  actor: LiveRoomActor,
  input: unknown,
) {
  const profile = normalizeLiveRoomProfileInput(input);
  const table =
    actor.kind === "member"
      ? "live_room_member_profiles"
      : "live_room_guest_profiles";
  const key =
    actor.kind === "member" ? "user_id" : "guest_session_id";
  const id =
    actor.kind === "member" ? actor.userId : actor.guestSessionId;

  if (actor.kind === "member") {
    await ensureUserBootstrap({
      id: actor.userId,
      email: actor.email,
    });
  }

  const result =
    actor.kind === "member"
      ? await supabaseRpc("set_live_room_member_profile", {
          p_bio: profile.bio,
          p_member_user_id: actor.userId,
          p_display_name: profile.displayName,
        })
      : await supabaseUpsert(
          table,
          {
            [key]: id,
            display_name: profile.displayName,
            emoji: "👋",
          },
          {
            onConflict: key,
            prefer: "resolution=merge-duplicates,return=representation",
          },
        );

  if (!result.ok) {
    const error = result.error || "";
    if (error.includes("LIVE_ROOM_CHAT_NAME_TAKEN")) {
      throw new LiveRoomPolicyError(
        "LIVE_ROOM_CHAT_NAME_TAKEN",
        "This chat name is already taken.",
        409,
      );
    }
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PROFILE_UPDATE_FAILED",
      result.error || "The Live Room profile could not be saved.",
      result.status || 502,
    );
  }

  return getLiveRoomProfile(actor);
}

export async function updateLiveRoomProfileAvatar(
  actor: LiveRoomActor,
  input: { bytes: Uint8Array; declaredMimeType: string },
) {
  assertLiveRoomProfileMember(actor);
  await ensureUserBootstrap({ id: actor.userId, email: actor.email });
  const current = await getLiveRoomAvatarState(actor.userId);
  const processed = await processLiveRoomAvatarUpload(input);
  const nextPath = buildLiveRoomAvatarPath(current.publicProfileId);

  await uploadLiveRoomAvatarObject(nextPath, processed);
  const result = await supabaseRpc("set_live_room_member_avatar_path", {
    p_avatar_path: nextPath,
    p_member_user_id: actor.userId,
  });
  if (!result.ok) {
    await removeLiveRoomAvatarObject(nextPath);
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_AVATAR_UPDATE_FAILED",
      result.error || "The profile photo could not be saved.",
      result.status || 502,
    );
  }

  if (current.avatarPath && current.avatarPath !== nextPath) {
    await removeLiveRoomAvatarObject(current.avatarPath);
  }
  return getLiveRoomProfile(actor);
}

export async function removeLiveRoomProfileAvatar(
  actor: LiveRoomActor,
) {
  assertLiveRoomProfileMember(actor);
  const current = await getLiveRoomAvatarState(actor.userId);
  const result = await supabaseRpc("set_live_room_member_avatar_path", {
    p_avatar_path: null,
    p_member_user_id: actor.userId,
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_AVATAR_UPDATE_FAILED",
      result.error || "The profile photo could not be removed.",
      result.status || 502,
    );
  }
  if (current.avatarPath) {
    await removeLiveRoomAvatarObject(current.avatarPath);
  }
  return getLiveRoomProfile(actor);
}

async function getLiveRoomAvatarState(userId: string) {
  const selected = await supabaseSelect("live_room_member_profiles", {
    select: "avatar_path,public_profile_id",
    user_id: `eq.${userId}`,
    limit: "1",
  });
  const row = readSingleRow(selected.data);
  const publicProfileId = readString(row?.public_profile_id);
  if (!selected.ok || !row || !isUuid(publicProfileId)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PROFILE_UNAVAILABLE",
      selected.error || "The member profile could not be loaded.",
      selected.status || 502,
    );
  }
  return {
    avatarPath: readString(row.avatar_path) || null,
    publicProfileId,
  };
}

export async function getLiveRoomPresenceSetting(
  actor: LiveRoomActor,
): Promise<LiveRoomPresenceSetting> {
  assertLiveRoomPresenceMember(actor);
  await getLiveRoomProfile(actor);
  const result = await supabaseRpc("get_live_room_presence_setting", {
    p_member_user_id: actor.userId,
  });
  if (!result.ok || typeof result.data !== "boolean") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PRESENCE_SETTING_UNAVAILABLE",
      result.error || "The Live Room presence setting could not be loaded.",
      result.status || 502,
    );
  }
  return { isAuthenticated: true, showPresence: result.data };
}

export async function updateLiveRoomPresenceSetting(
  actor: LiveRoomActor,
  input: unknown,
): Promise<LiveRoomPresenceSetting> {
  assertLiveRoomPresenceMember(actor);
  const data =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (typeof data.showPresence !== "boolean") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_PRESENCE_SETTING",
      "Choose whether to show when you are active in Live Rooms.",
    );
  }
  await getLiveRoomProfile(actor);
  const result = await supabaseRpc("set_live_room_presence_setting", {
    p_member_user_id: actor.userId,
    p_show_presence: data.showPresence,
  });
  if (!result.ok || typeof result.data !== "boolean") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PRESENCE_SETTING_UPDATE_FAILED",
      result.error || "The Live Room presence setting could not be saved.",
      result.status || 502,
    );
  }
  return { isAuthenticated: true, showPresence: result.data };
}

export async function heartbeatLiveRoomPresence(
  actor: LiveRoomActor,
  location:
    | string
    | { slug?: string; ticker?: string },
) {
  assertLiveRoomPresenceMember(actor);
  const room =
    typeof location === "string"
      ? await resolveLiveRoom({
          ticker: normalizeLiveRoomPresenceTicker(location),
        })
      : await resolveLiveRoom(location);
  const result = await supabaseRpc(
    "set_live_room_room_presence_heartbeat",
    {
      p_member_user_id: actor.userId,
      p_room_id: room.id,
    },
  );
  if (!result.ok || typeof result.data !== "boolean") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PRESENCE_HEARTBEAT_FAILED",
      result.error || "Live Room presence could not be updated.",
      result.status || 502,
    );
  }
  return { recorded: result.data };
}

export async function getLiveRoomPresenceSummary({
  actor,
  messageIds: rawMessageIds,
  slug,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  messageIds: unknown;
  slug?: string;
  ticker?: string;
}): Promise<LiveRoomPresenceSummary> {
  const room = await resolveLiveRoom({
    slug,
    ticker: rawTicker
      ? normalizeLiveRoomPresenceTicker(rawTicker)
      : undefined,
  });
  const messageIds = [
    ...new Set(
      (Array.isArray(rawMessageIds) ? rawMessageIds : [])
        .slice(0, 50)
        .map((messageId) => normalizeLiveRoomUuid(messageId)),
    ),
  ];

  if (actor.kind === "guest") {
    const heartbeat = await supabaseRpc(
      "set_live_room_guest_presence_for_room",
      {
        p_guest_session_id: actor.guestSessionId,
        p_room_id: room.id,
      },
    );
    if (!heartbeat.ok || heartbeat.data !== true) {
      throw new LiveRoomPolicyError(
        "LIVE_ROOM_GUEST_PRESENCE_HEARTBEAT_FAILED",
        heartbeat.error ||
          "Anonymous Live Room presence could not be updated.",
        heartbeat.status || 502,
      );
    }
  }

  const [countsResult, memberResult] = await Promise.all([
    supabaseRpc("get_live_room_room_state", {
      p_room_id: room.id,
      p_member_user_id:
        actor.kind === "member" ? actor.userId : null,
    }),
    actor.kind === "member"
      ? supabaseRpc("get_live_room_presence_summary_for_room", {
          p_member_user_id: actor.userId,
          p_room_id: room.id,
          p_message_ids: messageIds,
          p_message_limit: 50,
        })
      : Promise.resolve(null),
  ]);
  const counts = readSingleRow(countsResult.data);
  const memberSummary = memberResult
    ? readSingleRow(memberResult.data)
    : null;
  if (
    !countsResult.ok ||
    !counts ||
    (memberResult && (!memberResult.ok || !memberSummary))
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PRESENCE_UNAVAILABLE",
      countsResult.error ||
        memberResult?.error ||
        "Live Room presence could not be loaded.",
      countsResult.status || memberResult?.status || 502,
    );
  }
  const messages = readRows(memberSummary?.messages)
    .map((row) => ({
      isOnline: row.isOnline === true || row.is_online === true,
      messageId: readString(row.messageId ?? row.message_id),
    }))
    .filter((message) => isUuid(message.messageId));
  const onlineCount = Math.max(
    0,
    Number(counts.onlineCount ?? counts.online_count) || 0,
  );
  const memberCount = Math.max(
    0,
    Number(counts.memberCount ?? counts.member_count) || 0,
  );
  const visitorCount = Math.max(
    0,
    Number(counts.visitorCount ?? counts.visitor_count) || 0,
  );
  return {
    memberCount,
    messages,
    onlineCount,
    participantCount: Math.max(
      onlineCount,
      Number(
        counts.participantCount ?? counts.participant_count,
      ) || 0,
    ),
    visitorCount,
  };
}

export async function getLiveRoomMembership({
  actor,
  slug,
  ticker,
}: {
  actor: LiveRoomActor;
  slug?: string;
  ticker?: string;
}): Promise<LiveRoomMembershipState> {
  const room = await resolveLiveRoom({ slug, ticker });
  if (actor.kind === "member") {
    await getLiveRoomProfile(actor);
  }
  const result = await supabaseRpc("get_live_room_room_state", {
    p_room_id: room.id,
    p_member_user_id:
      actor.kind === "member" ? actor.userId : null,
  });
  const row = readSingleRow(result.data);
  if (!result.ok || !row) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBERSHIP_UNAVAILABLE",
      result.error || "Room membership could not be loaded.",
      result.status || 502,
    );
  }
  return mapMembershipState(row);
}

export async function listLiveRoomMemberSummaries({
  actor,
  publicProfileIds: rawPublicProfileIds,
  slug,
  ticker,
}: {
  actor: LiveRoomActor;
  publicProfileIds: unknown;
  slug?: string;
  ticker?: string;
}): Promise<LiveRoomMemberSummaryList> {
  const room = await resolveLiveRoom({ slug, ticker });
  const publicProfileIds = [
    ...new Set(
      (Array.isArray(rawPublicProfileIds) ? rawPublicProfileIds : [])
        .slice(0, 12)
        .map((value) => normalizeLiveRoomUuid(value)),
    ),
  ];
  if (!publicProfileIds.length) return { items: [] };

  const result = await supabaseRpc("get_live_room_member_summaries", {
    p_limit: 12,
    p_public_profile_ids: publicProfileIds,
    p_requester_guest_session_id:
      actor.kind === "guest" ? actor.guestSessionId : null,
    p_requester_kind: actor.kind,
    p_requester_member_user_id:
      actor.kind === "member" ? actor.userId : null,
    p_room_id: room.id,
  });
  const payload = readSingleRow(result.data);
  if (!result.ok || !payload) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_SUMMARIES_UNAVAILABLE",
      result.error || "Public member summaries could not be loaded.",
      result.status || 502,
    );
  }
  const items = readRows(payload.items)
    .map(mapLiveRoomMemberSummary)
    .filter(
      (item): item is LiveRoomMemberSummary => item !== null,
    );
  if (!items.length) return { items: [] };
  const avatarResult = await supabaseSelect(
    "live_room_member_profiles",
    {
      select: "public_profile_id,avatar_path",
      public_profile_id: `in.(${items
        .map((item) => item.publicProfileId)
        .join(",")})`,
      limit: String(items.length),
    },
  );
  if (!avatarResult.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_SUMMARIES_UNAVAILABLE",
      avatarResult.error ||
        "Public member profile photos could not be loaded.",
      avatarResult.status || 502,
    );
  }
  const avatarUrls = new Map(
    readRows(avatarResult.data).map((row) => [
      readString(row.public_profile_id),
      buildLiveRoomAvatarUrl(row.avatar_path),
    ]),
  );
  return {
    items: items.map((item) => ({
      ...item,
      avatarUrl: avatarUrls.get(item.publicProfileId) || null,
    })),
  };
}

export async function updateLiveRoomMembership({
  actor,
  joined,
  slug,
  ticker,
}: {
  actor: LiveRoomActor;
  joined: unknown;
  slug?: string;
  ticker?: string;
}): Promise<LiveRoomMembershipState> {
  assertLiveRoomMembershipMember(actor);
  if (typeof joined !== "boolean") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_MEMBERSHIP",
      "Choose Join room or Leave room.",
    );
  }
  const room = await resolveLiveRoom({ slug, ticker });
  await getLiveRoomProfile(actor);
  await assertLiveRoomMutationRateLimit(actor, "follow");
  const result = await supabaseRpc("set_live_room_membership", {
    p_joined: joined,
    p_member_user_id: actor.userId,
    p_room_id: room.id,
  });
  if (!result.ok || result.data !== joined) {
    const availabilityError = mapRoomAvailabilityDatabaseError(
      result.error,
    );
    if (availabilityError) throw availabilityError;
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBERSHIP_UPDATE_FAILED",
      result.error || "Room membership could not be updated.",
      result.status || 502,
    );
  }
  return getLiveRoomMembership({ actor, slug, ticker });
}

export async function listLiveRoomMemberships(
  actor: LiveRoomActor,
  rawLimit: unknown,
): Promise<LiveRoomMembershipList> {
  assertLiveRoomMembershipMember(actor);
  await getLiveRoomProfile(actor);
  const parsedLimit = Number(rawLimit);
  const limit = Math.max(
    1,
    Math.min(
      Number.isFinite(parsedLimit) ? Math.trunc(parsedLimit) : 20,
      100,
    ),
  );
  const result = await supabaseRpc("list_live_room_memberships", {
    p_limit: limit,
    p_member_user_id: actor.userId,
  });
  const row = readSingleRow(result.data);
  if (!result.ok || !row) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBERSHIPS_UNAVAILABLE",
      result.error || "Joined rooms could not be loaded.",
      result.status || 502,
    );
  }
  const items = readRows(row.items)
    .map(mapMembershipListItem)
    .filter(
      (item): item is LiveRoomMembershipListItem => item !== null,
    );
  return {
    hasMore: row.hasMore === true || row.has_more === true,
    items,
  };
}

export async function getLiveRoomFollow(
  actor: LiveRoomActor,
  rawTicker: string,
): Promise<LiveRoomFollowPreference> {
  const ticker = normalizeLiveRoomTicker(rawTicker);
  const membership = await getLiveRoomMembership({ actor, ticker });
  return {
    followed: membership.joined,
    notificationScope: "new_chat_messages",
    roomKey: { kind: "ticker_fallback", value: ticker },
  };
}

export async function getCommunityRoomFollow(
  actor: LiveRoomActor,
  rawSlug: string,
): Promise<LiveRoomFollowPreference> {
  const room = await getCommunityRoomIdentity(rawSlug);
  const membership = await getLiveRoomMembership({
    actor,
    slug: room.slug,
  });
  return {
    followed: membership.joined,
    notificationScope: "new_chat_messages",
    roomKey: { kind: "community_slug", value: room.slug },
  };
}

export async function updateLiveRoomFollow(
  actor: LiveRoomActor,
  rawTicker: string,
  input: unknown,
) {
  const data =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (typeof data.followed !== "boolean") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_FOLLOW",
      "Room membership state must be true or false.",
    );
  }

  const ticker = normalizeLiveRoomTicker(rawTicker);
  const membership = await updateLiveRoomMembership({
    actor,
    joined: data.followed,
    ticker,
  });
  return {
    followed: membership.joined,
    notificationScope: "new_chat_messages" as const,
    roomKey: { kind: "ticker_fallback" as const, value: ticker },
  };
}

export async function updateCommunityRoomFollow(
  actor: LiveRoomActor,
  rawSlug: string,
  input: unknown,
) {
  const data =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  if (typeof data.followed !== "boolean") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_FOLLOW",
      "Room membership state must be true or false.",
    );
  }

  const room = await getCommunityRoomIdentity(rawSlug);
  const membership = await updateLiveRoomMembership({
    actor,
    joined: data.followed,
    slug: room.slug,
  });
  return {
    followed: membership.joined,
    notificationScope: "new_chat_messages" as const,
    roomKey: {
      kind: "community_slug" as const,
      value: room.slug,
    },
  };
}

export async function markLiveRoomRead(
  actor: LiveRoomActor,
  rawTicker: string,
  rawMessageId: unknown,
) {
  const ticker = normalizeLiveRoomTicker(rawTicker);
  const room = await getOrCreateLiveRoom(ticker);
  return markLiveRoomReadByIdentity(actor, room.id, rawMessageId);
}

export async function markCommunityRoomRead(
  actor: LiveRoomActor,
  rawSlug: string,
  rawMessageId: unknown,
) {
  const room = await getCommunityRoomIdentity(rawSlug);
  return markLiveRoomReadByIdentity(actor, room.id, rawMessageId);
}

async function markLiveRoomReadByIdentity(
  actor: LiveRoomActor,
  roomId: string,
  rawMessageId: unknown,
) {
  const messageId =
    rawMessageId === null || rawMessageId === undefined
      ? null
      : normalizeLiveRoomUuid(rawMessageId);
  const result = await supabaseRpc("mark_live_room_follow_read", {
    p_room_id: roomId,
    p_actor_kind: actor.kind,
    p_member_user_id: actor.kind === "member" ? actor.userId : null,
    p_guest_session_id:
      actor.kind === "guest" ? actor.guestSessionId : null,
    p_message_id: messageId,
  });
  if (!result.ok) {
    throw mapLiveRoomActionError(
      result.error,
      result.status,
      "LIVE_ROOM_MARK_READ_FAILED",
      "The Live Room could not be marked as read.",
    );
  }
  return { markedRead: result.data === true };
}

export async function getLiveRoomUnreadSummary(
  actor: LiveRoomActor,
): Promise<LiveRoomUnreadSummary> {
  const [result, postActivityResult, followedRoomsPage] = await Promise.all([
    supabaseRpc("get_live_room_activity_summary", {
      p_actor_kind: actor.kind,
      p_member_user_id: actor.kind === "member" ? actor.userId : null,
      p_guest_session_id:
        actor.kind === "guest" ? actor.guestSessionId : null,
      p_people_limit: 30,
    }),
    actor.kind === "member"
      ? supabaseRpc("get_live_room_post_activity_summary", {
          p_recipient_user_id: actor.userId,
          p_limit: 30,
        })
      : Promise.resolve({
          data: null,
          error: undefined,
          ok: true,
          status: 200,
        }),
    actor.kind === "member"
      ? listCommunityHubRooms({ actor, limit: 50 })
      : Promise.resolve(null),
  ]);
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_UNREAD_UNAVAILABLE",
      result.error || "Live Room activity could not be loaded.",
      result.status || 502,
    );
  }
  if (!postActivityResult.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_POST_ACTIVITY_UNAVAILABLE",
      postActivityResult.error ||
        "Live Room post activity could not be loaded.",
      postActivityResult.status || 502,
    );
  }
  const summary = readSingleRow(result.data) || {};
  const postActivitySummary =
    readSingleRow(postActivityResult.data) || {};
  const activity = readRows(postActivitySummary.items)
    .map(mapLiveRoomPostActivity)
    .filter((item): item is LiveRoomPostActivity => Boolean(item));
  const activityUnreadCount =
    actor.kind === "member"
      ? Math.max(
          0,
          Number(
            postActivitySummary.unreadCount ??
              postActivitySummary.unread_count,
          ) || 0,
        )
      : 0;
  const legacyRooms = readRows(summary.rooms).map((row) => {
    const ticker = normalizeLiveRoomTicker(
      readString(row.ticker ?? row.room_ticker),
    );
    return {
      href: `/live/${encodeURIComponent(ticker)}`,
      kind: "company" as const,
      label: `${ticker} Live Room`,
      ticker,
      unreadCount: Math.max(
        0,
        Number(row.unreadCount ?? row.unread_count) || 0,
      ),
    };
  });
  const rooms =
    actor.kind === "member" && followedRoomsPage
      ? followedRoomsPage.items.map((room) => ({
          href: room.href,
          kind: room.kind,
          label: room.label,
          ticker: room.ticker,
          unreadCount: room.unreadCount,
        }))
      : legacyRooms;
  const legacyRoomUnreadCount = legacyRooms.reduce(
    (total, room) => total + room.unreadCount,
    0,
  );
  const additionalRoomUnreadCount =
    followedRoomsPage === null
      ? 0
      : Math.max(
          0,
          followedRoomsPage.totalUnreadCount - legacyRoomUnreadCount,
        );
  const followedPeople = readRows(summary.followedPeople)
    .map((row) => ({
      authorDisplayName: readString(
        row.authorDisplayName ?? row.author_display_name,
      ).slice(0, 24),
      authorEmoji: readString(
        row.authorEmoji ?? row.author_emoji,
      ).slice(0, 16),
      messageId: readString(row.messageId ?? row.message_id),
      ticker: normalizeLiveRoomTicker(readString(row.ticker)),
    }))
    .filter(
      (item) => isUuid(item.messageId) && Boolean(item.ticker),
    );
  const people = readRows(summary.people)
    .map((row) => ({
      authorDisplayName: readString(
        row.authorDisplayName ?? row.author_display_name,
      ).slice(0, 24),
      authorEmoji: readString(
        row.authorEmoji ?? row.author_emoji,
      ).slice(0, 16),
      bodyPreview: readString(
        row.bodyPreview ?? row.body_preview,
      ).slice(0, 160),
      createdAt: readString(row.createdAt ?? row.created_at),
      messageId: readString(row.messageId ?? row.message_id),
      ticker: normalizeLiveRoomTicker(readString(row.ticker)),
    }))
    .filter(
      (item) =>
        isUuid(item.messageId) &&
        Boolean(item.ticker) &&
        Boolean(item.createdAt),
    );
  return {
    activity: actor.kind === "member" ? activity : [],
    activityUnreadCount,
    followedPeople: actor.kind === "member" ? followedPeople : [],
    hasMemberFollows:
      actor.kind === "member" && summary.hasMemberFollows === true,
    isAuthenticated: actor.kind === "member",
    people,
    peopleUnreadCount:
      actor.kind === "member"
        ? Math.max(0, Number(summary.peopleUnreadCount) || 0)
        : 0,
    rooms,
    totalUnreadCount: Math.max(
      0,
      Number(summary.totalUnreadCount) || 0,
    ) + activityUnreadCount + additionalRoomUnreadCount,
  };
}

export async function markLiveRoomPostActivityRead({
  activityId: rawActivityId,
  actor,
}: {
  activityId: unknown;
  actor: LiveRoomActor;
}) {
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_REQUIRED",
      "Sign in to read Live Room activity.",
      401,
    );
  }
  const activityId = normalizeLiveRoomUuid(
    rawActivityId,
    "LIVE_ROOM_INVALID_ACTIVITY_ID",
    "The activity ID is invalid.",
  );
  const result = await supabaseRpc(
    "mark_live_room_post_activity_read",
    {
      p_recipient_user_id: actor.userId,
      p_activity_id: activityId,
    },
  );
  if (!result.ok) {
    throw mapLiveRoomActionError(
      result.error,
      result.status,
      "LIVE_ROOM_POST_ACTIVITY_READ_FAILED",
      "Live Room activity could not be marked as read.",
    );
  }
  return { activityId, markedRead: result.data === true };
}

export async function updateLiveRoomMemberFollow({
  actor,
  followed,
  messageId: rawMessageId,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  followed: unknown;
  messageId: unknown;
  ticker: string;
}): Promise<LiveRoomMemberFollowResult> {
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
  const ticker = normalizeLiveRoomTicker(rawTicker);
  const room = await getOrCreateLiveRoom(ticker);
  const messageId = normalizeLiveRoomUuid(rawMessageId);
  await ensureMemberBootstrap(actor);
  await assertLiveRoomMutationRateLimit(actor, "follow");
  const result = await supabaseRpc("set_live_room_member_follow", {
    p_follower_user_id: actor.userId,
    p_room_id: room.id,
    p_message_id: messageId,
    p_followed: followed,
  });
  if (!result.ok) {
    throw mapLiveRoomActionError(
      result.error,
      result.status,
      "LIVE_ROOM_MEMBER_FOLLOW_UPDATE_FAILED",
      "Member follow status could not be saved.",
    );
  }
  return { followed, messageId };
}

export async function markLiveRoomMemberActivityRead({
  actor,
  messageId: rawMessageId,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  messageId: unknown;
  ticker: string;
}) {
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_REQUIRED",
      "Sign in to read member activity.",
      401,
    );
  }
  const ticker = normalizeLiveRoomTicker(rawTicker);
  const room = await getOrCreateLiveRoom(ticker);
  const messageId = normalizeLiveRoomUuid(rawMessageId);
  await ensureMemberBootstrap(actor);
  const result = await supabaseRpc(
    "mark_live_room_member_activity_read",
    {
      p_follower_user_id: actor.userId,
      p_room_id: room.id,
      p_message_id: messageId,
    },
  );
  if (!result.ok) {
    throw mapLiveRoomActionError(
      result.error,
      result.status,
      "LIVE_ROOM_MEMBER_ACTIVITY_READ_FAILED",
      "Member activity could not be marked as read.",
    );
  }
  return { markedRead: result.data === true, messageId };
}

async function getLatestRoomChangeCursor(roomId: string) {
  const [messageResult, postResult] = await Promise.all([
    supabaseSelect("live_room_messages", {
      select: "id,updated_at",
      room_id: `eq.${roomId}`,
      order: "updated_at.desc,id.desc",
      limit: "1",
    }),
    supabaseSelect("live_room_posts", {
      select: "id,updated_at",
      room_id: `eq.${roomId}`,
      order: "updated_at.desc,id.desc",
      limit: "1",
    }),
  ]);
  if (!messageResult.ok || !postResult.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_CHANGES_UNAVAILABLE",
      messageResult.error ||
        postResult.error ||
        "The Live Room change cursor is unavailable.",
      messageResult.status || postResult.status || 502,
    );
  }
  const row = [
    readSingleRow(messageResult.data),
    readSingleRow(postResult.data),
  ]
    .filter(
      (item): item is Record<string, unknown> => Boolean(item),
    )
    .sort(
      (left, right) =>
        Date.parse(readString(right.updated_at)) -
          Date.parse(readString(left.updated_at)) ||
        readString(right.id).localeCompare(readString(left.id)),
    )[0];
  const id = readString(row?.id);
  const updatedAt = readString(row?.updated_at);
  return id && updatedAt
    ? encodeMessageCursor({ createdAt: updatedAt, id })
    : null;
}

async function getBlockedActorIds(actor: LiveRoomActor) {
  const result = await supabaseSelect("live_room_actor_blocks", {
    select: "blocked_actor_id",
    ...getBlockerFilter(actor),
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
    .map((row) => readString(row.blocked_actor_id))
    .filter((value) => isUuid(value));
}

function applyMessageCursorAndBlockFilters(
  search: Record<string, string>,
  cursor: CursorValue | null,
  ascending: boolean,
  blockedActorIds: string[],
) {
  const cursorExpression = cursor
    ? ascending
      ? `or(created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.gt.${cursor.id}))`
      : `or(created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id}))`
    : null;
  const blockedExpression = blockedActorIds.length
    ? `or(actor_id.is.null,actor_id.not.in.(${blockedActorIds.join(",")}))`
    : null;

  if (cursorExpression && blockedExpression) {
    search.and = `(${cursorExpression},${blockedExpression})`;
  } else if (cursorExpression) {
    search.or = `(${cursorExpression.slice(3, -1)})`;
  } else if (blockedExpression) {
    search.or = `(${blockedExpression.slice(3, -1)})`;
  }
}

function getBlockerFilter(
  actor: LiveRoomActor,
): Record<string, string> {
  return actor.kind === "member"
    ? {
        blocker_kind: "eq.member",
        blocker_member_user_id: `eq.${actor.userId}`,
      }
    : {
        blocker_kind: "eq.guest",
        blocker_guest_session_id: `eq.${actor.guestSessionId}`,
      };
}

async function ensureMemberBootstrap(actor: LiveRoomActor) {
  if (actor.kind === "member") {
    await ensureUserBootstrap({ id: actor.userId, email: actor.email });
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

function mapBlockRow(row: BlockRow): LiveRoomBlockedActor {
  return {
    blockedAt: readString(row.created_at),
    displayName: readString(row.blocked_display_name) || "Blocked author",
    emoji: readString(row.blocked_emoji) || "💬",
    id: readString(row.id),
  };
}

async function getOrCreateLiveRoom(ticker: string): Promise<RoomRow> {
  const selected = await supabaseSelect("live_room_rooms", {
    select: "id,ticker,room_kind",
    ticker: `eq.${ticker}`,
    room_kind: "eq.company",
    limit: "1",
  });
  let row = readSingleRow(selected.data);
  if (selected.ok && row) return readRoom(row);

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
      created.error || selected.error || "The company room is unavailable.",
      created.status || selected.status || 502,
    );
  }
  return readRoom(row);
}

async function resolveLiveRoom({
  slug,
  ticker: rawTicker,
}: {
  slug?: string;
  ticker?: string;
}): Promise<RoomRow> {
  if (rawTicker && !slug) {
    return getOrCreateLiveRoom(normalizeLiveRoomTicker(rawTicker));
  }
  if (slug && !rawTicker) {
    const room = await getCommunityRoomIdentity(slug);
    return {
      id: room.id,
      kind: "community",
      slug: room.slug,
      ticker: null,
    };
  }
  throw new LiveRoomPolicyError(
    "LIVE_ROOM_INVALID_ROOM",
    "Choose one valid Live Room.",
  );
}

async function getRecentActorMessages(actor: LiveRoomActor) {
  const result = await supabaseSelect("live_room_messages", {
    select: "body,created_at",
    ...getLiveRoomActorFilter(actor, "author_kind"),
    visibility_status: "eq.visible",
    created_at: `gte.${new Date(Date.now() - 120_000).toISOString()}`,
    order: "created_at.desc",
    limit: "20",
  });

  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MODERATION_UNAVAILABLE",
      "The message could not be checked safely. Try again.",
      503,
    );
  }

  return readRows(result.data).map((row) => ({
    body: readString(row.body),
    createdAt: readString(row.created_at),
  }));
}

async function getValidatedEventReference(
  ticker: string,
  eventId: string,
) {
  if (!isUuid(eventId)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_EVENT_REFERENCE",
      "That event cannot be mentioned in this company room.",
    );
  }
  const result = await supabaseSelect("events", {
    select: "id,ticker,title,source_group,delivery_level",
    id: `eq.${eventId}`,
    limit: "1",
  });
  const row = readSingleRow(result.data);
  if (!result.ok || !row) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_EVENT_REFERENCE",
      "That event cannot be mentioned in this company room.",
    );
  }

  return validateLiveRoomEventReference({
    deliveryLevel: readString(row.delivery_level) || null,
    eventId: readString(row.id),
    eventTicker: readString(row.ticker) || null,
    kind: readString(row.source_group) === "filings" ? "filing" : "news",
    roomTicker: ticker,
    title: readString(row.title),
  });
}

async function mapMessageRows(
  rows: MessageRow[],
  actor: LiveRoomActor,
  knownBlockedActorIds?: readonly string[],
) {
  const blockedActorIds = knownBlockedActorIds
    ? [...knownBlockedActorIds]
    : await getBlockedActorIds(actor);
  const memberUserIds = [
    ...new Set(
      rows
        .filter((row) => row.author_kind === "member")
        .map((row) => readString(row.member_user_id))
        .filter(Boolean),
    ),
  ];
  const enrichmentPromise = Promise.all([
    getLiveRoomSocialBadgeMap({
      actor,
      messageIds: rows.map((row) => readString(row.id)).filter(Boolean),
    }),
    getLiveRoomPublicProfileMap(memberUserIds),
    getLiveRoomReplyPreviewMap(rows, blockedActorIds),
    getLiveRoomMessageEngagement(rows, actor, blockedActorIds),
    getBrokerageProofMapForMessages(
      rows.map((row) => readString(row.id)).filter(Boolean),
    ),
    getKlipyMediaMapForMessages(
      rows.map((row) => readString(row.id)).filter(Boolean),
    ),
  ]);

  if (actor.kind !== "member") {
    const [
      socialBadges,
      publicProfiles,
      replyPreviews,
      engagement,
      brokerageProofs,
      media,
    ] =
      await enrichmentPromise;
    return rows.map((row) =>
      mapMessageRow(
        row,
        actor,
        new Set(),
        new Set(),
        socialBadges,
        publicProfiles,
        replyPreviews,
        engagement.likedMessageIds,
        engagement.replyCounts,
        brokerageProofs,
        media,
      ),
    );
  }

  const targetUserIds = [
    ...new Set(
      memberUserIds.filter((userId) => userId !== actor.userId),
    ),
  ];
  if (!targetUserIds.length) {
    const [
      socialBadges,
      publicProfiles,
      replyPreviews,
      engagement,
      brokerageProofs,
      media,
    ] =
      await enrichmentPromise;
    return rows.map((row) =>
      mapMessageRow(
        row,
        actor,
        new Set(),
        new Set(),
        socialBadges,
        publicProfiles,
        replyPreviews,
        engagement.likedMessageIds,
        engagement.replyCounts,
        brokerageProofs,
        media,
      ),
    );
  }

  const [
    [
      socialBadges,
      publicProfiles,
      replyPreviews,
      engagement,
      brokerageProofs,
      media,
    ],
    outgoing,
    blocks,
  ] = await Promise.all([
    enrichmentPromise,
    supabaseSelect("live_room_member_follows", {
      select: "followed_user_id",
      follower_user_id: `eq.${actor.userId}`,
      followed_user_id: `in.(${targetUserIds.join(",")})`,
      limit: String(targetUserIds.length),
    }),
    supabaseSelect("live_room_actor_blocks", {
      select: "blocker_member_user_id,blocked_member_user_id",
      blocker_kind: "eq.member",
      blocked_kind: "eq.member",
      or: `(and(blocker_member_user_id.eq.${actor.userId},blocked_member_user_id.in.(${targetUserIds.join(",")})),and(blocker_member_user_id.in.(${targetUserIds.join(",")}),blocked_member_user_id.eq.${actor.userId}))`,
      limit: String(targetUserIds.length * 2),
    }),
  ]);
  if (!outgoing.ok || !blocks.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_FOLLOW_STATE_UNAVAILABLE",
      outgoing.error ||
        blocks.error ||
        "Member follow state could not be loaded.",
      outgoing.status || blocks.status || 502,
    );
  }
  const followedUserIds = new Set(
    readRows(outgoing.data)
      .map((row) => readString(row.followed_user_id))
      .filter(Boolean),
  );
  const blockedUserIds = new Set(
    readRows(blocks.data).flatMap((row) => [
      readString(row.blocker_member_user_id),
      readString(row.blocked_member_user_id),
    ]),
  );
  blockedUserIds.delete(actor.userId);
  const messageableUserIds = new Set(
    targetUserIds.filter(
      (userId) => !blockedUserIds.has(userId),
    ),
  );
  return rows.map((row) =>
    mapMessageRow(
      row,
      actor,
      followedUserIds,
      messageableUserIds,
      socialBadges,
      publicProfiles,
      replyPreviews,
      engagement.likedMessageIds,
      engagement.replyCounts,
      brokerageProofs,
      media,
    ),
  );
}

async function getLiveRoomPublicProfileMap(
  memberUserIds: readonly string[],
) {
  if (!memberUserIds.length) {
    return new Map<string, LiveRoomPublicProfilePresentation>();
  }
  const result = await supabaseSelect("live_room_member_profiles", {
    select: "user_id,public_profile_id,avatar_path",
    user_id: `in.(${memberUserIds.join(",")})`,
    limit: String(memberUserIds.length),
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_PROFILES_UNAVAILABLE",
      result.error || "Member profiles could not be loaded.",
      result.status || 502,
    );
  }
  return new Map(
    readRows(result.data)
      .map(
        (row) =>
          [
            readString(row.user_id),
            {
              avatarUrl: buildLiveRoomAvatarUrl(row.avatar_path),
              publicProfileId: readString(row.public_profile_id),
            },
          ] as const,
      )
      .filter(([userId, profile]) =>
        Boolean(userId && profile.publicProfileId),
      ),
  );
}

async function getLiveRoomReplyPreviewMap(
  rows: readonly MessageRow[],
  blockedActorIds: readonly string[],
) {
  const replyMessageIds = [
    ...new Set(
      rows
        .map((row) => readString(row.reply_to_message_id))
        .filter(Boolean),
    ),
  ];
  if (!replyMessageIds.length) {
    return new Map<string, LiveRoomReplyPreview>();
  }

  const result = await supabaseSelect("live_room_messages", {
    select:
      "id,actor_id,author_kind,member_user_id,author_display_name,author_emoji,body,visibility_status",
    id: `in.(${replyMessageIds.join(",")})`,
    visibility_status: "eq.visible",
    limit: String(replyMessageIds.length),
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_REPLY_PREVIEWS_UNAVAILABLE",
      result.error || "Reply previews could not be loaded.",
      result.status || 502,
    );
  }

  const blocked = new Set(blockedActorIds);
  const resultRows = readRows(result.data) as MessageRow[];
  const [mediaMap, publicProfiles] = await Promise.all([
    getKlipyMediaMapForMessages(
      resultRows
      .map((row) => readString(row.id))
      .filter(Boolean),
    ),
    getLiveRoomPublicProfileMap(
      resultRows
        .filter((row) => row.author_kind === "member")
        .map((row) => readString(row.member_user_id))
        .filter(Boolean),
    ),
  ]);
  return new Map(
    resultRows
      .filter((row) => !blocked.has(readString(row.actor_id)))
      .map((row) => {
        const messageId = readString(row.id);
        const memberProfile = publicProfiles.get(
          readString(row.member_user_id),
        );
        return [
          messageId,
          {
            authorAvatarUrl: memberProfile?.avatarUrl || null,
            authorDisplayName:
              readString(row.author_display_name) || "Member",
            authorEmoji: readString(row.author_emoji) || "👋",
            bodyPreview: createLiveRoomReplyBodyPreview(
              readString(row.body),
            ) || (mediaMap.has(messageId) ? "GIF" : ""),
            messageId,
            mediaPreview: toKlipyReplyMediaPreview(
              mediaMap.get(messageId),
            ),
          },
        ] as const;
      }),
  );
}

async function getLiveRoomMessageEngagement(
  rows: readonly MessageRow[],
  actor: LiveRoomActor,
  blockedActorIds: readonly string[],
) {
  const messageIds = [
    ...new Set(
      rows.map((row) => readString(row.id)).filter(Boolean),
    ),
  ];
  const roomId = readString(rows[0]?.room_id);
  if (!messageIds.length || !roomId) {
    return {
      likedMessageIds: new Set<string>(),
      replyCounts: new Map<string, number>(),
    };
  }

  const [replyResult, likeResult] = await Promise.all([
    supabaseRpc("get_live_room_message_reply_counts", {
      p_room_id: roomId,
      p_message_ids: messageIds,
      p_blocked_actor_ids: blockedActorIds,
    }),
    actor.kind === "member"
      ? supabaseSelect("live_room_message_likes", {
          select: "message_id",
          actor_user_id: `eq.${actor.userId}`,
          message_id: `in.(${messageIds.join(",")})`,
          limit: String(messageIds.length),
        })
      : Promise.resolve({
          data: [],
          error: undefined,
          ok: true,
          status: 200,
        }),
  ]);
  if (!replyResult.ok || !likeResult.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MESSAGE_ENGAGEMENT_UNAVAILABLE",
      replyResult.error ||
        likeResult.error ||
        "Message engagement could not be loaded.",
      replyResult.status || likeResult.status || 502,
    );
  }

  return {
    likedMessageIds: new Set(
      readRows(likeResult.data)
        .map((row) => readString(row.message_id))
        .filter(Boolean),
    ),
    replyCounts: new Map(
      readRows(replyResult.data)
        .map(
          (row) =>
            [
              readString(row.message_id),
              readNonnegativeCount(row.reply_count),
            ] as const,
        )
        .filter(([messageId]) => Boolean(messageId)),
    ),
  };
}

function assertLiveRoomPresenceMember(
  actor: LiveRoomActor,
): asserts actor is Extract<LiveRoomActor, { kind: "member" }> {
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_REQUIRED",
      "Sign in to use Live Room presence.",
      401,
    );
  }
}

function assertLiveRoomProfileMember(
  actor: LiveRoomActor,
): asserts actor is Extract<LiveRoomActor, { kind: "member" }> {
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_REQUIRED",
      "Sign in to manage a profile photo.",
      401,
    );
  }
}

function assertLiveRoomEngagementMember(
  actor: LiveRoomActor,
): asserts actor is Extract<LiveRoomActor, { kind: "member" }> {
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_REQUIRED",
      "Sign in to like Live Room messages.",
      401,
    );
  }
}

function assertLiveRoomMembershipMember(
  actor: LiveRoomActor,
): asserts actor is Extract<LiveRoomActor, { kind: "member" }> {
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_REQUIRED",
      "Sign in to join this room.",
      401,
    );
  }
}

function mapMembershipState(
  row: Record<string, unknown>,
): LiveRoomMembershipState {
  const onlineCount = readNonnegativeCount(
    row.onlineCount ?? row.online_count,
  );
  const memberCount = readNonnegativeCount(
    row.memberCount ?? row.member_count,
  );
  const visitorCount = readNonnegativeCount(
    row.visitorCount ?? row.visitor_count,
  );
  return {
    joined: row.joined === true,
    memberCount,
    onlineCount,
    participantCount: Math.max(
      onlineCount,
      readNonnegativeCount(
        row.participantCount ?? row.participant_count,
      ),
    ),
    visitorCount,
  };
}

function mapMembershipListItem(
  row: Record<string, unknown>,
): LiveRoomMembershipListItem | null {
  const kind = readString(row.kind ?? row.room_kind);
  const href = readString(row.href);
  const label = readString(row.label);
  const ticker = readString(row.ticker) || null;
  const joinedAt = readString(row.joinedAt ?? row.joined_at);
  const recentActivityAt = readString(
    row.recentActivityAt ?? row.recent_activity_at,
  );
  if (
    (kind !== "company" && kind !== "community") ||
    !href.startsWith("/live/") ||
    href.startsWith("//") ||
    !label ||
    !joinedAt ||
    !recentActivityAt
  ) {
    return null;
  }
  return {
    href,
    joinedAt,
    kind,
    label,
    onlineCount: readNonnegativeCount(
      row.onlineCount ?? row.online_count,
    ),
    participantCount: readNonnegativeCount(
      row.participantCount ?? row.participant_count,
    ),
    recentActivityAt,
    ticker,
    unreadCount: readNonnegativeCount(
      row.unreadCount ?? row.unread_count,
    ),
  };
}

function mapLiveRoomMemberSummary(
  row: Record<string, unknown>,
): LiveRoomMemberSummary | null {
  const publicProfileId = readString(
    row.publicProfileId ?? row.public_profile_id,
  );
  if (!isUuid(publicProfileId)) return null;
  const socialBadges = readRows(
    row.socialBadges ?? row.social_badges,
  ).flatMap<LiveRoomMemberSummary["socialBadges"][number]>((badge) => {
    const platform = readString(badge.platform);
    const socialPlatform:
      | "x"
      | "youtube"
      | "instagram"
      | null =
      platform === "x" ||
      platform === "youtube" ||
      platform === "instagram"
        ? platform
        : null;
    const profileUrl = readString(
      badge.profileUrl ?? badge.profile_url,
    );
    const label = readString(badge.label);
    if (!socialPlatform || !profileUrl || !label) {
      return [];
    }
    return [{ label, platform: socialPlatform, profileUrl }];
  });
  return {
    avatarUrl: null,
    displayName:
      readString(row.displayName ?? row.display_name) || "Member",
    emoji:
      readString(row.emoji) || String.fromCodePoint(128100),
    followerCount: readNonnegativeCount(
      row.followerCount ?? row.follower_count,
    ),
    isOnline: row.isOnline === true || row.is_online === true,
    plan: normalizePlan(row.plan),
    postCount: readNonnegativeCount(
      row.postCount ?? row.post_count,
    ),
    publicProfileId,
    receivedLikeCount: readNonnegativeCount(
      row.receivedLikeCount ?? row.received_like_count,
    ),
    socialBadges,
  };
}

function mapMessageRow(
  row: MessageRow,
  actor: LiveRoomActor,
  followedUserIds: ReadonlySet<string> = new Set(),
  messageableUserIds: ReadonlySet<string> = new Set(),
  socialBadgeMap: ReadonlyMap<
    string,
    LiveRoomProfile["socialBadges"]
  > = new Map(),
  publicProfileMap: ReadonlyMap<
    string,
    LiveRoomPublicProfilePresentation
  > = new Map(),
  replyPreviewMap: ReadonlyMap<string, LiveRoomReplyPreview> = new Map(),
  likedMessageIds: ReadonlySet<string> = new Set(),
  replyCountMap: ReadonlyMap<string, number> = new Map(),
  brokerageProofMap: ReadonlyMap<string, BrokerageProofSummary> = new Map(),
  mediaMap: ReadonlyMap<string, KlipyMediaAttachment> = new Map(),
): LiveRoomChatMessage {
  const eventId = readString(row.referenced_event_id);
  const eventKind = readString(row.referenced_event_kind);
  const eventTitle = readString(row.referenced_event_title);
  const eventReference: CompanyEventReference | null =
    eventId &&
    (eventKind === "filing" || eventKind === "news") &&
    eventTitle
      ? { eventId, kind: eventKind, title: eventTitle }
      : null;

  const memberUserId = readString(row.member_user_id);
  const messageId = readString(row.id);
  const canFollowMember =
    actor.kind === "member" &&
    row.author_kind === "member" &&
    Boolean(memberUserId) &&
    memberUserId !== actor.userId;

  return {
    author: {
      avatarUrl:
        row.author_kind === "member"
          ? publicProfileMap.get(memberUserId)?.avatarUrl || null
          : null,
      displayName: readString(row.author_display_name) || "Member",
      emoji: readString(row.author_emoji) || "👋",
      isGuest: row.author_kind === "guest",
      plan: normalizePlan(row.author_plan),
      publicProfileId:
        row.author_kind === "member"
          ? publicProfileMap.get(memberUserId)?.publicProfileId
          : undefined,
      socialBadges:
        row.author_kind === "member"
          ? socialBadgeMap.get(readString(row.id)) || []
          : [],
    },
    body: readString(row.body),
    brokerageProof: brokerageProofMap.get(messageId) || null,
    canFollowMember,
    canMessageMember:
      canFollowMember && messageableUserIds.has(memberUserId),
    createdAt: readString(row.created_at),
    eventReference,
    id: messageId,
    isLiked: likedMessageIds.has(messageId),
    isMemberFollowed:
      canFollowMember && followedUserIds.has(memberUserId),
    isMine: isLiveRoomMessageMine(row, actor),
    kind: "message",
    likeCount: readNonnegativeCount(row.like_count),
    media: mediaMap.get(messageId) || null,
    replyCount: replyCountMap.get(messageId) || 0,
    replyPreview:
      replyPreviewMap.get(readString(row.reply_to_message_id)) || null,
  };
}

function mapDatabaseModerationError(error: string | undefined, status: number) {
  const value = error || "";
  const mappings: Record<string, [string, string, number]> = {
    LIVE_ROOM_LOCKED: [
      "LIVE_ROOM_LOCKED",
      "This room is locked. Existing public content remains readable.",
      423,
    ],
    LIVE_ROOM_ARCHIVED: [
      "LIVE_ROOM_ARCHIVED",
      "This room is archived and read-only.",
      423,
    ],
    LIVE_ROOM_EMPTY: [
      "LIVE_ROOM_EMPTY",
      "Write a message before sending.",
      400,
    ],
    LIVE_ROOM_MAX_LENGTH: [
      "LIVE_ROOM_MAX_LENGTH",
      "Messages can be up to 600 characters.",
      400,
    ],
    LIVE_ROOM_BLOCKED_WORD: [
      "LIVE_ROOM_BLOCKED_WORD",
      "This wording is blocked. Rephrase the message.",
      400,
    ],
    LIVE_ROOM_EXCESSIVE_LINKS: [
      "LIVE_ROOM_EXCESSIVE_LINKS",
      "A message can include up to 2 links.",
      400,
    ],
    LIVE_ROOM_DUPLICATE: [
      "LIVE_ROOM_DUPLICATE",
      "The same message was sent recently. Add something new before trying again.",
      429,
    ],
    LIVE_ROOM_RATE_LIMIT: [
      "LIVE_ROOM_RATE_LIMIT",
      "Too many messages in a short time. Try again shortly.",
      429,
    ],
    LIVE_ROOM_INVALID_EVENT_REFERENCE: [
      "LIVE_ROOM_INVALID_EVENT_REFERENCE",
      "That event cannot be mentioned in this company room.",
      400,
    ],
    LIVE_ROOM_INVALID_REPLY_TARGET: [
      "LIVE_ROOM_INVALID_REPLY_TARGET",
      "That message is not available to reply to.",
      400,
    ],
    BROKERAGE_PUBLIC_SHARING_DISABLED: [
      "BROKERAGE_PUBLIC_SHARING_DISABLED",
      "Public sharing is pending provider approval.",
      403,
    ],
    BROKERAGE_PLAN_REQUIRED: [
      "BROKERAGE_PLAN_REQUIRED",
      "A Pro, Advanced, or Ultimate plan is required.",
      403,
    ],
    BROKERAGE_PROOF_NOT_ATTACHABLE: [
      "BROKERAGE_PROOF_NOT_ATTACHABLE",
      "That brokerage proof cannot be attached.",
      400,
    ],
    BROKERAGE_MEMBER_REQUIRED: [
      "BROKERAGE_MEMBER_REQUIRED",
      "Sign in to attach brokerage evidence.",
      401,
    ],
    LIVE_ROOM_ATTACHMENT_CONFLICT: [
      "LIVE_ROOM_ATTACHMENT_CONFLICT",
      "Attach either Evidence or a KLIPY GIF.",
      400,
    ],
    LIVE_ROOM_MEMBER_REQUIRED: [
      "LIVE_ROOM_MEMBER_REQUIRED",
      "Sign in to send KLIPY GIFs.",
      401,
    ],
    KLIPY_MEDIA_INVALID: [
      "KLIPY_MEDIA_INVALID",
      "That KLIPY GIF is no longer available.",
      400,
    ],
  };
  const match = Object.entries(mappings).find(([code]) =>
    value.includes(code),
  );
  if (match) {
    const [code, message, mappedStatus] = match[1];
    return new LiveRoomPolicyError(code, message, mappedStatus);
  }
  return new LiveRoomPolicyError(
    "LIVE_ROOM_SEND_FAILED",
    "The message could not be saved.",
    status || 502,
  );
}

function mapRoomAvailabilityDatabaseError(error: string | undefined) {
  const value = error || "";
  if (value.includes("LIVE_ROOM_LOCKED")) {
    return new LiveRoomPolicyError(
      "LIVE_ROOM_LOCKED",
      "This room is locked. Existing public content remains readable.",
      423,
    );
  }
  if (value.includes("LIVE_ROOM_ARCHIVED")) {
    return new LiveRoomPolicyError(
      "LIVE_ROOM_ARCHIVED",
      "This room is archived and read-only.",
      423,
    );
  }
  return null;
}

function mapLiveRoomActionError(
  error: string | undefined,
  status: number,
  fallbackCode: string,
  fallbackMessage: string,
) {
  const value = error || "";
  const mappings: Record<string, [string, string, number]> = {
    LIVE_ROOM_INVALID_REPORT_REASON: [
      "LIVE_ROOM_INVALID_REPORT_REASON",
      "Choose spam, harassment, misinformation, or other.",
      400,
    ],
    LIVE_ROOM_CHAT_NAME_REQUIRED: [
      "LIVE_ROOM_CHAT_NAME_REQUIRED",
      "Choose a chat name before posting publicly.",
      409,
    ],
    LIVE_ROOM_MESSAGE_NOT_FOUND: [
      "LIVE_ROOM_MESSAGE_NOT_FOUND",
      "That message is no longer available.",
      404,
    ],
    LIVE_ROOM_BLOCK_TARGET_UNAVAILABLE: [
      "LIVE_ROOM_BLOCK_TARGET_UNAVAILABLE",
      "That author can no longer be blocked.",
      409,
    ],
    LIVE_ROOM_CANNOT_BLOCK_SELF: [
      "LIVE_ROOM_CANNOT_BLOCK_SELF",
      "You cannot block your own messages.",
      400,
    ],
    LIVE_ROOM_MEMBER_NOT_FOLLOWABLE: [
      "LIVE_ROOM_MEMBER_NOT_FOLLOWABLE",
      "Only visible messages from registered members can be followed.",
      400,
    ],
    LIVE_ROOM_CANNOT_FOLLOW_SELF: [
      "LIVE_ROOM_CANNOT_FOLLOW_SELF",
      "You cannot follow yourself.",
      400,
    ],
    LIVE_ROOM_MODERATOR_REQUIRED: [
      "LIVE_ROOM_MODERATOR_REQUIRED",
      "Moderator access is required.",
      403,
    ],
    LIVE_ROOM_INVALID_MODERATION_TRANSITION: [
      "LIVE_ROOM_INVALID_MODERATION_TRANSITION",
      "That message is no longer in the expected moderation state.",
      409,
    ],
  };
  const match = Object.entries(mappings).find(([code]) =>
    value.includes(code),
  );
  if (match) {
    const [code, message, mappedStatus] = match[1];
    return new LiveRoomPolicyError(code, message, mappedStatus);
  }
  return new LiveRoomPolicyError(
    fallbackCode,
    fallbackMessage,
    status || 502,
  );
}

function encodeMessageCursor(value: CursorValue) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeMessageCursor(value: string | null): CursorValue | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<CursorValue>;
    if (
      typeof parsed.createdAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.createdAt)) ||
      typeof parsed.id !== "string" ||
      !isUuid(parsed.id)
    ) {
      throw new Error("invalid cursor");
    }
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_CURSOR",
      "The message cursor is invalid.",
    );
  }
}

function readCursor(row: MessageRow): CursorValue {
  return {
    createdAt: readString(row.created_at),
    id: readString(row.id),
  };
}

function readRoom(row: Record<string, unknown>): RoomRow {
  const ticker = readString(row.ticker);
  if (!ticker || row.room_kind === "community") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_UNAVAILABLE",
      "The company room is unavailable.",
      502,
    );
  }
  return {
    id: readString(row.id),
    kind: "company",
    slug: null,
    ticker,
  };
}

function mapLiveRoomPostActivity(
  row: Record<string, unknown>,
): LiveRoomPostActivity | null {
  const activityId = readString(
    row.activityId ?? row.activity_id,
  );
  const postId = readString(row.postId ?? row.post_id);
  const createdAt = readString(row.createdAt ?? row.created_at);
  const rawKind = readString(row.kind ?? row.activity_kind);
  const allowedKinds: LiveRoomPostActivityKind[] = [
    "comment_reply",
    "followed_member_post",
    "followed_room_post",
    "post_comment",
  ];
  if (
    !isUuid(activityId) ||
    !isUuid(postId) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !allowedKinds.includes(rawKind as LiveRoomPostActivityKind)
  ) {
    return null;
  }
  const commentId =
    readString(row.commentId ?? row.comment_id) || null;
  if (commentId && !isUuid(commentId)) return null;
  return {
    activityId,
    actorDisplayName:
      readString(row.actorDisplayName ?? row.actor_display_name) ||
      "Member",
    actorEmoji:
      readString(row.actorEmoji ?? row.actor_emoji) ||
      String.fromCodePoint(128100),
    bodyPreview: readString(
      row.bodyPreview ?? row.body_preview,
    ).slice(0, 160),
    commentId,
    createdAt,
    isRead: row.isRead === true || row.is_read === true,
    kind: rawKind as LiveRoomPostActivityKind,
    postId,
    postTitle: readString(
      row.postTitle ?? row.post_title,
    ).slice(0, 120),
    roomLabel: readString(
      row.roomLabel ?? row.room_label,
    ).slice(0, 60),
  };
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
  if (Array.isArray(value)) return readRows(value)[0] || null;
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNonnegativeCount(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.trunc(number))
    : 0;
}

function compareTimeline(
  left: LiveRoomTimelineItem,
  right: LiveRoomTimelineItem,
) {
  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
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
