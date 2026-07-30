import "server-only";

import { createHash } from "node:crypto";
import { getBrokerageConfig } from "./config";
import { recordBrokerageManualRefreshWebhook } from "./serverRepository";
import { supabaseSelect, supabaseUpdate, supabaseUpsert } from "@/lib/supabase";
import {
  canonicalizeSnapTradePayload,
  verifySnapTradeWebhookPayload,
} from "./webhookSignature";

export { canonicalizeSnapTradePayload } from "./webhookSignature";

export function verifySnapTradeWebhook(input: {
  body: string;
  now?: Date;
  signature: string | null;
}) {
  const config = getBrokerageConfig();
  if (!config.consumerKey || !input.signature) return null;
  const verified = verifySnapTradeWebhookPayload({
    body: input.body,
    consumerKey: config.consumerKey,
    signature: input.signature,
    now: input.now,
  });
  if (!verified) return null;
  const { payload, eventTimestamp } = verified;
  const canonicalPayload = canonicalizeSnapTradePayload(payload);
  const webhookId =
    readString(payload.webhookId) ||
    createHash("sha256").update(canonicalPayload).digest("hex");
  return {
    eventTimestamp,
    eventType: readString(payload.eventType) || "UNKNOWN",
    payload,
    payloadSha256: createHash("sha256").update(canonicalPayload).digest("hex"),
    webhookId,
  };
}


export async function recordSnapTradeWebhook(
  event: NonNullable<ReturnType<typeof verifySnapTradeWebhook>>,
) {
  const inserted = await supabaseUpsert(
    "brokerage_webhook_events",
    {
      event_timestamp: event.eventTimestamp,
      event_type: event.eventType,
      payload_sha256: event.payloadSha256,
      status: "received",
      webhook_id: event.webhookId,
    },
    {
      onConflict: "webhook_id",
      prefer: "resolution=ignore-duplicates,return=representation",
    },
  );
  if (!inserted.ok) return { duplicate: false, ok: false };
  if (!Array.isArray(inserted.data) || inserted.data.length === 0) {
    return { duplicate: true, ok: true };
  }
  const providerUserId =
    readString(event.payload.userId) ||
    readString(event.payload.user_id);
  if (providerUserId) {
    const connection = await supabaseSelect("brokerage_connections", {
      limit: "1",
      provider_user_id: `eq.${providerUserId}`,
      select: "user_id",
    });
    const row =
      Array.isArray(connection.data) &&
      connection.data[0] &&
      typeof connection.data[0] === "object"
        ? (connection.data[0] as Record<string, unknown>)
        : null;
    const userId = readString(row?.user_id);
    if (connection.ok && userId) {
      const upperType = event.eventType.toUpperCase();
      if (upperType === "ACCOUNT_HOLDINGS_UPDATED") {
        const accountId =
          readString(event.payload.accountId) ||
          readString(event.payload.account_id);
        const authorizationId =
          readString(event.payload.brokerageAuthorizationId) ||
          readString(event.payload.brokerage_authorization_id);
        if (accountId && authorizationId) {
          // SnapTrade sends one completion webhook per account. The quota row
          // is counted only after every account under the connection reports
          // a successful holdings update.
          await recordBrokerageManualRefreshWebhook({
            accountId,
            authorizationId,
            eventTimestamp: event.eventTimestamp,
            succeeded: holdingsUpdateSucceeded(event.payload),
            userId,
          });
        }
      }
      const nextStatus = upperType.includes("DISABLED")
        ? "disabled"
        : upperType.includes("DELETED") ||
            upperType.includes("REMOVED")
          ? "disconnected"
          : upperType.includes("ADDED") ||
              upperType.includes("SYNC")
            ? "connected"
            : null;
      if (nextStatus) {
        await supabaseUpdate(
          "brokerage_connections",
          { user_id: `eq.${userId}` },
          {
            last_synced_at: new Date().toISOString(),
            status: nextStatus,
            updated_at: new Date().toISOString(),
          },
        );
      }
    }
  }
  await supabaseUpdate(
    "brokerage_webhook_events",
    { webhook_id: `eq.${event.webhookId}` },
    { processed_at: new Date().toISOString(), status: "processed" },
  );
  return { duplicate: false, ok: true };
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function holdingsUpdateSucceeded(payload: Record<string, unknown>) {
  const details =
    payload.details &&
    typeof payload.details === "object" &&
    !Array.isArray(payload.details)
      ? (payload.details as Record<string, unknown>)
      : null;
  if (!details) return false;
  const results = Object.values(details).filter(
    (value): value is Record<string, unknown> =>
      Boolean(value && typeof value === "object" && !Array.isArray(value)),
  );
  return results.length > 0 && results.every((result) => result.success === true);
}
