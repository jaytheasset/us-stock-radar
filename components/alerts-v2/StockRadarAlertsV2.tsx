"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { DesktopRailAdSlot } from "@/components/dashboard-v2/DesktopRailAdSlot";
import {
  alertIconSet,
  alertSources,
  coverageItems,
  deliveryItems,
  filingAlertGroups,
  getAlertsMockPlan,
  initialAlertTickers,
  marketCapFilters,
  recentAlerts,
  watchlistCandidates,
  type AlertTicker,
} from "@/lib/mock/alertsV2Data";
import styles from "./StockRadarAlertsV2.module.css";

const INITIAL_RECENT_ALERT_COUNT = 6;
const ALERT_HISTORY_PAGE_SIZE = 20;

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

function getCompanyName(ticker: string) {
  const knownCompanies: Record<string, string> = {
    AMD: "Advanced Micro Devices",
    GOOGL: "Alphabet Inc.",
    META: "Meta Platforms Inc.",
    MSFT: "Microsoft Corp.",
    TSLA: "Tesla Inc.",
  };

  return knownCompanies[ticker] ?? `${ticker} Corp.`;
}

function getDefaultCoverageState(hasRiskAlerts: boolean) {
  return Object.fromEntries(
    coverageItems.map((item) => [item.id, item.enabled || (hasRiskAlerts && Boolean(item.locked))]),
  );
}

export function StockRadarAlertsV2() {
  const searchParams = useSearchParams();
  const mockPlan = getAlertsMockPlan(searchParams.get("plan"));
  const [tickers, setTickers] = useState<AlertTicker[]>([...initialAlertTickers]);
  const [tickerInput, setTickerInput] = useState("");
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
  const [visibleRecentAlertCount, setVisibleRecentAlertCount] = useState(
    INITIAL_RECENT_ALERT_COUNT,
  );
  const fromWatchlistButtonRef = useRef<HTMLButtonElement>(null);

  const enabledCount = useMemo(
    () => tickers.filter((ticker) => ticker.enabled).length,
    [tickers],
  );
  const enabledCoreCoverageCount = useMemo(
    () => coverageItems.filter((item) => !item.locked && coverageState[item.id]).length,
    [coverageState],
  );
  const visibleRecentAlerts = recentAlerts.slice(0, visibleRecentAlertCount);
  const hasExpandedAlertHistory = visibleRecentAlertCount > INITIAL_RECENT_ALERT_COUNT;
  const hasMoreAlertHistory = visibleRecentAlertCount < recentAlerts.length;

  useEffect(() => {
    const visibleTickerCount = mockPlan.tickerLimit ?? initialAlertTickers.length;
    setTickers([...initialAlertTickers.slice(0, visibleTickerCount)]);
  }, [mockPlan.id, mockPlan.tickerLimit]);

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

  const addTicker = (tickerValue?: string, companyValue?: string) => {
    const ticker = (tickerValue ?? tickerInput).trim().toUpperCase();

    if (!ticker || tickers.some((item) => item.ticker === ticker)) {
      setTickerInput("");
      return;
    }

    if (mockPlan.tickerLimit && tickers.length >= mockPlan.tickerLimit) {
      setUpgradeMessage(`${mockPlan.label} supports up to ${mockPlan.tickerLimit} alert-enabled ticker${mockPlan.tickerLimit === 1 ? "" : "s"}.`);
      setTickerInput("");
      return;
    }

    setTickers((current) => [
      ...current,
      {
        id: ticker.toLowerCase(),
        ticker,
        company: companyValue ?? getCompanyName(ticker),
        enabled: true,
      },
    ]);
    setTickerInput("");
    markSettingsChanged();
  };

  const removeTicker = (id: string) => {
    setTickers((current) => current.filter((ticker) => ticker.id !== id));
    markSettingsChanged();
  };

  const toggleTicker = (id: string) => {
    setTickers((current) =>
      current.map((ticker) =>
        ticker.id === id ? { ...ticker, enabled: !ticker.enabled } : ticker,
      ),
    );
    markSettingsChanged();
  };

  const closeWatchlistPanel = () => {
    setIsWatchlistOpen(false);
    requestAnimationFrame(() => fromWatchlistButtonRef.current?.focus({ preventScroll: true }));
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
          <span>{enabledCount} / {mockPlan.tickerLimit ?? "Unlimited"} enabled</span>
        </div>

        <div className={styles.addTickerRow}>
          <label className={styles.searchBox}>
            <Search aria-hidden="true" size={18} />
            <span>Search ticker to add</span>
            <input
              onChange={(event) => setTickerInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTicker();
                }
              }}
              placeholder="Search ticker to add"
              value={tickerInput}
            />
          </label>
          <button className={styles.primaryButton} onClick={() => addTicker()} type="button">
            Add ticker
          </button>
          <button
            className={styles.secondaryButton}
            onClick={() => setIsWatchlistOpen(true)}
            ref={fromWatchlistButtonRef}
            type="button"
          >
            From Watchlist
          </button>
        </div>

        <div className={styles.tickerList}>
          {tickers.map((ticker) => (
            <article className={styles.tickerRow} key={ticker.id}>
              <strong>{ticker.ticker}</strong>
              <span>{ticker.company}</span>
              <div className={styles.inlineToggle}>
                <ToggleSwitch
                  checked={ticker.enabled}
                  label={`Toggle alerts for ${ticker.ticker}`}
                  onChange={() => toggleTicker(ticker.id)}
                />
                <em>{ticker.enabled ? "ON" : "OFF"}</em>
              </div>
              <button
                aria-label={`Remove ${ticker.ticker}`}
                className={styles.removeButton}
                onClick={() => removeTicker(ticker.id)}
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
              <Link href="/premium">View Pro</Link>
            </div>
          ) : !mockPlan.hasRiskAlerts ? (
            <div className={styles.cardFooter}>
              <span>Unlock critical risk alerts with Advanced</span>
              <Link href="/premium">View Advanced</Link>
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
              <Link href="/premium">View Ultimate</Link>
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
          {visibleRecentAlerts.map((alert) => (
            <article className={styles.recentRow} key={alert.id} role="row">
              <strong role="cell">{alert.ticker}</strong>
              <span role="cell">{alert.category}</span>
              <p role="cell">{alert.event}</p>
              <time role="cell">{alert.time}</time>
              <em role="cell">
                <CheckCircle2 aria-hidden="true" size={16} />
                Delivered
              </em>
            </article>
          ))}
        </div>
        <div className={styles.recentFooter}>
          {hasExpandedAlertHistory ? (
            <span aria-live="polite">
              Showing {visibleRecentAlerts.length} of {recentAlerts.length}
            </span>
          ) : (
            <span />
          )}
          <button
            onClick={() => {
              if (!hasMoreAlertHistory) {
                setVisibleRecentAlertCount(INITIAL_RECENT_ALERT_COUNT);
                return;
              }

              setVisibleRecentAlertCount((current) =>
                Math.min(
                  current === INITIAL_RECENT_ALERT_COUNT
                    ? ALERT_HISTORY_PAGE_SIZE
                    : current + ALERT_HISTORY_PAGE_SIZE,
                  recentAlerts.length,
                ),
              );
            }}
            type="button"
          >
            {!hasExpandedAlertHistory
              ? "View alert history"
              : hasMoreAlertHistory
                ? `Load more (${Math.min(ALERT_HISTORY_PAGE_SIZE, recentAlerts.length - visibleRecentAlerts.length)})`
                : "Show recent"}
          </button>
        </div>
          </section>
        </main>

        <aside className={styles.adRail} aria-label="Plan and advertising">
          {mockPlan.showsAds ? (
            <DesktopRailAdSlot />
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
            <section className={styles.railTallAd} aria-label="Advertisement">
              <span>Advertisement</span>
              <strong>300 x 600</strong>
              <p>Free-member placement</p>
              <small>Not shown to Ad-Free+ members.</small>
            </section>
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
              {watchlistCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  onClick={() => {
                    addTicker(candidate.ticker, candidate.company);
                    closeWatchlistPanel();
                  }}
                  type="button"
                >
                  <span>
                    <strong>{candidate.ticker}</strong>
                    <small>{candidate.company}</small>
                  </span>
                  <em>Add</em>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
