import type { RefObject } from "react";
import { Clock3, FileText, Radio, ShieldCheck } from "lucide-react";
import { MarketImpactLabel } from "@/components/market/MarketImpactLabel";
import { MarketTickerLogo } from "@/components/market/MarketTickerLogo";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { DetailPanelShell } from "@/components/ui/DetailPanelShell";
import {
  getAlertsV2SignalLabel,
  type AlertsV2Alert,
} from "@/lib/mock/alertsV2Data";
import { AlertsV2EventBadge } from "./AlertsV2EventBadge";
import styles from "./StockRadarAlertsV2.module.css";

export function AlertsV2DetailContent({
  alert,
  onToggleRead,
}: {
  alert: AlertsV2Alert;
  onToggleRead: (alertId: string) => void;
}) {
  const signalLabel = getAlertsV2SignalLabel(alert.signal);

  return (
    <div className={styles.detailContent}>
      <header className={styles.detailHeader}>
        <div className={styles.detailIdentity}>
          {alert.ticker ? (
            <MarketTickerLogo size="detail" ticker={alert.ticker} />
          ) : (
            <span className={styles.detailMarketMonogram}>M</span>
          )}
          <div>
            <span>{alert.ticker ?? "MARKET"}</span>
            <small>{alert.company ?? "All-market condition"}</small>
          </div>
        </div>
        <button className={styles.readAction} onClick={() => onToggleRead(alert.id)} type="button">
          Mark as {alert.unread ? "read" : "unread"}
        </button>
      </header>

      <div className={styles.detailBadgeRow}>
        <AlertsV2EventBadge eventType={alert.eventType} size="large" />
        <MarketImpactLabel impact={alert.impact} />
        <span className={`${styles.signal} ${styles[`signal-${alert.signal}`]}`}>
          {signalLabel}
        </span>
      </div>

      <section className={styles.detailSection}>
        <span className={styles.detailSectionLabel}>Matched alert</span>
        <h2>{alert.headline}</h2>
        <p>{alert.summary}</p>
      </section>

      <dl className={styles.detailFacts}>
        <div>
          <dt><Clock3 aria-hidden="true" size={15} />Triggered</dt>
          <dd>{alert.timestampLabel}</dd>
        </div>
        <div>
          <dt><ShieldCheck aria-hidden="true" size={15} />Matched rule</dt>
          <dd>{alert.matchedRule}</dd>
        </div>
        <div>
          <dt><Radio aria-hidden="true" size={15} />Scope</dt>
          <dd>{alert.scope === "watchlist" ? "Watchlist" : "All Market"}</dd>
        </div>
        <div>
          <dt><FileText aria-hidden="true" size={15} />Source</dt>
          <dd>{alert.source}</dd>
        </div>
      </dl>

      <div className={styles.detailNotice}>
        Deterministic UI fixture only. No live filing analysis, alert delivery, or trading conclusion is connected.
      </div>
      <button className={styles.mockAnalysisButton} disabled type="button">
        Related analysis unavailable in mock
      </button>
    </div>
  );
}

export function AlertsV2DetailPanel({
  alert,
  onToggleRead,
}: {
  alert?: AlertsV2Alert;
  onToggleRead: (alertId: string) => void;
}) {
  if (!alert) {
    return null;
  }

  return (
    <DetailPanelShell aria-label={`${alert.ticker ?? "Market"} alert detail`} className={styles.detailPanel}>
      <AlertsV2DetailContent alert={alert} onToggleRead={onToggleRead} />
    </DetailPanelShell>
  );
}

export function MobileAlertsV2DetailSheet({
  alert,
  isOpen,
  onClose,
  onToggleRead,
  openerRef,
}: {
  alert?: AlertsV2Alert;
  isOpen: boolean;
  onClose: () => void;
  onToggleRead: (alertId: string) => void;
  openerRef: RefObject<HTMLElement | null>;
}) {
  return (
    <BottomSheetShell
      aria-label={alert ? `${alert.ticker ?? "Market"} alert detail` : "Alert detail"}
      closeLabel="Close alert detail"
      id="alerts-v2-detail-sheet"
      isOpen={Boolean(isOpen && alert)}
      layout="full-scroll"
      onDismiss={onClose}
      openerRef={openerRef}
      overlayLabel="Close alert detail"
    >
      {alert ? <AlertsV2DetailContent alert={alert} onToggleRead={onToggleRead} /> : null}
    </BottomSheetShell>
  );
}
