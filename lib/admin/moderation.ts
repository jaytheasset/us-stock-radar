import "server-only";

import { supabaseRpc, supabaseSelect } from "@/lib/supabase";

type Row = Record<string, unknown>;

export type AdminModerationCase = {
  id: string;
  reportType: string;
  reportId: string;
  reportReason: string;
  status: string;
  severity: string;
  assignedTo: string | null;
  assigneeName: string | null;
  targetType: string;
  targetId: string;
  targetSnapshot: Record<string, unknown>;
  resolutionAction: string | null;
  resolutionReason: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
};

export async function listAdminModerationCases(input: {
  status?: string;
  severity?: string;
  type?: string;
  limit?: number;
}): Promise<AdminModerationCase[]> {
  const limit = Math.max(1, Math.min(input.limit || 100, 200));
  const result = await supabaseSelect("admin_moderation_cases", {
    select:
      "id,report_type,report_id,status,severity,assigned_to,target_type,target_id,target_snapshot,resolution_action,resolution_reason,created_at,updated_at,resolved_at",
    ...(isQueueStatus(input.status) ? { status: `eq.${input.status}` } : {}),
    ...(isSeverity(input.severity)
      ? { severity: `eq.${input.severity}` }
      : {}),
    ...(isReportType(input.type)
      ? { report_type: `eq.${input.type}` }
      : {}),
    order: "created_at.desc",
    limit: String(limit),
  });
  if (!result.ok) return [];
  return hydrateCases(readRows(result.data));
}

export async function getAdminModerationCase(
  caseId: string,
): Promise<{
  item: AdminModerationCase;
  events: Array<{
    id: string;
    action: string;
    actorUserId: string | null;
    actorName: string | null;
    actorRole: string;
    reason: string;
    createdAt: string;
  }>;
} | null> {
  if (!isUuid(caseId)) return null;
  const [caseResult, eventResult] = await Promise.all([
    supabaseSelect("admin_moderation_cases", {
      select:
        "id,report_type,report_id,status,severity,assigned_to,target_type,target_id,target_snapshot,resolution_action,resolution_reason,created_at,updated_at,resolved_at",
      id: `eq.${caseId}`,
      limit: "1",
    }),
    supabaseSelect("admin_moderation_case_events", {
      select: "id,actor_user_id,actor_role,action,reason,created_at",
      case_id: `eq.${caseId}`,
      order: "created_at.desc",
      limit: "100",
    }),
  ]);
  const [item] = await hydrateCases(readRows(caseResult.data));
  if (!item) return null;
  const eventRows = readRows(eventResult.data);
  const actorIds = [
    ...new Set(
      eventRows.map((row) => readString(row.actor_user_id)).filter(isUuid),
    ),
  ];
  const profiles = actorIds.length
    ? await supabaseSelect("live_room_member_profiles", {
        select: "user_id,display_name",
        user_id: `in.(${actorIds.join(",")})`,
        limit: String(actorIds.length),
      })
    : null;
  const names = mapRows(profiles?.data, "user_id");
  return {
    item,
    events: eventRows.map((row) => ({
      id: readString(row.id),
      action: readString(row.action),
      actorUserId: readNullableString(row.actor_user_id),
      actorName:
        readNullableString(names.get(readString(row.actor_user_id))?.display_name) ||
        null,
      actorRole: readString(row.actor_role),
      reason: readString(row.reason),
      createdAt: readString(row.created_at),
    })),
  };
}

export async function updateAdminModerationCase(input: {
  actorUserId: string;
  caseId: string;
  action: unknown;
  reason: unknown;
  status?: unknown;
  severity?: unknown;
  assignedTo?: unknown;
  suspendUntil?: unknown;
}) {
  const result = await supabaseRpc("admin_update_moderation_case", {
    p_action: readString(input.action),
    p_actor_user_id: input.actorUserId,
    p_assigned_to: readNullableString(input.assignedTo),
    p_case_id: input.caseId,
    p_reason: readString(input.reason),
    p_severity: readNullableString(input.severity),
    p_status: readNullableString(input.status),
    p_suspend_until: readNullableString(input.suspendUntil),
  });
  if (!result.ok) throw new Error(result.error || "ADMIN_MODERATION_UPDATE_FAILED");
  return result.data;
}

async function hydrateCases(rows: Row[]): Promise<AdminModerationCase[]> {
  if (!rows.length) return [];
  const assigneeIds = [
    ...new Set(rows.map((row) => readString(row.assigned_to)).filter(isUuid)),
  ];
  const [
    profiles,
    messageReasons,
    postReasons,
    commentReasons,
    directMessageReasons,
  ] = await Promise.all([
    assigneeIds.length
      ? supabaseSelect("live_room_member_profiles", {
          select: "user_id,display_name",
          user_id: `in.(${assigneeIds.join(",")})`,
          limit: String(assigneeIds.length),
        })
      : Promise.resolve(null),
    getReportReasons(rows, "message", "live_room_message_reports"),
    getReportReasons(rows, "post", "live_room_post_reports"),
    getReportReasons(rows, "comment", "live_room_post_comment_reports"),
    getReportReasons(
      rows,
      "direct_message",
      "live_room_direct_message_reports",
    ),
  ]);
  const names = mapRows(profiles?.data, "user_id");
  const reasonMap = new Map(
    [
      messageReasons,
      postReasons,
      commentReasons,
      directMessageReasons,
    ].flatMap((result) => [...result.entries()]),
  );
  return rows.map((row) => {
    const assignedTo = readNullableString(row.assigned_to);
    return {
      id: readString(row.id),
      reportType: readString(row.report_type),
      reportId: readString(row.report_id),
      reportReason: reasonMap.get(readString(row.report_id)) || "unspecified",
      status: readString(row.status),
      severity: readString(row.severity),
      assignedTo,
      assigneeName: assignedTo
        ? readNullableString(names.get(assignedTo)?.display_name)
        : null,
      targetType: readString(row.target_type),
      targetId: readString(row.target_id),
      targetSnapshot: readObject(row.target_snapshot),
      resolutionAction: readNullableString(row.resolution_action),
      resolutionReason: readNullableString(row.resolution_reason),
      createdAt: readString(row.created_at),
      updatedAt: readString(row.updated_at),
      resolvedAt: readNullableString(row.resolved_at),
    };
  });
}

async function getReportReasons(
  rows: Row[],
  reportType: string,
  table: string,
) {
  const ids = rows
    .filter((row) => row.report_type === reportType)
    .map((row) => readString(row.report_id))
    .filter(isUuid);
  if (!ids.length) return new Map<string, string>();
  const result = await supabaseSelect(table, {
    select: "id,reason",
    id: `in.(${ids.join(",")})`,
    limit: String(ids.length),
  });
  return new Map(
    readRows(result.data).map(
      (row) => [readString(row.id), readString(row.reason)] as const,
    ),
  );
}

function isQueueStatus(value: unknown) {
  return (
    value === "open" ||
    value === "in_review" ||
    value === "resolved" ||
    value === "dismissed"
  );
}

function isSeverity(value: unknown) {
  return (
    value === "low" ||
    value === "normal" ||
    value === "high" ||
    value === "critical"
  );
}

function isReportType(value: unknown) {
  return (
    value === "message" ||
    value === "post" ||
    value === "comment" ||
    value === "direct_message"
  );
}

function readRows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Row =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function mapRows(value: unknown, key: string) {
  return new Map(
    readRows(value).map((row) => [readString(row[key]), row] as const),
  );
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(value: unknown) {
  const result = readString(value);
  return result || null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
