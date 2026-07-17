import { MarketImpactLabel } from "@/components/market/MarketImpactLabel";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import {
  getAlertsV2SignalLabel,
  type AlertsV2Alert,
} from "@/lib/mock/alertsV2Data";
import { AlertsV2EventBadge } from "./AlertsV2EventBadge";
import styles from "./StockRadarAlertsV2.module.css";

export function AlertsV2List({
  alerts,
  onSelect,
  selectedId,
}: {
  alerts: readonly AlertsV2Alert[];
  onSelect: (alert: AlertsV2Alert, opener: HTMLElement) => void;
  selectedId?: string;
}) {
  if (alerts.length === 0) {
    return (
      <div className={styles.emptyState}>
        <strong>No alerts match these filters.</strong>
        <p>Clear or adjust the local mock filters to restore the feed.</p>
      </div>
    );
  }

  return (
    <div aria-label="Matched alerts" className={styles.alertList}>
      {alerts.map((alert) => {
        const isSelected = alert.id === selectedId;
        const signalLabel = getAlertsV2SignalLabel(alert.signal);
        const identity = alert.ticker ?? "MARKET";

        return (
          <button
            aria-label={`${alert.unread ? "Unread" : "Read"} alert for ${identity}: ${alert.headline}`}
            aria-current={isSelected ? "true" : undefined}
            className={`${styles.alertItem}${isSelected ? ` ${styles.selectedAlert}` : ""}`}
            key={alert.id}
            onClick={(event) => onSelect(alert, event.currentTarget)}
            type="button"
          >
            <span className={styles.alertState}>
              <i aria-hidden="true" className={alert.unread ? styles.unreadDot : styles.readDot} />
              <span className={styles.srOnly}>{alert.unread ? "Unread" : "Read"}</span>
            </span>

            <time className={styles.alertTime}>{alert.time}<small>ET</small></time>

            <div className={styles.alertIdentity}>
              {alert.ticker ? <MarketTickerLogo size="desktop" ticker={alert.ticker} /> : <span className={styles.marketMonogram}>M</span>}
              <span>
                <strong>{identity}</strong>
                <small>{alert.company ?? "All-market condition"}</small>
              </span>
            </div>

            <div className={styles.alertContent}>
              <div className={styles.alertHeadlineLine}>
                <AlertsV2EventBadge eventType={alert.eventType} />
                <strong>{alert.headline}</strong>
              </div>
              <p>{alert.summary}</p>
              <span className={styles.mobileRule}>Rule: {alert.matchedRule}</span>
            </div>

            <div className={styles.alertMetadata}>
              <MarketImpactLabel impact={alert.impact} size="compact" />
              <span className={`${styles.signal} ${styles[`signal-${alert.signal}`]}`}>
                {signalLabel}
              </span>
              <small title={alert.matchedRule}>{alert.matchedRule}</small>
            </div>
          </button>
        );
      })}
    </div>
  );
}
