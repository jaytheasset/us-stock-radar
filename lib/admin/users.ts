import "server-only";

import { getServerEnv } from "@/lib/env";
import {
  getEffectivePlanFromSubscription,
  type EffectiveUserPlan,
  type UserPlanSubscriptionRow,
} from "@/lib/subscription/effectivePlan";
import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import { isAdminRole, type AdminRole } from "./policy";

type Row = Record<string, unknown>;

export type AdminUserListItem = {
  id: string;
  email: string;
  displayName: string;
  publicProfileId: string | null;
  createdAt: string;
  plan: EffectiveUserPlan;
  communityStatus: string;
};

export type AdminUserDetail = AdminUserListItem & {
  auth: {
    accountStatus: "active" | "banned" | "unconfirmed" | "unknown";
    createdAt: string | null;
    lastSignInAt: string | null;
  };
  alertSummary: {
    activeTickers: number;
    channels: Array<{
      channel: string;
      enabled: boolean;
      verified: boolean;
    }>;
  };
  brokerage: {
    provider: string | null;
    status: string;
    connected: boolean;
    hasLiveAccount: boolean;
    hasPaperAccount: boolean;
    lastSyncedAt: string | null;
    disconnectedAt: string | null;
    proofCount: number;
    expiredProofCount: number;
    disconnectedProofCount: number;
  };
  community: {
    status: string;
    suspendedUntil: string | null;
    reason: string | null;
    warningCount: number;
    actionCount: number;
  };
  communitySummary: {
    joinedRooms: number;
    followers: number;
    following: number;
    reportsFiled: number;
    reportsReceived: number;
    openCases: number;
  };
  recentRooms: Array<{
    id: string;
    joinedAt: string;
    kind: string;
    label: string;
  }>;
  roles: AdminRole[];
  socialVerifications: Array<{
    platform: string;
    status: string;
    submittedAt: string | null;
    reviewedAt: string | null;
  }>;
};

export async function searchAdminUsers(
  rawQuery: string,
  limit = 25,
): Promise<AdminUserListItem[]> {
  const query = normalizeSearch(rawQuery);
  const cappedLimit = Math.max(1, Math.min(limit, 50));
  const userIds = new Set<string>();

  if (!query) {
    const recent = await supabaseSelect("user_profiles", {
      select: "id",
      order: "created_at.desc",
      limit: String(cappedLimit),
    });
    readRows(recent.data).forEach((row) => userIds.add(readString(row.id)));
  } else {
    const uuidQuery = isUuid(query);
    const safeLike = escapeLikeQuery(query);
    const [accounts, members] = await Promise.all([
      supabaseSelect("user_profiles", {
        select: "id",
        ...(uuidQuery
          ? { or: `(id.eq.${query},email.ilike.*${safeLike}*)` }
          : { email: `ilike.*${safeLike}*` }),
        order: "created_at.desc",
        limit: String(cappedLimit),
      }),
      supabaseSelect("live_room_member_profiles", {
        select: "user_id",
        ...(uuidQuery
          ? {
              or: `(public_profile_id.eq.${query},display_name.ilike.*${safeLike}*)`,
            }
          : { display_name: `ilike.*${safeLike}*` }),
        order: "updated_at.desc",
        limit: String(cappedLimit),
      }),
    ]);
    readRows(accounts.data).forEach((row) => userIds.add(readString(row.id)));
    readRows(members.data).forEach((row) =>
      userIds.add(readString(row.user_id)),
    );
  }

  const ids = [...userIds].filter(isUuid).slice(0, cappedLimit);
  if (!ids.length) return [];
  const [accounts, members, subscriptions, statuses] = await Promise.all([
    supabaseSelect("user_profiles", {
      select: "id,email,created_at",
      id: `in.(${ids.join(",")})`,
      limit: String(ids.length),
    }),
    supabaseSelect("live_room_member_profiles", {
      select: "user_id,display_name,public_profile_id",
      user_id: `in.(${ids.join(",")})`,
      limit: String(ids.length),
    }),
    supabaseSelect("user_plan_subscriptions", {
      select:
        "user_id,plan,status,trial_plan,trial_started_at,trial_ends_at,trial_used_at,trial_cancelled_at",
      user_id: `in.(${ids.join(",")})`,
      limit: String(ids.length),
    }),
    supabaseSelect("user_community_status", {
      select: "user_id,status,suspended_until",
      user_id: `in.(${ids.join(",")})`,
      limit: String(ids.length),
    }),
  ]);
  const accountMap = mapRows(accounts.data, "id");
  const memberMap = mapRows(members.data, "user_id");
  const subscriptionMap = mapRows(subscriptions.data, "user_id");
  const statusMap = mapRows(statuses.data, "user_id");

  return ids
    .flatMap((id): AdminUserListItem[] => {
      const account = accountMap.get(id);
      if (!account) return [];
      const member = memberMap.get(id);
      const status = statusMap.get(id);
      return [
        {
          id,
          email: readString(account.email) || "Email unavailable",
          displayName: readString(member?.display_name) || "Member",
          publicProfileId: readNullableString(member?.public_profile_id),
          createdAt: readString(account.created_at),
          plan: getEffectivePlanFromSubscription(
            subscriptionMap.get(id) as UserPlanSubscriptionRow | undefined,
          ),
          communityStatus: getEffectiveCommunityStatus(status),
        },
      ];
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function getAdminUserDetail(
  userId: string,
): Promise<AdminUserDetail | null> {
  if (!isUuid(userId)) return null;
  const [
    accountResult,
    memberResult,
    subscriptionResult,
    communityResult,
    enforcementResult,
    membershipsResult,
    followersResult,
    followingResult,
    messageReports,
    postReports,
    commentReports,
    directReports,
    receivedCases,
    openCases,
    socialResult,
    channelsResult,
    alertTickersResult,
    brokerageResult,
    proofsResult,
    rolesResult,
    auth,
  ] = await Promise.all([
    supabaseSelect("user_profiles", {
      select: "id,email,created_at",
      id: `eq.${userId}`,
      limit: "1",
    }),
    supabaseSelect("live_room_member_profiles", {
      select: "user_id,display_name,public_profile_id",
      user_id: `eq.${userId}`,
      limit: "1",
    }),
    supabaseSelect("user_plan_subscriptions", {
      select:
        "user_id,plan,status,billing_period_start,billing_period_end,trial_plan,trial_started_at,trial_ends_at,trial_used_at,trial_cancelled_at",
      user_id: `eq.${userId}`,
      limit: "1",
    }),
    supabaseSelect("user_community_status", {
      select: "user_id,status,suspended_until,reason,updated_at",
      user_id: `eq.${userId}`,
      limit: "1",
    }),
    supabaseSelect("user_community_enforcement_actions", {
      select: "id,action,created_at",
      user_id: `eq.${userId}`,
      order: "created_at.desc",
      limit: "100",
    }),
    supabaseSelect("live_room_memberships", {
      select: "room_id,joined_at",
      member_user_id: `eq.${userId}`,
      order: "joined_at.desc",
      limit: "100",
    }),
    countRows(
      "live_room_member_follows",
      {
        followed_user_id: `eq.${userId}`,
      },
      "follower_user_id",
    ),
    countRows(
      "live_room_member_follows",
      {
        follower_user_id: `eq.${userId}`,
      },
      "followed_user_id",
    ),
    countRows("live_room_message_reports", {
      reporter_member_user_id: `eq.${userId}`,
    }),
    countRows("live_room_post_reports", {
      reporter_member_user_id: `eq.${userId}`,
    }),
    countRows("live_room_post_comment_reports", {
      reporter_member_user_id: `eq.${userId}`,
    }),
    countRows("live_room_direct_message_reports", {
      reporter_user_id: `eq.${userId}`,
    }),
    countRows("admin_moderation_cases", {
      "target_snapshot->>author_user_id": `eq.${userId}`,
    }),
    countRows("admin_moderation_cases", {
      "target_snapshot->>author_user_id": `eq.${userId}`,
      status: "in.(open,in_review)",
    }),
    supabaseSelect("live_room_social_verifications", {
      select: "platform,status,submitted_at,reviewed_at",
      member_user_id: `eq.${userId}`,
      order: "created_at.desc",
      limit: "20",
    }),
    supabaseSelect("user_delivery_channels", {
      select: "channel,enabled,verified_at",
      user_id: `eq.${userId}`,
      order: "channel.asc",
      limit: "20",
    }),
    countRows("user_alert_tickers", {
      user_id: `eq.${userId}`,
      enabled: "eq.true",
    }),
    supabaseSelect("brokerage_connections", {
      select:
        "user_id,provider,status,has_live_account,has_paper_account,connected_at,last_synced_at,disconnected_at",
      user_id: `eq.${userId}`,
      limit: "1",
    }),
    supabaseSelect("brokerage_proofs", {
      select: "id",
      owner_user_id: `eq.${userId}`,
      order: "created_at.desc",
      limit: "1000",
    }),
    supabaseSelect("admin_role_assignments", {
      select: "role",
      user_id: `eq.${userId}`,
      active: "eq.true",
      order: "created_at.asc",
      limit: "20",
    }),
    getAuthUserById(userId),
  ]);
  const account = readRows(accountResult.data)[0];
  if (!account) return null;
  const member = readRows(memberResult.data)[0];
  const subscription = readRows(subscriptionResult.data)[0];
  const community = readRows(communityResult.data)[0];
  const enforcement = readRows(enforcementResult.data);
  const memberships = readRows(membershipsResult.data);
  const roomIds = memberships
    .map((row) => readString(row.room_id))
    .filter(isUuid)
    .slice(0, 10);
  const roomDetails = await getRecentRoomDetails(roomIds, memberships);
  const proofIds = readRows(proofsResult.data)
    .map((row) => readString(row.id))
    .filter(isUuid);
  const proofStatuses = proofIds.length
    ? await supabaseSelect("brokerage_proof_status", {
        select: "proof_id,connection_state",
        proof_id: `in.(${proofIds.join(",")})`,
        limit: String(proofIds.length),
      })
    : null;
  const proofStatusRows = readRows(proofStatuses?.data);
  const brokerage = readRows(brokerageResult.data)[0];

  return {
    id: userId,
    email: readString(account.email) || auth?.email || "Email unavailable",
    displayName: readString(member?.display_name) || "Member",
    publicProfileId: readNullableString(member?.public_profile_id),
    createdAt: readString(account.created_at),
    plan: getEffectivePlanFromSubscription(
      subscription as UserPlanSubscriptionRow | undefined,
    ),
    communityStatus: getEffectiveCommunityStatus(community),
    auth: {
      accountStatus: readAuthStatus(auth),
      createdAt: auth?.created_at || null,
      lastSignInAt: auth?.last_sign_in_at || null,
    },
    alertSummary: {
      activeTickers: alertTickersResult,
      channels: readRows(channelsResult.data).map((row) => ({
        channel: readString(row.channel),
        enabled: row.enabled === true,
        verified: Boolean(row.verified_at),
      })),
    },
    brokerage: {
      provider: readNullableString(brokerage?.provider),
      status: readString(brokerage?.status) || "not_connected",
      connected: readString(brokerage?.status) === "connected",
      hasLiveAccount: brokerage?.has_live_account === true,
      hasPaperAccount: brokerage?.has_paper_account === true,
      lastSyncedAt: readNullableString(brokerage?.last_synced_at),
      disconnectedAt: readNullableString(brokerage?.disconnected_at),
      proofCount: proofIds.length,
      expiredProofCount: proofStatusRows.filter(
        (row) => row.connection_state === "expired",
      ).length,
      disconnectedProofCount: proofStatusRows.filter(
        (row) => row.connection_state === "disconnected",
      ).length,
    },
    community: {
      status: getEffectiveCommunityStatus(community),
      suspendedUntil: readNullableString(community?.suspended_until),
      reason: readNullableString(community?.reason),
      warningCount: enforcement.filter((row) => row.action === "warning").length,
      actionCount: enforcement.length,
    },
    communitySummary: {
      joinedRooms: memberships.length,
      followers: followersResult,
      following: followingResult,
      reportsFiled:
        messageReports + postReports + commentReports + directReports,
      reportsReceived: receivedCases,
      openCases,
    },
    recentRooms: roomDetails,
    roles: readRows(rolesResult.data)
      .map((row) => row.role)
      .filter(isAdminRole),
    socialVerifications: readRows(socialResult.data).map((row) => ({
      platform: readString(row.platform),
      status: readString(row.status),
      submittedAt: readNullableString(row.submitted_at),
      reviewedAt: readNullableString(row.reviewed_at),
    })),
  };
}

export async function applyAdminUserCommunityAction(input: {
  actorUserId: string;
  targetUserId: string;
  action: unknown;
  reason: unknown;
  expiresAt?: unknown;
}) {
  const action = readString(input.action);
  if (
    action !== "temporary_suspend" &&
    action !== "permanent_suspend" &&
    action !== "unsuspend"
  ) {
    throw new Error("ADMIN_USER_ACTION_UNSUPPORTED");
  }
  const reason = readString(input.reason);
  const expiresAt = readNullableString(input.expiresAt);
  const result = await supabaseRpc("admin_apply_user_community_action", {
    p_action: action,
    p_actor_user_id: input.actorUserId,
    p_expires_at: expiresAt,
    p_reason: reason,
    p_target_user_id: input.targetUserId,
  });
  if (!result.ok) {
    throw new Error(result.error || "ADMIN_USER_ACTION_FAILED");
  }
  return readRows(result.data)[0] || result.data;
}

async function getRecentRoomDetails(
  roomIds: string[],
  memberships: Row[],
) {
  if (!roomIds.length) return [];
  const [rooms, communities] = await Promise.all([
    supabaseSelect("live_room_rooms", {
      select: "id,room_kind,ticker",
      id: `in.(${roomIds.join(",")})`,
      limit: String(roomIds.length),
    }),
    supabaseSelect("live_room_community_rooms", {
      select: "room_id,name",
      room_id: `in.(${roomIds.join(",")})`,
      limit: String(roomIds.length),
    }),
  ]);
  const roomMap = mapRows(rooms.data, "id");
  const communityMap = mapRows(communities.data, "room_id");
  const membershipMap = mapRows(memberships, "room_id");
  return roomIds.flatMap((id) => {
    const room = roomMap.get(id);
    if (!room) return [];
    const kind = readString(room.room_kind);
    return [
      {
        id,
        joinedAt: readString(membershipMap.get(id)?.joined_at),
        kind,
        label:
          kind === "company"
            ? `${readString(room.ticker)} Live Room`
            : readString(communityMap.get(id)?.name) || "Community room",
      },
    ];
  });
}

async function countRows(
  table: string,
  search: Record<string, string>,
  select = "id",
): Promise<number> {
  const result = await supabaseSelect(table, {
    select,
    ...search,
    limit: "1",
  });
  return result.ok ? result.count ?? readRows(result.data).length : 0;
}

async function getAuthUserById(userId: string) {
  const env = getServerEnv();
  const baseUrl = env.supabaseUrl
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/$/, "");
  const key = env.supabaseServiceRoleKey;
  if (!baseUrl || !key) return null;
  try {
    const response = await fetch(`${baseUrl}/auth/v1/admin/users/${userId}`, {
      cache: "no-store",
      headers: {
        apikey: key,
        Accept: "application/json",
        ...(key.startsWith("sb_secret_")
          ? {}
          : { Authorization: `Bearer ${key}` }),
      },
    });
    if (!response.ok) return null;
    return (await response.json()) as {
      email?: string;
      created_at?: string;
      last_sign_in_at?: string;
      confirmed_at?: string;
      banned_until?: string;
    };
  } catch {
    return null;
  }
}

function readAuthStatus(
  user: Awaited<ReturnType<typeof getAuthUserById>>,
): AdminUserDetail["auth"]["accountStatus"] {
  if (!user) return "unknown";
  if (user.banned_until && Date.parse(user.banned_until) > Date.now()) {
    return "banned";
  }
  return user.confirmed_at ? "active" : "unconfirmed";
}

function getEffectiveCommunityStatus(row?: Row) {
  const status = readString(row?.status);
  if (
    status === "temporarily_suspended" &&
    Date.parse(readString(row?.suspended_until)) <= Date.now()
  ) {
    return "active";
  }
  return status || "active";
}

function mapRows(value: unknown, key: string) {
  return new Map(
    readRows(value)
      .map((row) => [readString(row[key]), row] as const)
      .filter(([id]) => Boolean(id)),
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

function normalizeSearch(value: string) {
  return value.trim().slice(0, 100);
}

function escapeLikeQuery(value: string) {
  return value.replace(/[,*()]/g, " ").replace(/\s+/g, " ").trim();
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
