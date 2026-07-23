import "server-only";

import {
  type AlertCategory,
  type AlertChannel,
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
import {
  ALL_ALERT_CHANNELS,
  DEFAULT_ALERT_PREFERENCES,
  getChannelAvailabilityLabel,
  getChannelLockState,
} from "@/lib/alerts/alertValidation";
import type { AlertPreferences, AlertSettingsViewModel, DeliveredAlertItem, DeliveryChannelState } from "@/lib/alerts/types";

type AlertPreferencesRow = {
  watchlist_news_enabled?: unknown;
  watchlist_filings_enabled?: unknown;
  watchlist_calendar_enabled?: unknown;
  watchlist_risk_enabled?: unknown;
  discovery_enabled?: unknown;
  group_duplicates?: unknown;
  cooldown_minutes?: unknown;
};

type DeliveryChannelRow = {
  channel?: unknown;
  enabled?: unknown;
  destination?: unknown;
  verified_at?: unknown;
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
};

export async function getAlertSettingsViewModel(userId: string): Promise<AlertSettingsViewModel> {
  const planState = await getEffectiveUserPlan(userId);
  const plan = planState.effectivePlan;
  const limits = getPlanLimits(plan);

  const [watchlistResult, preferencesResult, categoriesResult, channelsResult, deliveriesResult] = await Promise.all([
    supabaseSelect("watchlist_tickers", {
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
      select: "channel,enabled,destination,verified_at",
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
  ]);

  const watchlistTickers = Array.isArray(watchlistResult.data)
    ? watchlistResult.count ?? watchlistResult.data.length
    : 0;
  const preferencesRow = Array.isArray(preferencesResult.data)
    ? (preferencesResult.data[0] as AlertPreferencesRow | undefined)
    : undefined;
  const selectedCategories = readSelectedCategories(categoriesResult.data);
  const channels = buildDeliveryChannels(plan, Array.isArray(channelsResult.data) ? channelsResult.data : []);
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
      watchlistTickers,
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
    },
    selectedCategories: [],
    selectedCategoryDetails: [],
    channels: buildDeliveryChannels(plan, [
      {
        channel: "web",
        enabled: true,
      },
    ]),
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
  lane?: "watchlist" | "market_discovery";
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
  };
}

function readSelectedCategories(data: unknown): AlertCategory[] {
  if (!Array.isArray(data)) return [];
  const allowed = new Set(getAllAlertCategoryValues());
  const selected: AlertCategory[] = [];

  for (const row of data as DiscoveryCategoryRow[]) {
    const category = stringValue(row.category);
    if (!allowed.has(category as AlertCategory)) continue;
    if (row.enabled !== true) continue;
    if (!selected.includes(category as AlertCategory)) {
      selected.push(category as AlertCategory);
    }
  }

  return selected;
}

function buildDeliveryChannels(plan: Parameters<typeof getChannelLockState>[0], rows: unknown[]): DeliveryChannelState[] {
  const rowsByChannel = new Map<AlertChannel, DeliveryChannelRow>();
  for (const row of rows as DeliveryChannelRow[]) {
    const channel = stringValue(row.channel);
    if (!isAlertChannel(channel)) continue;
    rowsByChannel.set(channel, row);
  }

  return ALL_ALERT_CHANNELS.map((channel) => {
    const locked = getChannelLockState(plan, channel);
    const available = !locked;
    const row = rowsByChannel.get(channel);
    const connected = isChannelConnected(channel, row);
    const enabled = available && connected && (row?.enabled === true);
    return {
      channel,
      label: formatChannels([channel]),
      available,
      enabled,
      locked,
      connected,
      availabilityLabel: getChannelAvailabilityLabel(plan, channel),
      statusLabel: getChannelStatusLabel({ available, connected, enabled }),
    };
  });
}

function isChannelConnected(channel: AlertChannel, row?: DeliveryChannelRow) {
  if (channel === "web") return true;
  if (!row) return false;
  return Boolean(stringValue(row.destination) || stringValue(row.verified_at));
}

function getChannelStatusLabel({
  available,
  connected,
  enabled,
}: {
  available: boolean;
  connected: boolean;
  enabled: boolean;
}) {
  if (!available) return "Locked";
  if (!connected) return "Not connected";
  return enabled ? "Enabled" : "Connected";
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
        severity: nullableString(row.severity),
        deliveredChannels: normalizeChannels(row.delivered_channels),
        deliveryStatus,
        deliveredAt,
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
  if (lane === "watchlist" || lane === "market_discovery") return lane;
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
