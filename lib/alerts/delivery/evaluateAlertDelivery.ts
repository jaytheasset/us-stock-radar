import "server-only";

import {
  getPlanLimits,
  isDiscoveryCategoryAllowed,
  type AlertCategory,
  type AlertChannel,
  type Plan,
} from "@/lib/subscriptionPolicy";
import { getEffectivePlanFromSubscription, type UserPlanSubscriptionRow } from "@/lib/subscription/effectivePlan";
import { supabaseSelect } from "@/lib/supabase";
import type {
  AlertDeliveryCandidate,
  AlertDeliveryEvaluation,
  AlertDeliverySkip,
  DeliveryCandidateChannel,
  NormalizedAlertEvent,
} from "@/lib/alerts/delivery/types";

type UserRow = {
  id?: unknown;
};

type PreferenceRow = {
  watchlist_news_enabled?: unknown;
  watchlist_filings_enabled?: unknown;
  watchlist_calendar_enabled?: unknown;
  watchlist_risk_enabled?: unknown;
  discovery_enabled?: unknown;
};

type WatchlistRow = {
  ticker?: unknown;
};

type DiscoveryCategoryRow = {
  category?: unknown;
};

type DeliveryChannelRow = {
  channel?: unknown;
  enabled?: unknown;
  destination?: unknown;
  verified_at?: unknown;
};

type UserAlertPreferences = {
  watchlistNewsEnabled: boolean;
  watchlistFilingsEnabled: boolean;
  watchlistCalendarEnabled: boolean;
  watchlistRiskEnabled: boolean;
  discoveryEnabled: boolean;
};

const DEFAULT_PREFERENCES: UserAlertPreferences = {
  watchlistNewsEnabled: true,
  watchlistFilingsEnabled: true,
  watchlistCalendarEnabled: true,
  watchlistRiskEnabled: true,
  discoveryEnabled: true,
};

const RISK_CATEGORIES = new Set<AlertCategory>([
  "listing_risk",
  "dilution_risk",
  "financial_risk",
  "legal_risk",
  "fda_clinical",
]);

const ALL_CHANNELS: AlertChannel[] = ["web", "telegram", "email", "webhook", "api"];

export async function evaluateAlertDeliveryForEvent(event: NormalizedAlertEvent): Promise<AlertDeliveryEvaluation> {
  if (event.category === "other") {
    return {
      event,
      candidates: [],
      skipped: [{ reason: "DISCOVERY_CATEGORY_NOT_ACTIVE", detail: "Internal fallback categories are not user alerts." }],
    };
  }

  if (!event.tickers.length) {
    return {
      event,
      candidates: [],
      skipped: [{ reason: "EVENT_HAS_NO_TICKERS", detail: "Watchlist and Discovery delivery require ticker linkage." }],
    };
  }

  const users = await fetchUsers();
  const candidates: AlertDeliveryCandidate[] = [];
  const skipped: AlertDeliverySkip[] = [];
  const now = new Date();

  for (const userId of users) {
    const context = await fetchUserContext(userId);
    const matchedTickers = event.tickers.filter((ticker) => context.watchlistTickers.has(ticker));
    const eligibleChannels = resolveEligibleChannels(context.plan, context.channels);

    if (!eligibleChannels.length) {
      skipped.push({ userId, reason: "NO_ENABLED_CHANNELS", detail: "No enabled, available, connected delivery channels." });
      continue;
    }

    if (matchedTickers.length) {
      const watchlistSkip = getWatchlistSkipReason(event, context.preferences);
      if (watchlistSkip) {
        skipped.push({ userId, reason: watchlistSkip });
        continue;
      }

      candidates.push(buildCandidate({ userId, plan: context.plan, alertLane: "watchlist", matchedTickers, eligibleChannels, now }));
      continue;
    }

    if (!context.preferences.discoveryEnabled) {
      skipped.push({ userId, reason: "DISCOVERY_DISABLED" });
      continue;
    }

    if (!context.discoveryCategories.has(event.category)) {
      skipped.push({ userId, reason: "DISCOVERY_CATEGORY_NOT_ACTIVE", detail: event.category });
      continue;
    }

    if (!isDiscoveryCategoryAllowed(context.plan, event.category)) {
      skipped.push({
        userId,
        reason: "DISCOVERY_CATEGORY_NOT_ACTIVE",
        detail: `${event.category} is not available for ${context.plan} market-wide Discovery.`,
      });
      continue;
    }

    candidates.push(
      buildCandidate({
        userId,
        plan: context.plan,
        alertLane: "market_discovery",
        matchedTickers: event.tickers,
        eligibleChannels,
        now,
      }),
    );
  }

  return { event, candidates, skipped };
}

async function fetchUsers() {
  const result = await supabaseSelect("user_profiles", {
    select: "id",
    limit: "500",
  });

  if (!result.ok || !Array.isArray(result.data)) return [];
  return (result.data as UserRow[]).map((row) => readString(row.id)).filter(Boolean);
}

async function fetchUserContext(userId: string) {
  const [planResult, preferencesResult, alertTickersResult, categoriesResult, channelsResult] = await Promise.all([
    supabaseSelect("user_plan_subscriptions", {
      select: "*",
      user_id: `eq.${userId}`,
      limit: "1",
    }),
    supabaseSelect("alert_preferences", {
      select:
        "watchlist_news_enabled,watchlist_filings_enabled,watchlist_calendar_enabled,watchlist_risk_enabled,discovery_enabled",
      user_id: `eq.${userId}`,
      limit: "1",
    }),
    supabaseSelect("user_alert_tickers", {
      select: "ticker",
      user_id: `eq.${userId}`,
      enabled: "eq.true",
      limit: "1000",
    }),
    supabaseSelect("user_discovery_categories", {
      select: "category",
      user_id: `eq.${userId}`,
      enabled: "eq.true",
      limit: "100",
    }),
    supabaseSelect("user_delivery_channels", {
      select: "channel,enabled,destination,verified_at",
      user_id: `eq.${userId}`,
      limit: "20",
    }),
  ]);

  return {
    plan: readPlan(Array.isArray(planResult.data) ? (planResult.data[0] as UserPlanSubscriptionRow | undefined) : undefined),
    preferences: readPreferences(Array.isArray(preferencesResult.data) ? (preferencesResult.data[0] as PreferenceRow | undefined) : undefined),
    watchlistTickers: new Set(
      (Array.isArray(alertTickersResult.data) ? (alertTickersResult.data as WatchlistRow[]) : [])
        .map((row) => readTicker(row.ticker))
        .filter(Boolean),
    ),
    discoveryCategories: new Set(
      (Array.isArray(categoriesResult.data) ? (categoriesResult.data as DiscoveryCategoryRow[]) : [])
        .map((row) => readString(row.category) as AlertCategory)
        .filter(Boolean),
    ),
    channels: Array.isArray(channelsResult.data) ? (channelsResult.data as DeliveryChannelRow[]) : [],
  };
}

function buildCandidate({
  userId,
  plan,
  alertLane,
  matchedTickers,
  eligibleChannels,
  now,
}: {
  userId: string;
  plan: Plan;
  alertLane: "watchlist" | "market_discovery";
  matchedTickers: string[];
  eligibleChannels: DeliveryCandidateChannel[];
  now: Date;
}): AlertDeliveryCandidate {
  const delayMinutes = getPlanLimits(plan).alertDelayMinutes;
  const scheduledFor = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
  return {
    userId,
    plan,
    alertLane,
    matchedTickers,
    eligibleChannels,
    scheduledFor,
    delayMinutes,
    deliveryStatus: delayMinutes > 0 ? "queued" : "sent",
  };
}

function getWatchlistSkipReason(event: NormalizedAlertEvent, preferences: UserAlertPreferences) {
  if (event.sourceType === "news" && !preferences.watchlistNewsEnabled) return "WATCHLIST_NEWS_DISABLED";
  if (event.sourceType === "filing" && !preferences.watchlistFilingsEnabled) return "WATCHLIST_FILINGS_DISABLED";
  if (event.sourceType === "calendar" && !preferences.watchlistCalendarEnabled) return "WATCHLIST_CALENDAR_DISABLED";
  if (RISK_CATEGORIES.has(event.category) && !preferences.watchlistRiskEnabled) return "WATCHLIST_RISK_DISABLED";
  return "";
}

function resolveEligibleChannels(plan: Plan, rows: DeliveryChannelRow[]): DeliveryCandidateChannel[] {
  const planChannels = new Set<AlertChannel>(getPlanLimits(plan).channels);
  const channelsByName = new Map<AlertChannel, DeliveryChannelRow>();
  for (const row of rows) {
    const channel = readChannel(row.channel);
    if (!channel) continue;
    channelsByName.set(channel, row);
  }

  const eligible: DeliveryCandidateChannel[] = [];
  for (const channel of ALL_CHANNELS) {
    if (!planChannels.has(channel)) continue;
    const row = channelsByName.get(channel);
    if (row?.enabled !== true) continue;
    const connected = isChannelConnected(channel, row);
    if (!connected) continue;
    eligible.push({
      channel,
      connected,
      destination: readString(row?.destination) || undefined,
    });
  }
  return eligible;
}

function isChannelConnected(channel: AlertChannel, row?: DeliveryChannelRow) {
  if (channel === "web") return true;
  return Boolean(readString(row?.destination) && readString(row?.verified_at));
}

function readPlan(row?: UserPlanSubscriptionRow): Plan {
  return getEffectivePlanFromSubscription(row).effectivePlan;
}

function readPreferences(row?: PreferenceRow): UserAlertPreferences {
  return {
    watchlistNewsEnabled: readBoolean(row?.watchlist_news_enabled, DEFAULT_PREFERENCES.watchlistNewsEnabled),
    watchlistFilingsEnabled: readBoolean(row?.watchlist_filings_enabled, DEFAULT_PREFERENCES.watchlistFilingsEnabled),
    watchlistCalendarEnabled: readBoolean(row?.watchlist_calendar_enabled, DEFAULT_PREFERENCES.watchlistCalendarEnabled),
    watchlistRiskEnabled: readBoolean(row?.watchlist_risk_enabled, DEFAULT_PREFERENCES.watchlistRiskEnabled),
    discoveryEnabled: readBoolean(row?.discovery_enabled, DEFAULT_PREFERENCES.discoveryEnabled),
  };
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readChannel(value: unknown): AlertChannel | null {
  const channel = readString(value);
  if (channel === "web" || channel === "telegram" || channel === "email" || channel === "webhook" || channel === "api") return channel;
  return null;
}

function readTicker(value: unknown) {
  return readString(value).toUpperCase();
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
