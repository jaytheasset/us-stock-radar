import "server-only";

import { sendTelegramMessage } from "@/lib/alerts/delivery/deliveryAdapters";
import { supabaseSelect, supabaseUpdate } from "@/lib/supabase";
import type { AlertChannel } from "@/lib/subscriptionPolicy";
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
    const result = await processQueuedDeliveryRow(row, { dryRun, write });
    items.push(result);
  }

  return {
    ok: true,
    dryRun,
    write,
    scanned: queuedRows.length,
    processed: write ? items.length : 0,
    wouldProcess: dryRun ? items.length : 0,
    sent: items.filter((item) => item.action === "sent").length,
    failed: items.filter((item) => item.action === "failed").length,
    suppressed: items.filter((item) => item.action === "suppressed").length,
    items,
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

  return (Array.isArray(result.data) ? result.data : []).map(readQueuedRow).filter(Boolean) as QueuedAlertDeliveryRow[];
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
  const channelResult = await processQueuedChannels(row, { dryRun });
  const channels = channelResult.channels;

  if (dryRun || !write) {
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      ticker: row.ticker,
      action: channels.length ? "would_send" : "suppressed",
      channels,
      error: channels.length ? channelResult.errors.join("; ") || undefined : "No enabled delivery channels available at processing time.",
    };
  }

  const attemptedAt = new Date().toISOString();
  if (!channels.length) {
    const updateResult = await supabaseUpdate(
      "user_alert_deliveries",
      { id: `eq.${row.id}` },
      {
        delivery_status: "suppressed",
        attempted_at: attemptedAt,
        last_error: "No enabled delivery channels available at processing time.",
      },
    );
    if (!updateResult.ok) {
      return markFailed(row, sanitizeError(updateResult.error || "Failed to suppress queued alert delivery."));
    }

    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      ticker: row.ticker,
      action: "suppressed",
      channels: [],
      error: channelResult.errors.join("; ") || "No enabled delivery channels available at processing time.",
    };
  }

  const sentAt = new Date().toISOString();
  const updateResult = await supabaseUpdate(
    "user_alert_deliveries",
    { id: `eq.${row.id}` },
    {
      delivery_status: "sent",
      delivered_channels: channels,
      attempted_at: attemptedAt,
      sent_at: sentAt,
      last_error: null,
    },
  );

  if (!updateResult.ok) {
    return markFailed(row, sanitizeError(updateResult.error || "Failed to mark queued alert delivery as sent."));
  }

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    ticker: row.ticker,
    action: "sent",
    channels,
  };
}

async function markFailed(row: QueuedAlertDeliveryRow, error: string): Promise<ProcessQueuedDeliveryItemResult> {
  await supabaseUpdate(
    "user_alert_deliveries",
    { id: `eq.${row.id}` },
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
    error,
  };
}

async function processQueuedChannels(
  row: QueuedAlertDeliveryRow,
  { dryRun }: { dryRun: boolean },
): Promise<{ channels: AlertChannel[]; errors: string[] }> {
  const requested = new Set(row.delivered_channels);
  if (!requested.size) return { channels: [], errors: [] };

  const result = await supabaseSelect("user_delivery_channels", {
    select: "channel,enabled,destination,verified_at",
    user_id: `eq.${row.user_id}`,
    limit: "20",
  });

  const channelRows = new Map<AlertChannel, DeliveryChannelRow>();
  if (result.ok && Array.isArray(result.data)) {
    for (const channelRow of result.data as DeliveryChannelRow[]) {
      const channel = readChannel(channelRow.channel);
      if (channel) channelRows.set(channel, channelRow);
    }
  }

  const processable: AlertChannel[] = [];
  const errors: string[] = [];
  for (const channel of requested) {
    const channelRow = channelRows.get(channel);
    if (channel === "web") {
      if (channelRow?.enabled === true) processable.push("web");
      continue;
    }

    if (channel === "telegram") {
      if (process.env.ALERT_DELIVERY_SEND_TELEGRAM !== "true") continue;
      const destination = readString(channelRow?.destination);
      if (channelRow?.enabled === true && destination && readString(channelRow.verified_at)) {
        if (dryRun) {
          processable.push("telegram");
          continue;
        }
        const sent = await sendTelegramMessage(destination, formatQueuedTelegramMessage(row));
        if (sent.ok) {
          processable.push("telegram");
        } else {
          errors.push(`telegram: ${sanitizeError(sent.error || "Telegram send failed")}`);
        }
      }
      continue;
    }

    errors.push(`${channel}: delivery adapter is not implemented yet.`);
  }
  return { channels: processable, errors };
}

function formatQueuedTelegramMessage(row: QueuedAlertDeliveryRow) {
  const ticker = row.ticker || "Market";
  return [`STOCK RADAR Alert`, `${ticker}: ${row.title}`, `Category: ${row.category || "other"}`].join("\n");
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
    source_type: readString(row.source_type) as QueuedAlertDeliveryRow["source_type"],
    source_label: readString(row.source_label) || null,
    alert_lane: readString(row.alert_lane) as QueuedAlertDeliveryRow["alert_lane"],
    severity: readString(row.severity) as QueuedAlertDeliveryRow["severity"],
    delivered_channels: readChannels(row.delivered_channels),
    scheduled_for: readString(row.scheduled_for) || null,
    delivery_status: readString(row.delivery_status) as QueuedAlertDeliveryRow["delivery_status"],
    created_at: readString(row.created_at) || null,
  };
}

function readChannels(value: unknown): AlertChannel[] {
  if (!Array.isArray(value)) return [];
  return value.map(readChannel).filter(Boolean) as AlertChannel[];
}

function readChannel(value: unknown): AlertChannel | null {
  const channel = readString(value);
  if (channel === "web" || channel === "telegram" || channel === "email" || channel === "webhook" || channel === "api") {
    return channel;
  }
  return null;
}

function normalizeLimit(value: unknown) {
  const limit = typeof value === "number" && Number.isFinite(value) ? value : DEFAULT_LIMIT;
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
