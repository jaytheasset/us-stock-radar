import "server-only";

import { randomUUID } from "node:crypto";
import { normalizePublicTelegramDestination } from "@/lib/alerts/delivery/publicTelegramBroadcastPolicy";
import { getServerEnv } from "@/lib/env";
import {
  sendTelegramMessage,
  type TelegramMessageOptions,
} from "@/lib/telegram/sendTelegramMessage";
import {
  claimAdminTelegramCampaign,
  claimDueAdminTelegramCampaign,
  expireAdminTelegramCampaignLeases,
  finishAdminTelegramCampaign,
  type AdminTelegramCampaign,
} from "./telegramCampaigns";
import { buildAdminTelegramCampaignPresentation } from "./telegramCampaignPolicy";

export type AdminTelegramTransportResult = {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
  outcome: "sent" | "not_sent" | "uncertain";
};

export type AdminTelegramTransport = (
  destination: string,
  text: string,
  options: TelegramMessageOptions,
) => Promise<AdminTelegramTransportResult>;

export type AdminTelegramCampaignDeliveryResult = {
  ok: boolean;
  campaignId: string | null;
  action: "sent" | "failed" | "uncertain" | "empty" | "disabled";
  providerMessageId?: string;
  error?: string;
  retryAllowed?: boolean;
};

export async function sendAdminTelegramCampaignNow(input: {
  actorUserId: string;
  campaignId: unknown;
  reason: unknown;
  requestId?: string;
  expectedVersion?: unknown;
  transport?: AdminTelegramTransport;
}) {
  const transport = input.transport || sendTelegramMessage;
  const configuration = resolveDeliveryConfiguration(transport);
  if (!configuration.ok) throw new Error(configuration.error);
  const claimed = await claimAdminTelegramCampaign(input);
  return deliverClaimedCampaign({
    ...claimed,
    destination: configuration.destination,
    transport,
  });
}

export async function runDueAdminTelegramCampaigns(input: {
  limit?: number;
  trigger?: "scheduler" | "local_mock";
  transport?: AdminTelegramTransport;
  actorUserId?: string;
  reason?: unknown;
  requestId?: string;
} = {}) {
  const limit = Math.max(1, Math.min(Math.trunc(input.limit || 10), 50));
  const trigger = input.trigger || "scheduler";
  const transport = input.transport || sendTelegramMessage;
  const expiredLeases = await expireAdminTelegramCampaignLeases(50);
  const configuration = resolveDeliveryConfiguration(transport);
  if (!configuration.ok) {
    return {
      ok: true,
      scanned: 0,
      sent: 0,
      failed: 0,
      uncertain: 0,
      expiredLeases,
      disabled: true,
      items: [] as AdminTelegramCampaignDeliveryResult[],
      error: configuration.error,
    };
  }

  const items: AdminTelegramCampaignDeliveryResult[] = [];
  for (let index = 0; index < limit; index += 1) {
    const claimed = await claimDueAdminTelegramCampaign({
      trigger,
      actorUserId: input.actorUserId,
      reason: input.reason,
      requestId: input.requestId,
    });
    if (!claimed) break;
    items.push(
      await deliverClaimedCampaign({
        ...claimed,
        destination: configuration.destination,
        transport,
      }),
    );
  }
  return {
    ok: items.every((item) => item.ok),
    scanned: items.length,
    sent: items.filter((item) => item.action === "sent").length,
    failed: items.filter((item) => item.action === "failed").length,
    uncertain: items.filter((item) => item.action === "uncertain").length,
    expiredLeases,
    disabled: false,
    items,
    error: items.find((item) => item.error)?.error,
  };
}

export function createLocalAdminTelegramMockTransport(): AdminTelegramTransport {
  return async () => ({
    ok: true,
    outcome: "sent",
    providerMessageId: `mock:${randomUUID()}`,
  });
}

async function deliverClaimedCampaign(input: {
  attemptToken: string;
  campaign: AdminTelegramCampaign;
  destination: string;
  transport: AdminTelegramTransport;
}): Promise<AdminTelegramCampaignDeliveryResult> {
  const env = getServerEnv();
  let sent: AdminTelegramTransportResult;
  try {
    const presentation = buildAdminTelegramCampaignPresentation(input.campaign, {
      baseUrl: env.appBaseUrl,
    });
    sent = await input.transport(
      input.destination,
      presentation.text,
      presentation,
    );
  } catch (error) {
    sent = {
      ok: false,
      outcome:
        error instanceof Error &&
        error.message.includes("ADMIN_TELEGRAM_URL_INVALID")
          ? "not_sent"
          : "uncertain",
      error:
        error instanceof Error ? error.message : "Telegram request failed.",
    };
  }

  const outcome = sent.ok ? "sent" : sent.outcome;
  const finished = await finishAdminTelegramCampaign({
    campaignId: input.campaign.id,
    attemptToken: input.attemptToken,
    outcome,
    providerMessageId: sent.providerMessageId,
    error: sent.error,
  });
  if (!finished.ok) {
    return {
      ok: false,
      campaignId: input.campaign.id,
      action: "uncertain",
      error:
        "Telegram provider result could not be saved. Automatic retry is blocked pending reconciliation.",
      retryAllowed: false,
    };
  }
  if (outcome === "sent") {
    return {
      ok: true,
      campaignId: input.campaign.id,
      action: "sent",
      providerMessageId: sent.providerMessageId,
      retryAllowed: false,
    };
  }
  return {
    ok: false,
    campaignId: input.campaign.id,
    action: outcome === "uncertain" ? "uncertain" : "failed",
    error: sanitizeError(sent.error || "Telegram send failed."),
    retryAllowed: outcome === "not_sent",
  };
}

function resolveDeliveryConfiguration(transport: AdminTelegramTransport) {
  if (transport !== sendTelegramMessage) {
    return { ok: true as const, destination: "@local_mock_channel" };
  }
  const env = getServerEnv();
  const destination = normalizePublicTelegramDestination(
    env.telegramPublicChannelId,
  );
  if (!env.alertDeliverySendTelegramPublic) {
    return {
      ok: false as const,
      error: "ADMIN_TELEGRAM_PUBLIC_SENDING_DISABLED",
    };
  }
  if (!env.telegramBotToken || !destination) {
    return {
      ok: false as const,
      error: "ADMIN_TELEGRAM_PUBLIC_CHANNEL_NOT_CONFIGURED",
    };
  }
  return { ok: true as const, destination };
}

function sanitizeError(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/bot[A-Za-z0-9:_-]+/g, "bot[REDACTED]")
    .replace(/-100\d{6,16}/g, "[REDACTED_CHANNEL]")
    .replace(/@[A-Za-z][A-Za-z0-9_]{4,31}/g, "[REDACTED_CHANNEL]")
    .slice(0, 500);
}
