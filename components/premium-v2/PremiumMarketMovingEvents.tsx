"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getDirectionalScoreTone } from "@/lib/directionalScore";
import {
  PREMIUM_MARKET_MOVING_POLL_INTERVAL_MS,
  shouldPollPremiumMarketMoving,
  type PremiumMarketMovingEvent,
  type PremiumMarketMovingResponse,
} from "@/lib/premiumMarketMoving";
import styles from "./StockRadarPremiumV2.module.css";

type LoadStatus = "loading" | "ready" | "error";

export function PremiumMarketMovingEvents() {
  const [events, setEvents] = useState<PremiumMarketMovingEvent[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [refreshFailed, setRefreshFailed] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const hasSuccessfulDataRef = useRef(false);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const refresh = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const request = fetch("/api/premium/market-moving-events", {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Premium filing refresh failed");
        const payload = (await response.json()) as PremiumMarketMovingResponse;
        if (!Array.isArray(payload.events)) {
          throw new Error("Premium filing response is invalid");
        }
        setEvents(payload.events);
        setStatus("ready");
        setRefreshFailed(false);
        hasSuccessfulDataRef.current = true;
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (hasSuccessfulDataRef.current) {
          setRefreshFailed(true);
          return;
        }
        setStatus("error");
      })
      .finally(() => {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        inFlightRef.current = null;
      });

    inFlightRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (shouldPollPremiumMarketMoving(document.visibilityState)) {
      void refresh();
    }

    const pollTimer = window.setInterval(() => {
      if (shouldPollPremiumMarketMoving(document.visibilityState)) {
        void refresh();
      }
    }, PREMIUM_MARKET_MOVING_POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (shouldPollPremiumMarketMoving(document.visibilityState)) {
        void refresh();
      }
    };
    const handleFocus = () => {
      if (shouldPollPremiumMarketMoving(document.visibilityState)) {
        void refresh();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      window.clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      abortControllerRef.current?.abort();
    };
  }, [refresh]);

  return (
    <aside
      aria-label="Market-moving filing events"
      className={styles.alertPreview}
      data-testid="premium-market-moving-events"
    >
      <header>
        <div>
          <span>Market-Moving Events</span>
          <strong>Latest 90+ filing signals</strong>
        </div>
      </header>
      {status === "loading" ? (
        <p className={styles.alertState}>Loading 90+ filings...</p>
      ) : null}
      {status === "error" ? (
        <p className={`${styles.alertState} ${styles.alertStateError}`} role="status">
          Market-moving filings are temporarily unavailable.
        </p>
      ) : null}
      {status === "ready" && events.length === 0 ? (
        <p className={styles.alertState}>No 90+ filings right now.</p>
      ) : null}
      {status === "ready" && events.length > 0 ? (
        <div className={styles.alertList}>
          {events.map((event) => {
            const tone = getDirectionalScoreTone(event.score, event.signal);
            return (
              <Link
                aria-label={`${event.ticker}: ${event.title}. ${event.signal} ${event.score}`}
                className={styles.alertRow}
                href={event.href}
                key={event.id}
              >
                <span
                  aria-hidden="true"
                  className={styles.alertDot}
                  data-score-tone={tone}
                />
                <div className={styles.alertContent}>
                  <div className={styles.alertMeta}>
                    <span className={styles.alertTicker}>{event.ticker}</span>
                    <span className={styles.alertType}>{event.eventTypeLabel}</span>
                  </div>
                  <strong>{event.title}</strong>
                </div>
                <span className={styles.alertSignal} data-score-tone={tone}>
                  <span>{formatSignal(event.signal)}</span>
                  <strong data-score-tone={tone}>{event.score}</strong>
                </span>
              </Link>
            );
          })}
        </div>
      ) : null}
      {refreshFailed ? (
        <p aria-live="polite" className={styles.alertRefreshStatus}>
          Refresh failed. Showing the latest available filings.
        </p>
      ) : null}
    </aside>
  );
}

function formatSignal(signal: PremiumMarketMovingEvent["signal"]) {
  return `${signal.charAt(0).toUpperCase()}${signal.slice(1)}`;
}
