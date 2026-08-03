"use client";

import { Check, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { AuthStatus } from "@/components/AuthStatus";
import { AdvancedTrialCta } from "@/components/AdvancedTrialCta";
import type { AlertPreferences, AlertSettingsViewModel, DeliveredAlertItem } from "@/lib/alerts/types";
import {
  ALERT_CATEGORIES,
  type AlertCategory,
  type AlertChannel,
  type Plan,
  type PublicAlertCategory,
  formatAlertSpeed,
  formatLimit,
  getCategoryDescription,
  getCategoryLabel,
  getPlanDisplayName,
  getPlanUpgradeTarget,
} from "@/lib/subscriptionPolicy";

type AlertsClientProps = {
  initialSettings: AlertSettingsViewModel;
};

type AlertsTab = "Alert Settings" | "Delivered Alerts" | "Delivery Channels" | "Muted & Grouping";
type SaveState = "idle" | "saving" | "recent" | "failed";
type DeliveredFilter = "all" | "watchlist" | "market_discovery" | "news" | "filings";
type BooleanPreferenceKey = Exclude<
  keyof AlertPreferences,
  "cooldownMinutes" | "marketCapFilters" | "filingTypeFilters"
>;
type TelegramConnectState = "idle" | "generating" | "opened" | "failed";

const navItems = [
  { label: "Live Feed", href: "/feed" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "News", href: "/news" },
  { label: "Filings", href: "/filings" },
  { label: "Calendar", href: "/calendar" },
  { label: "Alerts", href: "/alerts" },
  { label: "Premium", href: "/premium" },
];

const tabs: AlertsTab[] = ["Alert Settings", "Delivered Alerts", "Delivery Channels", "Muted & Grouping"];

const watchlistToggleRows: {
  key: BooleanPreferenceKey;
  label: string;
  detail: string;
}[] = [
  {
    key: "watchlistNewsEnabled",
    label: "News Alerts",
    detail: "Company news, press releases, and source updates for your Watchlist tickers.",
  },
  {
    key: "watchlistFilingsEnabled",
    label: "Filing Alerts",
    detail: "SEC filings and filing-derived risk signals for your watchlist.",
  },
  {
    key: "watchlistCalendarEnabled",
    label: "Calendar Alerts",
    detail: "Earnings dates, filing deadlines, and upcoming watchlist events.",
  },
  {
    key: "watchlistRiskEnabled",
    label: "Risk Alerts",
    detail: "Important risk signals detected for your Watchlist tickers.",
  },
];

const categoryTone: Record<AlertCategory, string> = {
  listing_risk: "risk",
  dilution_risk: "risk",
  earnings: "performance",
  sales_performance: "performance",
  product_update: "performance",
  leadership_governance: "governance",
  insider_ownership: "governance",
  shareholder_vote: "governance",
  strategic_transaction: "transaction",
  financial_risk: "risk",
  legal_risk: "risk",
  dividends: "performance",
  capital_return: "performance",
  ipo_listing: "transaction",
  fda_clinical: "policy",
  policy_regulation: "policy",
  macro_market: "policy",
  other: "neutral",
};

const alertLanes = [
  {
    label: "Ticker Alerts",
    detail: "Every alert-enabled ticker is covered across all 17 public event categories.",
  },
  {
    label: "Market Discovery Alerts",
    detail: "For events outside your watchlist based on selected categories and plan filters.",
  },
];

const channelRequirements: Record<AlertChannel, string> = {
  web: "Available on all plans",
  telegram: "Included in Pro and higher",
  email: "Advanced and higher",
  webhook: "Ultimate only",
  api: "Ultimate only",
};

export default function AlertsClient({ initialSettings }: AlertsClientProps) {
  const [settings, setSettings] = useState(initialSettings);
  const [activeTab, setActiveTab] = useState<AlertsTab>("Alert Settings");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deliveredFilter, setDeliveredFilter] = useState<DeliveredFilter>("all");
  const [deliveredAlerts, setDeliveredAlerts] = useState<DeliveredAlertItem[]>(initialSettings.recentDeliveredAlerts);
  const [recentDeliveredAlerts, setRecentDeliveredAlerts] = useState<DeliveredAlertItem[]>(initialSettings.recentDeliveredAlerts);
  const [deliveredLoading, setDeliveredLoading] = useState(false);
  const [telegramConnectState, setTelegramConnectState] = useState<TelegramConnectState>("idle");
  const [telegramConnectMessage, setTelegramConnectMessage] = useState<string | null>(null);

  const selectedCategorySet = useMemo(() => new Set(settings.selectedCategories), [settings.selectedCategories]);
  const availableDiscoveryCategories = useMemo(
    () => new Set(settings.limits.discoveryCategories),
    [settings.limits.discoveryCategories],
  );
  const enabledChannels = settings.channels.filter((channel) => channel.enabled);
  const availableChannels = settings.channels.filter((channel) => !channel.locked);
  const statusCards = [
    {
      label: "Alert tickers",
      value: `${settings.usage.watchlistTickers} / ${formatLimit(settings.limits.alertTickerLimit)}`,
      detail: "enabled for all 17 event types",
    },
    {
      label: "Discovery alert categories",
      value: `${settings.usage.discoveryCategories} selected`,
      detail: `${settings.limits.discoveryCategories.length} available on this plan`,
    },
    {
      label: "Alert speed",
      value: formatAlertSpeed(settings.plan),
      detail: settings.limits.realTime ? "no delivery delay" : `${settings.limits.alertDelayMinutes}-minute delivery delay`,
    },
    {
      label: "Channels",
      value: enabledChannels.length ? enabledChannels.map((channel) => channel.label).join(", ") : "None enabled",
      detail: `${availableChannels.length} channels available`,
    },
  ];
  const upgradeCard = getUpgradeCard(settings);
  const filteredDeliveredAlerts = useMemo(
    () => filterDeliveredAlerts(deliveredAlerts, deliveredFilter),
    [deliveredAlerts, deliveredFilter],
  );

  async function savePreferences(nextPreferences: AlertPreferences, previousSettings: AlertSettingsViewModel) {
    setSaveState("saving");
    setErrorMessage(null);

    if (previousSettings.guestMode) {
      setSaveState("idle");
      return;
    }

    try {
      const response = await fetch("/api/alerts/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextPreferences),
      });
      const payload = (await response.json().catch(() => null)) as SettingsApiResponse | null;

      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(payload?.message || "Failed to save alert preferences.");
      }

      setSettings(payload.data);
      setSaveState("recent");
    } catch (error) {
      setSettings(previousSettings);
      setSaveState("failed");
      setErrorMessage(error instanceof Error ? error.message : "Failed to save alert preferences.");
    }
  }

  function togglePreference(key: BooleanPreferenceKey, enabled: boolean) {
    const previousSettings = settings;
    const nextPreferences = {
      ...settings.preferences,
      [key]: enabled,
    };

    setSettings({
      ...settings,
      preferences: nextPreferences,
    });
    void savePreferences(nextPreferences, previousSettings);
  }

  function toggleDiscoveryCategory(category: PublicAlertCategory) {
    const previousSettings = settings;
    const isSelected = selectedCategorySet.has(category);
    const nextCategories = isSelected
      ? settings.selectedCategories.filter((selectedCategory) => selectedCategory !== category)
      : [...settings.selectedCategories, category];

    if (!isSelected && !availableDiscoveryCategories.has(category)) {
      setSaveState("failed");
      setErrorMessage(
        `${getPlanDisplayName(settings.plan)} includes the 12 Core Market Events for market-wide Discovery. Advanced unlocks all 17 public categories.`,
      );
      return;
    }

    setErrorMessage(null);
    setSettings(applySelectedCategories(settings, nextCategories));
    void saveDiscoveryCategories(nextCategories, previousSettings);
  }

  async function saveDiscoveryCategories(categories: PublicAlertCategory[], previousSettings: AlertSettingsViewModel) {
    setSaveState("saving");

    if (previousSettings.guestMode) {
      setSaveState("idle");
      return;
    }

    try {
      const response = await fetch("/api/alerts/discovery-categories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories }),
      });
      const payload = (await response.json().catch(() => null)) as SettingsApiResponse | null;

      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(payload?.message || "Failed to save Discovery categories.");
      }

      setSettings(payload.data);
      setSaveState("recent");
    } catch (error) {
      setSettings(previousSettings);
      setSaveState("failed");
      setErrorMessage(error instanceof Error ? error.message : "Failed to save Discovery categories.");
    }
  }

  async function loadDeliveredAlerts(nextFilter: DeliveredFilter, updateRecent = false) {
    setDeliveredFilter(nextFilter);
    setDeliveredLoading(true);
    setErrorMessage(null);

    try {
      const params = new URLSearchParams({ limit: "50" });
      if (nextFilter === "watchlist" || nextFilter === "market_discovery") {
        params.set("lane", nextFilter);
      }
      const response = await fetch(`/api/alerts/delivered?${params.toString()}`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as DeliveredAlertItem[] | ApiError | null;

      if (!response.ok || !Array.isArray(payload)) {
        throw new Error(!Array.isArray(payload) && payload?.message ? payload.message : "Failed to load delivered alerts.");
      }

      setDeliveredAlerts(payload);
      if (updateRecent || nextFilter === "all") {
        setRecentDeliveredAlerts(payload.slice(0, 5));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load delivered alerts.");
    } finally {
      setDeliveredLoading(false);
    }
  }

  async function refreshSettings() {
    setSaveState("saving");
    setErrorMessage(null);

    try {
      const response = await fetch("/api/alerts/settings", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as SettingsApiResponse | null;

      if (!response.ok || !payload?.ok || !payload.data) {
        throw new Error(payload?.message || "Failed to refresh alert settings.");
      }

      setSettings(payload.data);
      setRecentDeliveredAlerts(payload.data.recentDeliveredAlerts);
      setDeliveredAlerts(payload.data.recentDeliveredAlerts);
      setSaveState("recent");
    } catch (error) {
      setSaveState("failed");
      setErrorMessage(error instanceof Error ? error.message : "Failed to refresh alert settings.");
    }
  }

  async function connectTelegram() {
    setTelegramConnectState("generating");
    setTelegramConnectMessage(null);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/alerts/channels/telegram/connect", {
        method: "POST",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as TelegramConnectApiResponse | null;

      if (!response.ok || !payload || !payload.ok) {
        throw new Error(payload && !payload.ok ? payload.message || "Failed to create Telegram connection link." : "Failed to create Telegram connection link.");
      }

      window.open(payload.connectUrl, "_blank", "noopener,noreferrer");
      setTelegramConnectState("opened");
      setTelegramConnectMessage("Telegram link opened. Press Start in Telegram, then refresh this status.");
    } catch (error) {
      setTelegramConnectState("failed");
      setTelegramConnectMessage(error instanceof Error ? error.message : "Failed to start Telegram connection.");
    }
  }

  function activateTab(tab: AlertsTab) {
    setActiveTab(tab);
    if (tab === "Delivered Alerts") {
      void loadDeliveredAlerts(deliveredFilter);
    }
  }

  return (
    <main className="alerts-page">
      <header className="feed-nav alerts-top-nav">
        <Link className="brand-lockup" href="/feed" aria-label="US Stock Radar feed">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </Link>
        <nav className="feed-nav-links" aria-label="Primary">
          {navItems.map((item) => (
            <Link className={item.label === "Alerts" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="feed-search alerts-nav-search" role="search">
          <Search aria-hidden="true" size={15} />
          <input aria-label="Search alerts" placeholder="Search stocks, companies, events..." />
        </div>
        <AuthStatus />
      </header>

      <section className="alerts-shell">
        <section className="alerts-hero">
          <div>
            <h1>Alert Center</h1>
            <p>
              Choose which alerts get delivered to you. Browse all alert-tagged events in the{" "}
              <Link href="/feed">Feed</Link>.
            </p>
          </div>
          <div className="alerts-plan-badge">
            <span>Current plan</span>
            <strong>
              {settings.planLabel || getPlanDisplayName(settings.plan)} - {formatAlertSpeed(settings.plan)}
            </strong>
            {settings.trial?.active ? (
              <small className="alerts-trial-note">
                {getPlanDisplayName(settings.trial.plan ?? "advanced")} Trial Active - {settings.trial.daysRemaining ?? 14} days
                remaining
              </small>
            ) : null}
            <Link href="/premium">Manage Plan</Link>
          </div>
        </section>

        <section className="alerts-status-grid" aria-label="Current plan status">
          {statusCards.map((card) => (
            <article className="alerts-status-card" key={card.label}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.detail}</small>
            </article>
          ))}
        </section>

        <section className="alerts-delivery-banner">
          <strong>Watchlist alerts are separate from Market Discovery categories.</strong>
          <p>Plan limits control personalized delivery, not what you can browse in the Feed.</p>
        </section>

        {settings.guestMode ? (
          <section className="alerts-delivery-banner">
            <strong>Create an account to save your alert settings.</strong>
            <p>
              This guest view is a local preview only. <Link href="/signup">Sign up</Link> or <Link href="/login">log in</Link> to
              save settings, connect Telegram, and keep delivery history.
            </p>
          </section>
        ) : null}

        <nav className="alerts-tabs" aria-label="Alert settings tabs">
          {tabs.map((tab) => (
            <button className={activeTab === tab ? "active" : ""} key={tab} onClick={() => activateTab(tab)} type="button">
              {tab}
            </button>
          ))}
          <span className={`alerts-save-state state-${saveState}`}>
            {settings.guestMode ? "Guest preview - not saved" : getSaveStateText(saveState)}
          </span>
        </nav>

        {errorMessage ? <div className="alerts-error-message">{errorMessage}</div> : null}

        <section className="alerts-dashboard-grid">
          <div className="alerts-dashboard-main">
            {activeTab === "Alert Settings" ? (
              <>
                <section className="alerts-settings-grid">
                  <article className="alerts-panel watchlist-alert-panel">
                    <div className="alerts-panel-heading">
                      <div>
                        <span>Watchlist Alerts</span>
                        <h2>Alerts for tickers you added to your watchlist.</h2>
                      </div>
                      <b>
                        {settings.usage.watchlistTickers} / {formatLimit(settings.limits.alertTickerLimit)} alert tickers
                      </b>
                    </div>
                    <p className="alerts-inline-note">
                      These alerts apply to Watchlist tickers and do not use your Market Discovery category limit.
                    </p>
                    <div className="alerts-toggle-list">
                      {watchlistToggleRows.map((item) => (
                        <div className="alerts-toggle-row" key={item.label}>
                          <span>
                            <strong>{item.label}</strong>
                            <small>{item.detail}</small>
                          </span>
                          <label aria-label={`${item.label} toggle`}>
                            <input
                              checked={settings.preferences[item.key]}
                              onChange={(event) => togglePreference(item.key, event.currentTarget.checked)}
                              type="checkbox"
                            />
                            <i />
                          </label>
                        </div>
                      ))}
                    </div>
                    <div className="alerts-panel-footer">
                      <span>
                        Alert ticker usage: {settings.usage.watchlistTickers} / {formatLimit(settings.limits.alertTickerLimit)}
                      </span>
                      <Link href="/watchlist">Manage Watchlist</Link>
                    </div>
                  </article>

                  <article className="alerts-panel discovery-alert-panel">
                    <div className="alerts-panel-heading">
                      <div>
                        <span>Market Discovery Alerts</span>
                        <h2>Choose event categories to deliver alerts for stocks outside your watchlist.</h2>
                      </div>
                      <div className="alerts-quota-badge">
                        <strong>{settings.usage.discoveryCategories} selected</strong>
                        <span>{settings.limits.discoveryCategories.length} categories available</span>
                      </div>
                    </div>
                    <div className="alerts-category-grid" aria-label="Market Discovery categories">
                      {ALERT_CATEGORIES.map((category) => {
                        const selected = selectedCategorySet.has(category.code);
                        const available = availableDiscoveryCategories.has(category.code);
                        const tone = categoryTone[category.code];
                        return (
                          <button
                            aria-pressed={selected}
                            className={`${selected ? "selected" : ""} ${available ? "" : "locked"} tone-${tone}`}
                            key={category.code}
                            onClick={() => toggleDiscoveryCategory(category.code)}
                            title={getCategoryDescription(category.code)}
                            type="button"
                          >
                            {selected ? (
                              <span className="alerts-category-check" aria-hidden="true">
                                <Check size={12} />
                              </span>
                            ) : null}
                            <span className={`alerts-category-dot tone-${tone}`} />
                            {getCategoryLabel(category.code)}
                          </button>
                        );
                      })}
                    </div>
                    <p className="alerts-limit-note">
                      {settings.limits.discoveryCategories.length === 17
                        ? "All 17 public categories are available for market-wide Discovery."
                        : "Core 12 categories are available for market-wide Discovery. Advanced unlocks all 17 plus advanced filters."}
                    </p>
                  </article>
                </section>

                <section className="alerts-lanes-strip">
                  <div>
                    <span>Two alert lanes, one subscription.</span>
                    <strong>Plan limits control delivery, not browsing.</strong>
                  </div>
                  {alertLanes.map((lane) => (
                    <article key={lane.label}>
                      <b>{lane.label}</b>
                      <p>{lane.detail}</p>
                    </article>
                  ))}
                </section>
              </>
            ) : null}

            {activeTab === "Delivered Alerts" ? (
              <DeliveredAlertsPanel
                alerts={filteredDeliveredAlerts}
                activeFilter={deliveredFilter}
                loading={deliveredLoading}
                onFilterChange={(filter) => void loadDeliveredAlerts(filter)}
              />
            ) : null}

            {activeTab === "Delivery Channels" ? (
              <DeliveryChannelsPanel
                channels={settings.channels}
                onConnectTelegram={() => void connectTelegram()}
                onRefreshSettings={() => void refreshSettings()}
                plan={settings.plan}
                telegramConnectMessage={telegramConnectMessage}
                telegramConnectState={telegramConnectState}
              />
            ) : null}

            {activeTab === "Muted & Grouping" ? (
              <MutedGroupingPanel preferences={settings.preferences} onToggleGroupDuplicates={togglePreference} />
            ) : null}
          </div>

          <aside className="alerts-sidebar">
            <section className="alerts-sidebar-section">
              <div className="alerts-sidebar-heading">
                <h2>Recent Delivered Alerts</h2>
                <button onClick={() => void loadDeliveredAlerts("all", true)} type="button">
                  Refresh
                </button>
              </div>
              <DeliveredAlertList alerts={recentDeliveredAlerts} compactEmpty />
            </section>

            <section className="alerts-sidebar-section alerts-upgrade-panel">
              <span>{upgradeCard.title}</span>
              <h2>{upgradeCard.body}</h2>
              <ul>
                {upgradeCard.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              {renderUpgradeAction(settings, upgradeCard.cta)}
            </section>
          </aside>
        </section>
      </section>
    </main>
  );
}

function DeliveredAlertsPanel({
  alerts,
  activeFilter,
  loading,
  onFilterChange,
}: {
  alerts: DeliveredAlertItem[];
  activeFilter: DeliveredFilter;
  loading: boolean;
  onFilterChange: (filter: DeliveredFilter) => void;
}) {
  const filters: { label: string; value: DeliveredFilter }[] = [
    { label: "All", value: "all" },
    { label: "Watchlist", value: "watchlist" },
    { label: "Market Discovery", value: "market_discovery" },
    { label: "News", value: "news" },
    { label: "Filings", value: "filings" },
  ];

  return (
    <section className="alerts-panel alerts-tab-panel">
      <div className="alerts-panel-heading">
        <div>
          <span>Delivered Alerts</span>
          <h2>User-specific alert delivery history.</h2>
        </div>
        {loading ? <b>Loading</b> : null}
      </div>
      <div className="alerts-filter-pills" aria-label="Delivered alert filters">
        {filters.map((filter) => (
          <button
            className={activeFilter === filter.value ? "active" : ""}
            key={filter.value}
            onClick={() => onFilterChange(filter.value)}
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </div>
      <DeliveredAlertList alerts={alerts} emptyText="No delivered alerts yet. Configure alert settings to start receiving personalized alerts." />
    </section>
  );
}

function DeliveryChannelsPanel({
  channels,
  onConnectTelegram,
  onRefreshSettings,
  plan,
  telegramConnectMessage,
  telegramConnectState,
}: {
  channels: AlertSettingsViewModel["channels"];
  onConnectTelegram: () => void;
  onRefreshSettings: () => void;
  plan: Plan;
  telegramConnectMessage: string | null;
  telegramConnectState: TelegramConnectState;
}) {
  return (
    <section className="alerts-panel alerts-tab-panel">
      <div className="alerts-panel-heading">
        <div>
          <span>Delivery Channels</span>
          <h2>Channel availability follows your current plan.</h2>
        </div>
      </div>
      <div className="alerts-channel-list">
        {channels.map((channel) => (
          <article className={channel.locked ? "locked" : channel.connected ? "connected" : "not-connected"} key={channel.channel}>
            <span>
              <strong>{channel.label}</strong>
              <small>{getChannelDescription(channel.channel, channel.connected)}</small>
            </span>
            <div className="alerts-channel-state">
              <small>{channel.availabilityLabel || channelRequirements[channel.channel]}</small>
              <b>{channel.statusLabel}</b>
              {renderChannelAction({
                channel,
                onConnectTelegram,
                onRefreshSettings,
                plan,
                telegramConnectState,
              })}
            </div>
            {channel.channel === "telegram" && telegramConnectMessage ? (
              <p className={`alerts-channel-message state-${telegramConnectState}`}>{telegramConnectMessage}</p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function MutedGroupingPanel({
  preferences,
  onToggleGroupDuplicates,
}: {
  preferences: AlertPreferences;
  onToggleGroupDuplicates: (key: "groupDuplicates", enabled: boolean) => void;
}) {
  return (
    <section className="alerts-panel alerts-tab-panel">
      <div className="alerts-panel-heading">
        <div>
          <span>Muted & Grouping</span>
          <h2>Reduce repeated delivery without changing Feed browsing.</h2>
        </div>
      </div>
      <div className="alerts-toggle-list">
        <div className="alerts-toggle-row">
          <span>
            <strong>Group duplicate alerts</strong>
            <small>Bundle repeated alerts for the same ticker and event type when possible.</small>
          </span>
          <label aria-label="Group duplicate alerts toggle">
            <input
              checked={preferences.groupDuplicates}
              onChange={(event) => onToggleGroupDuplicates("groupDuplicates", event.currentTarget.checked)}
              type="checkbox"
            />
            <i />
          </label>
        </div>
        <div className="alerts-static-row">
          <span>
            <strong>Cooldown window</strong>
            <small>{preferences.cooldownMinutes} minutes between repeated deliveries.</small>
          </span>
        </div>
      </div>
    </section>
  );
}

function DeliveredAlertList({
  alerts,
  compactEmpty = false,
  emptyText = "No delivered alerts yet.",
}: {
  alerts: DeliveredAlertItem[];
  compactEmpty?: boolean;
  emptyText?: string;
}) {
  if (alerts.length === 0) {
    return <p className={compactEmpty ? "alerts-empty-state compact" : "alerts-empty-state"}>{emptyText}</p>;
  }

  return (
    <div className="alerts-delivered-list">
      {alerts.map((alert) => (
        <article key={alert.id}>
          <span>{alert.categoryLabel || humanizeAlertLane(alert.alertLane)}</span>
          <strong>{alert.title}</strong>
          <small>
            {alert.ticker ? `${alert.ticker} - ` : ""}
            {alert.sourceLabel || alert.sourceType || "Alert"} - {formatDeliveredChannels(alert.deliveredChannels)} -{" "}
            {formatRelativeTime(alert.deliveredAt)}
          </small>
          <Link href="/feed">View in Feed</Link>
          <b>{alert.severity || alert.deliveryStatus}</b>
        </article>
      ))}
    </div>
  );
}

type SettingsApiResponse = {
  ok: boolean;
  data?: AlertSettingsViewModel;
  message?: string;
};

type ApiError = {
  ok: false;
  message?: string;
};

type TelegramConnectApiResponse =
  | {
      ok: true;
      connectUrl: string;
      expiresAt: string;
    }
  | {
      ok: false;
      message?: string;
    };

function applySelectedCategories(settings: AlertSettingsViewModel, categories: PublicAlertCategory[]): AlertSettingsViewModel {
  return {
    ...settings,
    selectedCategories: categories,
    selectedCategoryDetails: categories.map((category) => ({
      category,
      label: getCategoryLabel(category),
      description: getCategoryDescription(category),
    })),
    usage: {
      ...settings.usage,
      discoveryCategories: categories.length,
    },
  };
}

function getSaveStateText(state: SaveState) {
  if (state === "saving") return "Saving...";
  if (state === "recent") return "Auto-saved just now";
  if (state === "failed") return "Save failed";
  return "All changes saved";
}

function getUpgradeCard(settings: AlertSettingsViewModel) {
  const plan = settings.plan;
  if (settings.guestMode) {
    return {
      title: "Try Advanced free for 14 days",
      body: "Create an account to access the card-backed Advanced trial when checkout is available.",
      cta: "Create account for Advanced trial",
      items: ["Unlimited alert tickers", "All 17 Discovery categories", "Email alerts"],
    };
  }

  if (settings.trial?.active) {
    return {
      title: `${getPlanDisplayName(settings.trial.plan ?? "advanced")} Trial Active`,
      body: `Trial access remains active until ${formatDate(settings.trial.endsAt)}, including after cancellation.`,
      cta: "Manage alerts",
      items:
        settings.trial.plan === "pro"
          ? ["15 alert tickers", "Core 12 Discovery categories", "Telegram included"]
          : ["Unlimited alert tickers", "All 17 Discovery categories", "Email alerts"],
    };
  }

  if ((plan === "free" || plan === "ad_free") && settings.trial?.used) {
    return {
      title: "Your free trial has ended",
      body: "Choose a paid plan to restore real-time delivery and additional channels.",
      cta: "View plans",
      items: ["Unlimited watchlist", "Real-time paid alerts", "Plan-based delivery channels"],
    };
  }

  if (plan === "free" || plan === "ad_free") {
    return {
      title: "Try Advanced free for 14 days",
      body: "A card is required. The trial auto-converts to monthly Advanced unless cancelled before it ends.",
      cta: "Start Advanced Trial",
      items: ["Unlimited alert tickers", "All 17 Discovery categories", "Email alerts"],
    };
  }

  if (plan === "pro") {
    return {
      title: "Unlock more with Advanced",
      body: "All 17 categories, advanced filters, email alerts, and more automation.",
      cta: "Upgrade to Advanced",
      items: ["All 17 categories", "Advanced filters", "Email alerts"],
    };
  }

  if (plan === "advanced") {
    return {
      title: "Automate alerts with Ultimate",
      body: "Custom rules, Webhook/API, fastest routing, and unlimited automation.",
      cta: "Upgrade to Ultimate",
      items: ["Custom rules", "Webhook/API", "Fastest routing"],
    };
  }

  return {
    title: "Manage advanced automation",
    body: "Configure custom rules, API access, and advanced delivery automation.",
    cta: "Manage API",
    items: ["Custom rules", "Webhook/API", "Advanced delivery automation"],
  };
}

function renderUpgradeAction(settings: AlertSettingsViewModel, label: string) {
  if (settings.guestMode) {
    return <AdvancedTrialCta guestMode>{label}</AdvancedTrialCta>;
  }

  if ((settings.plan === "free" || settings.plan === "ad_free") && !settings.trial?.used) {
    return <AdvancedTrialCta>{label}</AdvancedTrialCta>;
  }

  if (settings.trial?.active) {
    return <Link href="/alerts">{label}</Link>;
  }

  return <Link href="/premium">{label}</Link>;
}

function filterDeliveredAlerts(alerts: DeliveredAlertItem[], filter: DeliveredFilter) {
  if (filter === "all") return alerts;
  if (filter === "watchlist" || filter === "market_discovery") {
    return alerts.filter((alert) => alert.alertLane === filter);
  }
  if (filter === "news") {
    return alerts.filter((alert) => (alert.sourceType || "").toLowerCase().includes("news"));
  }
  return alerts.filter((alert) => (alert.sourceType || "").toLowerCase().includes("filing"));
}

function formatDeliveredChannels(channels: AlertChannel[]) {
  if (channels.length === 0) return "Delivered";
  return `Sent via ${channels.map((channel) => channelLabel(channel)).join(", ")}`;
}

function channelLabel(channel: AlertChannel) {
  if (channel === "api") return "API";
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function getChannelDescription(channel: AlertChannel, connected: boolean) {
  if (channel === "web") return "In-app delivery for alert notifications.";
  if (channel === "telegram") {
    return connected
      ? "Send alerts to your personal Telegram chat."
      : "Send alerts to your personal Telegram chat after connecting your account.";
  }
  if (channel === "email") return "Email delivery for higher-tier alert workflows.";
  if (channel === "webhook") return "Post alert payloads into your automation stack.";
  return "API access for professional alert automation.";
}

function renderChannelAction({
  channel,
  onConnectTelegram,
  onRefreshSettings,
  plan,
  telegramConnectState,
}: {
  channel: AlertSettingsViewModel["channels"][number];
  onConnectTelegram: () => void;
  onRefreshSettings: () => void;
  plan: Plan;
  telegramConnectState: TelegramConnectState;
}) {
  if (channel.locked) {
    const targetPlan = getPlanUpgradeTarget(plan);
    return <Link href="/premium">Upgrade{targetPlan ? ` to ${getPlanDisplayName(targetPlan)}` : ""}</Link>;
  }

  if (channel.channel === "telegram" && !channel.connected) {
    return (
      <div className="alerts-channel-actions">
        <button disabled={telegramConnectState === "generating"} onClick={onConnectTelegram} type="button">
          {telegramConnectState === "generating" ? "Generating link..." : "Connect Telegram"}
        </button>
        {telegramConnectState === "opened" ? (
          <button onClick={onRefreshSettings} type="button">
            I connected Telegram
          </button>
        ) : null}
      </div>
    );
  }

  if (channel.enabled) return <span>Active</span>;
  if (channel.connected) return <span>Ready to enable</span>;
  return <span>Connect first</span>;
}

function humanizeAlertLane(lane: DeliveredAlertItem["alertLane"]) {
  return lane === "watchlist" ? "Watchlist" : "Market Discovery";
}

function formatRelativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return value;
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "the trial end date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "the trial end date";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
