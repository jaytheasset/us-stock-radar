import type { AlertCategory, AlertChannel, Plan, PlanLimits, PublicAlertCategory } from "@/lib/subscriptionPolicy";
import type { PlanSource, TrialState } from "@/lib/subscription/effectivePlan";

export type AlertPreferences = {
  watchlistNewsEnabled: boolean;
  watchlistFilingsEnabled: boolean;
  watchlistCalendarEnabled: boolean;
  watchlistRiskEnabled: boolean;
  discoveryEnabled: boolean;
  groupDuplicates: boolean;
  cooldownMinutes: number;
  marketCapFilters: string[];
  filingTypeFilters: string[];
};

export type DeliveryChannelState = {
  channel: AlertChannel;
  label: string;
  available: boolean;
  enabled: boolean;
  locked: boolean;
  connected: boolean;
  implemented: boolean;
  availabilityLabel: string;
  statusLabel: string;
  accountLabel?: string | null;
};

export type SelectedAlertCategory = {
  category: PublicAlertCategory;
  label: string;
  description: string;
};

export type DeliveredAlertItem = {
  id: string;
  ticker: string | null;
  title: string;
  category: AlertCategory | null;
  categoryLabel: string | null;
  sourceType: string | null;
  sourceLabel: string | null;
  alertLane: "watchlist" | "market_discovery" | "calendar_follow";
  calendarEventId: string | null;
  severity: string | null;
  deliveredChannels: AlertChannel[];
  deliveryStatus: "queued" | "sent" | "failed" | "suppressed";
  deliveredAt: string;
  readAt: string | null;
  isRead: boolean;
};

export type FollowedCalendarEventItem = {
  followId: string;
  eventId: string;
  title: string;
  eventType: string;
  eventDate: string;
  eventTime: string | null;
  lifecycleStatus: string;
  ticker: string | null;
  enabled: boolean;
};

export type CalendarEventFollowUsage = {
  activeCount: number;
  limit: number | null;
  remaining: number | null;
};

export type CalendarEventFollowsViewModel = {
  follows: FollowedCalendarEventItem[];
  usage: CalendarEventFollowUsage;
};

export type AlertSettingsViewModel = {
  guestMode?: boolean;
  plan: Plan;
  planLabel: string;
  basePlan?: Plan;
  effectivePlan?: Plan;
  planSource?: PlanSource;
  trial?: TrialState;
  limits: PlanLimits;
  usage: {
    watchlistTickers: number;
    discoveryCategories: number;
  };
  preferences: AlertPreferences;
  selectedCategories: PublicAlertCategory[];
  selectedCategoryDetails: SelectedAlertCategory[];
  channels: DeliveryChannelState[];
  followedCalendarEvents: FollowedCalendarEventItem[];
  calendarEventFollowUsage: CalendarEventFollowUsage;
  recentDeliveredAlerts: DeliveredAlertItem[];
};
