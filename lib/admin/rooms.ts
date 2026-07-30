import "server-only";

import { supabaseRpc } from "@/lib/supabase";

type Row = Record<string, unknown>;

export type AdminRoomStatus = "active" | "archived" | "locked";
export type AdminRoomKind = "company" | "community";

export type AdminRoomSummary = {
  id: string;
  kind: AdminRoomKind;
  ticker: string | null;
  slug: string | null;
  name: string;
  ownerUserId: string | null;
  ownerName: string;
  status: AdminRoomStatus;
  statusUpdatedAt: string | null;
  memberCount: number;
  onlineCount: number;
  messageCount: number;
  postCount: number;
  reportCount: number;
  lastActivityAt: string;
};

export type AdminRoomContentItem = {
  id: string;
  authorDisplayName: string;
  body: string;
  createdAt: string;
  moderationReason: string | null;
  title: string | null;
  visibilityStatus: string;
};

export type AdminRoomDetail = {
  summary: AdminRoomSummary & {
    createdAt: string;
    hiddenMessageCount: number;
    hiddenPostCount: number;
    statusReason: string | null;
    description: string | null;
  };
  messages: AdminRoomContentItem[];
  posts: AdminRoomContentItem[];
};

export async function listAdminRooms(input: {
  actorUserId: string;
  kind?: unknown;
  limit?: number;
  search?: unknown;
  status?: unknown;
}): Promise<AdminRoomSummary[]> {
  const result = await supabaseRpc("admin_list_live_rooms", {
    p_actor_user_id: input.actorUserId,
    p_kind: readChoice(input.kind, ["company", "community"]),
    p_limit: Math.max(1, Math.min(input.limit || 50, 100)),
    p_search: readText(input.search).slice(0, 100) || null,
    p_status: readChoice(input.status, ["active", "locked", "archived"]),
  });
  if (!result.ok) throw new Error(result.error || "ADMIN_ROOMS_UNAVAILABLE");
  const payload = readRecord(result.data);
  return readRows(payload?.items).map(mapRoomSummary).filter(isDefined);
}

export async function getAdminRoomDetail(
  actorUserId: string,
  roomId: string,
): Promise<AdminRoomDetail | null> {
  if (!isUuid(roomId)) return null;
  const result = await supabaseRpc("admin_get_live_room_detail", {
    p_actor_user_id: actorUserId,
    p_room_id: roomId,
  });
  if (!result.ok) {
    if (String(result.error || "").includes("ADMIN_ROOM_NOT_FOUND")) {
      return null;
    }
    throw new Error(result.error || "ADMIN_ROOM_DETAIL_UNAVAILABLE");
  }
  const payload = readRecord(result.data);
  const rawSummary = readRecord(payload?.summary);
  const summary = mapRoomSummary(rawSummary);
  if (!summary || !rawSummary) return null;
  return {
    summary: {
      ...summary,
      createdAt: readText(rawSummary.createdAt ?? rawSummary.created_at),
      description:
        readText(rawSummary.summary ?? rawSummary.description) || null,
      hiddenMessageCount: readCount(
        rawSummary.hiddenMessageCount ?? rawSummary.hidden_message_count,
      ),
      hiddenPostCount: readCount(
        rawSummary.hiddenPostCount ?? rawSummary.hidden_post_count,
      ),
      statusReason:
        readText(rawSummary.statusReason ?? rawSummary.status_reason) || null,
    },
    messages: readRows(payload?.messages)
      .map((row) => mapContent(row, false))
      .filter(isDefined),
    posts: readRows(payload?.posts)
      .map((row) => mapContent(row, true))
      .filter(isDefined),
  };
}

export async function setAdminRoomStatus(input: {
  action: unknown;
  actorUserId: string;
  reason: unknown;
  requestId: string;
  roomId: string;
}) {
  if (!isUuid(input.roomId)) throw new Error("ADMIN_ROOM_NOT_FOUND");
  const result = await supabaseRpc("admin_set_live_room_status", {
    p_action: readText(input.action),
    p_actor_user_id: input.actorUserId,
    p_reason: readText(input.reason),
    p_request_id: input.requestId,
    p_room_id: input.roomId,
  });
  if (!result.ok) throw new Error(result.error || "ADMIN_ROOM_UPDATE_FAILED");
  return result.data;
}

function mapRoomSummary(value: unknown): AdminRoomSummary | null {
  const row = readRecord(value);
  if (!row) return null;
  const id = readText(row.id);
  const kind = readText(row.kind ?? row.room_kind);
  const status = readText(row.status ?? row.admin_status);
  if (
    !isUuid(id) ||
    (kind !== "company" && kind !== "community") ||
    (status !== "active" && status !== "locked" && status !== "archived")
  ) {
    return null;
  }
  return {
    id,
    kind,
    lastActivityAt: readText(
      row.lastActivityAt ?? row.last_activity_at,
    ),
    memberCount: readCount(row.memberCount ?? row.member_count),
    messageCount: readCount(row.messageCount ?? row.message_count),
    name: readText(row.name ?? row.room_name) || "Live Room",
    onlineCount: readCount(row.onlineCount ?? row.online_count),
    ownerName: readText(row.ownerName ?? row.owner_name) || "Stock Radar",
    ownerUserId:
      readText(row.ownerUserId ?? row.owner_user_id) || null,
    postCount: readCount(row.postCount ?? row.post_count),
    reportCount: readCount(row.reportCount ?? row.report_count),
    slug: readText(row.slug) || null,
    status,
    statusUpdatedAt:
      readText(row.statusUpdatedAt ?? row.admin_status_updated_at) || null,
    ticker: readText(row.ticker) || null,
  };
}

function mapContent(
  row: Row,
  post: boolean,
): AdminRoomContentItem | null {
  const id = readText(row.id);
  if (!isUuid(id)) return null;
  return {
    authorDisplayName:
      readText(row.authorDisplayName ?? row.author_display_name) || "Member",
    body: readText(row.body),
    createdAt: readText(row.createdAt ?? row.created_at),
    id,
    moderationReason:
      readText(row.moderationReason ?? row.moderation_reason) || null,
    title: post ? readText(row.title) || "Untitled post" : null,
    visibilityStatus:
      readText(row.visibilityStatus ?? row.visibility_status) || "visible",
  };
}

function readRecord(value: unknown): Row | null {
  if (Array.isArray(value)) return readRecord(value[0]);
  return value && typeof value === "object"
    ? (value as Row)
    : null;
}

function readRows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Row =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function readText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function readChoice(value: unknown, choices: readonly string[]) {
  const text = readText(value);
  return choices.includes(text) ? text : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isDefined<T>(value: T | null): value is T {
  return value !== null;
}
