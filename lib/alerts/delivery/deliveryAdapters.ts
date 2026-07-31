import "server-only";

import type {
  AlertDeliveryCandidate,
  DeliveryAdapterResult,
  NormalizedAlertEvent,
} from "@/lib/alerts/delivery/types";
import type { AlertChannel } from "@/lib/subscriptionPolicy";
import { sendTelegramMessage } from "@/lib/telegram/sendTelegramMessage";

export async function runDeliveryAdapters({
  event,
  candidate,
  dryRun,
}: {
  event: NormalizedAlertEvent;
  candidate: AlertDeliveryCandidate;
  dryRun: boolean;
}): Promise<DeliveryAdapterResult> {
  const deliveredChannels: AlertChannel[] = [];
  const attemptedChannels: AlertChannel[] = [];
  const errors: DeliveryAdapterResult["errors"] = [];

  if (candidate.deliveryStatus !== "sent") {
    return { deliveredChannels, attemptedChannels, errors };
  }

  for (const channel of candidate.eligibleChannels) {
    if (channel.channel === "web") {
      if (!dryRun) deliveredChannels.push("web");
      continue;
    }

    if (channel.channel === "telegram") {
      if (dryRun || process.env.ALERT_DELIVERY_SEND_TELEGRAM !== "true") {
        continue;
      }
      attemptedChannels.push("telegram");
      const result = await sendTelegramMessage(channel.destination || "", formatTelegramAlertMessage(event));
      if (result.ok) {
        deliveredChannels.push("telegram");
      } else {
        errors.push({ channel: "telegram", error: result.error || "Telegram send failed" });
      }
      continue;
    }

    errors.push({ channel: channel.channel, error: `${channel.channel} delivery adapter is not implemented yet.` });
  }

  return { deliveredChannels, attemptedChannels, errors };
}

function formatTelegramAlertMessage(event: NormalizedAlertEvent) {
  const ticker = event.primaryTicker || event.tickers[0] || "Market";
  return [`STOCK RADAR Alert`, `${ticker}: ${event.title}`, `Category: ${event.category}`].join("\n");
}
