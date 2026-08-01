import "server-only";

import {
  type AlertCategory,
  type AlertChannel,
  type PublicAlertCategory,
  formatChannels,
  getAllAlertCategoryValues,
  getCategoryDescription,
  getCategoryLabel,
  getPlanDisplayName,
  getPlanLimits,
  isValidAlertCategory,
} from "@/lib/subscriptionPolicy";
import { getEffectiveUserPlan } from "@/lib/subscription/effectivePlan";
import { supabaseSelect } from "@/lib/supabase";
import { normalizeTelegramUsername } from "@/lib/telegram/telegramConnectPolicy";
import { getUserCalendarFollowsViewModel } from "@/lib/alerts/calendarFollows";
import {
  ALERT_FILING_TYPE_FILTERS,
  ALERT_MARKET_CAP_FILTERS,
  ALL_ALERT_CHANNELS,
  DEFAULT_ALERT_PREFERENCES,
  getChannelAvailabilityLabel,
  getChannelLockState,
  IMPLEMENTED_ALERT_CHANNELS,
} from "@/lib/alerts/alertValidation";
import type { AlertPreferences, AlertSettingsViewModel, DeliveredAlertItem, DeliveryChannelState } from "@/lib/alerts/types";
import { getAuthUserById, getVerifiedAuthEmail, maskEmailAddress } from "@/lib/auth/getAuthUserById";
import { getAlertEmailConfig } from "@/lib/alerts/emailConfig";

type AlertPreferencesRow = {
  watchlist_news_enabled?: unknown;
  watchlist_filings_enabled?: unknown;
  watchlist_calendar_enabled?: unknown;
  watchlist_risk_enabled?: unknown;
  discovery_enabled?: unknown;
  group_duplicates?: unknown;
  cooldown_minutes?: unknown;
  market_cap_filters?: unknown;
  filing_type_filters?: unknown;
};

type DeliveryChannelRow = {
  channel?: unknown;
  enabled?: unknown;
  destination?: unknown;
  verified_at?: unknown;
  metadata?: unknown;
};

type DiscoveryCategoryRow = {
  category?: unknown;
  enabled?: unknown;
};

type DeliveredAlertRow = {
  id?: unknown;
  ticker?: unknown;
  title?: unknown;
  category?: unknown;
  source_type?: unknown;
  source_label?: unknown;
  alert_lane?: unknown;
  severity?: unknown;
  delivered_channels?: unknown;
  delivery_status?: unknown;
  delivered_at?: unknown;
  calendar_event_id?: unknown;
  read_at?: unknown;
};

type EmailAttemptRow = { status?: unknown; provider_status?: unknown; updated_at?: unknown };

export async function getAlertSettingsViewModel(userId: string): Promise<AlertSettingsViewModel> {
  const planState = await getEffectiveUserPlan(userId);
  const plan = planState.effectivePlan;
  const limits = getPlanLimits(plan);

  const [
    alertTickersResult,
    preferencesResult,
    categoriesResult,
    channelsResult,
    deliveriesResult,
    calendarEventFollows,
    authUser,
    emailAttemptsResult,
  ] = await Promise.all([
    supabaseSelect("user_alert_tickers", {
      select: "id",
      user_id: `eq.${userId}`,
      limit: "1000",
    }),
    supabaseSelect("alert_preferences", {
      select: "*",
      user_id: `eq.${userId}`,
      limit: "1",
    }),
    supabaseSelect("user_discovery_categories", {
      select: "category,enabled",
      user_id: `eq.${userId}`,
      enabled: "eq.true",
      order: "created_at.asc",
      limit: "100",
    }),
    supabaseSelect("user_delivery_channels", {
      select: "channel,enabled,destination,verified_at,metadata",
      user_id: `eq.${userId}`,
      limit: "20",
    }),
    supabaseSelect("user_alert_deliveries", {
      select: "*",
      user_id: `eq.${userId}`,
      delivery_status: "eq.sent",
      order: "delivered_at.desc",
      limit: "5",
    }),
    getUserCalendarFollowsViewModel(userId, plan),
    getAuthUserById(userId),
    supabaseSelect("alert_delivery_channel_attempts", {
      select: "status,provider_status,updated_at",
      user_id: `eq.${userId}`,
      channel: "eq.email",
      order: "updated_at.desc",
      limit: "1",
    }),
  ]);

  const alertTickers = Array.isArray(alertTickersResult.data)
    ? alertTickersResult.count ?? alertTickersResult.data.length
    : 0;
  const preferencesRow = Array.isArray(preferencesResult.data)
    ? (preferencesResult.data[0] as AlertPreferencesRow | undefined)
    : undefined;
  const allowedDiscoveryCategories = new Set(limits.discoveryCategories);
  const selectedCategories = readSelectedCategories(categoriesResult.data).filter((category) =>
    allowedDiscoveryCategories.has(category),
  );
  const channels = buildDeliveryChannels(
    plan,
    Array.isArray(channelsResult.data) ? channelsResult.data : [],
    getVerifiedAuthEmail(authUser),
    Array.isArray(emailAttemptsResult.data) ? emailAttemptsResult.data[0] as EmailAttemptRow | undefined : undefined,
  );
  const recentDeliveredAlerts = mapDeliveredAlerts(Array.isArray(deliveriesResult.data) ? deliveriesResult.data : []);

  return {
    plan,
    planLabel: getPlanDisplayName(plan),
    basePlan: planState.basePlan,
    effectivePlan: planState.effectivePlan,
    planSource: planState.planSource,
    trial: planState.trial,
    limits,
    usage: {
      watchlistTickers: alertTickers,
      discoveryCategories: selectedCategories.length,
    },
    preferences: mapPreferences(preferencesRow),
    selectedCategories,
    selectedCategoryDetails: selectedCategories.map((category) => ({
      category,
      label: getCategoryLabel(category),
      description: getCategoryDescription(category),
    })),
    channels,
    followedCalendarEvents: calendarEventFollows.follows,
    calendarEventFollowUsage: calendarEventFollows.usage,
    recentDeliveredAlerts,
  };
}

export function getGuestAlertSettingsViewModel(): AlertSettingsViewModel {
  const plan = "free";
  const limits = getPlanLimits(plan);

  return {
    guestMode: true,
    plan,
    planLabel: getPlanDisplayName(plan),
    basePlan: plan,
    effectivePlan: plan,
    planSource: "base",
    trial: {
      active: false,
      used: false,
    },
    limits,
    usage: {
      watchlistTickers: 0,
      discoveryCategories: 0,
    },
    preferences: {
      ...DEFAULT_ALERT_PREFERENCES,
      marketCapFilters: [...DEFAULT_ALERT_PREFERENCES.marketCapFilters],
      filingTypeFilters: [...DEFAULT_ALERT_PREFERENCES.filingTypeFilters],
    },
    selectedCategories: [],
    selectedCategoryDetails: [],
    channels: buildDeliveryChannels(plan, [
      {
        channel: "web",
        enabled: true,
      },
    ], null, undefined),
    followedCalendarEvents: [],
    calendarEventFollowUsage: {
      activeCount: 0,
      limit: limits.calendarEventFollowLimit,
      remaining: limits.calendarEventFollowLimit,
    },
    recentDeliveredAlerts: [],
  };
}

export async function getDeliveredAlertsForUser({
  userId,
  limit = 20,
  offset = 0,
  lane,
  category,
  status = "sent",
}: {
  userId: string;
  limit?: number;
  offset?: number;
  lane?: "watchlist" | "market_discovery" | "calendar_follow";
  category?: AlertCategory;
  status?: DeliveryStatusFilter;
}) {
  const query: Record<string, string> = {
    select: "*",
    user_id: `eq.${userId}`,
    order: "delivered_at.desc",
    limit: String(Math.max(1, Math.min(limit, 100))),
    offset: String(Math.max(0, Math.floor(offset))),
  };

  if (lane) query.alert_lane = `eq.${lane}`;
  if (category) query.category = `eq.${category}`;
  if (status !== "all") query.delivery_status = `eq.${status}`;

  const result = await supabaseSelect("user_alert_deliveries", query);

  return {
    ok: result.ok,
    status: result.status,
    data: mapDeliveredAlerts(Array.isArray(result.data) ? result.data : []),
    total: result.count ?? 0,
    error: result.error,
  };
}

export async function getUnreadAlertCountForUser(userId: string) {
  const result = await supabaseSelect("user_alert_deliveries", {
    select: "id",
    user_id: `eq.${userId}`,
    delivery_status: "eq.sent",
    read_at: "is.null",
    limit: "1",
  });

  return {
    ok: result.ok,
    status: result.status,
    count: result.count ?? 0,
    error: result.error,
  };
}

export type DeliveryStatusFilter = "queued" | "sent" | "failed" | "suppressed" | "all";

function mapPreferences(row?: AlertPreferencesRow): AlertPreferences {
  return {
    watchlistNewsEnabled: booleanValue(row?.watchlist_news_enabled, DEFAULT_ALERT_PREFERENCES.watchlistNewsEnabled),
    watchlistFilingsEnabled: booleanValue(row?.watchlist_filings_enabled, DEFAULT_ALERT_PREFERENCES.watchlistFilingsEnabled),
    watchlistCalendarEnabled: booleanValue(row?.watchlist_calendar_enabled, DEFAULT_ALERT_PREFERENCES.watchlistCalendarEnabled),
    watchlistRiskEnabled: booleanValue(row?.watchlist_risk_enabled, DEFAULT_ALERT_PREFERENCES.watchlistRiskEnabled),
    discoveryEnabled: booleanValue(row?.discovery_enabled, DEFAULT_ALERT_PREFERENCES.discoveryEnabled),
    groupDuplicates: booleanValue(row?.group_duplicates, DEFAULT_ALERT_PREFERENCES.groupDuplicates),
    cooldownMinutes: numberValue(row?.cooldown_minutes, DEFAULT_ALERT_PREFERENCES.cooldownMinutes),
    marketCapFilters: stringArrayValue(
      row?.market_cap_filters,
      ALERT_MARKET_CAP_FILTERS,
      DEFAULT_ALERT_PREFERENCES.marketCapFilters,
    ),
    filingTypeFilters: stringArrayValue(
      row?.filing_type_filters,
      ALERT_FILING_TYPE_FILTERS,
      DEFAULT_ALERT_PREFERENCES.filingTypeFilters,
    ),
  };
}

function readSelectedCategories(data: unknown): PublicAlertCategory[] {
  if (!Array.isArray(data)) return [];
  const allowed = new Set(getAllAlertCategoryValues());
  const selected: PublicAlertCategory[] = [];

  for (const row of data as DiscoveryCategoryRow[]) {
    const category = stringValue(row.category);
    if (!allowed.has(category as PublicAlertCategory)) continue;
    if (row.enabled !== true) continue;
    if (!selected.includes(category as PublicAlertCategory)) {
      selected.push(category as PublicAlertCategory);
    }
  }

  return selected;
}

function buildDeliveryChannels(
  plan: Parameters<typeof getChannelLockState>[0],
  rows: unknown[],
  authEmail: { email: string; verifiedAt: string } | null,
  recentEmailAttempt?: EmailAttemptRow,
): DeliveryChannelState[] {
  const rowsByChannel = new Map<AlertChannel, DeliveryChannelRow>();
  for (const row of rows as DeliveryChannelRow[]) {
    const channel = stringValue(row.channel);
    if (!isAlertChannel(channel)) continue;
    rowsByChannel.set(channel, row);
  }

  return ALL_ALERT_CHANNELS.map((channel) => {
    const implemented = IMPLEMENTED_ALERT_CHANNELS.includes(channel);
    const locked = getChannelLockState(plan, channel);
    const available = !locked && implemented;
    const row = rowsByChannel.get(channel);
    const emailConfig = getAlertEmailConfig();
    const connected = channel === "email" ? Boolean(authEmail) : isChannelConnected(channel, row);
    const accountLabel = channel === "telegram"
      ? readTelegramAccountLabel(row?.metadata)
      : channel === "email" && authEmail ? maskEmailAddress(authEmail.email) : null;
    const suppressed = channel === "email" && isEmailSuppressed(row?.metadata);
    const configured = channel !== "email" || emailConfig.configured;
    const canEnable = available && connected && configured && !suppressed;
    const enabled =
      canEnable &&
      connected &&
      (row?.enabled === true || (channel === "web" && !row));
    return {
      channel,
      label: formatChannels([channel]),
      available,
      enabled,
      locked,
      connected,
      implemented,
      availabilityLabel: getChannelAvailabilityLabel(plan, channel),
      statusLabel: implemented
        ? getChannelStatusLabel({ channel, available, connected, enabled, accountLabel, configured, sendingEnabled: emailConfig.sendingEnabled, suppressed })
        : "Not available",
      accountLabel,
      canEnable,
      configured,
      sendingEnabled: channel === "email" ? emailConfig.sendingEnabled : undefined,
      suppressed,
      recentStatusLabel: channel === "email" ? formatEmailAttemptStatus(recentEmailAttempt) : null,
    };
  });
}

function isChannelConnected(channel: AlertChannel, row?: DeliveryChannelRow) {
  if (channel === "web") return true;
  if (!row) return false;
  return Boolean(stringValue(row.destination) || stringValue(row.verified_at));
}

function getChannelStatusLabel({
  channel,
  available,
  connected,
  enabled,
  accountLabel,
  configured,
  sendingEnabled,
  suppressed,
}: {
  channel: AlertChannel;
  available: boolean;
  connected: boolean;
  enabled: boolean;
  accountLabel: string | null;
  configured: boolean;
  sendingEnabled: boolean;
  suppressed: boolean;
}) {
  if (channel === "telegram" && connected) {
    return accountLabel ? `Connected · ${accountLabel}` : "Connected";
  }
  if (!available) return "Locked";
  if (channel === "email") {
    if (!connected) return "Verify your account email";
    if (!configured) return "Email delivery is not configured";
    if (suppressed) return "Paused after a delivery safety event";
    if (enabled && !sendingEnabled) {
      return accountLabel ? `Enabled · ${accountLabel} · Delivery paused` : "Enabled · Delivery paused";
    }
    if (enabled) return accountLabel ? `Enabled · ${accountLabel}` : "Enabled";
    return accountLabel ? `Ready · ${accountLabel}` : "Ready";
  }
  if (!connected) return "Not connected";
  return enabled ? "Enabled" : "Connected";
}

function isEmailSuppressed(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as { email_suppressed?: unknown }).email_suppressed === true);
}

function formatEmailAttemptStatus(row?: EmailAttemptRow) {
  const provider = stringValue(row?.provider_status);
  const status = provider || stringValue(row?.status);
  if (!status) return null;
  const labels: Record<string, string> = {
    "email.delivered": "Recent: Delivered",
    "email.bounced": "Recent: Bounced",
    "email.complained": "Recent: Complaint received",
    "email.suppressed": "Recent: Suppressed",
    sent: "Recent: Sent",
    failed: "Recent: Failed",
    uncertain: "Recent: Needs review",
    attempting: "Recent: Sending",
  };
  return labels[status] || null;
}

function readTelegramAccountLabel(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return normalizeTelegramUsername((value as { username?: unknown }).username);
}

function mapDeliveredAlerts(rows: unknown[]): DeliveredAlertItem[] {
  return rows.flatMap((rowValue) => {
    const row = rowValue as DeliveredAlertRow;
    const id = stringValue(row.id);
    const title = stringValue(row.title);
    const alertLane = normalizeLane(row.alert_lane);
    const deliveryStatus = normalizeDeliveryStatus(row.delivery_status);
    const deliveredAt = stringValue(row.delivered_at);

    if (!id || !title || !alertLane || !deliveryStatus || !deliveredAt) return [];

    const category = normalizeCategory(row.category);
    return [
      {
        id,
        ticker: nullableString(row.ticker),
        title,
        category,
        categoryLabel: category ? getCategoryLabel(category) : null,
        sourceType: nullableString(row.source_type),
        sourceLabel: nullableString(row.source_label),
        alertLane,
        calendarEventId: nullableString(row.calendar_event_id),
        severity: nullableString(row.severity),
        deliveredChannels: normalizeChannels(row.delivered_channels),
        deliveryStatus,
        deliveredAt,
        readAt: nullableString(row.read_at),
        isRead: Boolean(nullableString(row.read_at)),
      },
    ];
  });
}

function normalizeCategory(value: unknown) {
  const category = stringValue(value);
  return isValidAlertCategory(category) ? category : null;
}

function normalizeLane(value: unknown) {
  const lane = stringValue(value);
  if (
    lane === "watchlist" ||
    lane === "market_discovery" ||
    lane === "calendar_follow"
  ) {
    return lane;
  }
  return null;
}

function normalizeDeliveryStatus(value: unknown) {
  const status = stringValue(value);
  if (status === "queued" || status === "sent" || status === "failed" || status === "suppressed") return status;
  return null;
}

function normalizeChannels(value: unknown): AlertChannel[] {
  if (!Array.isArray(value)) return [];
  return value.filter((channel): channel is AlertChannel => typeof channel === "string" && isAlertChannel(channel));
}

function isAlertChannel(value: string): value is AlertChannel {
  return value === "web" || value === "telegram" || value === "email" || value === "webhook" || value === "api";
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function stringArrayValue(
  value: unknown,
  allowedValues: readonly string[],
  fallback: readonly string[],
) {
  if (!Array.isArray(value)) return [...fallback];
  const allowed = new Set(allowedValues);
  return value.filter(
    (item): item is string => typeof item === "string" && allowed.has(item),
  );
}
