import "server-only";

import { ensureUserBootstrap } from "@/lib/auth/supabaseAuth";
import {
  LiveRoomPolicyError,
  normalizeLiveRoomUuid,
  type LiveRoomActor,
} from "@/lib/live-room/policy";
import { buildLiveRoomAvatarUrl } from "@/lib/live-room/profileAvatar";
import { assertLiveRoomMutationRateLimit } from "@/lib/live-room/mutationRateLimit";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import type { Plan } from "@/lib/subscriptionPolicy";
import { evaluateDirectMessage } from "./moderation";
import type {
  DirectMessage,
  DirectMessageConversation,
  DirectMessageConversationSummary,
  DirectMessageInbox,
  DirectMessagePeer,
  DirectMessageReportReason,
  DirectMessageRequestSummary,
  DirectMessageSettings,
  DirectMessageStartResult,
} from "./types";
import {
  DIRECT_MESSAGE_RECEIVE_MODES,
  DIRECT_MESSAGE_REPORT_REASONS,
  DIRECT_MESSAGE_REQUEST_FILTERS,
  DIRECT_MESSAGE_RISK_FLAGS,
} from "./types";

type DirectCursor = {
  createdAt: string;
  messageId: string;
};

export async function startDirectConversation({
  actor,
  body,
  messageId,
}: {
  actor: LiveRoomActor;
  body?: unknown;
  messageId: unknown;
}): Promise<DirectMessageStartResult> {
  const member = requireMember(actor);
  await ensureUserBootstrap({ id: member.userId, email: member.email });
  let normalizedBody: string | null = null;
  if (body !== undefined) {
    const recent = await getRecentDirectMessages(member.userId);
    const decision = evaluateDirectMessage(
      typeof body === "string" ? body : "",
      {
        history: recent,
        now: new Date().toISOString(),
        request: true,
      },
    );
    assertModerationAllowed(decision);
    normalizedBody = decision.normalizedBody;
  }
  const result = await supabaseRpc(
    "start_live_room_direct_conversation",
    {
      p_requester_user_id: member.userId,
      p_source_message_id: normalizeLiveRoomUuid(messageId),
      p_body: normalizedBody,
    },
  );
  if (!result.ok) {
    throw mapDirectMessageError(result.error, result.status);
  }
  const mapped = mapStartResult(result.data);
  const avatarUrls = await getDirectMessageAvatarUrls([
    mapped.peer.displayName,
  ]);
  return {
    ...mapped,
    peer: {
      ...mapped.peer,
      avatarUrl: avatarUrls.get(mapped.peer.displayName) || null,
    },
  };
}
export async function getDirectMessageInbox(
  actor: LiveRoomActor,
): Promise<DirectMessageInbox> {
  const member = requireMember(actor);
  const result = await supabaseRpc("get_live_room_direct_inbox", {
    p_requester_user_id: member.userId,
    p_limit: 30,
  });
  if (!result.ok) {
    throw mapDirectMessageError(result.error, result.status);
  }
  const data = readRecord(result.data);
  const conversations = readRows(data?.conversations)
    .map(mapConversationSummary)
    .filter(
      (
        item,
      ): item is DirectMessageConversationSummary => item !== null,
    );
  const incomingRequests = readRows(data?.incomingRequests)
    .map(mapRequestSummary)
    .filter((item): item is DirectMessageRequestSummary => item !== null);
  const outgoingRequests = readRows(data?.outgoingRequests)
    .map(mapRequestSummary)
    .filter((item): item is DirectMessageRequestSummary => item !== null);
  const avatarUrls = await getDirectMessageAvatarUrls([
    ...conversations.map((item) => item.peer.displayName),
    ...incomingRequests.map((item) => item.peer.displayName),
    ...outgoingRequests.map((item) => item.peer.displayName),
  ]);
  return {
    conversations: conversations.map((item) => ({
      ...item,
      peer: withDirectMessageAvatar(item.peer, avatarUrls),
    })),
    incomingRequests: incomingRequests.map((item) => ({
      ...item,
      peer: withDirectMessageAvatar(item.peer, avatarUrls),
    })),
    isAuthenticated: true,
    outgoingRequests: outgoingRequests.map((item) => ({
      ...item,
      peer: withDirectMessageAvatar(item.peer, avatarUrls),
    })),
    pendingRequestCount: Math.max(
      0,
      Number(data?.pendingRequestCount ?? data?.pending_request_count) || 0,
    ),
    totalUnreadCount: Math.max(
      0,
      Number(data?.totalUnreadCount ?? data?.total_unread_count) || 0,
    ),
  };
}

export async function getDirectConversation({
  actor,
  before,
  conversationId,
  limit,
}: {
  actor: LiveRoomActor;
  before?: string | null;
  conversationId: unknown;
  limit?: number;
}): Promise<DirectMessageConversation> {
  const member = requireMember(actor);
  const cursor = decodeCursor(before);
  const result = await supabaseRpc(
    "get_live_room_direct_conversation",
    {
      p_requester_user_id: member.userId,
      p_conversation_public_id: normalizeLiveRoomUuid(conversationId),
      p_before_created_at: cursor?.createdAt || null,
      p_before_message_id: cursor?.messageId || null,
      p_limit: Math.max(1, Math.min(Number(limit) || 50, 50)),
    },
  );
  if (!result.ok) {
    throw mapDirectMessageError(result.error, result.status);
  }
  const conversation = mapConversation(result.data);
  const avatarUrls = await getDirectMessageAvatarUrls([
    conversation.peer.displayName,
  ]);
  return {
    ...conversation,
    peer: withDirectMessageAvatar(conversation.peer, avatarUrls),
  };
}

export async function sendDirectMessage({
  actor,
  body,
  conversationId,
}: {
  actor: LiveRoomActor;
  body: unknown;
  conversationId: unknown;
}) {
  const member = requireMember(actor);
  const rawBody = typeof body === "string" ? body : "";
  const recent = await getRecentDirectMessages(member.userId);
  const decision = evaluateDirectMessage(rawBody, {
    history: recent,
    now: new Date().toISOString(),
    request: false,
  });
  assertModerationAllowed(decision);
  const normalizedConversationId =
    normalizeLiveRoomUuid(conversationId);
  const result = await supabaseRpc(
    "send_live_room_direct_message",
    {
      p_requester_user_id: member.userId,
      p_conversation_public_id: normalizedConversationId,
      p_body: decision.normalizedBody,
    },
  );
  if (!result.ok) {
    throw mapDirectMessageError(result.error, result.status);
  }
  const messageId = readScalarUuid(result.data);
  if (!messageId) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_SEND_FAILED",
      "The message could not be sent.",
      502,
    );
  }
  const conversation = await getDirectConversation({
    actor,
    conversationId: normalizedConversationId,
    limit: 50,
  });
  const message = conversation.messages.find(
    (item) => item.id === messageId,
  );
  if (!message) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_SEND_FAILED",
      "The message was sent, but could not be displayed safely.",
      502,
    );
  }
  return message;
}

export async function respondToDirectMessageRequest({
  action,
  actor,
  conversationId,
}: {
  action: unknown;
  actor: LiveRoomActor;
  conversationId: unknown;
}) {
  const member = requireMember(actor);
  const normalizedAction =
    action === "accept" || action === "decline" || action === "block"
      ? action
      : null;
  if (!normalizedAction) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_INVALID_ACTION",
      "Choose Accept, Decline, or Block.",
      400,
    );
  }
  const result = await supabaseRpc(
    "respond_live_room_direct_request",
    {
      p_requester_user_id: member.userId,
      p_conversation_public_id: normalizeLiveRoomUuid(conversationId),
      p_action: normalizedAction,
    },
  );
  if (!result.ok) {
    throw mapDirectMessageError(result.error, result.status);
  }
  const data = readRecord(result.data);
  const status = readString(data?.status);
  if (!["accepted", "blocked", "declined"].includes(status)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_UNAVAILABLE",
      "The message request could not be updated.",
      502,
    );
  }
  return {
    conversationId:
      status === "accepted" ? readString(data?.conversationId) : null,
    status: status as "accepted" | "blocked" | "declined",
  };
}

export async function getDirectMessageSettings(
  actor: LiveRoomActor,
): Promise<DirectMessageSettings> {
  const member = requireMember(actor);
  await ensureUserBootstrap({ id: member.userId, email: member.email });
  const result = await supabaseRpc(
    "get_live_room_direct_message_settings",
    { p_member_user_id: member.userId },
  );
  if (!result.ok) {
    throw mapDirectMessageError(result.error, result.status);
  }
  return mapSettings(result.data);
}

export async function updateDirectMessageSettings({
  actor,
  receiveMode,
  requestFilter,
}: {
  actor: LiveRoomActor;
  receiveMode: unknown;
  requestFilter: unknown;
}): Promise<DirectMessageSettings> {
  const member = requireMember(actor);
  if (
    typeof receiveMode !== "string" ||
    !DIRECT_MESSAGE_RECEIVE_MODES.includes(
      receiveMode as DirectMessageSettings["receiveMode"],
    )
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_INVALID_RECEIVE_MODE",
      "Choose who may send you message requests.",
      400,
    );
  }
  if (
    typeof requestFilter !== "string" ||
    !DIRECT_MESSAGE_REQUEST_FILTERS.includes(
      requestFilter as DirectMessageSettings["requestFilter"],
    )
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_INVALID_REQUEST_FILTER",
      "Choose a message request filter.",
      400,
    );
  }
  const currentSettings = await getDirectMessageSettings(actor);
  if (requestFilter !== "any" && !currentSettings.canUseSelectiveFilters) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_SELECTIVE_FILTER_FORBIDDEN",
      "Selective message request filters are available only to verified creators and active moderators.",
      403,
    );
  }
  const result = await supabaseRpc(
    "set_live_room_direct_message_settings",
    {
      p_member_user_id: member.userId,
      p_receive_mode: receiveMode,
      p_request_filter: requestFilter,
    },
  );
  if (!result.ok) {
    throw mapDirectMessageError(result.error, result.status);
  }
  return mapSettings(result.data);
}

export async function reportDirectMessage({
  actor,
  conversationId,
  messageId,
  reason,
}: {
  actor: LiveRoomActor;
  conversationId: unknown;
  messageId: unknown;
  reason: unknown;
}) {
  const member = requireMember(actor);
  if (
    typeof reason !== "string" ||
    !DIRECT_MESSAGE_REPORT_REASONS.includes(
      reason as DirectMessageReportReason,
    )
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_INVALID_REPORT_REASON",
      "Choose a report reason.",
      400,
    );
  }
  const normalizedConversationId = normalizeLiveRoomUuid(conversationId);
  const normalizedMessageId = normalizeLiveRoomUuid(messageId);
  await assertLiveRoomMutationRateLimit(actor, "report");
  const result = await supabaseRpc(
    "report_live_room_direct_message",
    {
      p_requester_user_id: member.userId,
      p_conversation_public_id: normalizedConversationId,
      p_message_id: normalizedMessageId,
      p_reason: reason,
    },
  );
  if (!result.ok) {
    throw mapDirectMessageError(result.error, result.status);
  }
  return { reported: result.data === true };
}

export async function markDirectConversationRead({
  actor,
  conversationId,
  messageId,
}: {
  actor: LiveRoomActor;
  conversationId: unknown;
  messageId?: unknown;
}) {
  const member = requireMember(actor);
  const result = await supabaseRpc(
    "mark_live_room_direct_conversation_read",
    {
      p_requester_user_id: member.userId,
      p_conversation_public_id: normalizeLiveRoomUuid(conversationId),
      p_message_id:
        messageId === null || messageId === undefined
          ? null
          : normalizeLiveRoomUuid(messageId),
    },
  );
  if (!result.ok) {
    throw mapDirectMessageError(result.error, result.status);
  }
  return { markedRead: result.data === true };
}

async function getRecentDirectMessages(userId: string) {
  const result = await supabaseSelect("live_room_direct_messages", {
    select: "body,created_at",
    sender_user_id: `eq.${userId}`,
    created_at: `gte.${new Date(Date.now() - 120_000).toISOString()}`,
    order: "created_at.desc,id.desc",
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

function requireMember(actor: LiveRoomActor) {
  if (actor.kind !== "member") {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_MEMBER_REQUIRED",
      "Sign in with a member account to use messages.",
      401,
    );
  }
  return actor;
}

function mapConversation(value: unknown): DirectMessageConversation {
  const data = readRecord(value);
  const conversationId = readString(data?.conversationId);
  if (!isUuid(conversationId)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_UNAVAILABLE",
      "The conversation could not be loaded.",
      502,
    );
  }
  const cursor = readRecord(data?.nextCursor);
  const messages = readRows(data?.messages)
    .map(mapMessage)
    .filter((item): item is DirectMessage => item !== null);
  const status = data?.status === "pending" ? "pending" : "accepted";
  const requestRole =
    status === "pending" &&
    (data?.requestRole === "sender" || data?.requestRole === "recipient")
      ? data.requestRole
      : null;
  return {
    canRespond: data?.canRespond === true,
    canSend: data?.canSend === true,
    conversationId,
    messages,
    mutualFollow: data?.mutualFollow === true,
    nextCursor:
      cursor &&
      isUuid(readString(cursor.messageId)) &&
      isIsoDate(readString(cursor.createdAt))
        ? encodeCursor({
            createdAt: readString(cursor.createdAt),
            messageId: readString(cursor.messageId),
          })
        : null,
    peer: mapPeer(data?.peer),
    readOnlyReason:
      typeof data?.readOnlyReason === "string"
        ? data.readOnlyReason.slice(0, 180)
        : null,
    requestRole,
    status,
  };
}

function mapConversationSummary(
  value: Record<string, unknown>,
): DirectMessageConversationSummary | null {
  const conversationId = readString(value.conversationId);
  if (!isUuid(conversationId)) return null;
  const latestCreatedAt = readString(value.latestCreatedAt);
  return {
    conversationId,
    latestBodyPreview: readString(value.latestBodyPreview).slice(0, 120),
    latestCreatedAt: isIsoDate(latestCreatedAt)
      ? latestCreatedAt
      : null,
    latestIsMine: value.latestIsMine === true,
    mutualFollow: value.mutualFollow === true,
    peer: {
      avatarUrl: null,
      displayName: readString(value.peerDisplayName).slice(0, 24) || "Member",
      emoji: readString(value.peerEmoji).slice(0, 16) || "💬",
      plan: normalizePlan(value.peerPlan),
    },
    status: "accepted",
    unreadCount: Math.max(0, Number(value.unreadCount) || 0),
  };
}

function mapRequestSummary(
  value: Record<string, unknown>,
): DirectMessageRequestSummary | null {
  const conversationId = readString(value.conversationId);
  if (!isUuid(conversationId)) return null;
  const createdAt = readString(value.createdAt);
  return {
    bodyPreview: readString(value.bodyPreview).slice(0, 160),
    conversationId,
    createdAt: isIsoDate(createdAt) ? createdAt : null,
    peer: {
      avatarUrl: null,
      displayName:
        readString(value.peerDisplayName).slice(0, 24) || "Member",
      emoji: readString(value.peerEmoji).slice(0, 16) || "💬",
      plan: normalizePlan(value.peerPlan),
    },
    riskFlags: readRiskFlags(value.riskFlags),
    riskScore: normalizeRiskScore(value.riskScore),
  };
}

function mapMessage(value: Record<string, unknown>): DirectMessage | null {
  const id = readString(value.id);
  const createdAt = readString(value.createdAt);
  if (!isUuid(id) || !isIsoDate(createdAt)) return null;
  return {
    body: readString(value.body).slice(0, 600),
    createdAt,
    id,
    isMine: value.isMine === true,
    kind: value.kind === "request" ? "request" : "chat",
    riskFlags: readRiskFlags(value.riskFlags),
    riskScore: normalizeRiskScore(value.riskScore),
  };
}

function mapPeer(value: unknown): DirectMessagePeer {
  const peer = readRecord(value);
  return {
    avatarUrl: null,
    displayName: readString(peer?.displayName).slice(0, 24) || "Member",
    emoji: readString(peer?.emoji).slice(0, 16) || "💬",
    plan: normalizePlan(peer?.plan),
  };
}

function mapStartResult(value: unknown): DirectMessageStartResult {
  const data = readRecord(value);
  const mode = readString(data?.mode);
  if (
    mode !== "accepted" &&
    mode !== "pending" &&
    mode !== "request_required"
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_UNAVAILABLE",
      "The conversation could not be opened.",
      502,
    );
  }
  const conversationId = readString(data?.conversationId);
  if (mode !== "request_required" && !isUuid(conversationId)) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_UNAVAILABLE",
      "The conversation could not be opened.",
      502,
    );
  }
  const peer = mapPeer(data?.peer);
  return {
    conversationId: mode === "request_required" ? null : conversationId,
    isRequestSender: data?.isRequestSender === true,
    mode,
    peer: {
      avatarUrl: peer.avatarUrl,
      displayName: peer.displayName,
      emoji: peer.emoji,
    },
  };
}

async function getDirectMessageAvatarUrls(
  displayNames: readonly string[],
) {
  const names = [...new Set(displayNames.filter(Boolean))];
  if (!names.length) return new Map<string, string | null>();
  const result = await supabaseSelect("live_room_member_profiles", {
    select: "display_name,avatar_path",
    display_name: `in.(${names
      .map((name) => `"${name}"`)
      .join(",")})`,
    limit: String(names.length),
  });
  if (!result.ok) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_UNAVAILABLE",
      "Member profile photos could not be loaded.",
      result.status || 502,
    );
  }
  return new Map(
    readRows(result.data).map((row) => [
      readString(row.display_name),
      buildLiveRoomAvatarUrl(row.avatar_path),
    ]),
  );
}

function withDirectMessageAvatar(
  peer: DirectMessagePeer,
  avatarUrls: ReadonlyMap<string, string | null>,
) {
  return {
    ...peer,
    avatarUrl: avatarUrls.get(peer.displayName) || null,
  };
}

function mapSettings(value: unknown): DirectMessageSettings {
  const data = readRecord(value);
  const canUseSelectiveFilters =
    data?.canUseSelectiveFilters === true;
  const receiveMode = readString(data?.receiveMode);
  const requestFilter = readString(data?.requestFilter);
  if (
    !DIRECT_MESSAGE_RECEIVE_MODES.includes(
      receiveMode as DirectMessageSettings["receiveMode"],
    ) ||
    !DIRECT_MESSAGE_REQUEST_FILTERS.includes(
      requestFilter as DirectMessageSettings["requestFilter"],
    )
  ) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_UNAVAILABLE",
      "Message privacy settings could not be loaded.",
      502,
    );
  }
  return {
    canUseSelectiveFilters,
    receiveMode: receiveMode as DirectMessageSettings["receiveMode"],
    requestFilter:
      canUseSelectiveFilters
        ? (requestFilter as DirectMessageSettings["requestFilter"])
        : "any",
  };
}

function mapDirectMessageError(
  error: string | undefined,
  status: number,
) {
  const value = error || "";
  const mappings: Array<[string, string, number]> = [
    ["LIVE_ROOM_DIRECT_TARGET_NOT_FOUND", "That member message is no longer available.", 404],
    ["LIVE_ROOM_DIRECT_SELF", "You cannot message yourself.", 400],
    ["LIVE_ROOM_DIRECT_REQUEST_UNAVAILABLE", "This member is not accepting message requests right now.", 403],
    ["LIVE_ROOM_DIRECT_REQUEST_LINK", "Message requests cannot include links or contact URLs.", 400],
    ["LIVE_ROOM_DIRECT_BLOCKED", "This conversation is unavailable.", 404],
    ["LIVE_ROOM_DIRECT_NOT_FOUND", "This conversation is unavailable.", 404],
    ["LIVE_ROOM_DIRECT_READ_ONLY", "This message request cannot receive another message.", 403],
    ["LIVE_ROOM_DIRECT_INVALID_ACTION", "That request action is unavailable.", 400],
    ["LIVE_ROOM_DIRECT_INVALID_RECEIVE_MODE", "Choose who may send you message requests.", 400],
    ["LIVE_ROOM_DIRECT_INVALID_REQUEST_FILTER", "Choose a message request filter.", 400],
    ["LIVE_ROOM_DIRECT_SELECTIVE_FILTER_FORBIDDEN", "Selective message request filters are available only to verified creators and active moderators.", 403],
    ["LIVE_ROOM_DIRECT_INVALID_REPORT_REASON", "Choose a report reason.", 400],
    ["LIVE_ROOM_DIRECT_MESSAGE_NOT_FOUND", "That message is not part of this conversation.", 404],
    ["LIVE_ROOM_EMPTY", "Write a message before sending.", 400],
    ["LIVE_ROOM_MAX_LENGTH", "Messages can be up to 600 characters.", 400],
    ["LIVE_ROOM_BLOCKED_WORD", "This wording is blocked. Rephrase the message.", 400],
    ["LIVE_ROOM_EXCESSIVE_LINKS", "A message can include up to 2 links.", 400],
    ["LIVE_ROOM_DUPLICATE", "The same message was sent recently. Add something new before trying again.", 429],
    ["LIVE_ROOM_RATE_LIMIT", "Too many messages in a short time. Try again shortly.", 429],
  ];
  const mapping = mappings.find(([code]) => value.includes(code));
  if (mapping) {
    return new LiveRoomPolicyError(mapping[0], mapping[1], mapping[2]);
  }
  return new LiveRoomPolicyError(
    "LIVE_ROOM_DIRECT_UNAVAILABLE",
    "Messages are temporarily unavailable.",
    status || 502,
  );
}

function assertModerationAllowed(
  decision: ReturnType<typeof evaluateDirectMessage>,
): asserts decision is Extract<
  ReturnType<typeof evaluateDirectMessage>,
  { allowed: true }
> {
  if (decision.allowed) return;
  const code =
    decision.reason === "request_link"
      ? "LIVE_ROOM_DIRECT_REQUEST_LINK"
      : `LIVE_ROOM_${decision.reason.toUpperCase()}`;
  throw new LiveRoomPolicyError(
    code,
    decision.message,
    decision.reason === "duplicate" ||
      decision.reason === "rate_limit"
      ? 429
      : 400,
    decision.retryAfterSeconds,
  );
}

function readRiskFlags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is (typeof DIRECT_MESSAGE_RISK_FLAGS)[number] =>
          typeof item === "string" &&
          DIRECT_MESSAGE_RISK_FLAGS.includes(
            item as (typeof DIRECT_MESSAGE_RISK_FLAGS)[number],
          ),
      ),
    ),
  ];
}

function normalizeRiskScore(value: unknown) {
  const score = Number(value);
  return Number.isFinite(score)
    ? Math.max(0, Math.min(100, Math.round(score)))
    : 0;
}

function encodeCursor(cursor: DirectCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value?: string | null): DirectCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<DirectCursor>;
    if (
      !isIsoDate(parsed.createdAt) ||
      !isUuid(readString(parsed.messageId))
    ) {
      throw new Error("invalid cursor");
    }
    return {
      createdAt: parsed.createdAt as string,
      messageId: parsed.messageId as string,
    };
  } catch {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_INVALID_CURSOR",
      "That message page cursor is invalid.",
      400,
    );
  }
}

function readScalarUuid(value: unknown) {
  const candidate =
    typeof value === "string"
      ? value
      : Array.isArray(value) && typeof value[0] === "string"
        ? value[0]
        : "";
  return isUuid(candidate) ? candidate : "";
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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
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
