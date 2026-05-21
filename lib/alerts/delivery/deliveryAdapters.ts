import "server-only";

import type {
  AlertDeliveryCandidate,
  DeliveryAdapterResult,
  NormalizedAlertEvent,
} from "@/lib/alerts/delivery/types";
import type { AlertChannel } from "@/lib/subscriptionPolicy";

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

export async function sendTelegramMessage(chatId: string, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!token || !chatId) {
    return {
      ok: false,
      status: 0,
      error: "Telegram is not configured.",
    };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
      }),
    });
    const data = await response.json().catch(() => null);
    return {
      ok: Boolean(response.ok && data?.ok),
      status: response.status,
      error: response.ok && data?.ok ? undefined : readTelegramError(data, response.statusText),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Telegram send failed",
    };
  }
}

function readTelegramError(data: unknown, fallback: string) {
  if (data && typeof data === "object" && "description" in data) {
    return String((data as { description?: unknown }).description || fallback);
  }
  return fallback;
}
