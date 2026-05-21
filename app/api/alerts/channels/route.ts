import { NextRequest, NextResponse } from "next/server";
import { getAlertSettingsViewModel } from "@/lib/alerts/getAlertSettingsViewModel";
import {
  AlertValidationError,
  buildChannelNotAvailableMessage,
  getChannelLockState,
  getUserPlan,
  normalizeChannelPatch,
} from "@/lib/alerts/alertValidation";
import { getCurrentUserId } from "@/lib/currentUser";
import { supabaseSelect, supabaseUpsert } from "@/lib/supabase";
import type { AlertChannel } from "@/lib/subscriptionPolicy";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

type ChannelRow = {
  destination?: unknown;
  verified_at?: unknown;
};

export async function PATCH(request: NextRequest) {
  try {
    const userId = await getCurrentUserId();
    const body = await request.json().catch(() => null);
    const patch = normalizeChannelPatch(body);
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

    if (patch.enabled && !(await isChannelConnected(userId, patch.channel))) {
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
        message: error instanceof Error ? error.message : "Failed to update delivery channel.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

async function isChannelConnected(userId: string, channel: AlertChannel) {
  if (channel === "web") return true;

  const result = await supabaseSelect("user_delivery_channels", {
    select: "destination,verified_at",
    user_id: `eq.${userId}`,
    channel: `eq.${channel}`,
    limit: "1",
  });
  const row = Array.isArray(result.data) ? (result.data[0] as ChannelRow | undefined) : undefined;

  return Boolean(stringValue(row?.destination) || stringValue(row?.verified_at));
}

function channelLabel(channel: AlertChannel) {
  if (channel === "api") return "API";
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
