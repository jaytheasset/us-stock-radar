import "server-only";

import { ensureUserBootstrap } from "@/lib/auth/supabaseAuth";
import { evaluateLiveRoomMessage } from "@/lib/live-room/moderation";
import {
  LiveRoomPolicyError,
  normalizeLiveRoomUuid,
  type LiveRoomActor,
} from "@/lib/live-room/policy";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import type { Plan } from "@/lib/subscriptionPolicy";
import type {
  DirectMessage,
  DirectMessageConversation,
  DirectMessageConversationSummary,
  DirectMessageInbox,
  DirectMessagePeer,
} from "./types";

type DirectCursor = {
  createdAt: string;
  messageId: string;
};

export async function startDirectConversation({
  actor,
  messageId,
}: {
  actor: LiveRoomActor;
  messageId: unknown;
}) {
  const member = requireMember(actor);
  await ensureUserBootstrap({ id: member.userId, email: member.email });
  const result = await supabaseRpc(
    "start_live_room_direct_conversation",
    {
      p_requester_user_id: member.userId,
      p_source_message_id: normalizeLiveRoomUuid(messageId),
    },
  );
  if (!result.ok) {
    throw mapDirectMessageError(result.error, result.status);
  }
  const conversationId = readScalarUuid(result.data);
  if (!conversationId) {
    throw new LiveRoomPolicyError(
      "LIVE_ROOM_DIRECT_UNAVAILABLE",
      "The conversation could not be opened.",
      502,
    );
  }
  return { conversationId };
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
  return {
    conversations,
    isAuthenticated: true,
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
  return mapConversation(result.data);
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
  const decision = evaluateLiveRoomMessage(rawBody, {
    history: recent,
    now: new Date().toISOString(),
  });
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
  return {
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
      displayName: readString(value.peerDisplayName).slice(0, 24) || "Member",
      emoji: readString(value.peerEmoji).slice(0, 16) || "💬",
      plan: normalizePlan(value.peerPlan),
    },
    unreadCount: Math.max(0, Number(value.unreadCount) || 0),
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
  };
}

function mapPeer(value: unknown): DirectMessagePeer {
  const peer = readRecord(value);
  return {
    displayName: readString(peer?.displayName).slice(0, 24) || "Member",
    emoji: readString(peer?.emoji).slice(0, 16) || "💬",
    plan: normalizePlan(peer?.plan),
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
    ["LIVE_ROOM_DIRECT_MUTUAL_REQUIRED", "You can message a member after you follow each other.", 403],
    ["LIVE_ROOM_DIRECT_BLOCKED", "This conversation is unavailable.", 404],
    ["LIVE_ROOM_DIRECT_NOT_FOUND", "This conversation is unavailable.", 404],
    ["LIVE_ROOM_DIRECT_READ_ONLY", "This conversation is read-only until you follow each other again.", 403],
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
