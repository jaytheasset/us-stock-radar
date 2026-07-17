import { MarketImpactLabel } from "@/components/market/MarketImpactLabel";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { Pagination } from "@/components/ui/Pagination";
import type { AlertsV2Alert } from "@/lib/mock/alertsV2Data";
import { AlertsV2EventBadge } from "./AlertsV2EventBadge";
import styles from "./StockRadarAlertsV2.module.css";

const pageSize = 4;

export function AlertsV2History({
  alerts,
  currentPage,
  onPageChange,
  onSelect,
}: {
  alerts: readonly AlertsV2Alert[];
  currentPage: number;
  onPageChange: (page: number) => void;
  onSelect: (alert: AlertsV2Alert, opener: HTMLElement) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(alerts.length / pageSize));
  const visibleAlerts = alerts.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const groups = visibleAlerts.reduce<Record<string, AlertsV2Alert[]>>((result, alert) => {
    (result[alert.dateGroup] ??= []).push(alert);
    return result;
  }, {});

  return (
    <section aria-labelledby="alerts-v2-history-title" className={styles.modePanel}>
      <header className={styles.modePanelHeader}>
        <div>
          <span>LOCAL HISTORY</span>
          <h2 id="alerts-v2-history-title">Alert History</h2>
          <p>Read and past deterministic alerts grouped by ET date.</p>
        </div>
        <span>Page {currentPage} of {totalPages}</span>
      </header>

      <div className={styles.historyGroups}>
        {Object.entries(groups).map(([date, groupAlerts]) => (
          <section className={styles.historyGroup} key={date}>
            <h3>{date}</h3>
            <div>
              {groupAlerts.map((alert) => (
                <button
                  aria-label={`Open history alert: ${alert.headline}`}
                  className={styles.historyItem}
                  key={alert.id}
                  onClick={(event) => onSelect(alert, event.currentTarget)}
                  type="button"
                >
                  <time>{alert.time}<small>ET</small></time>
                  <div className={styles.historyIdentity}>
                    {alert.ticker ? <MarketTickerLogo size="mobile" ticker={alert.ticker} /> : <span className={styles.marketMonogram}>M</span>}
                    <span><strong>{alert.ticker ?? "MARKET"}</strong><small>{alert.company ?? "All-market condition"}</small></span>
                  </div>
                  <AlertsV2EventBadge eventType={alert.eventType} />
                  <strong className={styles.historyHeadline}>{alert.headline}</strong>
                  <MarketImpactLabel impact={alert.impact} size="compact" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <footer className={styles.historyFooter}>
        <span>{alerts.length} mock history items</span>
        <Pagination
          ariaLabel="Alert history pagination"
          currentPage={currentPage}
          items={Array.from({ length: totalPages }, (_, index) => index + 1)}
          onPageChange={onPageChange}
          totalPages={totalPages}
        />
      </footer>
    </section>
  );
}
