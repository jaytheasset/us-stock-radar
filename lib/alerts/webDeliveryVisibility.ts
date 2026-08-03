export type WebDeliveryEvidenceRow = Record<string, unknown> & {
  id?: unknown;
  delivery_status?: unknown;
  delivered_channels?: unknown;
  delivered_at?: unknown;
  web_delivery_attempts?: unknown;
};

type WebDeliveryQueryOptions = {
  userId: string;
  select?: string;
  limit?: number;
  offset?: number;
  lane?: "watchlist" | "market_discovery" | "calendar_follow";
  category?: string;
  unreadOnly?: boolean;
  deliveryId?: string;
};

const WEB_DELIVERY_ATTEMPT_SELECT = [
  "web_delivery_attempts:alert_delivery_channel_attempts(channel,status)",
  "sent_web_delivery_attempts:alert_delivery_channel_attempts(channel,status,completed_at)",
].join(",");
const WEB_DELIVERY_VISIBILITY_FILTER =
  "(sent_web_delivery_attempts.not.is.null,and(web_delivery_attempts.is.null,delivery_status.eq.sent,delivered_channels.cs.{web}))";

export function buildWebDeliveredAlertsQuery({
  userId,
  select = "*",
  limit = 20,
  offset = 0,
  lane,
  category,
  unreadOnly = false,
  deliveryId,
}: WebDeliveryQueryOptions): Record<string, string> {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.floor(limit), 100))
    : 20;
  const normalizedOffset = Number.isFinite(offset)
    ? Math.max(0, Math.floor(offset))
    : 0;
  const query: Record<string, string> = {
    select: `${select},${WEB_DELIVERY_ATTEMPT_SELECT}`,
    user_id: `eq.${userId}`,
    "web_delivery_attempts.user_id": `eq.${userId}`,
    "web_delivery_attempts.channel": "eq.web",
    "sent_web_delivery_attempts.user_id": `eq.${userId}`,
    "sent_web_delivery_attempts.channel": "eq.web",
    "sent_web_delivery_attempts.status": "eq.sent",
    or: WEB_DELIVERY_VISIBILITY_FILTER,
    order: "delivered_at.desc",
    limit: String(normalizedLimit),
    offset: String(normalizedOffset),
  };

  if (lane) query.alert_lane = `eq.${lane}`;
  if (category) query.category = `eq.${category}`;
  if (unreadOnly) query.read_at = "is.null";
  if (deliveryId) query.id = `eq.${deliveryId}`;

  return query;
}

export function normalizeWebDeliveredRows(rows: unknown[]): WebDeliveryEvidenceRow[] {
  const seen = new Set<string>();
  const normalized: WebDeliveryEvidenceRow[] = [];

  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as WebDeliveryEvidenceRow;
    const id = readString(row.id);
    if (!id || seen.has(id) || !hasWebDeliveryEvidence(row)) continue;

    seen.add(id);
    normalized.push({
      ...row,
      delivered_channels: ["web"],
      delivery_status: "sent",
      delivered_at: readWebCompletedAt(row) || row.delivered_at,
    });
  }

  return normalized;
}

export function hasWebDeliveryEvidence(row: WebDeliveryEvidenceRow) {
  if (readWebCompletedAt(row)) return true;

  return (
    (!Array.isArray(row.web_delivery_attempts) || row.web_delivery_attempts.length === 0) &&
    readString(row.delivery_status) === "sent" &&
    Array.isArray(row.delivered_channels) &&
    row.delivered_channels.includes("web")
  );
}

function readWebCompletedAt(row: WebDeliveryEvidenceRow) {
  const sentAttempts = (row as WebDeliveryEvidenceRow & {
    sent_web_delivery_attempts?: unknown;
  }).sent_web_delivery_attempts;
  if (!Array.isArray(sentAttempts)) return "";

  for (const value of sentAttempts) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const attempt = value as Record<string, unknown>;
    if (readString(attempt.channel) !== "web" || readString(attempt.status) !== "sent") continue;
    return readString(attempt.completed_at) || readString(row.delivered_at);
  }

  return "";
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
