import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import {
  AUTH_ACCESS_COOKIE,
  AUTH_REFRESH_COOKIE,
  clearAuthSessionCookies,
  setAuthSessionCookies,
} from "@/lib/auth/authCookies";
import { resolveAuthSession } from "@/lib/auth/sessionResolution";
import { rolesHavePermission, type AdminPermission } from "./policy";
import { getAdminAccessForUser } from "./server";

export class AdminApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export async function resolveAdminApiAccess(
  request: NextRequest,
  permission: AdminPermission,
) {
  const auth = await resolveAuthSession({
    accessToken: request.cookies.get(AUTH_ACCESS_COOKIE)?.value || "",
    refreshToken: request.cookies.get(AUTH_REFRESH_COOKIE)?.value || "",
  });
  const userId = auth.user?.id;
  if (!userId) {
    throw new AdminApiError(
      "ADMIN_AUTH_REQUIRED",
      "Administrator sign-in is required.",
      401,
    );
  }
  const access = await getAdminAccessForUser(userId);
  if (!access || !rolesHavePermission(access.roles, permission)) {
    throw new AdminApiError(
      "ADMIN_PERMISSION_REQUIRED",
      "Your administrator role does not allow this action.",
      403,
    );
  }
  return { access, auth };
}

export function applyAdminAuthCookies(
  response: NextResponse,
  resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>>,
) {
  if (resolution.auth.refreshedSession?.access_token) {
    setAuthSessionCookies(response, {
      accessToken: resolution.auth.refreshedSession.access_token,
      refreshToken: resolution.auth.refreshedSession.refresh_token,
      expiresIn: resolution.auth.refreshedSession.expires_in,
    });
  } else if (resolution.auth.shouldClearCookies) {
    clearAuthSessionCookies(response);
  }
}

export function normalizeAdminError(error: unknown) {
  if (error instanceof AdminApiError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
    };
  }
  const message = error instanceof Error ? error.message : "";
  const known = [
    "ADMIN_ASSIGNEE_INVALID",
    "ADMIN_COMMUNITY_ACTION_INVALID",
    "ADMIN_DIRECT_MESSAGE_VISIBILITY_UNSUPPORTED",
    "ADMIN_LAST_SUPER_ADMIN_REQUIRED",
    "ADMIN_MODERATION_CASE_NOT_FOUND",
    "ADMIN_MODERATION_MEMBER_TARGET_REQUIRED",
    "ADMIN_MODERATION_TARGET_NOT_MUTABLE",
    "ADMIN_REASON_REQUIRED",
    "ADMIN_ROLE_INVALID",
    "ADMIN_ROOM_ACTION_INVALID",
    "ADMIN_ROOM_FILTER_INVALID",
    "ADMIN_ROOM_NOT_FOUND",
    "ADMIN_ROOM_STATE_CONFLICT",
    "ADMIN_SELF_ENFORCEMENT_FORBIDDEN",
    "ADMIN_SELF_ROLE_CHANGE_FORBIDDEN",
    "ADMIN_SUSPENSION_EXPIRY_INVALID",
    "ADMIN_SOURCE_RUN_AUDIT_FAILED",
    "ADMIN_SOURCE_RUN_CONFIRMATION_REQUIRED",
    "ADMIN_SOURCE_RUN_FAILED",
    "ADMIN_SOURCE_RUN_LIMIT_INVALID",
    "ADMIN_SOURCE_RUN_LOCK_UNAVAILABLE",
    "ADMIN_TELEGRAM_AI_FAILED",
    "ADMIN_TELEGRAM_AI_FACTS_REQUIRED",
    "ADMIN_TELEGRAM_AI_NOT_CONFIGURED",
    "ADMIN_TELEGRAM_AI_RATE_LIMITED",
    "ADMIN_TELEGRAM_ACTION_INVALID",
    "ADMIN_TELEGRAM_BODY_TOO_LONG",
    "ADMIN_TELEGRAM_CAMPAIGN_NOT_CANCELABLE",
    "ADMIN_TELEGRAM_CAMPAIGN_NOT_EDITABLE",
    "ADMIN_TELEGRAM_CAMPAIGN_NOT_FOUND",
    "ADMIN_TELEGRAM_CAMPAIGN_NOT_SCHEDULABLE",
    "ADMIN_TELEGRAM_CAMPAIGN_NOT_SENDABLE",
    "ADMIN_TELEGRAM_CAMPAIGN_STATE_CONFLICT",
    "ADMIN_TELEGRAM_CAMPAIGN_NOT_RECONCILABLE",
    "ADMIN_TELEGRAM_CONTENT_REQUIRED",
    "ADMIN_TELEGRAM_EXPECTED_VERSION_REQUIRED",
    "ADMIN_TELEGRAM_LOCAL_RUN_CONFIRMATION_REQUIRED",
    "ADMIN_TELEGRAM_LOCAL_RUN_UNAVAILABLE",
    "ADMIN_TELEGRAM_NOTICE_TYPE_INVALID",
    "ADMIN_TELEGRAM_PUBLIC_CHANNEL_NOT_CONFIGURED",
    "ADMIN_TELEGRAM_PUBLIC_SENDING_DISABLED",
    "ADMIN_TELEGRAM_RECONCILIATION_INVALID",
    "ADMIN_TELEGRAM_SCHEDULE_INVALID",
    "ADMIN_TELEGRAM_SOURCE_LABEL_TOO_LONG",
    "ADMIN_TELEGRAM_TICKER_INVALID",
    "ADMIN_TELEGRAM_TITLE_TOO_LONG",
    "ADMIN_TELEGRAM_URL_INVALID",
    "ADMIN_TRIAGE_INVALID",
    "ADMIN_USER_ACTION_UNSUPPORTED",
    "ADMIN_USER_NOT_FOUND",
  ].find((code) => message.includes(code));
  return known
    ? { code: known, message: adminErrorMessage(known), status: 400 }
    : {
        code: "ADMIN_OPERATION_UNAVAILABLE",
        message: "The administrator operation is temporarily unavailable.",
        status: 503,
      };
}

function adminErrorMessage(code: string) {
  const messages: Record<string, string> = {
    ADMIN_ASSIGNEE_INVALID: "Choose an active moderator as the assignee.",
    ADMIN_COMMUNITY_ACTION_INVALID: "Choose a supported community action.",
    ADMIN_DIRECT_MESSAGE_VISIBILITY_UNSUPPORTED:
      "Direct-message evidence cannot be hidden from this queue.",
    ADMIN_LAST_SUPER_ADMIN_REQUIRED:
      "At least one active super administrator must remain.",
    ADMIN_MODERATION_CASE_NOT_FOUND: "That moderation case no longer exists.",
    ADMIN_MODERATION_MEMBER_TARGET_REQUIRED:
      "This report does not identify a member account for enforcement.",
    ADMIN_MODERATION_TARGET_NOT_MUTABLE:
      "The reported content is deleted or no longer mutable.",
    ADMIN_REASON_REQUIRED: "Enter a reason of at least four characters.",
    ADMIN_ROLE_INVALID: "Choose a supported administrator role.",
    ADMIN_ROOM_ACTION_INVALID: "Choose a supported room action.",
    ADMIN_ROOM_FILTER_INVALID: "Choose supported Live Room filters.",
    ADMIN_ROOM_NOT_FOUND: "That Live Room no longer exists.",
    ADMIN_ROOM_STATE_CONFLICT:
      "The Live Room state changed. Refresh before trying again.",
    ADMIN_SELF_ENFORCEMENT_FORBIDDEN:
      "Administrators cannot apply community enforcement to themselves.",
    ADMIN_SELF_ROLE_CHANGE_FORBIDDEN:
      "Administrators cannot change their own roles from this screen.",
    ADMIN_SUSPENSION_EXPIRY_INVALID:
      "Choose a future suspension end within 365 days.",
    ADMIN_SOURCE_RUN_AUDIT_FAILED:
      "The ingest was not started because its audit record could not be saved.",
    ADMIN_SOURCE_RUN_CONFIRMATION_REQUIRED:
      "Type FORCE REANALYZE to confirm forced analysis.",
    ADMIN_SOURCE_RUN_FAILED:
      "GlobeNewswire ingest completed with a source or analysis failure.",
    ADMIN_SOURCE_RUN_LIMIT_INVALID: "Choose a supported ingest limit.",
    ADMIN_SOURCE_RUN_LOCK_UNAVAILABLE:
      "The ingest lock is temporarily unavailable.",
    ADMIN_TELEGRAM_AI_FAILED:
      "AI drafting failed. Manual campaign editing is still available.",
    ADMIN_TELEGRAM_AI_FACTS_REQUIRED:
      "Add at least one verified fact before requesting an AI draft.",
    ADMIN_TELEGRAM_AI_NOT_CONFIGURED:
      "AI drafting is not configured. Continue with manual editing.",
    ADMIN_TELEGRAM_AI_RATE_LIMITED:
      "This administrator has reached the hourly AI draft limit.",
    ADMIN_TELEGRAM_ACTION_INVALID:
      "Choose a supported Telegram campaign action.",
    ADMIN_TELEGRAM_BODY_TOO_LONG:
      "Keep the Telegram body within 3,500 characters.",
    ADMIN_TELEGRAM_CAMPAIGN_NOT_CANCELABLE:
      "Only a campaign that has not started sending can be canceled.",
    ADMIN_TELEGRAM_CAMPAIGN_NOT_EDITABLE:
      "This campaign has already entered delivery and cannot be edited.",
    ADMIN_TELEGRAM_CAMPAIGN_NOT_FOUND:
      "That Telegram campaign no longer exists.",
    ADMIN_TELEGRAM_CAMPAIGN_NOT_SCHEDULABLE:
      "This campaign can no longer be scheduled.",
    ADMIN_TELEGRAM_CAMPAIGN_NOT_SENDABLE:
      "This campaign is not safe to send or retry.",
    ADMIN_TELEGRAM_CAMPAIGN_STATE_CONFLICT:
      "The campaign changed. Refresh before trying again.",
    ADMIN_TELEGRAM_CAMPAIGN_NOT_RECONCILABLE:
      "This campaign is not ready for delivery reconciliation.",
    ADMIN_TELEGRAM_CONTENT_REQUIRED:
      "Enter a title or body for the Telegram campaign.",
    ADMIN_TELEGRAM_EXPECTED_VERSION_REQUIRED:
      "Refresh the campaign before reconciling its delivery.",
    ADMIN_TELEGRAM_LOCAL_RUN_CONFIRMATION_REQUIRED:
      "Confirm the local mock scheduler run before continuing.",
    ADMIN_TELEGRAM_LOCAL_RUN_UNAVAILABLE:
      "The mock due-campaign runner is available only in local development.",
    ADMIN_TELEGRAM_NOTICE_TYPE_INVALID:
      "Choose a supported Telegram notice type.",
    ADMIN_TELEGRAM_PUBLIC_CHANNEL_NOT_CONFIGURED:
      "The public Telegram channel is not configured on the server.",
    ADMIN_TELEGRAM_PUBLIC_SENDING_DISABLED:
      "Public Telegram sending is disabled on the server.",
    ADMIN_TELEGRAM_RECONCILIATION_INVALID:
      "Choose a supported Telegram delivery reconciliation.",
    ADMIN_TELEGRAM_SCHEDULE_INVALID:
      "Choose a valid future time in Eastern Time.",
    ADMIN_TELEGRAM_SOURCE_LABEL_TOO_LONG:
      "Keep the source label within 120 characters.",
    ADMIN_TELEGRAM_TICKER_INVALID: "Enter a valid ticker symbol.",
    ADMIN_TELEGRAM_TITLE_TOO_LONG:
      "Keep the Telegram title within 160 characters.",
    ADMIN_TELEGRAM_URL_INVALID:
      "Use a valid http or https URL. Script and data URLs are blocked.",
    ADMIN_TRIAGE_INVALID: "Choose a valid queue status and severity.",
    ADMIN_USER_ACTION_UNSUPPORTED:
      "User detail actions are limited to community suspension or restoration.",
    ADMIN_USER_NOT_FOUND: "That user no longer exists.",
  };
  return messages[code] || "The administrator operation could not be completed.";
}
