import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";
import { getAlertSettingsViewModel, getGuestAlertSettingsViewModel } from "@/lib/alerts/getAlertSettingsViewModel";
import {
  AlertValidationError,
  buildChannelNotAvailableMessage,
  getChannelLockState,
  getUserPlan,
  IMPLEMENTED_ALERT_CHANNELS,
  normalizeChannelPatch,
} from "@/lib/alerts/alertValidation";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { supabaseSelect, supabaseUpsert } from "@/lib/supabase";
import type { AlertChannel } from "@/lib/subscriptionPolicy";
import { getAuthUserById, getVerifiedAuthEmail } from "@/lib/auth/getAuthUserById";
import { getAlertEmailConfig } from "@/lib/alerts/emailConfig";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

type ChannelRow = {
  destination?: unknown;
  verified_at?: unknown;
  metadata?: unknown;
};

export async function PATCH(request: NextRequest) {
  const originRejection = rejectCrossOriginMutationRequest(request, NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  try {
    const userId = await getOptionalCurrentUserId();
    const body = await request.json().catch(() => null);
    const patch = normalizeChannelPatch(body);

    if (!userId) {
      return NextResponse.json(
        {
          ok: true,
          guestMode: true,
          persisted: false,
          message: "Create an account to save your delivery channels.",
          data: getGuestAlertSettingsViewModel(),
        },
        { headers: NO_STORE_HEADERS },
      );
    }

    const plan = await getUserPlan(userId);
    const locked = getChannelLockState(plan, patch.channel);

    if (patch.enabled && locked) {
      return NextResponse.json(
        {
          ok: false,
          error: "CHANNEL_NOT_AVAILABLE",
          message: buildChannelNotAvailableMessage(patch.channel),
        },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }

    if (patch.enabled && !IMPLEMENTED_ALERT_CHANNELS.includes(patch.channel)) {
      return NextResponse.json(
        {
          ok: false,
          error: "CHANNEL_NOT_IMPLEMENTED",
          message: `${channelLabel(patch.channel)} delivery is not available.`,
        },
        { status: 501, headers: NO_STORE_HEADERS },
      );
    }

    const emailIdentity = patch.channel === "email" && patch.enabled
      ? getVerifiedAuthEmail(await getAuthUserById(userId))
      : null;
    if (patch.channel === "email" && patch.enabled && !getAlertEmailConfig().configured) {
      return NextResponse.json({ ok: false, error: "EMAIL_NOT_CONFIGURED", message: "Email delivery is not configured yet." }, { status: 503, headers: NO_STORE_HEADERS });
    }
    if (patch.channel === "email" && patch.enabled && !emailIdentity) {
      return NextResponse.json({ ok: false, error: "EMAIL_NOT_VERIFIED", message: "Verify the email on your Stock Radar account before enabling Email alerts." }, { status: 409, headers: NO_STORE_HEADERS });
    }

    const currentChannel = await getChannelRow(userId, patch.channel);
    if (patch.channel === "email" && patch.enabled && isEmailSuppressed(currentChannel?.metadata)) {
      return NextResponse.json({ ok: false, error: "EMAIL_SUPPRESSED", message: "Email alerts are paused after a delivery safety event. Contact support after resolving the address issue." }, { status: 409, headers: NO_STORE_HEADERS });
    }
    if (patch.enabled && patch.channel !== "email" && !isConnectedRow(patch.channel, currentChannel)) {
      return NextResponse.json(
        {
          ok: false,
          error: "CHANNEL_NOT_CONNECTED",
          message: `Connect ${channelLabel(patch.channel)} before enabling ${channelLabel(patch.channel)} alerts.`,
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const result = await supabaseUpsert(
      "user_delivery_channels",
      {
        user_id: userId,
        channel: patch.channel,
        enabled: patch.enabled,
        ...(emailIdentity ? { destination: emailIdentity.email, verified_at: emailIdentity.verifiedAt } : {}),
      },
      {
        onConflict: "user_id,channel",
        prefer: "resolution=merge-duplicates,return=representation",
      },
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "CHANNEL_SAVE_FAILED",
          message: result.error || "Failed to save delivery channel.",
        },
        { status: result.status || 502, headers: NO_STORE_HEADERS },
      );
    }

    const data = await getAlertSettingsViewModel(userId);
    return NextResponse.json({ ok: true, data }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof AlertValidationError) {
      return NextResponse.json(
        {
          ok: false,
          error: error.code,
          message: error.message,
          ...error.details,
        },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error: "CHANNEL_UPDATE_FAILED",
        message: "Failed to update delivery channel.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

async function getChannelRow(userId: string, channel: AlertChannel) {
  if (channel === "web") return undefined;
  const result = await supabaseSelect("user_delivery_channels", {
    select: "destination,verified_at,metadata",
    user_id: `eq.${userId}`,
    channel: `eq.${channel}`,
    limit: "1",
  });
  const row = Array.isArray(result.data) ? (result.data[0] as ChannelRow | undefined) : undefined;

  return row;
}

function isConnectedRow(channel: AlertChannel, row?: ChannelRow) {
  if (channel === "web") return true;
  return Boolean(stringValue(row?.destination) || stringValue(row?.verified_at));
}

function isEmailSuppressed(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as { email_suppressed?: unknown }).email_suppressed === true);
}

function channelLabel(channel: AlertChannel) {
  if (channel === "api") return "API";
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
