"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DesktopRailAdSlot } from "@/components/dashboard-v2/DesktopRailAdSlot";
import {
  alertIconSet,
  coverageItems,
  deliveryItems,
  feedAlertSettings,
  filingAlertGroups,
  initialAlertTickers,
  marketCapFilters,
  recentAlerts,
  watchlistCandidates,
  type AlertTicker,
} from "@/lib/mock/alertsV2Data";
import styles from "./StockRadarAlertsV2.module.css";

const tickerLimit = 20;

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

export function StockRadarAlertsV2() {
  const [tickers, setTickers] = useState<AlertTicker[]>([...initialAlertTickers]);
  const [tickerInput, setTickerInput] = useState("");
  const [coverageState, setCoverageState] = useState(
    Object.fromEntries(coverageItems.map((item) => [item.id, item.enabled])),
  );
  const [deliveryState, setDeliveryState] = useState(
    Object.fromEntries(deliveryItems.map((item) => [item.id, item.enabled])),
  );
  const [marketCapState, setMarketCapState] = useState(
    Object.fromEntries(marketCapFilters.map((item) => [item.id, true])),
  );
  const [isWatchlistOpen, setIsWatchlistOpen] = useState(false);
  const [upgradeMessage, setUpgradeMessage] = useState("");
  const fromWatchlistButtonRef = useRef<HTMLButtonElement>(null);

  const enabledCount = useMemo(
    () => tickers.filter((ticker) => ticker.enabled).length,
    [tickers],
  );

  const addTicker = (tickerValue?: string, companyValue?: string) => {
    const ticker = (tickerValue ?? tickerInput).trim().toUpperCase();

    if (!ticker || tickers.some((item) => item.ticker === ticker)) {
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
  };

  const removeTicker = (id: string) => {
    setTickers((current) => current.filter((ticker) => ticker.id !== id));
  };

  const toggleTicker = (id: string) => {
    setTickers((current) =>
      current.map((ticker) =>
        ticker.id === id ? { ...ticker, enabled: !ticker.enabled } : ticker,
      ),
    );
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
              <span>Your plan: Pro</span>
              <Link href="/premium-v2">Manage plan</Link>
            </div>
          </section>

          <section className={styles.notice} aria-label="Push permission notice">
            <Bell aria-hidden="true" size={20} />
            <p>Push notifications are disabled. Enable notifications to receive real-time alerts.</p>
            <div>
              <button type="button">Enable notifications</button>
              <button type="button">Send test alert</button>
            </div>
          </section>

          <section className={styles.card} aria-labelledby="alerts-v2-tickers-title">
        <div className={styles.cardHeader}>
          <div>
            <h2 id="alerts-v2-tickers-title">Alert-enabled tickers</h2>
            <p>Enabled tickers are covered across every category below, including Dilution &amp; Offerings, Listing Risk &amp; Delisting, Reverse Splits, and Bankruptcy &amp; Default.</p>
          </div>
          <span>{enabledCount} / {tickerLimit} enabled</span>
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
        <section className={styles.card} aria-labelledby="alerts-v2-coverage-title">
          <div className={styles.cardHeader}>
            <div>
              <h2 id="alerts-v2-coverage-title">Alert coverage</h2>
              <p>Stocks outside your alert-enabled tickers receive only the enabled Core Event alerts below.</p>
            </div>
          </div>

          <div className={styles.settingList}>
            {coverageItems.map((item) => {
              const Icon = item.icon;
              const locked = Boolean(item.locked);

              return (
                <article
                  className={styles.settingRow}
                  data-locked={locked}
                  key={item.id}
                  onClick={() => {
                    if (locked) {
                      setUpgradeMessage(`${item.title} requires Advanced.`);
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
                      <em>ADVANCED+</em>
                    </span>
                  ) : null}
                  <div className={styles.inlineToggle}>
                    <ToggleSwitch
                      checked={Boolean(coverageState[item.id])}
                      disabled={locked}
                      label={`Toggle ${item.title}`}
                      onChange={() =>
                        setCoverageState((current) => ({
                          ...current,
                          [item.id]: !current[item.id],
                        }))
                      }
                    />
                    <em>{coverageState[item.id] ? "ON" : "OFF"}</em>
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

          <div className={styles.cardFooter}>
            <span>Unlock critical risk alerts with Advanced</span>
            <Link href="/premium-v2">View Advanced</Link>
          </div>
        </section>

        <div className={styles.settingsSideColumn}>
          <section className={styles.card} aria-labelledby="alerts-v2-delivery-title">
            <div className={styles.cardHeader}>
              <div>
                <h2 id="alerts-v2-delivery-title">Delivery</h2>
              </div>
            </div>

            <div className={styles.settingList}>
              {deliveryItems.map((item) => {
                const Icon = item.icon;
                const locked = Boolean(item.lockedTier);

                return (
                  <article className={styles.settingRow} key={item.id}>
                    <Icon aria-hidden="true" size={20} />
                    <div>
                      <strong>{item.title}</strong>
                    </div>
                    {locked ? (
                      <span className={styles.lockGroup}>
                        <Lock aria-hidden="true" size={15} />
                        <em>{item.lockedTier}+</em>
                      </span>
                    ) : null}
                    <div className={styles.inlineToggle}>
                      <ToggleSwitch
                        checked={Boolean(deliveryState[item.id])}
                        disabled={locked}
                        label={`Toggle ${item.title}`}
                        onChange={() =>
                          setDeliveryState((current) => ({
                            ...current,
                            [item.id]: !current[item.id],
                          }))
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
                <p>Choose which market-cap bands are eligible for alert discovery.</p>
              </div>
            </div>

            <div className={styles.marketCapGrid}>
              {marketCapFilters.map((item) => (
                <label className={styles.marketCapOption} key={item.id}>
                  <input
                    checked={Boolean(marketCapState[item.id])}
                    onChange={(event) =>
                      setMarketCapState((current) => ({
                        ...current,
                        [item.id]: event.currentTarget.checked,
                      }))
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

        <section className={`${styles.card} ${styles.ultimateCard}`} aria-labelledby="alerts-v2-ultimate-title">
          <div className={styles.cardHeader}>
            <div>
              <h2 id="alerts-v2-ultimate-title">Ultimate alert controls</h2>
              <p>Preview advanced alert tools available on Ultimate.</p>
            </div>
            <span className={styles.lockedBadge}>
              <Lock aria-hidden="true" size={14} />
              ADVANCED+
            </span>
          </div>

          <div className={styles.ultimateFeatureList}>
            {feedAlertSettings.map((item) => (
              <article className={styles.ultimateFeatureRow} key={item.id}>
                <Bell aria-hidden="true" size={20} />
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </div>
                <span className={styles.lockGroup}>
                  <Lock aria-hidden="true" size={15} />
                  <em>ADVANCED+</em>
                </span>
              </article>
            ))}

          </div>

          <div className={styles.ultimateFooter}>
            <span>Unlock feed-wide alerts and priority routing with Advanced</span>
            <Link href="/premium-v2">View Advanced</Link>
          </div>
        </section>

        <section className={`${styles.card} ${styles.filingCard}`} aria-labelledby="alerts-v2-filing-title">
          <div className={styles.cardHeader}>
            <div>
              <h2 id="alerts-v2-filing-title">Filing type alerts</h2>
              <p>Choose which SEC forms can trigger filing alerts.</p>
            </div>
            <span className={styles.lockedBadge}>
              <Lock aria-hidden="true" size={14} />
              ULTIMATE+
            </span>
          </div>

          <div className={styles.filingGroupList}>
            {filingAlertGroups.map((group) => (
              <section className={styles.filingGroup} key={group.id}>
                <strong>{group.title}</strong>
                <div className={styles.filingTypeGrid}>
                  {group.items.map((item) => (
                    <label className={styles.filingTypeOption} key={item.id}>
                      <input checked disabled readOnly type="checkbox" />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>

          <div className={styles.ultimateFooter}>
            <span>Unlock form-level filing alert rules with Ultimate</span>
            <Link href="/premium-v2">View Ultimate</Link>
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
          {recentAlerts.map((alert) => (
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
          <Link href="/alerts-v2">View alert history</Link>
        </div>
          </section>
        </main>

        <aside className={styles.adRail} aria-label="Advertisement">
          <DesktopRailAdSlot note="Pro+ members do not see ads." />
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
