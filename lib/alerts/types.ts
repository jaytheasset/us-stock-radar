import type { AlertCategory, AlertChannel, Plan, PlanLimits } from "@/lib/subscriptionPolicy";

export type AlertPreferences = {
  watchlistNewsEnabled: boolean;
  watchlistFilingsEnabled: boolean;
  watchlistCalendarEnabled: boolean;
  watchlistRiskEnabled: boolean;
  discoveryEnabled: boolean;
  groupDuplicates: boolean;
  cooldownMinutes: number;
};

export type DeliveryChannelState = {
  channel: AlertChannel;
  label: string;
  available: boolean;
  enabled: boolean;
  locked: boolean;
  connected: boolean;
  availabilityLabel: string;
  statusLabel: string;
};

export type SelectedAlertCategory = {
  category: AlertCategory;
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
  alertLane: "watchlist" | "market_discovery";
  severity: string | null;
  deliveredChannels: AlertChannel[];
  deliveryStatus: "queued" | "sent" | "failed" | "suppressed";
  deliveredAt: string;
};

export type AlertSettingsViewModel = {
  plan: Plan;
  planLabel: string;
  limits: PlanLimits;
  usage: {
    watchlistTickers: number;
    discoveryCategories: number;
  };
  preferences: AlertPreferences;
  selectedCategories: AlertCategory[];
  selectedCategoryDetails: SelectedAlertCategory[];
  channels: DeliveryChannelState[];
  recentDeliveredAlerts: DeliveredAlertItem[];
};
