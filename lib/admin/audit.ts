import "server-only";

import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import {
  isAdminRole,
  type AdminRole,
} from "./policy";
import { searchAdminUsers } from "./users";

type Row = Record<string, unknown>;

export type AdminAuditItem = {
  id: string;
  actorUserId: string | null;
  actorName: string | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  createdAt: string;
};

export type AdminRoleAssignmentItem = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: AdminRole;
  active: boolean;
  grantedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listAdminAuditLogs(input: {
  actor?: string;
  action?: string;
  target?: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<AdminAuditItem[]> {
  const limit = Math.max(1, Math.min(input.limit || 100, 250));
  const from = isIsoDate(input.from) ? input.from : "";
  const to = isIsoDate(input.to) ? input.to : "";
  const dateFilter: Record<string, string> = {};
  if (from && to) {
    dateFilter.and = `(created_at.gte.${from},created_at.lte.${to})`;
  } else if (from) {
    dateFilter.created_at = `gte.${from}`;
  } else if (to) {
    dateFilter.created_at = `lte.${to}`;
  }
  const result = await supabaseSelect("admin_audit_logs", {
    select:
      "id,actor_user_id,actor_role,action,target_type,target_id,reason,created_at",
    ...(isUuid(input.actor || "")
      ? { actor_user_id: `eq.${input.actor}` }
      : {}),
    ...(safeTerm(input.action)
      ? { action: `ilike.*${safeTerm(input.action)}*` }
      : {}),
    ...(safeTerm(input.target)
      ? {
          or: `(target_type.ilike.*${safeTerm(input.target)}*,target_id.ilike.*${safeTerm(input.target)}*)`,
        }
      : {}),
    ...dateFilter,
    order: "created_at.desc",
    limit: String(limit),
  });
  if (!result.ok) return [];
  const rows = readRows(result.data);
  const actorIds = [
    ...new Set(rows.map((row) => readString(row.actor_user_id)).filter(isUuid)),
  ];
  const profiles = actorIds.length
    ? await supabaseSelect("live_room_member_profiles", {
        select: "user_id,display_name",
        user_id: `in.(${actorIds.join(",")})`,
        limit: String(actorIds.length),
      })
    : null;
  const names = mapRows(profiles?.data, "user_id");
  return rows.map((row) => {
    const actorUserId = readNullableString(row.actor_user_id);
    return {
      id: readString(row.id),
      actorUserId,
      actorName: actorUserId
        ? readNullableString(names.get(actorUserId)?.display_name)
        : null,
      actorRole: readString(row.actor_role),
      action: readString(row.action),
      targetType: readString(row.target_type),
      targetId: readNullableString(row.target_id),
      reason: readNullableString(row.reason),
      createdAt: readString(row.created_at),
    };
  });
}

export async function listAdminRoleAssignments(
  query = "",
): Promise<AdminRoleAssignmentItem[]> {
  const matchedUsers = query ? await searchAdminUsers(query, 50) : [];
  if (query && !matchedUsers.length) return [];
  const result = await supabaseSelect("admin_role_assignments", {
    select: "id,user_id,role,active,granted_by,created_at,updated_at",
    ...(matchedUsers.length
      ? { user_id: `in.(${matchedUsers.map((user) => user.id).join(",")})` }
      : {}),
    order: "updated_at.desc",
    limit: "250",
  });
  if (!result.ok) return [];
  const rows = readRows(result.data).filter((row) => isAdminRole(row.role));
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((row) => readString(row.user_id)))];
  const [profiles, accounts] = await Promise.all([
    supabaseSelect("live_room_member_profiles", {
      select: "user_id,display_name",
      user_id: `in.(${ids.join(",")})`,
      limit: String(ids.length || 1),
    }),
    supabaseSelect("user_profiles", {
      select: "id,email",
      id: `in.(${ids.join(",")})`,
      limit: String(ids.length || 1),
    }),
  ]);
  const profileMap = mapRows(profiles.data, "user_id");
  const accountMap = mapRows(accounts.data, "id");
  return rows.map((row) => {
    const userId = readString(row.user_id);
    return {
      id: readString(row.id),
      userId,
      email: readString(accountMap.get(userId)?.email) || "Email unavailable",
      displayName:
        readString(profileMap.get(userId)?.display_name) || "Member",
      role: row.role as AdminRole,
      active: row.active === true,
      grantedBy: readNullableString(row.granted_by),
      createdAt: readString(row.created_at),
      updatedAt: readString(row.updated_at),
    };
  });
}

export async function setAdminRoleAssignment(input: {
  actorUserId: string;
  targetUserId: string;
  role: unknown;
  active: unknown;
  reason: unknown;
}) {
  const result = await supabaseRpc("admin_set_role_assignment", {
    p_active: input.active === true,
    p_actor_user_id: input.actorUserId,
    p_reason: readString(input.reason),
    p_role: readString(input.role),
    p_target_user_id: input.targetUserId,
  });
  if (!result.ok) throw new Error(result.error || "ADMIN_ROLE_UPDATE_FAILED");
  return result.data;
}

function safeTerm(value: unknown) {
  return readString(value).replace(/[,*()]/g, " ").trim().slice(0, 100);
}

function isIsoDate(value: unknown) {
  const text = readString(value);
  return Boolean(text && Number.isFinite(Date.parse(text)));
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
