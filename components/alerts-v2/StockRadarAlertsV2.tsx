"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { AdSenseSlot } from "@/components/ads/AdSenseSlot";
import type { DeliveredAlertItem } from "@/lib/alerts/types";
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
  getAlertsMockPlan,
  marketCapFilters,
} from "@/lib/mock/alertsV2Data";
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

function getDefaultCoverageState(hasRiskAlerts: boolean) {
  return Object.fromEntries(
    coverageItems.map((item) => [item.id, item.enabled || (hasRiskAlerts && Boolean(item.locked))]),
  );
}

export function StockRadarAlertsV2() {
  const searchParams = useSearchParams();
  const mockPlan = getAlertsMockPlan(searchParams.get("plan"));
  const [tickers, setTickers] = useState<AlertTickerItem[]>([]);
  const [alertTickerLimit, setAlertTickerLimit] = useState<number | null>(null);
  const [tickersLoading, setTickersLoading] = useState(true);
  const [tickerAction, setTickerAction] = useState("");
  const [tickerInput, setTickerInput] = useState("");
  const [selectedTicker, setSelectedTicker] = useState<TickerSearchResult | null>(null);
  const [tickerSuggestions, setTickerSuggestions] = useState<TickerSearchResult[]>([]);
  const [tickerSearchLoading, setTickerSearchLoading] = useState(false);
  const [tickerSearchOpen, setTickerSearchOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [tickerMessage, setTickerMessage] = useState("");
  const [watchlistItems, setWatchlistItems] = useState<WatchlistTickerItem[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState("");
  const [coverageState, setCoverageState] = useState(() => getDefaultCoverageState(mockPlan.hasRiskAlerts));
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
  const [isPushEnabled, setIsPushEnabled] = useState(false);
  const [hasSentTestAlert, setHasSentTestAlert] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const [recentAlerts, setRecentAlerts] = useState<DeliveredAlertItem[]>([]);
  const [recentAlertTotal, setRecentAlertTotal] = useState(0);
  const [recentAlertsLoading, setRecentAlertsLoading] = useState(true);
  const [recentAlertsError, setRecentAlertsError] = useState("");
  const [hasExpandedAlertHistory, setHasExpandedAlertHistory] = useState(false);
  const fromWatchlistButtonRef = useRef<HTMLButtonElement>(null);
  const tickerSearchRef = useRef<HTMLDivElement>(null);

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
    const query = tickerInput.trim();
    if (
      !query ||
      (selectedTicker && selectedTicker.ticker === query.toUpperCase())
    ) {
      setTickerSuggestions([]);
      setTickerSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setTickerSearchLoading(true);
      fetch(`/api/tickers/search?q=${encodeURIComponent(query)}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = await readApiPayload<TickerSearchResult[]>(response);
          if (!response.ok || !Array.isArray(payload?.data)) {
            throw new Error(payload?.message || "Failed to search tickers.");
          }
          setTickerSuggestions(payload.data);
          setActiveSuggestionIndex(0);
          setTickerSearchOpen(true);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setTickerSuggestions([]);
          setTickerMessage(error instanceof Error ? error.message : "Failed to search tickers.");
        })
        .finally(() => {
          if (!controller.signal.aborted) setTickerSearchLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selectedTicker, tickerInput]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (
        tickerSearchRef.current &&
        !tickerSearchRef.current.contains(event.target as Node)
      ) {
        setTickerSearchOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    setCoverageState(getDefaultCoverageState(mockPlan.hasRiskAlerts));
  }, [mockPlan.id, mockPlan.hasRiskAlerts]);

  const markSettingsChanged = () => setSaveStatus("idle");

  const updatePushEnabled = (enabled: boolean) => {
    setIsPushEnabled(enabled);
    setHasSentTestAlert(false);
  };

  const sendTestAlert = () => {
    setIsPushEnabled(true);
    setHasSentTestAlert(true);
  };

  const selectTickerSuggestion = (suggestion: TickerSearchResult) => {
    setSelectedTicker(suggestion);
    setTickerInput(suggestion.ticker);
    setTickerSuggestions([]);
    setTickerSearchOpen(false);
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
      setTickerSuggestions([]);
      setTickerSearchOpen(false);
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

  const Bell = alertIconSet.Bell;
  const CheckCircle2 = alertIconSet.CheckCircle2;
  const Lock = alertIconSet.Lock;
  const Search = alertIconSet.Search;
  const Trash2 = alertIconSet.Trash2;
  const isUltimate = mockPlan.id === "ultimate";
  const upgradeTier = mockPlan.id === "advanced" ? "Ultimate" : "Advanced";
  const isTelegramLocked = !["pro", "advanced", "ultimate"].includes(mockPlan.id);
  const outsideTickerCoverage = mockPlan.hasRiskAlerts
    ? "All market tickers are eligible for the enabled Core Event and Risk & Catalyst alerts below."
    : "Stocks outside your alert-enabled tickers receive only the enabled Core Event alerts below.";
  const coverageDescription = mockPlan.hasCoverageControls
    ? outsideTickerCoverage
    : "Unlock event coverage controls with Pro.";

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
              <span>Your plan: {mockPlan.label}</span>
              <Link href="/premium">Manage plan</Link>
            </div>
          </section>

          <section className={styles.notice} aria-label="Push permission notice">
            <Bell aria-hidden="true" size={20} />
            <p>
              {hasSentTestAlert
                ? "Test alert sent."
                : isPushEnabled
                  ? "Push notifications are enabled."
                  : "Push notifications are disabled. Enable notifications to receive real-time alerts."}
            </p>
            <span className={styles.noticeMobileLabel}>Push notifications</span>
            <div className={styles.noticeMobileToggle}>
              <ToggleSwitch
                checked={isPushEnabled}
                label="Toggle push notifications"
                onChange={() => updatePushEnabled(!isPushEnabled)}
              />
              <em>{isPushEnabled ? "ON" : "OFF"}</em>
            </div>
            <div className={styles.noticeActions}>
              <button onClick={() => updatePushEnabled(!isPushEnabled)} type="button">
                {isPushEnabled ? "Disable notifications" : "Enable notifications"}
              </button>
              <button onClick={sendTestAlert} type="button">
                {hasSentTestAlert ? "Test alert sent" : "Send test alert"}
              </button>
            </div>
          </section>

          <section className={`${styles.card} ${styles.tickerCard}`} aria-labelledby="alerts-v2-tickers-title">
        <div className={styles.cardHeader}>
          <div>
            <h2 id="alerts-v2-tickers-title">Alert-enabled tickers</h2>
            <p>Enabled tickers are covered across every category below, including Dilution &amp; Offerings, Listing Risk &amp; Delisting, Reverse Splits, and Bankruptcy &amp; Default.</p>
          </div>
          <span>{enabledCount} / {alertTickerLimit ?? "Unlimited"} enabled</span>
        </div>

        <div className={styles.addTickerRow}>
          <div className={styles.tickerSearch} ref={tickerSearchRef}>
            <label className={styles.searchBox}>
              <Search aria-hidden="true" size={18} />
              <span>Search ticker or company to add</span>
              <input
                aria-autocomplete="list"
                aria-controls="alert-ticker-suggestions"
                aria-expanded={tickerSearchOpen}
                autoComplete="off"
                onChange={(event) => {
                  setTickerInput(event.target.value);
                  setSelectedTicker(null);
                  setTickerMessage("");
                }}
                onFocus={() => {
                  if (tickerSuggestions.length > 0) setTickerSearchOpen(true);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" && tickerSuggestions.length > 0) {
                    event.preventDefault();
                    setTickerSearchOpen(true);
                    setActiveSuggestionIndex((current) =>
                      Math.min(current + 1, tickerSuggestions.length - 1),
                    );
                  } else if (event.key === "ArrowUp" && tickerSuggestions.length > 0) {
                    event.preventDefault();
                    setActiveSuggestionIndex((current) => Math.max(current - 1, 0));
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    const activeSuggestion = tickerSuggestions[activeSuggestionIndex];
                    if (tickerSearchOpen && activeSuggestion) {
                      selectTickerSuggestion(activeSuggestion);
                    } else if (selectedTicker) {
                      void addTicker();
                    }
                  } else if (event.key === "Escape") {
                    setTickerSearchOpen(false);
                  }
                }}
                placeholder="Search ticker or company"
                value={tickerInput}
              />
            </label>

            {tickerSearchOpen ? (
              <div
                className={styles.tickerSuggestions}
                id="alert-ticker-suggestions"
                role="listbox"
              >
                {tickerSearchLoading ? (
                  <p className={styles.tickerSearchStatus}>Searching...</p>
                ) : tickerSuggestions.length > 0 ? (
                  tickerSuggestions.map((suggestion, index) => (
                    <button
                      aria-selected={index === activeSuggestionIndex}
                      className={styles.tickerSuggestion}
                      data-active={index === activeSuggestionIndex}
                      key={suggestion.ticker}
                      onClick={() => selectTickerSuggestion(suggestion)}
                      role="option"
                      type="button"
                    >
                      <strong>{suggestion.ticker}</strong>
                      <span>{suggestion.companyName}</span>
                      <small>{suggestion.exchange || suggestion.assetType || ""}</small>
                    </button>
                  ))
                ) : tickerInput.trim() ? (
                  <p className={styles.tickerSearchStatus}>No matching listed ticker.</p>
                ) : null}
              </div>
            ) : null}
          </div>
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
                {mockPlan.hasCoverageControls
                  ? `${enabledCoreCoverageCount} core alerts on`
                  : "Pro+ coverage controls"}
              </small>
            </span>
            <ChevronDown aria-hidden="true" size={18} />
          </label>
          <div className={styles.cardHeader}>
            <div>
              <h2 id="alerts-v2-coverage-title">Alert coverage</h2>
              <p>{coverageDescription}</p>
            </div>
            {!mockPlan.hasCoverageControls ? <span className={styles.lockedBadge}>PRO+</span> : null}
          </div>

          <div className={styles.settingList} id="alerts-v2-coverage-settings">
            {coverageItems.map((item) => {
              const Icon = item.icon;
              const locked = !mockPlan.hasCoverageControls || (Boolean(item.locked) && !mockPlan.hasRiskAlerts);
              const lockedTier = item.locked ? "ADVANCED" : "PRO";
              const isEnabled = mockPlan.hasCoverageControls && Boolean(coverageState[item.id]);

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
                      disabled={locked}
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

          {!mockPlan.hasCoverageControls ? (
            <div className={styles.cardFooter}>
              <span>Unlock event coverage controls with Pro</span>
              <Link href="/premium">Upgrade to Pro</Link>
            </div>
          ) : !mockPlan.hasRiskAlerts ? (
            <div className={styles.cardFooter}>
              <span>Unlock critical risk alerts with Advanced</span>
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
              {!mockPlan.hasSourceFilters ? <span className={styles.lockedBadge}>PRO+</span> : null}
            </div>

            <div className={styles.sourceFilterGrid} role="group" aria-label="Alert sources">
              {alertSources.map((source) => (
                <label className={styles.sourceFilterOption} key={source.id}>
                  <input
                    checked={Boolean(sourceState[source.id])}
                    disabled={!mockPlan.hasSourceFilters}
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
                const locked = item.id === "email"
                  ? !mockPlan.hasEmailDelivery
                  : item.id === "telegram"
                    ? isTelegramLocked
                    : false;
                const lockedTier = item.id === "email" ? "ADVANCED" : "PRO";

                return (
                  <article className={styles.settingRow} key={item.id}>
                    <Icon aria-hidden="true" size={20} />
                    <div>
                      <strong>{item.title}</strong>
                    </div>
                    {locked ? (
                      <span className={styles.lockGroup}>
                        <Lock aria-hidden="true" size={15} />
                      <em>{lockedTier}+</em>
                      </span>
                    ) : null}
                    <div className={styles.inlineToggle}>
                      <ToggleSwitch
                        checked={Boolean(deliveryState[item.id])}
                        disabled={locked}
                        label={`Toggle ${item.title}`}
                        onChange={() =>
                          {
                            setDeliveryState((current) => ({
                              ...current,
                              [item.id]: !current[item.id],
                            }));
                            markSettingsChanged();
                          }
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
              {!mockPlan.hasMarketCapFilters ? <span className={styles.lockedBadge}>PRO+</span> : null}
            </div>

            <div className={styles.marketCapGrid}>
              {marketCapFilters.map((item) => (
                <label className={styles.marketCapOption} key={item.id}>
                  <input
                    checked={Boolean(marketCapState[item.id])}
                    disabled={!mockPlan.hasMarketCapFilters}
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
          <button className={`${styles.primaryButton} ${styles.saveButton}`} onClick={() => setSaveStatus("saved")} type="button">
            Save changes
          </button>
        </div>

        <section className={`${styles.card} ${styles.filingCard}`} aria-labelledby="alerts-v2-filing-title">
          <div className={styles.cardHeader}>
            <div>
              <h2 id="alerts-v2-filing-title">Filing type alerts</h2>
              <p>Choose which SEC forms can trigger filing alerts.</p>
            </div>
            {!mockPlan.hasFilingTypeAlerts ? (
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
                        disabled={!mockPlan.hasFilingTypeAlerts}
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
                          disabled={!mockPlan.hasFilingTypeAlerts}
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

          {!mockPlan.hasFilingTypeAlerts ? (
            <div className={styles.ultimateFooter}>
              <span>Unlock form-level filing alert rules with Ultimate</span>
              <Link href="/premium">Upgrade to Ultimate</Link>
            </div>
          ) : null}
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
            <article className={styles.recentRow} key={alert.id} role="row">
              <strong role="cell">{alert.ticker || "MARKET"}</strong>
              <span role="cell">{getDeliveredAlertType(alert)}</span>
              <p role="cell">{alert.title}</p>
              <time dateTime={alert.deliveredAt} role="cell">
                {formatRelativeTime(alert.deliveredAt)}
              </time>
              <em data-status={alert.deliveryStatus} role="cell">
                <CheckCircle2 aria-hidden="true" size={16} />
                {getDeliveryStatusLabel(alert.deliveryStatus)}
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
          {mockPlan.showsAds ? (
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
              <p>{upgradeTier === "Advanced" ? "Get critical risk alerts and Email delivery with Advanced." : "Get form-level filing filters and custom rules with Ultimate."}</p>
              <Link className={styles.railUpgradeLink} href="/premium">View {upgradeTier}</Link>
            </section>
          ) : null}

          {mockPlan.showsAds ? (
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
