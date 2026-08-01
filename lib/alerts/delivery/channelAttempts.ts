import "server-only";

import { randomUUID } from "crypto";
import { supabaseRpc } from "@/lib/supabase";
import type { AlertChannel } from "@/lib/subscriptionPolicy";

export type AlertDeliveryAttemptStatus =
  | "pending"
  | "attempting"
  | "sent"
  | "failed"
  | "suppressed"
  | "uncertain";

type ClaimRow = {
  acquired?: unknown;
  attempt_status?: unknown;
  retry_at?: unknown;
  attempt_number?: unknown;
};

export async function claimAlertDeliveryChannelAttempt({
  deliveryId,
  userId,
  channel,
}: {
  deliveryId: string;
  userId: string;
  channel: AlertChannel;
}) {
  const attemptToken = randomUUID();
  const result = await supabaseRpc("claim_alert_delivery_channel_attempt", {
    p_delivery_id: deliveryId,
    p_user_id: userId,
    p_channel: channel,
    p_attempt_token: attemptToken,
  });

  if (!result.ok) {
    return {
      ok: false as const,
      acquired: false,
      attemptToken,
      status: null,
      error: result.error || "Failed to claim alert delivery channel.",
    };
  }

  const row = Array.isArray(result.data)
    ? (result.data[0] as ClaimRow | undefined)
    : undefined;
  return {
    ok: true as const,
    acquired: row?.acquired === true,
    attemptToken,
    status: readAttemptStatus(row?.attempt_status),
    retryAt: readString(row?.retry_at) || null,
    attemptNumber: readInteger(row?.attempt_number),
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

export async function finishAlertDeliveryChannelAttempt({
  deliveryId,
  channel,
  attemptToken,
  status,
  providerMessageId,
  error,
}: {
  deliveryId: string;
  channel: AlertChannel;
  attemptToken: string;
  status: Extract<
    AlertDeliveryAttemptStatus,
    "sent" | "failed" | "suppressed" | "uncertain"
  >;
  providerMessageId?: string;
  error?: string;
}) {
  const result = await supabaseRpc("finish_alert_delivery_channel_attempt", {
    p_delivery_id: deliveryId,
    p_channel: channel,
    p_attempt_token: attemptToken,
    p_status: status,
    p_provider_message_id: providerMessageId || null,
    p_last_error: error || null,
  });

  return {
    ok: result.ok && result.data === true,
    error:
      result.ok && result.data === true
        ? undefined
        : result.error || "Failed to finish alert delivery channel attempt.",
  };
}

function readAttemptStatus(value: unknown): AlertDeliveryAttemptStatus | null {
  if (
    value === "pending" ||
    value === "attempting" ||
    value === "sent" ||
    value === "failed" ||
    value === "suppressed" ||
    value === "uncertain"
  ) {
    return value;
  }
  return null;
}
