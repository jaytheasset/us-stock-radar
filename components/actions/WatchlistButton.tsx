"use client";

import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import {
  getWatchlistOverride,
  publishUserContentChange,
  subscribeToUserContentChanges,
} from "@/lib/userContentSync";
import styles from "./ContentActionButtons.module.css";

export function WatchlistButton({
  className,
  initialAuthenticated,
  initialWatched,
  returnHref,
  ticker,
}: {
  className?: string;
  initialAuthenticated: boolean;
  initialWatched: boolean;
  returnHref?: string;
  ticker: string;
}) {
  const [watched, setWatched] = useState(
    () => getWatchlistOverride(ticker) ?? initialWatched,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const normalizedTicker = ticker.trim().toUpperCase();

  useEffect(() => {
    setWatched(getWatchlistOverride(normalizedTicker) ?? initialWatched);
  }, [initialWatched, normalizedTicker]);

  useEffect(
    () =>
      subscribeToUserContentChanges((change) => {
        if (
          change.kind === "watchlist" &&
          change.ticker === normalizedTicker
        ) {
          setWatched(change.value);
        }
      }),
    [normalizedTicker],
  );

  const actionLabel = watched
    ? `Remove ${normalizedTicker} from Watchlist`
    : `Add ${normalizedTicker} to Watchlist`;

  async function toggleWatchlist() {
    if (busy) return;
    if (!initialAuthenticated) {
      window.location.assign(createLoginHref(returnHref));
      return;
    }

    const previous = watched;
    const next = !previous;
    setWatched(next);
    setBusy(true);
    setMessage(next ? "Adding to Watchlist…" : "Removing from Watchlist…");
    publishUserContentChange({
      kind: "watchlist",
      ticker: normalizedTicker,
      value: next,
    });

    try {
      const response = await fetch(
        next
          ? "/api/watchlist"
          : `/api/watchlist/${encodeURIComponent(normalizedTicker)}`,
        next
          ? {
              body: JSON.stringify({ ticker: normalizedTicker }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            }
          : { method: "DELETE" },
      );
      const payload = (await response.json()) as {
        guestMode?: boolean;
        message?: string;
        ok?: boolean;
        persisted?: boolean;
      };
      if (payload.guestMode || payload.persisted === false) {
        setWatched(previous);
        publishUserContentChange({
          kind: "watchlist",
          ticker: normalizedTicker,
          value: previous,
        });
        window.location.assign(createLoginHref(returnHref));
        return;
      }
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || "Watchlist update failed");
      }
      setMessage(next ? "Added to Watchlist." : "Removed from Watchlist.");
    } catch {
      setWatched(previous);
      publishUserContentChange({
        kind: "watchlist",
        ticker: normalizedTicker,
        value: previous,
      });
      setMessage("Could not update Watchlist. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      aria-label={actionLabel}
      aria-pressed={watched}
      className={[styles.button, className].filter(Boolean).join(" ")}
      disabled={busy}
      onClick={() => void toggleWatchlist()}
      title={actionLabel}
      type="button"
    >
      <Star aria-hidden="true" size={18} />
      <span aria-live="polite" className={styles.status}>
        {message}
      </span>
    </button>
  );
}

function createLoginHref(returnHref?: string) {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = returnHref?.startsWith("/") ? returnHref : current;
  return `/login?next=${encodeURIComponent(next)}`;
}
