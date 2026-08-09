import "server-only";

import { supabaseUpsert } from "@/lib/supabase";
import type { CreateAlertDeliveryInput, CreateAlertDeliveryResult } from "@/lib/alerts/delivery/types";
import { buildDeliveryDedupeKey } from "@/lib/alerts/delivery/eventDeliveryDedupe";

export { buildDeliveryDedupeKey } from "@/lib/alerts/delivery/eventDeliveryDedupe";

export async function createUserAlertDelivery(input: CreateAlertDeliveryInput): Promise<CreateAlertDeliveryResult> {
  const dedupeKey = buildDeliveryDedupeKey(input.event.id);
  const deliveredAt = input.sentAt || new Date().toISOString();

  const result = await supabaseUpsert("user_alert_deliveries", {
    user_id: input.userId,
    alert_event_id: input.event.id,
    ticker: input.event.primaryTicker || input.event.tickers[0] || null,
    title: input.event.title,
    category: input.event.category,
    source_type: input.event.sourceType,
    source_label: input.event.sourceLabel || null,
    alert_lane: input.alertLane,
    severity: input.event.severity || null,
    delivered_channels: input.deliveredChannels,
    delivery_status: input.deliveryStatus,
    delivered_at: deliveredAt,
    scheduled_for: input.scheduledFor,
    sent_at: input.deliveryStatus === "sent" ? input.sentAt || deliveredAt : null,
    attempted_at: input.attemptedAt || null,
    last_error: input.lastError || null,
    dedupe_key: dedupeKey,
  });

  if (!result.ok) {
    if (result.status === 409 || /duplicate|unique/i.test(result.error || "")) {
      return {
        ok: true,
        skipped: true,
        reason: "DUPLICATE_DELIVERY",
        status: result.status,
      };
    }
    return {
      ok: false,
      status: result.status,
      error: result.error || "Failed to create user alert delivery.",
    };
  }

  const row = Array.isArray(result.data) ? (result.data[0] as Record<string, unknown> | undefined) : undefined;
  return {
    ok: true,
    row,
  };
}
