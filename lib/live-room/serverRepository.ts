import "server-only";

import { ensureUserBootstrap } from "@/lib/auth/supabaseAuth";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import {
  supabaseDelete,
  supabaseRpc,
  supabaseSelect,
  supabaseUpsert,
} from "@/lib/supabase";
import type { Plan } from "@/lib/subscriptionPolicy";
import { getLiveRoomSocialBadgeMap } from "@/lib/social-verification/serverRepository";
import { getCommunityRoomIdentity } from "./communityServerRepository";
import { evaluateLiveRoomMessage } from "./moderation";
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
  validateLiveRoomEventReference,
  type LiveRoomActor,
} from "./policy";
import type {
  CompanyEventReference,
  LiveRoomBlockedActor,
  LiveRoomBlockResult,
  LiveRoomChatMessage,
  LiveRoomFollowPreference,
  LiveRoomMemberFollowResult,
  LiveRoomModerationItem,
  LiveRoomNotificationScope,
  LiveRoomProfile,
  LiveRoomPresenceSetting,
  LiveRoomPresenceSummary,
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

type MessageRow = {
  id?: unknown;
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
  items: LiveRoomChatMessage[];
  latestChangeCursor: string | null;
  latestCursor: string | null;
  nextCursor: string | null;
};

export type LiveRoomMessageChanges = {
  hasMore: boolean;
  latestChangeCursor: string | null;
  removedIds: string[];
  upserts: LiveRoomChatMessage[];
};

export async function getLiveRoomMessagePage({
  actor,
  after,
  before,
  limit,
  slug,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  after?: string | null;
  before?: string | null;
  limit?: number;
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
  const cursor = decodeMessageCursor(after || before || null);
  const ascending = Boolean(after);
  const search: Record<string, string> = {
    select:
      "id,actor_id,author_kind,member_user_id,guest_session_id,author_display_name,author_emoji,author_plan,body,referenced_event_id,referenced_event_kind,referenced_event_title,created_at",
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

  const result = await supabaseSelect("live_room_messages", search);
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MESSAGES_UNAVAILABLE",
      result.error || "Messages could not be loaded.",
      result.status || 502,
    );
  }

  const fetchedRows = readRows(result.data) as MessageRow[];
  const hasMore = fetchedRows.length > pageSize;
  const pageRows = fetchedRows.slice(0, pageSize);
  const chronologicalRows = ascending ? pageRows : [...pageRows].reverse();
  const items = await mapMessageRows(chronologicalRows, actor);
  const oldest = chronologicalRows[0];
  const latest = chronologicalRows[chronologicalRows.length - 1];

  return {
    items,
    latestChangeCursor,
    latestCursor: latest ? encodeMessageCursor(readCursor(latest)) : null,
    nextCursor:
      !ascending && hasMore && oldest
        ? encodeMessageCursor(readCursor(oldest))
        : null,
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
        "id,actor_id,author_kind,member_user_id,guest_session_id,author_display_name,author_emoji,author_plan,body,referenced_event_id,referenced_event_kind,referenced_event_title,created_at",
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
  const [message] = await mapMessageRows([row], actor);
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
      "id,actor_id,author_kind,member_user_id,guest_session_id,author_display_name,author_emoji,author_plan,body,referenced_event_id,referenced_event_kind,referenced_event_title,visibility_status,created_at,updated_at",
    room_id: `eq.${room.id}`,
    order: "updated_at.asc,id.asc",
    limit: String(pageSize + 1),
  };
  if (cursor) {
    search.or =
      `(updated_at.gt.${cursor.createdAt},and(updated_at.eq.${cursor.createdAt},id.gt.${cursor.id}))`;
  }

  const [result, blockedActorIds] = await Promise.all([
    supabaseSelect("live_room_messages", search),
    getBlockedActorIds(actor),
  ]);
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_CHANGES_UNAVAILABLE",
      result.error || "Live Room updates could not be loaded.",
      result.status || 502,
    );
  }

  const fetchedRows = readRows(result.data) as MessageRow[];
  const hasMore = fetchedRows.length > pageSize;
  const pageRows = fetchedRows.slice(0, pageSize);
  const blocked = new Set(blockedActorIds);
  const upsertRows: MessageRow[] = [];
  const removedIds: string[] = [];

  pageRows.forEach((row) => {
    const id = readString(row.id);
    const actorId = readString(row.actor_id);
    if (
      row.visibility_status === "visible" &&
      (!actorId || !blocked.has(actorId))
    ) {
      upsertRows.push(row);
    } else if (id) {
      removedIds.push(id);
    }
  });

  const latest = pageRows[pageRows.length - 1];
  const upserts = await mapMessageRows(upsertRows, actor);
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
  slug,
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  body: string;
  eventId?: string | null;
  slug?: string;
  ticker?: string;
}) {
  const room = await resolveLiveRoom({ slug, ticker: rawTicker });
  const profile = await getLiveRoomProfile(actor);
  const history = await getRecentActorMessages(actor);
  const decision = evaluateLiveRoomMessage(
    typeof body === "string" ? body : "",
    {
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
  const result = await supabaseRpc("insert_live_room_message", {
    p_room_id: room.id,
    p_actor_kind: author.actorKind,
    p_member_user_id: author.memberUserId,
    p_guest_session_id: author.guestSessionId,
    p_author_display_name: author.displayName,
    p_author_emoji: author.emoji,
    p_author_plan: author.plan,
    p_body: decision.normalizedBody,
    p_referenced_event_id: reference?.eventId || null,
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
      "id,author_kind,member_user_id,guest_session_id,author_display_name,author_emoji,author_plan,body,referenced_event_id,referenced_event_kind,referenced_event_title,moderation_reason,hidden_at,created_at",
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
    select: "display_name,emoji",
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
    const defaults = {
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

  return {
    canModerate,
    displayName:
      readString(row.display_name) || getDefaultLiveRoomDisplayName(actor),
    emoji: readString(row.emoji) || "👋",
    isGuest: actor.kind === "guest",
    plan,
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

  const result = await supabaseUpsert(
    table,
    {
      [key]: id,
      display_name: profile.displayName,
      emoji: profile.emoji,
    },
    {
      onConflict: key,
      prefer: "resolution=merge-duplicates,return=representation",
    },
  );

  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PROFILE_UPDATE_FAILED",
      result.error || "The Live Room profile could not be saved.",
      result.status || 502,
    );
  }

  return getLiveRoomProfile(actor);
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
  rawTicker: string,
) {
  assertLiveRoomPresenceMember(actor);
  const ticker = normalizeLiveRoomPresenceTicker(rawTicker);
  const result = await supabaseRpc(
    "set_live_room_member_presence_heartbeat",
    {
      p_member_user_id: actor.userId,
      p_ticker: ticker,
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
  ticker: rawTicker,
}: {
  actor: LiveRoomActor;
  messageIds: unknown;
  ticker: string;
}): Promise<LiveRoomPresenceSummary> {
  assertLiveRoomPresenceMember(actor);
  const ticker = normalizeLiveRoomPresenceTicker(rawTicker);
  const messageIds = [
    ...new Set(
      (Array.isArray(rawMessageIds) ? rawMessageIds : [])
        .slice(0, 50)
        .map((messageId) => normalizeLiveRoomUuid(messageId)),
    ),
  ];
  const result = await supabaseRpc(
    "get_live_room_member_presence_summary",
    {
      p_member_user_id: actor.userId,
      p_ticker: ticker,
      p_message_ids: messageIds,
      p_message_limit: 50,
    },
  );
  const summary = readSingleRow(result.data);
  if (!result.ok || !summary) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_PRESENCE_UNAVAILABLE",
      result.error || "Live Room presence could not be loaded.",
      result.status || 502,
    );
  }
  const messages = readRows(summary.messages)
    .map((row) => ({
      isOnline: row.isOnline === true || row.is_online === true,
      messageId: readString(row.messageId ?? row.message_id),
    }))
    .filter((message) => isUuid(message.messageId));
  return {
    messages,
    onlineMemberCount: Math.max(
      0,
      Number(summary.onlineMemberCount ?? summary.online_member_count) ||
        0,
    ),
  };
}

export async function getLiveRoomFollow(
  actor: LiveRoomActor,
  rawTicker: string,
): Promise<LiveRoomFollowPreference> {
  const ticker = normalizeLiveRoomTicker(rawTicker);
  const room = await getOrCreateLiveRoom(ticker);
  const result = await supabaseSelect("live_room_follows", {
    select: "followed,notification_scope",
    room_id: `eq.${room.id}`,
    ...getLiveRoomActorFilter(actor),
    limit: "1",
  });

  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_FOLLOW_UNAVAILABLE",
      result.error || "Follow status could not be loaded.",
      result.status || 502,
    );
  }

  const row = readSingleRow(result.data);
  return {
    followed: row?.followed === true,
    notificationScope: normalizeNotificationScope(
      row?.notification_scope,
    ),
    roomKey: { kind: "ticker_fallback", value: ticker },
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
      "Follow status must be true or false.",
    );
  }

  const ticker = normalizeLiveRoomTicker(rawTicker);
  const room = await getOrCreateLiveRoom(ticker);
  const notificationScope = normalizeNotificationScope(
    data.notificationScope,
  );
  if (actor.kind === "member") {
    await ensureUserBootstrap({
      id: actor.userId,
      email: actor.email,
    });
  }
  const result = await supabaseRpc("set_live_room_chat_follow", {
    p_room_id: room.id,
    p_actor_kind: actor.kind,
    p_member_user_id: actor.kind === "member" ? actor.userId : null,
    p_guest_session_id:
      actor.kind === "guest" ? actor.guestSessionId : null,
    p_followed: data.followed,
  });

  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_FOLLOW_UPDATE_FAILED",
      result.error || "Follow status could not be saved.",
      result.status || 502,
    );
  }

  return {
    followed: data.followed,
    notificationScope,
    roomKey: { kind: "ticker_fallback" as const, value: ticker },
  };
}

export async function markLiveRoomRead(
  actor: LiveRoomActor,
  rawTicker: string,
  rawMessageId: unknown,
) {
  const ticker = normalizeLiveRoomTicker(rawTicker);
  const room = await getOrCreateLiveRoom(ticker);
  const messageId =
    rawMessageId === null || rawMessageId === undefined
      ? null
      : normalizeLiveRoomUuid(rawMessageId);
  const result = await supabaseRpc("mark_live_room_follow_read", {
    p_room_id: room.id,
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
  const result = await supabaseRpc("get_live_room_activity_summary", {
    p_actor_kind: actor.kind,
    p_member_user_id: actor.kind === "member" ? actor.userId : null,
    p_guest_session_id:
      actor.kind === "guest" ? actor.guestSessionId : null,
    p_people_limit: 30,
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_UNREAD_UNAVAILABLE",
      result.error || "Live Room activity could not be loaded.",
      result.status || 502,
    );
  }
  const summary = readSingleRow(result.data) || {};
  const rooms = readRows(summary.rooms).map((row) => ({
    ticker: normalizeLiveRoomTicker(
      readString(row.ticker ?? row.room_ticker),
    ),
    unreadCount: Math.max(
      0,
      Number(row.unreadCount ?? row.unread_count) || 0,
    ),
  }));
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
    ),
  };
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
  const result = await supabaseSelect("live_room_messages", {
    select: "id,updated_at",
    room_id: `eq.${roomId}`,
    order: "updated_at.desc,id.desc",
    limit: "1",
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_CHANGES_UNAVAILABLE",
      result.error || "The Live Room change cursor is unavailable.",
      result.status || 502,
    );
  }
  const row = readSingleRow(result.data);
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
) {
  const socialBadgePromise = getLiveRoomSocialBadgeMap({
    actor,
    messageIds: rows.map((row) => readString(row.id)).filter(Boolean),
  });
  if (actor.kind !== "member") {
    const socialBadges = await socialBadgePromise;
    return rows.map((row) =>
      mapMessageRow(
        row,
        actor,
        new Set(),
        new Set(),
        socialBadges,
      ),
    );
  }

  const targetUserIds = [
    ...new Set(
      rows
        .filter(
          (row) =>
            row.author_kind === "member" &&
            readString(row.member_user_id) !== actor.userId,
        )
        .map((row) => readString(row.member_user_id))
        .filter(Boolean),
    ),
  ];
  if (!targetUserIds.length) {
    const socialBadges = await socialBadgePromise;
    return rows.map((row) =>
      mapMessageRow(
        row,
        actor,
        new Set(),
        new Set(),
        socialBadges,
      ),
    );
  }

  const [outgoing, blocks, socialBadges] = await Promise.all([
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
    socialBadgePromise,
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
    ),
  );
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

function mapMessageRow(
  row: MessageRow,
  actor: LiveRoomActor,
  followedUserIds: ReadonlySet<string> = new Set(),
  messageableUserIds: ReadonlySet<string> = new Set(),
  socialBadgeMap: ReadonlyMap<
    string,
    LiveRoomProfile["socialBadges"]
  > = new Map(),
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
  const canFollowMember =
    actor.kind === "member" &&
    row.author_kind === "member" &&
    Boolean(memberUserId) &&
    memberUserId !== actor.userId;

  return {
    author: {
      displayName: readString(row.author_display_name) || "Member",
      emoji: readString(row.author_emoji) || "👋",
      isGuest: row.author_kind === "guest",
      plan: normalizePlan(row.author_plan),
      socialBadges:
        row.author_kind === "member"
          ? socialBadgeMap.get(readString(row.id)) || []
          : [],
    },
    body: readString(row.body),
    canFollowMember,
    canMessageMember:
      canFollowMember && messageableUserIds.has(memberUserId),
    createdAt: readString(row.created_at),
    eventReference,
    id: readString(row.id),
    isMemberFollowed:
      canFollowMember && followedUserIds.has(memberUserId),
    isMine: isLiveRoomMessageMine(row, actor),
    kind: "message",
  };
}

function mapDatabaseModerationError(error: string | undefined, status: number) {
  const value = error || "";
  const mappings: Record<string, [string, string, number]> = {
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

function normalizeNotificationScope(
  _value: unknown,
): LiveRoomNotificationScope {
  return "new_chat_messages";
}
