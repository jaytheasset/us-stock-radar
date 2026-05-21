"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { formatLimit } from "@/lib/subscriptionPolicy";
import type { WatchlistViewModel } from "@/lib/watchlist/types";

type WatchlistClientProps = {
  initialWatchlist: WatchlistViewModel;
};

type RequestState = "idle" | "saving" | "failed";

const navItems = [
  { label: "Live Feed", href: "/feed" },
  { label: "Watchlist", href: "/watchlist" },
  { label: "News", href: "/news" },
  { label: "Filings", href: "/filings" },
  { label: "Calendar", href: "/calendar" },
  { label: "Alerts", href: "/alerts" },
  { label: "Premium", href: "/premium" },
];

export default function WatchlistClient({ initialWatchlist }: WatchlistClientProps) {
  const [watchlist, setWatchlist] = useState(initialWatchlist);
  const [tickerInput, setTickerInput] = useState("");
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [message, setMessage] = useState("");
  const [removingTicker, setRemovingTicker] = useState<string | null>(null);

  const usageLabel = useMemo(() => `${watchlist.usage} / ${formatLimit(watchlist.limit)}`, [watchlist.limit, watchlist.usage]);
  const limitReached = watchlist.limit !== null && watchlist.usage >= watchlist.limit;

  async function handleAddTicker(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ticker = tickerInput.trim();
    if (!ticker) return;

    setRequestState("saving");
    setMessage("");

    try {
      const response = await fetch("/api/watchlist", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ticker }),
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Failed to add ticker.");
      }

      setWatchlist(payload.data);
      setTickerInput("");
      setRequestState("idle");
      if (payload.guestMode || payload.persisted === false) {
        setMessage(payload.message || "Create an account to save your watchlist.");
        return;
      }
      setMessage(`${payload.data.items.find((item: { ticker: string }) => item.ticker === ticker.toUpperCase())?.ticker || ticker.toUpperCase()} added.`);
    } catch (error) {
      setRequestState("failed");
      setMessage(error instanceof Error ? error.message : "Failed to add ticker.");
    }
  }

  async function handleRemoveTicker(ticker: string) {
    setRemovingTicker(ticker);
    setRequestState("saving");
    setMessage("");

    try {
      const response = await fetch(`/api/watchlist/${encodeURIComponent(ticker)}`, {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        throw new Error(payload.message || "Failed to remove ticker.");
      }

      setWatchlist(payload.data);
      setRequestState("idle");
      if (payload.guestMode || payload.persisted === false) {
        setMessage(payload.message || "Create an account to save your watchlist.");
        return;
      }
      setMessage(`${ticker} removed.`);
    } catch (error) {
      setRequestState("failed");
      setMessage(error instanceof Error ? error.message : "Failed to remove ticker.");
    } finally {
      setRemovingTicker(null);
    }
  }

  return (
    <main className="feed-page watchlist-page">
      <header className="feed-nav">
        <Link className="brand-lockup" href="/feed" aria-label="US Stock Radar feed">
          <span className="brand-mark">SR</span>
          <span>STOCK RADAR</span>
        </Link>
        <nav className="feed-nav-links" aria-label="Primary">
          {navItems.map((item) => (
            <Link className={item.label === "Watchlist" ? "active" : ""} href={item.href} key={item.label}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="feed-search" role="search">
          <span aria-hidden="true">/</span>
          <input aria-label="Search watchlist" placeholder="Search watchlist or ticker" />
        </div>
        <div className="feed-actions">
          <button className="icon-button" type="button" aria-label="Notifications">
            <span aria-hidden="true">!</span>
            <span className="notification-dot">3</span>
          </button>
          <button className="avatar-button" type="button" aria-label="User menu">
            N
          </button>
        </div>
      </header>

      <section className="watchlist-shell">
        <div className="watchlist-heading">
          <div>
            <span>Watchlist Settings</span>
            <h1>Watchlist</h1>
            <p>Manage saved tickers used by Watchlist Alerts. Price data, event summaries, and ticker search are intentionally left for the next build step.</p>
          </div>
          <form className="watchlist-actions" onSubmit={handleAddTicker}>
            <label>
              <span>+</span>
              <input
                aria-label="Add ticker"
                autoCapitalize="characters"
                placeholder="Add ticker"
                value={tickerInput}
                onChange={(event) => setTickerInput(event.target.value.toUpperCase())}
              />
            </label>
            <button disabled={requestState === "saving" || limitReached} type="submit">
              Add
            </button>
          </form>
        </div>

        <div className="watchlist-stat-strip" aria-label="Watchlist summary">
          <WatchStat label="Watchlist Usage" value={usageLabel} note={`${watchlist.planLabel} plan`} />
          <WatchStat label="Plan Limit" value={formatLimit(watchlist.limit)} note="Saved tickers allowed" tone={limitReached ? "volatile" : "neutral"} />
          <WatchStat label="Alert Link" value="Active" note="Alerts reads this same DB" tone="bullish" />
          <WatchStat label="Data Scope" value="MVP" note="No price/news lookup yet" tone="neutral" />
        </div>

        <div className="watchlist-status-line" aria-live="polite">
          <span className={requestState === "failed" ? "bearish" : "neutral"}>
            {requestState === "saving"
              ? "Saving..."
              : message ||
                (watchlist.guestMode
                  ? "Guest preview only. Create an account to save your watchlist."
                  : "Changes apply to Watchlist Alerts and Alerts usage immediately.")}
          </span>
          {watchlist.guestMode ? <Link href="/signup">Create Account</Link> : <Link href="/premium">Manage Plan</Link>}
        </div>

        <div className="watchlist-grid watchlist-grid-compact">
          <section className="watchlist-main">
            <div className="watchlist-toolbar">
              <div className="watchlist-tabs" aria-label="Watchlist filters">
                <button className="active" type="button">
                  Saved Tickers
                </button>
              </div>
              <div className="watchlist-sort">
                <Link className="watchlist-plan-link" href="/alerts">
                  Alert settings
                </Link>
              </div>
            </div>

            <div className="watchlist-table watchlist-simple-table" aria-label="Saved watchlist tickers">
              <div className="watchlist-table-head">
                <span>Ticker</span>
                <span>Company</span>
                <span>Added</span>
                <span>Actions</span>
              </div>
              {watchlist.items.length ? (
                watchlist.items.map((item) => (
                  <div className="watchlist-row watchlist-simple-row" key={item.id}>
                    <div className="watchlist-symbol">
                      <strong>{item.ticker}</strong>
                      <small>Watchlist Alert ticker</small>
                    </div>
                    <div className="watchlist-event">
                      <strong>{item.companyName || "Company name not set"}</strong>
                      <small>Automatic company lookup is not enabled in this MVP.</small>
                    </div>
                    <div className="watchlist-next">
                      <strong>{formatDate(item.createdAt)}</strong>
                      <small>Stored in watchlist_tickers</small>
                    </div>
                    <div className="watchlist-row-actions">
                      <button disabled={removingTicker === item.ticker} type="button" onClick={() => handleRemoveTicker(item.ticker)}>
                        {removingTicker === item.ticker ? "Removing..." : "Remove"}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="watchlist-empty-state">
                  <strong>No watchlist tickers yet.</strong>
                  <span>Add a ticker to enable watchlist-based alert delivery.</span>
                </div>
              )}
            </div>
          </section>

          <aside className="watchlist-rail">
            <section className="watchlist-rail-section">
              <div className="watchlist-panel-heading">
                <h2>What This Controls</h2>
                <Link href="/alerts">Alerts</Link>
              </div>
              <div className="watchlist-exposure-list">
                <div>
                  <span>Watchlist Alerts</span>
                  <strong>Enabled by ticker</strong>
                </div>
                <div>
                  <span>Discovery Categories</span>
                  <strong>Separate limit</strong>
                </div>
                <div>
                  <span>Browsing Feed</span>
                  <strong>No plan gate</strong>
                </div>
              </div>
            </section>

            <section className="watchlist-upgrade">
              <span>{watchlist.planLabel}</span>
              <h2>Watchlist limit</h2>
              <p>
                You are using {usageLabel} saved ticker slots. Upgrade only when you need more ticker coverage or faster alert routing.
              </p>
              <Link href="/premium">Manage Plan</Link>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function WatchStat({
  label,
  value,
  note,
  tone = "bullish",
}: {
  label: string;
  value: string;
  note: string;
  tone?: "bullish" | "bearish" | "volatile" | "neutral";
}) {
  return (
    <div className="watchlist-stat">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}
