"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import { TickerCompanyAutocomplete } from "@/components/ui/TickerCompanyAutocomplete";
import { AlertReliabilityNotice } from "@/components/ui/AlertReliabilityNotice";
import { areAdsEnabledForPlan } from "@/lib/advertisingPolicy";
import type {
  AlertSettingsViewModel,
  DeliveredAlertItem,
} from "@/lib/alerts/types";
import type {
  AlertTickerItem,
  AlertTickersViewModel,
  TickerSearchResult,
} from "@/lib/alerts/tickers/types";
import type { WatchlistTickerItem, WatchlistViewModel } from "@/lib/watchlist/types";
import {
  alertIconSet,
  alertSources,
  coverageItems,
  deliveryItems,
  filingAlertGroups,
  marketCapFilters,
} from "@/lib/alerts/alertsV2Config";
import {
  getPlanDisplayName,
  getPlanLimits,
  type AlertChannel,
  type PublicAlertCategory,
} from "@/lib/subscriptionPolicy";
import styles from "./StockRadarAlertsV2.module.css";

const INITIAL_RECENT_ALERT_COUNT = 6;
const ALERT_HISTORY_PAGE_SIZE = 20;

type ApiPayload<T> = {
  data?: T;
  error?: string;
  message?: string;
  ok?: boolean;
};

async function readApiPayload<T>(response: Response) {
  return (await response.json().catch(() => null)) as ApiPayload<T> | null;
}

async function fetchAlertTickers(signal?: AbortSignal) {
  const response = await fetch("/api/alerts/tickers", { cache: "no-store", signal });
  const payload = await readApiPayload<AlertTickersViewModel>(response);
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.message || "Failed to load alert-enabled tickers.");
  }
  return payload.data;
}

async function fetchWatchlist(signal?: AbortSignal) {
  const response = await fetch("/api/watchlist", { cache: "no-store", signal });
  const payload = await readApiPayload<WatchlistViewModel>(response);
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.message || "Failed to load watchlist.");
  }
  return payload.data.items;
}

async function fetchDeliveredAlertPage({
  limit,
  offset,
  signal,
}: {
  limit: number;
  offset: number;
  signal?: AbortSignal;
}) {
  const response = await fetch(
    `/api/alerts/delivered?limit=${limit}&offset=${offset}&status=all`,
    {
      cache: "no-store",
      signal,
    },
  );
  const payload = (await response.json().catch(() => null)) as DeliveredAlertItem[] | null;

  if (!response.ok || !Array.isArray(payload)) {
    throw new Error("Failed to load delivered alerts.");
  }

  const totalValue = response.headers.get("X-Total-Count");
  const totalHeader = totalValue === null ? Number.NaN : Number(totalValue);

  return {
    alerts: payload,
    total: Number.isFinite(totalHeader) ? Math.max(payload.length, totalHeader) : payload.length,
  };
}

function ToggleSwitch({
  checked,
  disabled = false,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={styles.toggle}
      data-state={checked ? "on" : "off"}
      disabled={disabled}
      onClick={onChange}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" />
    </button>
  );
}

function getDefaultCoverageState() {
  return Object.fromEntries(coverageItems.map((item) => [item.id, false]));
}

type StockRadarAlertsV2Props = {
  initialTicker?: string;
};

export function StockRadarAlertsV2({
  initialTicker = "",
}: StockRadarAlertsV2Props) {
  const normalizedInitialTicker = initialTicker.trim().toUpperCase();
  const [settings, setSettings] = useState<AlertSettingsViewModel | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [tickers, setTickers] = useState<AlertTickerItem[]>([]);
  const [alertTickerLimit, setAlertTickerLimit] = useState<number | null>(null);
  const [tickersLoading, setTickersLoading] = useState(true);
  const [tickerAction, setTickerAction] = useState("");
  const [tickerInput, setTickerInput] = useState(normalizedInitialTicker);
  const [selectedTicker, setSelectedTicker] = useState<TickerSearchResult | null>(null);
  const [tickerMessage, setTickerMessage] = useState("");
  const [watchlistItems, setWatchlistItems] = useState<WatchlistTickerItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState("");
  const [coverageState, setCoverageState] = useState(getDefaultCoverageState);
  const [sourceState, setSourceState] = useState(
    Object.fromEntries(alertSources.map((source) => [source.id, true])),
  );
  const [deliveryState, setDeliveryState] = useState(
    Object.fromEntries(deliveryItems.map((item) => [item.id, item.enabled])),
  );
  const [marketCapState, setMarketCapState] = useState(
    Object.fromEntries(marketCapFilters.map((item) => [item.id, true])),
  );
  const [filingState, setFilingState] = useState(
    Object.fromEntries(
      filingAlertGroups.flatMap((group) => group.items.map((item) => [item.id, true])),
    ),
  );
  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const [hasSentTestAlert, setHasSentTestAlert] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const [recentAlerts, setRecentAlerts] = useState<DeliveredAlertItem[]>([]);
  const [recentAlertTotal, setRecentAlertTotal] = useState(0);
  const [recentAlertsLoading, setRecentAlertsLoading] = useState(true);
  const [recentAlertsError, setRecentAlertsError] = useState("");
  const [hasExpandedAlertHistory, setHasExpandedAlertHistory] = useState(false);
  const fromWatchlistButtonRef = useRef<HTMLButtonElement>(null);
  const lastInitialTickerRef = useRef(normalizedInitialTicker);
  const plan = settings?.plan ?? "free";
  const planLimits = settings?.limits ?? getPlanLimits(plan);
  const allowedDiscoveryCategories = useMemo(
    () => new Set(planLimits.discoveryCategories),
    [planLimits.discoveryCategories],
  );
  const showsAds = areAdsEnabledForPlan(plan);
  const isUltimate = plan === "ultimate";
  const hasAdvancedFilters = planLimits.advancedFilters;
  const hasFilingTypeAlerts = planLimits.customRules;
  const isPushEnabled = Boolean(deliveryState.web);

  const enabledCount = useMemo(
    () => tickers.filter((ticker) => ticker.enabled).length,
    [tickers],
  );
  const enabledCoreCoverageCount = useMemo(
    () => coverageItems.filter((item) => !item.locked && coverageState[item.id]).length,
    [coverageState],
  );
  const visibleRecentAlerts = hasExpandedAlertHistory
    ? recentAlerts
    : recentAlerts.slice(0, INITIAL_RECENT_ALERT_COUNT);
  const hasMoreAlertHistory = recentAlerts.length < recentAlertTotal;
  const availableWatchlistItems = useMemo(
    () => watchlistItems.filter((item) => !tickers.some((ticker) => ticker.ticker === item.ticker)),
    [tickers, watchlistItems],
  );

  useEffect(() => {
    const controller = new AbortController();
    setSettingsLoading(true);
    fetch("/api/alerts/settings", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await readApiPayload<AlertSettingsViewModel>(response);
        if (!response.ok || !payload?.data) {
          throw new Error(payload?.message || "Failed to load alert settings.");
        }
        applySettings(payload.data);
        setSettingsMessage("");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSettingsMessage(
          error instanceof Error ? error.message : "Failed to load alert settings.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettingsLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    setRecentAlertsLoading(true);
    fetchDeliveredAlertPage({
      limit: INITIAL_RECENT_ALERT_COUNT,
      offset: 0,
      signal: controller.signal,
    })
      .then(({ alerts, total }) => {
        setRecentAlerts(alerts);
        setRecentAlertTotal(total);
        setRecentAlertsError("");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setRecentAlertsError(error instanceof Error ? error.message : "Failed to load delivered alerts.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecentAlertsLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setTickersLoading(true);

    fetchAlertTickers(controller.signal)
      .then((data) => {
        setTickers(data.items);
        setAlertTickerLimit(data.limit);
        setTickerMessage("");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setTickerMessage(error instanceof Error ? error.message : "Failed to load alert-enabled tickers.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setTickersLoading(false);
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (
      !normalizedInitialTicker ||
      normalizedInitialTicker === lastInitialTickerRef.current
    ) {
      return;
    }

    lastInitialTickerRef.current = normalizedInitialTicker;
    setTickerInput(normalizedInitialTicker);
    setSelectedTicker(null);
    setTickerMessage("");
  }, [normalizedInitialTicker]);

  const markSettingsChanged = () => setSaveStatus("idle");

  const applySettings = (nextSettings: AlertSettingsViewModel) => {
    setSettings(nextSettings);
    const selected = new Set(nextSettings.selectedCategories);
    setCoverageState(
      Object.fromEntries(coverageItems.map((item) => [item.id, selected.has(item.id as PublicAlertCategory)])),
    );
    setSourceState({
      news: nextSettings.preferences.watchlistNewsEnabled,
      filings: nextSettings.preferences.watchlistFilingsEnabled,
    });
    setDeliveryState(
      Object.fromEntries(
        nextSettings.channels.map((channel) => [channel.channel, channel.enabled]),
      ),
    );
    setMarketCapState(
      Object.fromEntries(
        marketCapFilters.map((item) => [
          item.id,
          nextSettings.preferences.marketCapFilters.includes(item.id),
        ]),
      ),
    );
    setFilingState(
      Object.fromEntries(
        filingAlertGroups.flatMap((group) =>
          group.items.map((item) => [
            item.id,
            nextSettings.preferences.filingTypeFilters.includes(item.id),
          ]),
        ),
      ),
    );
  };

  const updateDeliveryChannel = async (channel: AlertChannel, enabled: boolean) => {
    if (settingsLoading) return false;
    setSettingsLoading(true);
    setSettingsMessage("");
    setHasSentTestAlert(false);
    try {
      if (channel === "telegram" && enabled) {
        const currentChannel = settings?.channels.find((item) => item.channel === "telegram");
        if (!currentChannel?.connected) {
          const connectResponse = await fetch("/api/alerts/channels/telegram/connect", {
            method: "POST",
          });
          const connectPayload = (await connectResponse.json().catch(() => null)) as {
            url?: string;
            message?: string;
          } | null;
          if (!connectResponse.ok || !connectPayload?.url) {
            throw new Error(connectPayload?.message || "Failed to start Telegram connection.");
          }
          window.location.assign(connectPayload.url);
          return false;
        }
      }
      const response = await fetch("/api/alerts/channels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, enabled }),
      });
      const payload = await readApiPayload<AlertSettingsViewModel>(response);
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.message || "Failed to update delivery channel.");
      }
      applySettings(payload.data);
      setSaveStatus("saved");
      return true;
    } catch (error) {
      setSettingsMessage(
        error instanceof Error ? error.message : "Failed to update delivery channel.",
      );
      return false;
    } finally {
      setSettingsLoading(false);
    }
  };

  const sendTestAlert = async () => {
    setSettingsMessage("");
    try {
      if (!isPushEnabled) {
        const enabled = await updateDeliveryChannel("web", true);
        if (!enabled) return;
      }
      const response = await fetch("/api/alerts/delivered", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      });
      const payload = await readApiPayload<never>(response);
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to send the test alert.");
      }
      setHasSentTestAlert(true);
      await loadAlertHistory({
        limit: hasExpandedAlertHistory ? ALERT_HISTORY_PAGE_SIZE : INITIAL_RECENT_ALERT_COUNT,
        offset: 0,
        replace: true,
      });
    } catch (error) {
      setSettingsMessage(
        error instanceof Error ? error.message : "Failed to send the test alert.",
      );
    }
  };

  const saveSettings = async () => {
    if (!settings || settingsLoading) return;
    setSettingsLoading(true);
    setSettingsMessage("");
    try {
      const categories = coverageItems
        .filter((item) => coverageState[item.id] && allowedDiscoveryCategories.has(item.id as PublicAlertCategory))
        .map((item) => item.id as PublicAlertCategory);
      const preferencePatch: Record<string, unknown> = {
        watchlistNewsEnabled: Boolean(sourceState.news),
        watchlistFilingsEnabled: Boolean(sourceState.filings),
      };
      if (hasAdvancedFilters) {
        preferencePatch.marketCapFilters = marketCapFilters
          .filter((item) => marketCapState[item.id])
          .map((item) => item.id);
      }
      if (hasFilingTypeAlerts) {
        preferencePatch.filingTypeFilters = filingAlertGroups.flatMap((group) =>
          group.items.filter((item) => filingState[item.id]).map((item) => item.id),
        );
      }
      const [preferencesResponse, categoriesResponse] = await Promise.all([
        fetch("/api/alerts/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preferencePatch),
        }),
        fetch("/api/alerts/discovery-categories", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories }),
        }),
      ]);
      const preferencesPayload = await readApiPayload<AlertSettingsViewModel>(preferencesResponse);
      const categoriesPayload = await readApiPayload<AlertSettingsViewModel>(categoriesResponse);
      if (!preferencesResponse.ok || !preferencesPayload?.data) {
        throw new Error(preferencesPayload?.message || "Failed to save alert preferences.");
      }
      if (!categoriesResponse.ok || !categoriesPayload?.data) {
        throw new Error(categoriesPayload?.message || "Failed to save Discovery categories.");
      }
      const settingsResponse = await fetch("/api/alerts/settings", {
        cache: "no-store",
      });
      const settingsPayload = await readApiPayload<AlertSettingsViewModel>(settingsResponse);
      if (!settingsResponse.ok || !settingsPayload?.data) {
        throw new Error(
          settingsPayload?.message ||
            "Settings saved, but the refreshed state could not be loaded.",
        );
      }
      applySettings(settingsPayload.data);
      setSaveStatus("saved");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "Failed to save alert settings.");
    } finally {
      setSettingsLoading(false);
    }
  };

  const selectTickerSuggestion = (suggestion: TickerSearchResult) => {
    setSelectedTicker(suggestion);
    setTickerInput(suggestion.ticker);
    setTickerMessage("");
  };

  const addTicker = async (tickerValue?: string) => {
    const ticker = tickerValue || selectedTicker?.ticker;
    if (!ticker || tickerAction) {
      setTickerMessage("Select a ticker from the search results.");
      return;
    }

    setTickerAction(`add:${ticker}`);
    setTickerMessage("");

    try {
      const response = await fetch("/api/alerts/tickers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const payload = await readApiPayload<AlertTickersViewModel>(response);
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.message || "Failed to add alert-enabled ticker.");
      }

      setTickers(payload.data.items);
      setAlertTickerLimit(payload.data.limit);
      setTickerInput("");
      setSelectedTicker(null);
      markSettingsChanged();
    } catch (error) {
      setTickerMessage(error instanceof Error ? error.message : "Failed to add alert-enabled ticker.");
    } finally {
      setTickerAction("");
    }
  };

  const removeTicker = async (ticker: string) => {
    if (tickerAction) return;
    setTickerAction(`remove:${ticker}`);
    setTickerMessage("");

    try {
      const response = await fetch(`/api/alerts/tickers/${encodeURIComponent(ticker)}`, {
        method: "DELETE",
      });
      const payload = await readApiPayload<AlertTickersViewModel>(response);
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.message || "Failed to remove alert-enabled ticker.");
      }
      setTickers(payload.data.items);
      setAlertTickerLimit(payload.data.limit);
      markSettingsChanged();
    } catch (error) {
      setTickerMessage(error instanceof Error ? error.message : "Failed to remove alert-enabled ticker.");
    } finally {
      setTickerAction("");
    }
  };

  const toggleTicker = async (ticker: string, enabled: boolean) => {
    if (tickerAction) return;
    setTickerAction(`toggle:${ticker}`);
    setTickerMessage("");

    try {
      const response = await fetch(`/api/alerts/tickers/${encodeURIComponent(ticker)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await readApiPayload<AlertTickersViewModel>(response);
      if (!response.ok || !payload?.data) {
        throw new Error(payload?.message || "Failed to update alert-enabled ticker.");
      }
      setTickers(payload.data.items);
      setAlertTickerLimit(payload.data.limit);
      markSettingsChanged();
    } catch (error) {
      setTickerMessage(error instanceof Error ? error.message : "Failed to update alert-enabled ticker.");
    } finally {
      setTickerAction("");
    }
  };

  const openWatchlistPanel = () => {
    setIsWatchlistOpen(true);
    setWatchlistLoading(true);
    setWatchlistError("");
    fetchWatchlist()
      .then(setWatchlistItems)
      .catch((error: unknown) => {
        setWatchlistError(error instanceof Error ? error.message : "Failed to load watchlist.");
      })
      .finally(() => setWatchlistLoading(false));
  };

  const closeWatchlistPanel = () => {
    setIsWatchlistOpen(false);
    requestAnimationFrame(() => fromWatchlistButtonRef.current?.focus({ preventScroll: true }));
  };

  const loadAlertHistory = async ({
    limit,
    offset,
    replace,
  }: {
    limit: number;
    offset: number;
    replace: boolean;
  }) => {
    setRecentAlertsLoading(true);

    try {
      const { alerts, total } = await fetchDeliveredAlertPage({ limit, offset });
      setRecentAlerts((current) => {
        if (replace) return alerts;

        const knownIds = new Set(current.map((alert) => alert.id));
        return [...current, ...alerts.filter((alert) => !knownIds.has(alert.id))];
      });
      setRecentAlertTotal(total);
      setRecentAlertsError("");
    } catch (error) {
      setRecentAlertsError(error instanceof Error ? error.message : "Failed to load delivered alerts.");
    } finally {
      setRecentAlertsLoading(false);
    }
  };

  const updateAlertHistory = async () => {
    if (recentAlertsLoading) return;

    if (recentAlertsError && recentAlerts.length === 0) {
      await loadAlertHistory({
        limit: INITIAL_RECENT_ALERT_COUNT,
        offset: 0,
        replace: true,
      });
      return;
    }

    if (!hasExpandedAlertHistory) {
      setHasExpandedAlertHistory(true);
      const firstPageSize = Math.min(ALERT_HISTORY_PAGE_SIZE, recentAlertTotal);
      if (recentAlerts.length < firstPageSize) {
        await loadAlertHistory({
          limit: ALERT_HISTORY_PAGE_SIZE,
          offset: 0,
          replace: true,
        });
      }
      return;
    }

    if (hasMoreAlertHistory) {
      await loadAlertHistory({
        limit: ALERT_HISTORY_PAGE_SIZE,
        offset: recentAlerts.length,
        replace: false,
      });
      return;
    }

    setHasExpandedAlertHistory(false);
  };

  const markAlertRead = async (alert: DeliveredAlertItem) => {
    if (alert.isRead) return;
    try {
      const response = await fetch("/api/alerts/delivered", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: alert.id, read: true }),
      });
      const payload = await readApiPayload<never>(response);
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to mark alert read.");
      }
      const readAt = new Date().toISOString();
      setRecentAlerts((current) =>
        current.map((item) =>
          item.id === alert.id ? { ...item, isRead: true, readAt } : item,
        ),
      );
    } catch (error) {
      setRecentAlertsError(
        error instanceof Error ? error.message : "Failed to mark alert read.",
      );
    }
  };

  const Bell = alertIconSet.Bell;
  const CheckCircle2 = alertIconSet.CheckCircle2;
  const Lock = alertIconSet.Lock;
  const Trash2 = alertIconSet.Trash2;
  const upgradeTier = plan === "advanced" ? "Ultimate" : "Advanced";
  const coverageDescription =
    planLimits.discoveryCategories.length === coverageItems.length
      ? "All 17 Discovery categories are available for stocks outside your alert-enabled tickers."
      : "Your plan includes the 12 core Discovery categories. Advanced unlocks all 17.";

  return (
    <div className={styles.page}>
      <div className={styles.pageShell}>
        <main className={styles.contentColumn}>
          <section className={styles.header} aria-labelledby="alerts-v2-title">
            <div>
              <h1 id="alerts-v2-title">Alerts</h1>
              <p>Choose the stocks you want to monitor and how you receive alerts.</p>
            </div>
            <div className={styles.planSummary}>
              <span>
                Your plan: {settings?.planLabel || getPlanDisplayName(plan)}
                {settings?.trial?.active ? " (trial)" : ""}
              </span>
              <Link href="/premium">Manage plan</Link>
            </div>
          </section>

          <section className={styles.notice} aria-label="In-app alert status">
            <Bell aria-hidden="true" size={20} />
            <p>
              {hasSentTestAlert
                ? "Test in-app alert delivered to Recent alerts."
                : isPushEnabled
                  ? "In-app alerts are enabled and stored in your delivery history."
                  : "In-app alerts are disabled. Enable Web delivery to receive alerts here."}
            </p>
            <span className={styles.noticeMobileLabel}>In-app alerts</span>
            <div className={styles.noticeMobileToggle}>
              <ToggleSwitch
                checked={isPushEnabled}
                disabled={settingsLoading}
                label="Toggle in-app alerts"
                onChange={() => void updateDeliveryChannel("web", !isPushEnabled)}
              />
              <em>{isPushEnabled ? "ON" : "OFF"}</em>
            </div>
            <div className={styles.noticeActions}>
              <button
                disabled={settingsLoading}
                onClick={() => void updateDeliveryChannel("web", !isPushEnabled)}
                type="button"
              >
                {isPushEnabled ? "Disable in-app alerts" : "Enable in-app alerts"}
              </button>
              <button disabled={settingsLoading} onClick={() => void sendTestAlert()} type="button">
                {hasSentTestAlert ? "Test alert sent" : "Send test alert"}
              </button>
            </div>
          </section>

          {settingsMessage ? (
            <p className={styles.tickerMessage} role="status">{settingsMessage}</p>
          ) : null}
          {settings?.guestMode ? (
            <section className={styles.notice} aria-label="Sign in required">
              <Lock aria-hidden="true" size={20} />
              <p>Sign in to save alert settings, follow Calendar events, and keep delivery history.</p>
              <Link href="/login?next=%2Falerts">Sign in</Link>
            </section>
          ) : null}

          <section className={`${styles.card} ${styles.tickerCard}`} aria-labelledby="alerts-v2-tickers-title">
        <div className={styles.cardHeader}>
          <div>
            <h2 id="alerts-v2-tickers-title">Alert-enabled tickers</h2>
            <p>Enabled tickers are covered across every category below, including Dilution &amp; Offerings, Listing Risk &amp; Delisting, Reverse Splits, and Bankruptcy &amp; Default.</p>
          </div>
          <span>{enabledCount} / {alertTickerLimit ?? "Unlimited"} enabled</span>
        </div>

        <div className={styles.addTickerRow}>
          <TickerCompanyAutocomplete
            autoSelectExact
            className={styles.tickerSearch}
            id="alerts-v2-ticker-search"
            label="Search ticker or company to add"
            onSelect={selectTickerSuggestion}
            onValueChange={(value) => {
              setTickerInput(value);
              setSelectedTicker(null);
              setTickerMessage("");
            }}
            placeholder="Search ticker or company"
            selectedTicker={selectedTicker?.ticker}
            value={tickerInput}
          />
          <button
            className={styles.primaryButton}
            disabled={!selectedTicker || Boolean(tickerAction)}
            onClick={() => void addTicker()}
            type="button"
          >
            Add ticker
          </button>
          <button
            className={styles.secondaryButton}
            disabled={watchlistLoading || Boolean(tickerAction)}
            onClick={openWatchlistPanel}
            ref={fromWatchlistButtonRef}
            type="button"
          >
            From Watchlist
          </button>
        </div>

        {tickerMessage ? (
          <p className={styles.tickerMessage} role="status">{tickerMessage}</p>
        ) : null}

        <div className={styles.tickerList}>
          {tickersLoading ? (
            <p className={styles.tickerEmpty}>Loading alert-enabled tickers...</p>
          ) : tickers.length === 0 ? (
            <p className={styles.tickerEmpty}>No alert-enabled tickers yet.</p>
          ) : tickers.map((ticker) => (
            <article className={styles.tickerRow} key={ticker.id}>
              <strong>{ticker.ticker}</strong>
              <span>{ticker.companyName}</span>
              <div className={styles.inlineToggle}>
                <ToggleSwitch
                  checked={ticker.enabled}
                  disabled={Boolean(tickerAction)}
                  label={`Toggle alerts for ${ticker.ticker}`}
                  onChange={() => void toggleTicker(ticker.ticker, !ticker.enabled)}
                />
                <em>{ticker.enabled ? "ON" : "OFF"}</em>
              </div>
              <button
                aria-label={`Remove ${ticker.ticker}`}
                className={styles.removeButton}
                disabled={Boolean(tickerAction)}
                onClick={() => void removeTicker(ticker.ticker)}
                type="button"
              >
                <Trash2 aria-hidden="true" size={20} />
              </button>
            </article>
          ))}
        </div>
          </section>

          <div className={styles.settingsGrid}>
        <section className={`${styles.card} ${styles.coverageCard}`} aria-labelledby="alerts-v2-coverage-title">
          <input
            aria-label="Toggle Alert coverage settings"
            className={styles.mobileCoverageControl}
            id="alerts-v2-coverage-toggle"
            type="checkbox"
          />
          <label className={styles.mobileCoverageSummary} htmlFor="alerts-v2-coverage-toggle">
            <span>
              <strong>Alert coverage</strong>
              <small>
                {settingsLoading
                  ? "Loading saved coverage"
                  : `${enabledCoreCoverageCount} core alerts on`}
              </small>
            </span>
            <ChevronDown aria-hidden="true" size={18} />
          </label>
          <div className={styles.cardHeader}>
            <div>
              <h2 id="alerts-v2-coverage-title">Alert coverage</h2>
              <p>{coverageDescription}</p>
            </div>
          </div>

          <div className={styles.settingList} id="alerts-v2-coverage-settings">
            {coverageItems.map((item) => {
              const Icon = item.icon;
              const locked = !allowedDiscoveryCategories.has(item.id as PublicAlertCategory);
              const lockedTier = "ADVANCED";
              const isEnabled = !locked && Boolean(coverageState[item.id]);

              return (
                <article
                  className={styles.settingRow}
                  data-locked={locked}
                  key={item.id}
                  onClick={() => {
                    if (locked) {
                      setUpgradeMessage(`${item.title} requires ${lockedTier}.`);
                    }
                  }}
                >
                  <Icon aria-hidden="true" size={20} />
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.description}</span>
                  </div>
                  {locked ? (
                    <span className={styles.lockGroup}>
                      <Lock aria-hidden="true" size={15} />
                      <em>{lockedTier}+</em>
                    </span>
                  ) : null}
                  <div className={styles.inlineToggle}>
                    <ToggleSwitch
                      checked={isEnabled}
                      disabled={locked || settingsLoading}
                      label={`Toggle ${item.title}`}
                      onChange={() =>
                        {
                          setCoverageState((current) => ({
                            ...current,
                            [item.id]: !current[item.id],
                          }));
                          markSettingsChanged();
                        }
                      }
                    />
                    <em>{isEnabled ? "ON" : "OFF"}</em>
                  </div>
                </article>
              );
            })}
          </div>

          {upgradeMessage ? (
            <div className={styles.upgradePanel} role="status">
              {upgradeMessage} Unlock critical risk alerts with Advanced.
            </div>
          ) : null}

          {planLimits.discoveryCategories.length < coverageItems.length ? (
            <div className={styles.cardFooter}>
              <span>Unlock all 17 Discovery categories with Advanced</span>
              <Link className={styles.advancedUpgradeButton} href="/premium">
                Upgrade to Advanced
              </Link>
            </div>
          ) : null}
        </section>

        <div className={styles.settingsSideColumn}>
          <section className={`${styles.card} ${styles.sourceCard}`} aria-labelledby="alerts-v2-sources-title">
            <div className={styles.cardHeader}>
              <div>
                <h2 id="alerts-v2-sources-title">Alert sources</h2>
              </div>
            </div>

            <div className={styles.sourceFilterGrid} role="group" aria-label="Alert sources">
              {alertSources.map((source) => (
                <label className={styles.sourceFilterOption} key={source.id}>
                  <input
                    checked={Boolean(sourceState[source.id])}
                    disabled={settingsLoading}
                    onChange={(event) =>
                      {
                        setSourceState((current) => ({
                          ...current,
                          [source.id]: event.currentTarget.checked,
                        }));
                        markSettingsChanged();
                      }
                    }
                    type="checkbox"
                  />
                  <span>{source.label}</span>
                </label>
              ))}
            </div>
          </section>

          <section className={`${styles.card} ${styles.deliveryCard}`} aria-labelledby="alerts-v2-delivery-title">
            <div className={styles.cardHeader}>
              <div>
                <h2 id="alerts-v2-delivery-title">Delivery</h2>
              </div>
            </div>

            <div className={styles.settingList}>
              {deliveryItems.map((item) => {
                const Icon = item.icon;
                const channel = settings?.channels.find(
                  (candidate) => candidate.channel === item.id,
                );
                const locked = channel?.locked ?? true;
                const comingLater = channel?.comingLater ?? false;

                return (
                  <article className={styles.settingRow} key={item.id}>
                    <Icon aria-hidden="true" size={20} />
                    <div>
                      <strong>{item.title}</strong>
                      <span>{channel?.statusLabel || "Loading..."}</span>
                    </div>
                    {comingLater ? (
                      <span className={styles.lockGroup}>
                        <Lock aria-hidden="true" size={15} />
                        <em>COMING LATER</em>
                      </span>
                    ) : locked ? (
                      <span className={styles.lockGroup}>
                        <Lock aria-hidden="true" size={15} />
                        <em>{channel?.availabilityLabel}</em>
                      </span>
                    ) : null}
                    <div className={styles.inlineToggle}>
                      <ToggleSwitch
                        checked={Boolean(deliveryState[item.id])}
                        disabled={locked || comingLater || settingsLoading}
                        label={`Toggle ${item.title}`}
                        onChange={() =>
                          void updateDeliveryChannel(
                            item.id as AlertChannel,
                            !deliveryState[item.id],
                          )
                        }
                      />
                      <em>{deliveryState[item.id] ? "ON" : "OFF"}</em>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className={`${styles.card} ${styles.marketCapCard}`} aria-labelledby="alerts-v2-market-cap-title">
            <div className={styles.cardHeader}>
              <div>
                <h2 id="alerts-v2-market-cap-title">Market cap filters</h2>
              </div>
              {!hasAdvancedFilters ? <span className={styles.lockedBadge}>ADVANCED+</span> : null}
            </div>

            <div className={styles.marketCapGrid}>
              {marketCapFilters.map((item) => (
                <label className={styles.marketCapOption} key={item.id}>
                  <input
                    checked={Boolean(marketCapState[item.id])}
                    disabled={!hasAdvancedFilters || settingsLoading}
                    onChange={(event) =>
                      {
                        setMarketCapState((current) => ({
                          ...current,
                          [item.id]: event.currentTarget.checked,
                        }));
                        markSettingsChanged();
                      }
                    }
                    type="checkbox"
                  />
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.range}</small>
                  </div>
                </label>
              ))}
            </div>
          </section>
        </div>
        </div>

        <div className={styles.settingsSaveBar}>
          {saveStatus === "saved" ? <span role="status">Saved</span> : null}
          <button
            className={`${styles.primaryButton} ${styles.saveButton}`}
            disabled={settingsLoading || !settings}
            onClick={() => void saveSettings()}
            type="button"
          >
            {settingsLoading ? "Saving..." : "Save changes"}
          </button>
        </div>

        <section className={`${styles.card} ${styles.filingCard}`} aria-labelledby="alerts-v2-filing-title">
          <div className={styles.cardHeader}>
            <div>
              <h2 id="alerts-v2-filing-title">Filing type alerts</h2>
              <p>Choose which SEC forms can trigger filing alerts.</p>
            </div>
            {!hasFilingTypeAlerts ? (
              <span className={styles.lockedBadge}>
                <Lock aria-hidden="true" size={14} />
                ULTIMATE+
              </span>
            ) : null}
          </div>

          <div className={styles.filingGroupList}>
            {filingAlertGroups.map((group) => {
              const selectedItemCount = group.items.filter((item) => filingState[item.id]).length;
              const isGroupSelected = selectedItemCount === group.items.length;
              const isGroupPartiallySelected = selectedItemCount > 0 && !isGroupSelected;

              return (
                <section className={styles.filingGroup} key={group.id}>
                  <div className={styles.filingGroupHeader}>
                    <strong>{group.title}</strong>
                    <label className={styles.filingGroupToggle}>
                      <input
                        aria-label={`Select all ${group.title}`}
                        checked={isGroupSelected}
                        disabled={!hasFilingTypeAlerts || settingsLoading}
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setFilingState((current) => ({
                            ...current,
                            ...Object.fromEntries(group.items.map((item) => [item.id, checked])),
                          }));
                          markSettingsChanged();
                        }}
                        ref={(input) => {
                          if (input) {
                            input.indeterminate = isGroupPartiallySelected;
                          }
                        }}
                        type="checkbox"
                      />
                      <span>All</span>
                    </label>
                  </div>
                  <div className={styles.filingTypeGrid}>
                    {group.items.map((item) => (
                      <label className={styles.filingTypeOption} key={item.id}>
                        <input
                          checked={Boolean(filingState[item.id])}
                          disabled={!hasFilingTypeAlerts || settingsLoading}
                          onChange={(event) => {
                            setFilingState((current) => ({
                              ...current,
                              [item.id]: event.currentTarget.checked,
                            }));
                            markSettingsChanged();
                          }}
                          type="checkbox"
                        />
                        <span>{item.label}</span>
                      </label>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          {!hasFilingTypeAlerts ? (
            <div className={styles.ultimateFooter}>
              <span>Unlock form-level filing alert rules with Ultimate</span>
              <Link href="/premium">Upgrade to Ultimate</Link>
            </div>
          ) : null}
        </section>

        <div className={styles.reliabilityNotice}>
          <AlertReliabilityNotice />
        </div>

        <section className={`${styles.card} ${styles.recentCard}`} aria-labelledby="alerts-v2-followed-title">
          <div className={styles.cardHeader}>
            <div>
              <h2 id="alerts-v2-followed-title">Followed Calendar events</h2>
              <p>Event-specific schedule updates and reminders. These are separate from Watch Stock.</p>
            </div>
            <Link href="/calendar">Manage in Calendar</Link>
          </div>
          <div className={styles.settingList}>
            {settingsLoading && !settings ? (
              <p className={styles.recentEmpty}>Loading followed events...</p>
            ) : settings?.followedCalendarEvents.length ? (
              settings.followedCalendarEvents.map((event) => (
                <article className={styles.settingRow} key={event.followId}>
                  <Bell aria-hidden="true" size={20} />
                  <div>
                    <strong>{event.title}</strong>
                    <span>
                      {event.ticker ? `${event.ticker} · ` : ""}
                      {formatCalendarFollowDate(event.eventDate, event.eventTime)}
                    </span>
                  </div>
                  <em>{event.lifecycleStatus}</em>
                </article>
              ))
            ) : (
              <p className={styles.recentEmpty}>No followed Calendar events yet.</p>
            )}
          </div>
        </section>

        <section className={`${styles.card} ${styles.recentCard}`} aria-labelledby="alerts-v2-recent-title">
          <div className={styles.cardHeader}>
            <div>
            <h2 id="alerts-v2-recent-title">Recent alerts</h2>
          </div>
        </div>

        <div className={styles.recentTable} role="table" aria-label="Recent alerts">
          <div className={styles.recentHead} role="row">
            <span role="columnheader">Ticker</span>
            <span role="columnheader">Alert type</span>
            <span role="columnheader">Title</span>
            <span role="columnheader">Time</span>
            <span role="columnheader">Status</span>
          </div>
          {recentAlertsLoading && recentAlerts.length === 0 ? (
            <p className={styles.recentEmpty}>Loading delivered alerts...</p>
          ) : null}
          {!recentAlertsLoading && recentAlertsError && recentAlerts.length === 0 ? (
            <p className={styles.recentError}>{recentAlertsError}</p>
          ) : null}
          {!recentAlertsLoading && !recentAlertsError && recentAlerts.length === 0 ? (
            <p className={styles.recentEmpty}>No delivered alerts yet.</p>
          ) : null}
          {visibleRecentAlerts.map((alert) => (
            <article
              className={styles.recentRow}
              data-read={alert.isRead}
              key={alert.id}
              role="row"
            >
              <strong role="cell">{alert.ticker || "MARKET"}</strong>
              <span role="cell">{getDeliveredAlertType(alert)}</span>
              <p role="cell">{alert.title}</p>
              <time dateTime={alert.deliveredAt} role="cell">
                {formatRelativeTime(alert.deliveredAt)}
              </time>
              <em data-status={alert.deliveryStatus} role="cell">
                <CheckCircle2 aria-hidden="true" size={16} />
                {alert.isRead ? "Read" : getDeliveryStatusLabel(alert.deliveryStatus)}
                {!alert.isRead && alert.deliveryStatus === "sent" ? (
                  <button
                    className={styles.readButton}
                    onClick={() => void markAlertRead(alert)}
                    type="button"
                  >
                    Mark read
                  </button>
                ) : null}
              </em>
            </article>
          ))}
        </div>
        <div className={styles.recentFooter}>
          {hasExpandedAlertHistory ? (
            <span aria-live="polite">
              Showing {visibleRecentAlerts.length} of {recentAlertTotal}
            </span>
          ) : (
            <span />
          )}
          {recentAlertsError || recentAlertTotal > INITIAL_RECENT_ALERT_COUNT || hasExpandedAlertHistory ? (
            <button
              disabled={recentAlertsLoading}
              onClick={() => void updateAlertHistory()}
              type="button"
            >
              {recentAlertsLoading
                ? "Loading..."
                : recentAlertsError && recentAlerts.length === 0
                  ? "Retry"
                  : !hasExpandedAlertHistory
                    ? "View alert history"
                    : hasMoreAlertHistory
                      ? `Load more (${Math.min(ALERT_HISTORY_PAGE_SIZE, recentAlertTotal - recentAlerts.length)})`
                      : "Show recent"}
            </button>
          ) : null}
        </div>
          </section>
        </main>

        <aside className={styles.adRail} aria-label="Plan and advertising">
          {showsAds ? (
            <AdSenseSlot
              className={styles.railAdSlot}
              format="responsive"
              height={250}
              inventory="alerts-rail-300x250"
              mediaQuery="(min-width: 1181px)"
              placeholderSize="Responsive display"
              width={336}
            />
          ) : null}

          {!isUltimate ? (
            <section className={styles.railUpgrade} aria-labelledby="alerts-v2-rail-upgrade-title">
              <span>{upgradeTier.toUpperCase()}</span>
              <h2 id="alerts-v2-rail-upgrade-title">Unlock more signal</h2>
              <p>{upgradeTier === "Advanced" ? "Get all 17 Discovery categories and advanced filters." : "Get form-level filing filters and custom rules with Ultimate."}</p>
              <Link className={styles.railUpgradeLink} href="/premium">View {upgradeTier}</Link>
            </section>
          ) : null}

          {showsAds ? (
            <AdSenseSlot
              className={styles.railAdSlot}
              format="responsive"
              height={250}
              inventory="alerts-rail-300x600"
              mediaQuery="(min-width: 1181px)"
              placeholderSize="Responsive display"
              width={336}
            />
          ) : null}
        </aside>

      </div>

      {isWatchlistOpen ? (
        <div className={styles.watchlistOverlay} role="presentation">
          <button
            aria-label="Close watchlist picker"
            className={styles.overlayButton}
            onClick={closeWatchlistPanel}
            type="button"
          />
          <section
            aria-label="Add tickers from Watchlist"
            aria-modal="true"
            className={styles.watchlistPanel}
            role="dialog"
          >
            <div className={styles.sheetHandle} aria-hidden="true" />
            <div className={styles.panelTitle}>
              <strong>From Watchlist</strong>
              <button onClick={closeWatchlistPanel} type="button">Close</button>
            </div>
            <p>Select from your watchlist without showing the full Watchlist page here.</p>
            <div className={styles.watchlistItems}>
              {watchlistLoading ? (
                <p className={styles.watchlistStatus}>Loading Watchlist...</p>
              ) : watchlistError ? (
                <p className={styles.watchlistStatus}>{watchlistError}</p>
              ) : availableWatchlistItems.length === 0 ? (
                <p className={styles.watchlistStatus}>No additional Watchlist tickers to add.</p>
              ) : availableWatchlistItems.map((candidate) => (
                <button
                  key={candidate.id}
                  disabled={Boolean(tickerAction)}
                  onClick={() => void addTicker(candidate.ticker)}
                  type="button"
                >
                  <span>
                    <strong>{candidate.ticker}</strong>
                    <small>{candidate.companyName || candidate.ticker}</small>
                  </span>
                  <em>{tickerAction === `add:${candidate.ticker}` ? "Adding..." : "Add"}</em>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function getDeliveredAlertType(alert: DeliveredAlertItem) {
  if (alert.categoryLabel) return alert.categoryLabel;
  if (alert.sourceLabel) return alert.sourceLabel;
  if (alert.alertLane === "calendar_follow") return "Calendar follow";
  return alert.alertLane === "watchlist" ? "Watchlist" : "Market discovery";
}

function getDeliveryStatusLabel(status: DeliveredAlertItem["deliveryStatus"]) {
  if (status === "sent") return "Delivered";
  if (status === "failed") return "Failed";
  if (status === "suppressed") return "Suppressed";
  return "Queued";
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;

  const elapsedMilliseconds = Math.max(0, Date.now() - timestamp);
  const elapsedMinutes = Math.floor(elapsedMilliseconds / 60_000);

  if (elapsedMinutes < 1) return "Just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hr ago`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays === 1) return "Yesterday";
  if (elapsedDays < 7) return `${elapsedDays} days ago`;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: new Date(timestamp).getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(timestamp);
}

function formatCalendarFollowDate(eventDate: string, eventTime: string | null) {
  const timestamp = Date.parse(`${eventDate}T12:00:00Z`);
  const dateLabel = Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(timestamp)
    : eventDate;
  return eventTime ? `${dateLabel} · ${eventTime.slice(0, 5)} ET` : dateLabel;
}
