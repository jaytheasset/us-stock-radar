import "server-only";

import { supabaseRpc, supabaseSelect } from "@/lib/supabase";
import {
  normalizePublicRequestId,
  normalizeSocialHandle,
  normalizeSocialPlatform,
  normalizeSocialUrl,
  SocialVerificationError,
  socialBadgeLabel,
} from "./policy";
import { createSocialProofCode } from "./proofCode";
import type {
  LiveRoomSocialBadge,
  SocialVerificationPlatform,
  SocialVerificationRequest,
  SocialVerificationReview,
  SocialVerificationStatus,
} from "./types";

type DataRow = Record<string, unknown>;

export async function listOwnSocialVerifications(userId: string) {
  const result = await supabaseSelect("live_room_social_verifications", {
    select:
      "public_request_id,platform,normalized_handle,profile_url,proof_code,proof_url,status,show_on_profile,submitted_at,expires_at,review_note,created_at",
    member_user_id: `eq.${userId}`,
    order: "created_at.desc",
    limit: "20",
  });
  if (!result.ok) throw repositoryError(result.error, result.status);
  return readRows(result.data).map(mapRequest);
}

export async function createSocialVerificationRequest({
  handle,
  platform: rawPlatform,
  profileUrl: rawProfileUrl,
  userId,
}: {
  handle: unknown;
  platform: unknown;
  profileUrl: unknown;
  userId: string;
}) {
  const platform = normalizeSocialPlatform(rawPlatform);
  const normalizedHandle = normalizeSocialHandle(handle);
  const profileUrl = normalizeSocialUrl(rawProfileUrl, platform, "profile");
  const result = await supabaseRpc(
    "create_live_room_social_verification",
    {
      p_member_user_id: userId,
      p_normalized_handle: normalizedHandle,
      p_platform: platform,
      p_profile_url: profileUrl,
      p_proof_code: createSocialProofCode(),
    },
  );
  return mapRpcRequest(result);
}

export async function mutateSocialVerificationRequest({
  action,
  proofUrl: rawProofUrl,
  publicRequestId: rawId,
  showOnProfile,
  userId,
}: {
  action: unknown;
  proofUrl?: unknown;
  publicRequestId: unknown;
  showOnProfile?: unknown;
  userId: string;
}) {
  const publicRequestId = normalizePublicRequestId(rawId);
  const allowedActions = new Set([
    "save_proof",
    "submit_review",
    "reissue_code",
    "set_visibility",
    "cancel",
  ]);
  if (typeof action !== "string" || !allowedActions.has(action)) {
    throw new SocialVerificationError(
      "SOCIAL_VERIFICATION_INVALID_ACTION",
      "That verification action is not available.",
    );
  }

  let proofUrl: string | null = null;
  if (action === "save_proof") {
    const current = await getOwnedRequestPlatform(userId, publicRequestId);
    proofUrl = normalizeSocialUrl(rawProofUrl, current, "proof");
  }
  if (
    action === "set_visibility" &&
    typeof showOnProfile !== "boolean"
  ) {
    throw new SocialVerificationError(
      "SOCIAL_VERIFICATION_INVALID_VISIBILITY",
      "Choose whether the verified account appears on your profile.",
    );
  }

  const result = await supabaseRpc(
    "mutate_live_room_social_verification",
    {
      p_action: action,
      p_member_user_id: userId,
      p_proof_code:
        action === "reissue_code" ? createSocialProofCode() : null,
      p_proof_url: proofUrl,
      p_public_request_id: publicRequestId,
      p_show_on_profile:
        action === "set_visibility" ? showOnProfile : null,
    },
  );
  return mapRpcRequest(result);
}

export async function isSocialVerificationAdmin(userId: string) {
  const result = await supabaseSelect("live_room_moderators", {
    select: "user_id",
    user_id: `eq.${userId}`,
    role: "eq.admin",
    active: "eq.true",
    limit: "1",
  });
  return result.ok && readRows(result.data).length === 1;
}

export async function assertSocialVerificationAdmin(userId: string) {
  if (!(await isSocialVerificationAdmin(userId))) {
    throw new SocialVerificationError(
      "SOCIAL_VERIFICATION_ADMIN_REQUIRED",
      "Administrator access is required.",
      403,
    );
  }
}

export async function listSocialVerificationReviews({
  cursor,
  limit,
  userId,
}: {
  cursor?: string | null;
  limit?: number;
  userId: string;
}) {
  await assertSocialVerificationAdmin(userId);
  const decoded = decodeReviewCursor(cursor);
  const result = await supabaseRpc(
    "list_live_room_social_verification_reviews",
    {
      p_admin_user_id: userId,
      p_cursor_public_request_id: decoded?.publicRequestId || null,
      p_cursor_submitted_at: decoded?.submittedAt || null,
      p_limit: Math.min(Math.max(Number(limit) || 25, 1), 50),
    },
  );
  if (!result.ok) throw repositoryError(result.error, result.status);
  const rows = readRows(result.data);
  const items = rows.map(mapReview);
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      rows.length >= Math.min(Math.max(Number(limit) || 25, 1), 50) && last
        ? encodeReviewCursor(last)
        : null,
  };
}

export async function reviewSocialVerification({
  decision,
  note,
  publicRequestId: rawId,
  userId,
}: {
  decision: unknown;
  note?: unknown;
  publicRequestId: unknown;
  userId: string;
}) {
  await assertSocialVerificationAdmin(userId);
  const publicRequestId = normalizePublicRequestId(rawId);
  if (decision !== "approve" && decision !== "reject") {
    throw new SocialVerificationError(
      "SOCIAL_VERIFICATION_INVALID_DECISION",
      "Choose approve or reject.",
    );
  }
  const reviewNote =
    typeof note === "string" ? note.trim().slice(0, 240) : "";
  if (decision === "reject" && !reviewNote) {
    throw new SocialVerificationError(
      "SOCIAL_VERIFICATION_REVIEW_NOTE_REQUIRED",
      "Add a short reason before rejecting.",
    );
  }
  const result = await supabaseRpc(
    "review_live_room_social_verification",
    {
      p_admin_user_id: userId,
      p_decision: decision,
      p_public_request_id: publicRequestId,
      p_review_note: reviewNote || null,
    },
  );
  return mapRpcRequest(result);
}

export async function getLiveRoomSocialBadgeMap({
  actor,
  messageIds,
}: {
  actor:
    | { kind: "member"; userId: string }
    | { kind: "guest"; guestSessionId: string };
  messageIds: string[];
}) {
  const boundedIds = [...new Set(messageIds)].slice(0, 50);
  if (!boundedIds.length) return new Map<string, LiveRoomSocialBadge[]>();
  const result = await supabaseRpc("get_live_room_social_badges", {
    p_actor_kind: actor.kind,
    p_guest_session_id:
      actor.kind === "guest" ? actor.guestSessionId : null,
    p_member_user_id: actor.kind === "member" ? actor.userId : null,
    p_message_ids: boundedIds,
  });
  if (!result.ok) throw repositoryError(result.error, result.status);
  const map = new Map<string, LiveRoomSocialBadge[]>();
  for (const row of readRows(result.data)) {
    const messageId = readString(row.message_id);
    const platform = readPlatform(row.platform);
    const profileUrl = readString(row.profile_url);
    if (!messageId || !platform || !profileUrl) continue;
    const badges = map.get(messageId) || [];
    badges.push({
      label: socialBadgeLabel(platform),
      platform,
      profileUrl,
    });
    map.set(messageId, badges);
  }
  return map;
}

async function getOwnedRequestPlatform(
  userId: string,
  publicRequestId: string,
) {
  const result = await supabaseSelect("live_room_social_verifications", {
    select: "platform",
    member_user_id: `eq.${userId}`,
    public_request_id: `eq.${publicRequestId}`,
    limit: "1",
  });
  const platform = readPlatform(readRows(result.data)[0]?.platform);
  if (!result.ok || !platform) {
    throw new SocialVerificationError(
      "SOCIAL_VERIFICATION_NOT_FOUND",
      "That verification request was not found.",
      404,
    );
  }
  return platform;
}

function mapRpcRequest(result: {
  ok: boolean;
  data: unknown;
  error?: string;
  status: number;
}) {
  if (!result.ok) throw repositoryError(result.error, result.status);
  const row = readRows(result.data)[0];
  if (!row) throw repositoryError(undefined, 502);
  return mapRequest(row);
}

function mapRequest(row: DataRow): SocialVerificationRequest {
  const platform = readPlatform(row.platform);
  const rawStatus = readString(row.status);
  const expiresAt = readNullableString(row.expires_at);
  const isExpired =
    ["draft", "proof_ready", "pending_review"].includes(rawStatus) &&
    Boolean(expiresAt) &&
    new Date(expiresAt || 0).getTime() <= Date.now();
  return {
    expiresAt,
    normalizedHandle: readString(row.normalized_handle),
    platform: platform || "x",
    profileUrl: readString(row.profile_url),
    proofCode: readString(row.proof_code),
    proofUrl: readNullableString(row.proof_url),
    publicRequestId: readString(row.public_request_id),
    reviewNote: readNullableString(row.review_note),
    showOnProfile: row.show_on_profile === true,
    status: (isExpired ? "expired" : rawStatus) as SocialVerificationStatus,
    submittedAt: readNullableString(row.submitted_at),
  };
}

function mapReview(row: DataRow): SocialVerificationReview {
  return {
    applicantDisplayName:
      readString(row.applicant_display_name) || "Member",
    applicantEmoji: readString(row.applicant_emoji) || "•",
    expiresAt: readString(row.expires_at),
    normalizedHandle: readString(row.normalized_handle),
    platform: readPlatform(row.platform) || "x",
    profileUrl: readString(row.profile_url),
    proofCode: readString(row.proof_code),
    proofUrl: readString(row.proof_url),
    publicRequestId: readString(row.public_request_id),
    submittedAt: readString(row.submitted_at),
  };
}

function repositoryError(error?: string, status = 500) {
  const value = error || "";
  const known = [
    "SOCIAL_VERIFICATION_MEMBER_REQUIRED",
    "SOCIAL_VERIFICATION_INVALID_PLATFORM",
    "SOCIAL_VERIFICATION_ACTIVE_REQUEST_EXISTS",
    "SOCIAL_VERIFICATION_CODE_RATE_LIMIT",
    "SOCIAL_VERIFICATION_CONFLICT",
    "SOCIAL_VERIFICATION_NOT_FOUND",
    "SOCIAL_VERIFICATION_INVALID_TRANSITION",
    "SOCIAL_VERIFICATION_PROOF_REQUIRED",
    "SOCIAL_VERIFICATION_INVALID_ACTION",
    "SOCIAL_VERIFICATION_ADMIN_REQUIRED",
    "SOCIAL_VERIFICATION_ALREADY_REVIEWED",
    "SOCIAL_VERIFICATION_EXPIRED",
    "SOCIAL_VERIFICATION_REVIEW_NOTE_REQUIRED",
    "SOCIAL_VERIFICATION_HANDLE_CONFLICT",
  ].find((code) => value.includes(code));
  const messages: Record<string, string> = {
    SOCIAL_VERIFICATION_ACTIVE_REQUEST_EXISTS:
      "You already have an active request for this platform.",
    SOCIAL_VERIFICATION_ADMIN_REQUIRED:
      "Administrator access is required.",
    SOCIAL_VERIFICATION_ALREADY_REVIEWED:
      "This request has already been reviewed.",
    SOCIAL_VERIFICATION_CODE_RATE_LIMIT:
      "Please wait before requesting another proof code.",
    SOCIAL_VERIFICATION_CONFLICT:
      "This social account is already in an active verification flow.",
    SOCIAL_VERIFICATION_EXPIRED:
      "This proof code has expired. Start a new request.",
    SOCIAL_VERIFICATION_HANDLE_CONFLICT:
      "This handle is already pending or verified.",
    SOCIAL_VERIFICATION_INVALID_TRANSITION:
      "This request cannot be changed in its current state.",
    SOCIAL_VERIFICATION_NOT_FOUND:
      "That verification request was not found.",
    SOCIAL_VERIFICATION_PROOF_REQUIRED:
      "Save a valid public proof URL first.",
    SOCIAL_VERIFICATION_REVIEW_NOTE_REQUIRED:
      "Add a short reason before rejecting.",
  };
  if (known) {
    return new SocialVerificationError(
      known,
      messages[known] || "That verification action is not available.",
      known.endsWith("REQUIRED") ? 403 : known.endsWith("NOT_FOUND") ? 404 : 409,
    );
  }
  return new SocialVerificationError(
    "SOCIAL_VERIFICATION_UNAVAILABLE",
    "Social account verification is temporarily unavailable.",
    status || 500,
  );
}

function encodeReviewCursor(review: SocialVerificationReview) {
  return Buffer.from(
    JSON.stringify({
      publicRequestId: review.publicRequestId,
      submittedAt: review.submittedAt,
    }),
  ).toString("base64url");
}

function decodeReviewCursor(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as { publicRequestId?: unknown; submittedAt?: unknown };
    return {
      publicRequestId: normalizePublicRequestId(parsed.publicRequestId),
      submittedAt: new Date(String(parsed.submittedAt)).toISOString(),
    };
  } catch {
    throw new SocialVerificationError(
      "SOCIAL_VERIFICATION_INVALID_CURSOR",
      "That review cursor is invalid.",
    );
  }
}

function readRows(value: unknown): DataRow[] {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is DataRow => Boolean(row) && typeof row === "object",
    );
  }
  return value && typeof value === "object" ? [value as DataRow] : [];
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown) {
  const string = readString(value);
  return string || null;
}

function readPlatform(value: unknown): SocialVerificationPlatform | null {
  return value === "x" || value === "youtube" || value === "instagram"
    ? value
    : null;
}
