import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { supabaseSelect } from "@/lib/supabase";
import {
  isAdminRole,
  rolesHavePermission,
  type AdminPermission,
  type AdminRole,
} from "./policy";

type DataRow = Record<string, unknown>;

export type AdminAccess = {
  userId: string;
  roles: AdminRole[];
};

function rows(value: unknown): DataRow[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is DataRow =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

async function readAdminAccessForUser(
  userId: string,
): Promise<AdminAccess | null> {
  const roleResult = await supabaseSelect("admin_role_assignments", {
    select: "role",
    user_id: `eq.${userId}`,
    active: "eq.true",
    order: "created_at.asc",
    limit: "20",
  });

  if (roleResult.ok) {
    const roles = [
      ...new Set(
        rows(roleResult.data)
          .map((row) => row.role)
          .filter(isAdminRole),
      ),
    ];
    return roles.length ? { userId, roles } : null;
  }

  // Deployment-safe bridge while the RBAC migration rolls out. Only legacy
  // active admins receive access; legacy moderators never gain admin rights.
  const legacyResult = await supabaseSelect("live_room_moderators", {
    select: "user_id",
    user_id: `eq.${userId}`,
    role: "eq.admin",
    active: "eq.true",
    limit: "1",
  });
  return legacyResult.ok && rows(legacyResult.data).length === 1
    ? { userId, roles: ["super_admin"] }
    : null;
}

export const getAdminAccessForUser = cache(readAdminAccessForUser);

const getRequiredAdminAccess = cache(async (): Promise<AdminAccess> => {
  const userId = await getOptionalCurrentUserId();
  if (!userId) redirect("/login?next=%2Fadmin");

  const access = await getAdminAccessForUser(userId);
  if (!access) redirect("/");
  return access;
});

export async function requireAdminPageAccess(): Promise<AdminAccess> {
  return getRequiredAdminAccess();
}

export async function requireAdminPermission(
  permission: AdminPermission,
): Promise<AdminAccess> {
  const access = await requireAdminPageAccess();
  if (!rolesHavePermission(access.roles, permission)) redirect("/admin");
  return access;
}

export async function userHasAdminPermission(
  userId: string,
  permission: AdminPermission,
) {
  const access = await getAdminAccessForUser(userId);
  return Boolean(access && rolesHavePermission(access.roles, permission));
}
