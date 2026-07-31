import "server-only";

import {
  claimAlertDeliveryChannelAttempt,
  finishAlertDeliveryChannelAttempt,
} from "@/lib/alerts/delivery/channelAttempts";
import { sendTelegramMessage } from "@/lib/telegram/sendTelegramMessage";
import { supabaseSelect, supabaseUpdate } from "@/lib/supabase";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import {
  getPlanLimits,
  isDiscoveryCategoryAllowed,
  isTickerAlertCategoryAllowed,
  type AlertChannel,
  type Plan,
} from "@/lib/subscriptionPolicy";
import type {
  ProcessQueuedDeliveryItemResult,
  ProcessQueuedDeliveryOptions,
  ProcessQueuedDeliveryResult,
  QueuedAlertDeliveryRow,
} from "@/lib/alerts/delivery/types";

type DeliveryChannelRow = {
  channel?: unknown;
  enabled?: unknown;
  destination?: unknown;
  verified_at?: unknown;
};

type ChannelProcessingResult = {
  sentChannels: AlertChannel[];
  errors: string[];
  failedCount: number;
  suppressedCount: number;
  duplicateCount: number;
  inProgress: boolean;
  uncertain: boolean;
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;

export async function processQueuedDeliveries(
  options: ProcessQueuedDeliveryOptions = {},
): Promise<ProcessQueuedDeliveryResult> {
  const requestedWrite = options.write === true;
  const dryRun = options.dryRun ?? !requestedWrite;
  const write = requestedWrite && !dryRun;
  const limit = normalizeLimit(options.limit);
  const queuedRows = await fetchDueQueuedDeliveries(limit);
  const items: ProcessQueuedDeliveryItemResult[] = [];

  for (const row of queuedRows) {
    items.push(await processQueuedDeliveryRow(row, { dryRun, write }));
  }

  const failed = items.filter((item) => item.action === "failed").length;
  const inProgress = items.filter(
    (item) => item.action === "in_progress",
  ).length;

  return {
    ok: failed === 0 && inProgress === 0,
    dryRun,
    write,
    scanned: queuedRows.length,
    processed: write
      ? items.filter((item) => item.action !== "in_progress").length
      : 0,
    wouldProcess: dryRun ? items.length : 0,
    sent: items.filter((item) => item.action === "sent").length,
    failed,
    suppressed: items.filter((item) => item.action === "suppressed").length,
    duplicatesPrevented: items.reduce(
      (sum, item) => sum + item.duplicatesPrevented,
      0,
    ),
    inProgress,
    items,
    error:
      failed > 0
        ? `${failed} queued alert delivery row(s) failed.`
        : inProgress > 0
          ? `${inProgress} queued alert delivery row(s) require reconciliation.`
          : undefined,
  };
}

async function fetchDueQueuedDeliveries(limit: number) {
  const result = await supabaseSelect("user_alert_deliveries", {
    select:
      "id,user_id,ticker,title,category,source_type,source_label,alert_lane,severity,delivered_channels,scheduled_for,delivery_status,created_at",
    delivery_status: "eq.queued",
    scheduled_for: `lte.${new Date().toISOString()}`,
    order: "scheduled_for.asc,created_at.asc",
    limit: String(limit),
  });

  if (!result.ok) {
    throw new Error(result.error || "Failed to fetch queued alert deliveries.");
  }

  return (Array.isArray(result.data) ? result.data : [])
    .map(readQueuedRow)
    .filter(Boolean) as QueuedAlertDeliveryRow[];
}

async function processQueuedDeliveryRow(
  row: QueuedAlertDeliveryRow,
  {
    dryRun,
    write,
  }: {
    dryRun: boolean;
    write: boolean;
  },
): Promise<ProcessQueuedDeliveryItemResult> {
  const plan = (await getEffectiveUserPlan(row.user_id)).effectivePlan;
  const policyError = getQueuedDeliveryPolicyError(row, plan);
  if (policyError) {
    return suppressQueuedDeliveryForPolicy(row, policyError, { dryRun, write });
  }

  const channelRows = await fetchChannelRows(row.user_id);
  const channels = await processRequestedChannels(row, channelRows, {
    dryRun,
    write,
    plan,
  });

  const base = {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    ticker: row.ticker,
    channels: channels.sentChannels,
    duplicatesPrevented: channels.duplicateCount,
  };

  if (dryRun || !write) {
    return {
      ...base,
      action: channels.sentChannels.length ? "would_send" : "suppressed",
      error:
        channels.errors.join("; ") ||
        (channels.sentChannels.length
          ? undefined
          : "No enabled delivery channels available at processing time."),
    };
  }

  if (channels.inProgress) {
    return {
      ...base,
      action: "in_progress",
      error:
        channels.errors.join("; ") ||
        "Another worker owns a channel attempt or its outcome requires reconciliation.",
    };
  }

  const attemptedAt = new Date().toISOString();
  if (channels.failedCount > 0 || channels.uncertain) {
    const error =
      channels.errors.join("; ") ||
      "One or more requested delivery channels failed.";
    const updateResult = await supabaseUpdate(
      "user_alert_deliveries",
      { id: `eq.${row.id}`, delivery_status: "eq.queued" },
      {
        delivery_status: channels.sentChannels.length ? "sent" : "failed",
        delivered_channels: channels.sentChannels,
        attempted_at: attemptedAt,
        sent_at: channels.sentChannels.length ? attemptedAt : null,
        last_error: sanitizeError(error),
      },
    );
    if (!updateResult.ok) {
      return markDeliveryFailed(
        row,
        sanitizeError(
          updateResult.error || "Failed to record partial channel delivery.",
        ),
        channels.duplicateCount,
      );
    }

    return {
      ...base,
      action: "failed",
      error: sanitizeError(error),
    };
  }

  if (channels.sentChannels.length) {
    const updateResult = await supabaseUpdate(
      "user_alert_deliveries",
      { id: `eq.${row.id}`, delivery_status: "eq.queued" },
      {
        delivery_status: "sent",
        delivered_channels: channels.sentChannels,
        attempted_at: attemptedAt,
        sent_at: attemptedAt,
        last_error: channels.errors.join("; ") || null,
      },
    );
    if (!updateResult.ok) {
      return markDeliveryFailed(
        row,
        sanitizeError(
          updateResult.error ||
            "Channel delivery succeeded but the outbox row could not be finalized.",
        ),
        channels.duplicateCount,
      );
    }

    return {
      ...base,
      action: "sent",
      error: channels.errors.join("; ") || undefined,
    };
  }

  const error =
    channels.errors.join("; ") ||
    "No enabled delivery channels available at processing time.";
  const status =
    channels.failedCount > 0 || channels.uncertain ? "failed" : "suppressed";
  const updateResult = await supabaseUpdate(
    "user_alert_deliveries",
    { id: `eq.${row.id}`, delivery_status: "eq.queued" },
    {
      delivery_status: status,
      delivered_channels: [],
      attempted_at: attemptedAt,
      last_error: sanitizeError(error),
    },
  );

  if (!updateResult.ok) {
    return markDeliveryFailed(
      row,
      sanitizeError(
        updateResult.error || "Failed to finalize queued alert delivery.",
      ),
      channels.duplicateCount,
    );
  }

  return {
    ...base,
    action: status,
    error: sanitizeError(error),
  };
}

async function processRequestedChannels(
  row: QueuedAlertDeliveryRow,
  channelRows: Map<AlertChannel, DeliveryChannelRow>,
  {
    dryRun,
    write,
    plan,
  }: {
    dryRun: boolean;
    write: boolean;
    plan: Plan;
  },
): Promise<ChannelProcessingResult> {
  const result: ChannelProcessingResult = {
    sentChannels: [],
    errors: [],
    failedCount: 0,
    suppressedCount: 0,
    duplicateCount: 0,
    inProgress: false,
    uncertain: false,
  };
  const entitledChannels = new Set(getPlanLimits(plan).channels);

  for (const channel of new Set(row.delivered_channels)) {
    if (!entitledChannels.has(channel)) {
      result.suppressedCount += 1;
      result.errors.push(`${channel}: channel is not available on the current plan.`);
      continue;
    }
    const channelRow = channelRows.get(channel);
    if (dryRun || !write) {
      if (isChannelReady(channel, channelRow)) {
        result.sentChannels.push(channel);
      } else {
        result.errors.push(channelUnavailableReason(channel, channelRow));
      }
      continue;
    }

    const claim = await claimAlertDeliveryChannelAttempt({
      deliveryId: row.id,
      userId: row.user_id,
      channel,
    });
    if (!claim.ok) {
      result.failedCount += 1;
      result.errors.push(`${channel}: ${sanitizeError(claim.error)}`);
      continue;
    }
    if (!claim.acquired) {
      if (claim.status === "sent") {
        result.sentChannels.push(channel);
        result.duplicateCount += 1;
      } else if (
        claim.status === "attempting" ||
        claim.status === "uncertain"
      ) {
        result.inProgress = true;
        result.uncertain ||= claim.status === "uncertain";
        result.errors.push(
          `${channel}: existing ${claim.status} attempt was not retried.`,
        );
      } else if (claim.status === "suppressed") {
        result.suppressedCount += 1;
        result.errors.push(`${channel}: delivery is suppressed.`);
      } else {
        result.failedCount += 1;
        result.errors.push(`${channel}: previous delivery attempt failed.`);
      }
      continue;
    }

    if (!isChannelReady(channel, channelRow)) {
      const error = channelUnavailableReason(channel, channelRow);
      const finished = await finishAlertDeliveryChannelAttempt({
        deliveryId: row.id,
        channel,
        attemptToken: claim.attemptToken,
        status: "suppressed",
        error,
      });
      result.suppressedCount += 1;
      result.errors.push(`${channel}: ${sanitizeError(error)}`);
      if (!finished.ok) result.inProgress = true;
      continue;
    }

    if (channel === "web") {
      const finished = await finishAlertDeliveryChannelAttempt({
        deliveryId: row.id,
        channel,
        attemptToken: claim.attemptToken,
        status: "sent",
      });
      if (finished.ok) {
        result.sentChannels.push("web");
      } else {
        result.inProgress = true;
        result.errors.push(`web: ${sanitizeError(finished.error || "")}`);
      }
      continue;
    }

    if (channel === "telegram") {
      const sent = await sendTelegramMessage(
        readString(channelRow?.destination),
        formatQueuedTelegramMessage(row),
      );
      const status = sent.ok
        ? "sent"
        : sent.outcome === "uncertain"
          ? "uncertain"
          : "failed";
      const error = sent.ok
        ? undefined
        : sanitizeError(sent.error || "Telegram send failed.");
      const finished = await finishAlertDeliveryChannelAttempt({
        deliveryId: row.id,
        channel,
        attemptToken: claim.attemptToken,
        status,
        providerMessageId: sent.providerMessageId,
        error,
      });

      if (!finished.ok) {
        result.inProgress = true;
        result.errors.push(
          `telegram: provider outcome could not be persisted; automatic retry is blocked.`,
        );
      } else if (sent.ok) {
        result.sentChannels.push("telegram");
      } else {
        result.failedCount += 1;
        result.uncertain ||= status === "uncertain";
        result.errors.push(`telegram: ${error}`);
      }
      continue;
    }

    const error = `${channel} delivery adapter is not implemented yet.`;
    const finished = await finishAlertDeliveryChannelAttempt({
      deliveryId: row.id,
      channel,
      attemptToken: claim.attemptToken,
      status: "suppressed",
      error,
    });
    result.suppressedCount += 1;
    result.errors.push(`${channel}: ${error}`);
    if (!finished.ok) result.inProgress = true;
  }

  return result;
}

function getQueuedDeliveryPolicyError(row: QueuedAlertDeliveryRow, plan: Plan) {
  if (row.alert_lane === "market_discovery") {
    if (!row.category || !isDiscoveryCategoryAllowed(plan, row.category)) {
      return `${row.category || "Unknown category"} is not available for ${plan} market-wide Discovery.`;
    }
    return "";
  }

  if (!row.category || !isTickerAlertCategoryAllowed(plan, row.category)) {
    return `${row.category || "Unknown category"} is not a public ticker alert category.`;
  }
  return "";
}

async function suppressQueuedDeliveryForPolicy(
  row: QueuedAlertDeliveryRow,
  error: string,
  { dryRun, write }: { dryRun: boolean; write: boolean },
): Promise<ProcessQueuedDeliveryItemResult> {
  const result: ProcessQueuedDeliveryItemResult = {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    ticker: row.ticker,
    action: "suppressed",
    channels: [],
    duplicatesPrevented: 0,
    error: sanitizeError(error),
  };
  if (dryRun || !write) return result;

  const updated = await supabaseUpdate(
    "user_alert_deliveries",
    { id: `eq.${row.id}`, delivery_status: "eq.queued" },
    {
      delivery_status: "suppressed",
      delivered_channels: [],
      attempted_at: new Date().toISOString(),
      last_error: result.error,
    },
  );
  if (!updated.ok) {
    return markDeliveryFailed(
      row,
      sanitizeError(updated.error || "Failed to suppress an ineligible queued alert delivery."),
      0,
    );
  }
  return result;
}

async function fetchChannelRows(userId: string) {
  const result = await supabaseSelect("user_delivery_channels", {
    select: "channel,enabled,destination,verified_at",
    user_id: `eq.${userId}`,
    limit: "20",
  });
  if (!result.ok) {
    throw new Error(result.error || "Failed to read user delivery channels.");
  }

  const rows = new Map<AlertChannel, DeliveryChannelRow>();
  for (const row of Array.isArray(result.data)
    ? (result.data as DeliveryChannelRow[])
    : []) {
    const channel = readChannel(row.channel);
    if (channel) rows.set(channel, row);
  }
  return rows;
}

function isChannelReady(
  channel: AlertChannel,
  row: DeliveryChannelRow | undefined,
) {
  if (channel === "web") return row?.enabled === true;
  if (channel === "telegram") {
    return (
      process.env.ALERT_DELIVERY_SEND_TELEGRAM === "true" &&
      row?.enabled === true &&
      Boolean(readString(row.destination)) &&
      Boolean(readString(row.verified_at)) &&
      Boolean(process.env.TELEGRAM_BOT_TOKEN)
    );
  }
  return false;
}

function channelUnavailableReason(
  channel: AlertChannel,
  row: DeliveryChannelRow | undefined,
) {
  if (channel === "web") {
    return row?.enabled === true
      ? "Web delivery is unavailable."
      : "Web delivery is disabled.";
  }
  if (channel === "telegram") {
    if (process.env.ALERT_DELIVERY_SEND_TELEGRAM !== "true") {
      return "Telegram sending is disabled by ALERT_DELIVERY_SEND_TELEGRAM.";
    }
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return "Telegram bot token is not configured.";
    }
    if (row?.enabled !== true) return "Telegram delivery is disabled.";
    if (!readString(row.destination) || !readString(row.verified_at)) {
      return "Telegram is not connected and verified.";
    }
  }
  return `${channel} delivery is not implemented yet.`;
}

async function markDeliveryFailed(
  row: QueuedAlertDeliveryRow,
  error: string,
  duplicatesPrevented: number,
): Promise<ProcessQueuedDeliveryItemResult> {
  await supabaseUpdate(
    "user_alert_deliveries",
    { id: `eq.${row.id}`, delivery_status: "eq.queued" },
    {
      delivery_status: "failed",
      attempted_at: new Date().toISOString(),
      last_error: error,
    },
  );

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    ticker: row.ticker,
    action: "failed",
    channels: [],
    duplicatesPrevented,
    error,
  };
}

function formatQueuedTelegramMessage(row: QueuedAlertDeliveryRow) {
  const ticker = row.ticker || "Market";
  return [
    "STOCK RADAR Alert",
    `${ticker}: ${row.title}`,
    `Category: ${row.category || "other"}`,
  ].join("\n");
}

function readQueuedRow(value: unknown): QueuedAlertDeliveryRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = readString(row.id);
  const userId = readString(row.user_id);
  const title = readString(row.title);
  if (!id || !userId || !title) return null;

  return {
    id,
    user_id: userId,
    ticker: readString(row.ticker) || null,
    title,
    category: readString(row.category) as QueuedAlertDeliveryRow["category"],
    source_type: readString(
      row.source_type,
    ) as QueuedAlertDeliveryRow["source_type"],
    source_label: readString(row.source_label) || null,
    alert_lane: readString(
      row.alert_lane,
    ) as QueuedAlertDeliveryRow["alert_lane"],
    severity: readString(row.severity) as QueuedAlertDeliveryRow["severity"],
    delivered_channels: readChannels(row.delivered_channels),
    scheduled_for: readString(row.scheduled_for) || null,
    delivery_status: readString(
      row.delivery_status,
    ) as QueuedAlertDeliveryRow["delivery_status"],
    created_at: readString(row.created_at) || null,
  };
}

function readChannels(value: unknown): AlertChannel[] {
  if (!Array.isArray(value)) return [];
  return value.map(readChannel).filter(Boolean) as AlertChannel[];
}

function readChannel(value: unknown): AlertChannel | null {
  const channel = readString(value);
  if (
    channel === "web" ||
    channel === "telegram" ||
    channel === "email" ||
    channel === "webhook" ||
    channel === "api"
  ) {
    return channel;
  }
  return null;
}

function normalizeLimit(value: unknown) {
  const limit =
    typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), MAX_LIMIT));
}

function sanitizeError(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [REDACTED]")
    .replace(/bot[A-Za-z0-9:_-]+/g, "bot[REDACTED]")
    .slice(0, 500);
}

function readString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
